import { Controller, Get, Post } from '@nestjs/common';
import { ClickhouseWriterConsumer } from './consumers/clickhouse-writer.consumer';
import { PoolRegistryConsumer } from './consumers/pool-registry.consumer';
import { RedisWriterConsumer } from './consumers/redis-writer.consumer';
import { MockScannerService } from './mock-scanner.service';

@Controller('dex-scanner')
export class DexScannerController {
  constructor(
    private readonly scanner: MockScannerService,
    private readonly redisWriter: RedisWriterConsumer,
    private readonly clickhouseWriter: ClickhouseWriterConsumer,
    private readonly poolRegistry: PoolRegistryConsumer,
  ) {}

  @Post('start')
  start(): { message: string } {
    this.scanner.startScanning();
    return { message: 'Scanner started — emitting swap events every 500ms, new pools every 10s' };
  }

  @Post('stop')
  stop(): { message: string } {
    this.scanner.stopScanning();
    return { message: 'Scanner stopped' };
  }

  // Shows current state of the mocked Redis (latest prices per pool)
  @Get('redis-state')
  getRedisState(): Record<string, string> {
    return this.redisWriter.getMockRedisState();
  }

  @Get('clickhouse-stats')
  async getClickhouseStats(): Promise<{ inserted_rows: number }> {
    return { inserted_rows: await this.clickhouseWriter.getInsertedCount() };
  }

  // Shows all pools registered via token_created events
  @Get('pool-registry')
  getPoolRegistry() {
    return { pools: this.poolRegistry.getRegisteredPools() };
  }
}
