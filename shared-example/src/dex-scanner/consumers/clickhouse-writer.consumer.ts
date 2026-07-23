import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Consumer, Kafka } from 'kafkajs';
import { ClickhouseService } from '../clickhouse.service';
import { KafkaService } from '../kafka.service';
import { SwapEvent, TOPICS } from '../types';

@Injectable()
export class ClickhouseWriterConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClickhouseWriterConsumer.name);
  private consumer: Consumer;

  private batch: SwapEvent[] = [];
  private flushIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly BATCH_SIZE = 1000;
  private readonly FLUSH_INTERVAL_MS = 1000;

  constructor(
    private readonly kafkaService: KafkaService,
    private readonly clickhouseService: ClickhouseService,
  ) {
    const kafka: Kafka = kafkaService.getKafka();
    this.consumer = kafka.consumer({
      groupId: 'clickhouse-writers',
      maxWaitTimeInMs: 1000,
      minBytes: 1024 * 1024,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.kafkaService.ready;
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: TOPICS.SWAP_EVENTS,
      fromBeginning: false,
    });

    this.flushIntervalId = setInterval(() => {
      void this.flushBatch();
    }, this.FLUSH_INTERVAL_MS);

    await this.consumer.run({
      partitionsConsumedConcurrently: 3,
      eachMessage: async ({ partition, message }) => {
        const raw = message.value?.toString();
        if (!raw) return;

        const event = JSON.parse(raw) as SwapEvent;
        this.batch.push(event);

        this.logger.debug(
          `[clickhouse-writers] partition=${partition} buffered tx=${event.tx_hash} (batch size: ${this.batch.length})`,
        );

        if (this.batch.length >= this.BATCH_SIZE) {
          await this.flushBatch();
        }
      },
    });

    this.logger.log('[clickhouse-writers] Consumer group started — subscribed to swap_events');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.flushIntervalId) clearInterval(this.flushIntervalId);
    await this.flushBatch();
    await this.consumer.disconnect();
  }

  private async flushBatch(): Promise<void> {
    if (this.batch.length === 0) return;

    const toInsert = this.batch.splice(0);

    await this.clickhouseService.getClient().insert({
      table: 'swap_events',
      values: toInsert,
      format: 'JSONEachRow',
    });

    this.logger.log(`[clickhouse-writers] INSERT INTO swap_events — ${toInsert.length} rows`);
  }

  async getInsertedCount(): Promise<number> {
    const result = await this.clickhouseService.getClient().query({
      query: 'SELECT count() AS cnt FROM swap_events',
      format: 'JSONEachRow',
    });
    const rows = await result.json<{ cnt: string }>();
    return parseInt(rows[0]?.cnt ?? '0', 10);
  }
}
