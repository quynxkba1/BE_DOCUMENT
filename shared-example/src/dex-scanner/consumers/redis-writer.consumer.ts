import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Consumer, Kafka } from 'kafkajs';
import { KafkaService } from '../kafka.service';
import { SwapEvent, TOPICS } from '../types';

// Mocked Redis writer consumer.
// In production: import Redis from 'ioredis' and call redis.set(key, value).
// This consumer reads swap_events and writes the latest price per pool to Redis.
@Injectable()
export class RedisWriterConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisWriterConsumer.name);
  private consumer: Consumer;

  // Simulated in-memory Redis store (replace with real ioredis in production)
  private readonly mockRedis = new Map<string, string>();

  constructor(private readonly kafkaService: KafkaService) {
    const kafka: Kafka = kafkaService.getKafka();

    this.consumer = kafka.consumer({
      groupId: 'redis-writers',
      // Detect dead consumer in 6s (default: 30s) → faster partition rebalance
      sessionTimeout: 6000,
      heartbeatInterval: 2000,
      // Return messages immediately without waiting — critical for price feed latency
      // Default maxWaitTimeInMs is 5000ms (5s!) which would make prices 5s stale
      maxWaitTimeInMs: 5,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.kafkaService.ready;
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: TOPICS.SWAP_EVENTS,
      fromBeginning: false, // only process new events, not historical
    });

    await this.consumer.run({
      // Process up to 10 messages concurrently per partition
      partitionsConsumedConcurrently: 3,
      eachMessage: async ({ partition, message }) => {
        const raw = message.value?.toString();
        if (!raw) return;

        const event = JSON.parse(raw) as SwapEvent;
        await this.writeToRedis(event, partition);

        // Offset is auto-committed after eachMessage resolves.
        // If this throws, the message is retried (at-least-once delivery).
      },
    });

    this.logger.log('[redis-writers] Consumer group started — subscribed to swap_events');
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect();
  }

  private async writeToRedis(event: SwapEvent, partition: number): Promise<void> {
    const priceKey = `pair:${event.pool_address}:price`;
    const timeKey = `pair:${event.pool_address}:time`;

    // MOCK: in production this would be:
    //   await redis.set(priceKey, event.price.toString());
    //   await redis.set(timeKey, event.timestamp.toString());
    this.mockRedis.set(priceKey, event.price.toString());
    this.mockRedis.set(timeKey, event.timestamp.toString());

    this.logger.log(
      `[redis-writers] partition=${partition} SET ${priceKey} = ${event.price} (source: ${event.source})`,
    );
  }

  // Expose for controller to show current mock Redis state
  getMockRedisState(): Record<string, string> {
    return Object.fromEntries(this.mockRedis);
  }
}
