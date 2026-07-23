import { Module } from '@nestjs/common';
import { ClickhouseWriterConsumer } from './consumers/clickhouse-writer.consumer';
import { PoolRegistryConsumer } from './consumers/pool-registry.consumer';
import { RedisWriterConsumer } from './consumers/redis-writer.consumer';
import { DexScannerController } from './dex-scanner.controller';
import { ClickhouseService } from './clickhouse.service';
import { KafkaService } from './kafka.service';
import { MockScannerService } from './mock-scanner.service';

@Module({
  controllers: [DexScannerController],
  providers: [
    KafkaService,
    ClickhouseService,
    MockScannerService,
    RedisWriterConsumer,
    ClickhouseWriterConsumer,
    PoolRegistryConsumer,
  ],
})
export class DexScannerModule {}
