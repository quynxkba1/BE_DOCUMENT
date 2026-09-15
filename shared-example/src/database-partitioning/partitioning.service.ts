import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Only ever built from validated year/month integers (see ensureMonthlyPartition)
// or checked against this pattern (see dropPartition) before being interpolated
// into DDL — Postgres doesn't allow $1-style parameters in PARTITION OF bounds
// or table names, so raw DDL is the only option here.
const PARTITION_NAME_PATTERN = /^swap_events_\d{4}_\d{2}$/;

@Injectable()
export class PartitioningService {
  constructor(private readonly prisma: PrismaService) {}

  // Assumes swap_events has already been retrofitted into a partitioned table
  // (see examples.sql section 1). Must run before a given month starts receiving
  // inserts, otherwise those inserts fail with "no partition found for row".
  async ensureMonthlyPartition(year: number, month: number): Promise<string> {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('invalid year');
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('invalid month');
    }

    const partitionName = `swap_events_${year}_${String(month).padStart(2, '0')}`;
    const rangeStart = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
    const rangeEnd = new Date(
      Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1),
    )
      .toISOString()
      .slice(0, 10);

    await this.prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS ${partitionName} PARTITION OF swap_events
       FOR VALUES FROM ('${rangeStart}') TO ('${rangeEnd}')`,
    );

    return partitionName;
  }

  // Lists every physical partition currently attached to swap_events.
  listPartitions(): Promise<{ partition_name: string; partition_range: string }[]> {
    return this.prisma.$queryRaw`
      SELECT
        child.relname AS partition_name,
        pg_get_expr(child.relpartbound, child.oid) AS partition_range
      FROM pg_inherits
      JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
      JOIN pg_class child  ON pg_inherits.inhrelid  = child.oid
      WHERE parent.relname = 'swap_events'
      ORDER BY partition_name
    `;
  }

  // Confirms pruning: the plan should only ever mention one partition for a
  // query that filters on block_timestamp within a single month.
  async explainPruning(pairAddress: string, from: Date, to: Date): Promise<string> {
    const result = await this.prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN ANALYZE
       SELECT * FROM swap_events
       WHERE pair_address = $1 AND block_timestamp >= $2 AND block_timestamp < $3`,
      pairAddress,
      from,
      to,
    );
    return result.map((row) => row['QUERY PLAN']).join('\n');
  }

  // Instant retention cleanup — drops a whole month instead of a row-by-row
  // DELETE, which would scan and mark millions of rows dead.
  async dropPartition(partitionName: string): Promise<void> {
    if (!PARTITION_NAME_PATTERN.test(partitionName)) {
      throw new BadRequestException('invalid partition name');
    }
    await this.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${partitionName}`);
  }
}
