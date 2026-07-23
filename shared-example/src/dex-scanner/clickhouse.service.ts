import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createClient, ClickHouseClient } from '@clickhouse/client';

@Injectable()
export class ClickhouseService implements OnModuleInit {
  private readonly logger = new Logger(ClickhouseService.name);
  private readonly client: ClickHouseClient;

  constructor() {
    this.client = createClient({
      url: 'http://localhost:8123',
      database: 'dex_scanner',
      username: 'default',
      password: '',
    });
  }

  async onModuleInit(): Promise<void> {
    await this.ensureTable();
    this.logger.log('ClickHouse ready — swap_events table exists');
  }

  getClient(): ClickHouseClient {
    return this.client;
  }

  private async ensureTable(): Promise<void> {
    await this.client.command({
      query: `
        CREATE TABLE IF NOT EXISTS swap_events (
          pool_address  LowCardinality(String),
          source        LowCardinality(String),
          chain_id      UInt32,
          block_number  UInt64,
          price         Float64,
          amount_in     String,
          amount_out    String,
          wallet        String,
          tx_hash       String,
          direction     LowCardinality(String),
          timestamp     DateTime
        )
        ENGINE = ReplacingMergeTree()
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (pool_address, timestamp)
      `,
    });
  }
}
