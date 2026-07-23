import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { KafkaService } from './kafka.service';
import { SwapEvent, TokenCreatedEvent, TOPICS } from './types';

// Simulates a blockchain scanner that listens to on-chain events.
// In production this would connect to a WebSocket RPC node and
// decode real smart contract events. Here we generate random data.
@Injectable()
export class MockScannerService implements OnModuleDestroy {
  private readonly logger = new Logger(MockScannerService.name);

  // Pool registry grows over time as new pools are discovered
  private readonly knownPools: string[] = [
    '0xAAA111',
    '0xBBB222',
    '0xCCC333',
  ];

  private swapIntervalId: ReturnType<typeof setInterval> | null = null;
  private poolIntervalId: ReturnType<typeof setInterval> | null = null;
  private blockNumber = 22_500_000;

  constructor(private readonly kafkaService: KafkaService) {}

  startScanning(): void {
    if (this.swapIntervalId) {
      this.logger.warn('Scanner already running');
      return;
    }

    this.logger.log('Mock scanner started — emitting swap events every 500ms');
    this.logger.log('Mock scanner started — emitting new pool every 10s');

    // Emit swap events every 500ms (simulates high-throughput chain activity)
    this.swapIntervalId = setInterval(() => {
      void this.emitSwapEvent();
    }, 500);

    // Emit a new pool creation every 10s (simulates bonding curve launches)
    this.poolIntervalId = setInterval(() => {
      void this.emitTokenCreatedEvent();
    }, 10_000);
  }

  stopScanning(): void {
    if (this.swapIntervalId) clearInterval(this.swapIntervalId);
    if (this.poolIntervalId) clearInterval(this.poolIntervalId);
    this.swapIntervalId = null;
    this.poolIntervalId = null;
    this.logger.log('Mock scanner stopped');
  }

  onModuleDestroy(): void {
    this.stopScanning();
  }

  private async emitSwapEvent(): Promise<void> {
    const pool = this.randomPool();
    const basePrice = 1800 + Math.random() * 100;
    const event: SwapEvent = {
      pool_address: pool,
      price: parseFloat(basePrice.toFixed(2)),
      amount_in: String(Math.floor(Math.random() * 1_000_000_000)),
      amount_out: String(Math.floor(Math.random() * 1_000_000_000)),
      direction: Math.random() > 0.5 ? 'buy' : 'sell',
      wallet: `0xWALLET_${Math.floor(Math.random() * 9999)}`,
      tx_hash: `0xTX_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
      block_number: ++this.blockNumber,
      timestamp: Math.floor(Date.now() / 1000),
      // Randomly simulate bonding curve vs DEX pool events
      source: Math.random() > 0.4 ? 'dex_pool' : 'bonding_curve',
      chain_id: 1,
    };

    // Partition key = pool_address → all events for same pool always go to same partition
    await this.kafkaService.publish(TOPICS.SWAP_EVENTS, pool, event);
    this.logger.debug(`[SCANNER] Emitted swap: pool=${pool} price=${event.price} dir=${event.direction}`);
  }

  private async emitTokenCreatedEvent(): Promise<void> {
    const newPool = `0xNEWPOOL_${Date.now()}`;
    this.knownPools.push(newPool); // scanner hot-reloads its subscription list

    const event: TokenCreatedEvent = {
      pool_address: newPool,
      token0: `0xTOKEN0_${Math.floor(Math.random() * 999)}`,
      token1: `0xUSDC`,
      source: Math.random() > 0.5 ? 'bonding_curve' : 'dex_pool',
      chain_id: 1,
      block_number: this.blockNumber,
      timestamp: Math.floor(Date.now() / 1000),
    };

    // Partition key = pool_address → new pools land in existing partitions automatically
    await this.kafkaService.publish(TOPICS.TOKEN_CREATED, newPool, event);
    this.logger.log(`[SCANNER] New pool discovered: ${newPool} (total known: ${this.knownPools.length})`);
  }

  private randomPool(): string {
    return this.knownPools[Math.floor(Math.random() * this.knownPools.length)];
  }
}
