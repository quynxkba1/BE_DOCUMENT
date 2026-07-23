export interface TokenCreatedEvent {
  pool_address: string;
  token0: string;
  token1: string;
  source: 'bonding_curve' | 'dex_pool';
  chain_id: number;
  block_number: number;
  timestamp: number;
}

export interface SwapEvent {
  pool_address: string;
  price: number;
  amount_in: string;
  amount_out: string;
  direction: 'buy' | 'sell';
  wallet: string;
  tx_hash: string;
  block_number: number;
  timestamp: number;
  source: 'bonding_curve' | 'dex_pool';
  chain_id: number;
}

export const TOPICS = {
  TOKEN_CREATED: 'token_created',
  SWAP_EVENTS: 'swap_events',
} as const;
