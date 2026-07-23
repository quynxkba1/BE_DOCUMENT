import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class IndexingService {
  constructor(private readonly prisma: PrismaService) {}

  // Uses unique index on email — Index Scan instead of Seq Scan
  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  // Uses unique index on email — case-insensitive via Prisma insensitive mode
  findByEmailCaseInsensitive(email: string) {
    return this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
  }

  // Uses idx_orders_user_id_created_at — composite index (userId + createdAt)
  findOrdersByUser(userId: number) {
    return this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Uses idx_orders_status_created_at — composite index (status + createdAt)
  findPaidOrdersSince(since: Date) {
    return this.prisma.order.findMany({
      where: { status: 'paid', createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Uses idx_orders_user_id_created_at — partial query on composite index
  findStalePendingOrders(olderThan: Date) {
    return this.prisma.order.findMany({
      where: { status: 'pending', createdAt: { lt: olderThan } },
    });
  }

  // SELECT only userId, status, totalAmount — matches covering index columns
  findUserOrderSummary(userId: number) {
    return this.prisma.order.findMany({
      where: { userId },
      select: { userId: true, status: true, totalAmount: true },
    });
  }

  // Shows EXPLAIN ANALYZE output — useful during development to verify index usage
  async explainQuery(email: string): Promise<string> {
    const result = await this.prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN ANALYZE SELECT * FROM users WHERE email = $1`,
      email,
    );
    return result.map((row) => row['QUERY PLAN']).join('\n');
  }

  // Lists all indexes on a table — useful for auditing
  async listIndexes(tableName: string): Promise<{ indexname: string; indexdef: string }[]> {
    return this.prisma.$queryRawUnsafe(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1`,
      tableName,
    );
  }

  // Finds indexes with zero scans — candidates for removal
  async findUnusedIndexes(): Promise<{ tablename: string; indexname: string; idx_scan: bigint }[]> {
    return this.prisma.$queryRaw`
      SELECT schemaname, tablename, indexname, idx_scan
      FROM pg_stat_user_indexes
      WHERE idx_scan = 0
        AND indexname NOT LIKE '%pkey%'
      ORDER BY tablename
    `;
  }
}
