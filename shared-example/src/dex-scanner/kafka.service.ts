import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Admin, CompressionTypes, ITopicConfig, Kafka, Producer } from 'kafkajs';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private readonly kafka: Kafka;
  private producer: Producer;
  private admin: Admin;

  // Resolves after topics are created and producer is connected.
  // Consumers await this because NestJS calls onModuleInit concurrently (Promise.all).
  private resolveReady!: () => void;
  readonly ready: Promise<void>;

  constructor() {
    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });

    this.kafka = new Kafka({
      clientId: 'dex-scanner',
      brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
      // In production add:
      // ssl: true,
      // sasl: { mechanism: 'plain', username, password }
    });

    this.producer = this.kafka.producer({
      allowAutoTopicCreation: false,
      // acks=all equivalent: set in each send() call
    });

    this.admin = this.kafka.admin();
  }

  async onModuleInit(): Promise<void> {
    await this.admin.connect();
    await this.ensureTopics([
      // Low volume: 3 partitions is enough for pool discovery events
      { topic: 'token_created', numPartitions: 3, replicationFactor: 1 },
      // High volume: 100 partitions → supports up to 100 parallel consumers at 2000 TPS
      { topic: 'swap_events', numPartitions: 100, replicationFactor: 1 },
    ]);
    await this.admin.disconnect();

    await this.producer.connect();
    this.resolveReady();
    this.logger.log('Kafka producer ready');
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer.disconnect();
  }

  async publish(topic: string, key: string, value: object): Promise<void> {
    await this.producer.send({
      topic,
      // GZIP compresses batches before sending → less network I/O at high TPS
      // In production prefer LZ4 (faster CPU) via kafkajs-lz4 package
      compression: CompressionTypes.GZIP,
      messages: [
        {
          key,
          value: JSON.stringify(value),
        },
      ],
      // acks: 1 = leader confirms (speed over durability — fine for price feed)
      // acks: -1 = all replicas confirm (use for token_created, never lose a pool)
    });
  }

  // Expose raw kafka instance so consumers can create their own consumer groups
  getKafka(): Kafka {
    return this.kafka;
  }

  private async ensureTopics(topics: ITopicConfig[]): Promise<void> {
    const existing = await this.admin.listTopics();
    const toCreate = topics.filter((t) => !existing.includes(t.topic));

    if (toCreate.length === 0) return;

    await this.admin.createTopics({ topics: toCreate });
    this.logger.log(`Created topics: ${toCreate.map((t) => t.topic).join(', ')}`);
  }
} 
