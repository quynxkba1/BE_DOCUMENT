import DataLoader from 'dataloader';
import { PrismaService } from '../database-indexing/prisma.service';
import type {
  Order as PrismaOrderRow,
  User as PrismaUserRow,
} from '../../generated/prisma';

export interface GraphQLLoaders {
  userById: DataLoader<number, PrismaUserRow | null>;
  ordersByUserId: DataLoader<number, PrismaOrderRow[]>;
}

// One set of loaders per request — batches every User.orders / Order.user
// lookup fired within that request into a single findMany() instead of one
// query per parent (the classic GraphQL N+1 problem).
export function createLoaders(prisma: PrismaService): GraphQLLoaders {
  return {
    userById: new DataLoader(async (ids: readonly number[]) => {
      const users = await prisma.user.findMany({
        where: { id: { in: [...ids] } },
      });
      const byId = new Map(users.map((user) => [user.id, user]));
      return ids.map((id) => byId.get(id) ?? null);
    }),

    ordersByUserId: new DataLoader(async (userIds: readonly number[]) => {
      const orders = await prisma.order.findMany({
        where: { userId: { in: [...userIds] } },
      });
      const byUserId = new Map<number, PrismaOrderRow[]>();
      for (const order of orders) {
        const existing = byUserId.get(order.userId) ?? [];
        existing.push(order);
        byUserId.set(order.userId, existing);
      }
      return userIds.map((id) => byUserId.get(id) ?? []);
    }),
  };
}
