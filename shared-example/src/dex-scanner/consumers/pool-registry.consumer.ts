import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Consumer, Kafka } from 'kafkajs';
import { KafkaService } from '../kafka.service';
import { TokenCreatedEvent, TOPICS } from '../types';

// Mocked pool registry consumer.
// In production: insert the new pool into PostgreSQL pools table,
// then signal the scanner to reload its subscription list.
@Injectable()
export class PoolRegistryConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PoolRegistryConsumer.name);
  private consumer: Consumer;

  // Simulated PostgreSQL pools table
  private readonly mockPoolsTable: TokenCreatedEvent[] = [];

  constructor(private readonly kafkaService: KafkaService) {
    const kafka: Kafka = kafkaService.getKafka();
    this.consumer = kafka.consumer({ groupId: 'pool-registry-writers' });
  }

  async onModuleInit(): Promise<void> {
    await this.kafkaService.ready;
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: TOPICS.TOKEN_CREATED,
      fromBeginning: true, // always replay from start — pool registry must be complete
    });

    await this.consumer.run({
      eachMessage: async ({ partition, message }) => {
        const raw = message.value?.toString();
        if (!raw) return;

        const event = JSON.parse(raw) as TokenCreatedEvent;
        await this.registerPool(event, partition);
      },
    });

    this.logger.log('[pool-registry-writers] Consumer group started — subscribed to token_created');
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect();
  }

  private async registerPool(event: TokenCreatedEvent, partition: number): Promise<void> {
    const alreadyExists = this.mockPoolsTable.some(
      (p) => p.pool_address === event.pool_address,
    );

    if (alreadyExists) {
      // at-least-once delivery means we may see the same event twice
      // idempotent check prevents duplicate registration
      this.logger.debug(`[pool-registry] Pool already registered: ${event.pool_address}`);
      return;
    }

    // MOCK: in production this would be:
    //   await db.query(
    //     `INSERT INTO pools (address, token0, token1, source, chain_id)
    //      VALUES ($1, $2, $3, $4, $5)
    //      ON CONFLICT (address) DO NOTHING`,
    //     [event.pool_address, event.token0, event.token1, event.source, event.chain_id]
    //   );
    //   await redis.set(`registry:${event.chain_id}:pools:updated`, Date.now());
    this.mockPoolsTable.push(event);

    this.logger.log(
      `[pool-registry] partition=${partition} MOCK INSERT pools: ${event.pool_address} ` +
      `(${event.token0}/${event.token1}, source: ${event.source}) — total: ${this.mockPoolsTable.length}`,
    );
  }

  getRegisteredPools(): TokenCreatedEvent[] {
    return this.mockPoolsTable;
  }
}
