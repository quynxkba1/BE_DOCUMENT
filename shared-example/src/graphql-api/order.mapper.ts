import { Order } from './models/order.model';

type PrismaOrder = { totalAmount: { toNumber(): number } } & Record<
  string,
  unknown
>;

// Prisma's Decimal type doesn't map to GraphQL's Float — convert explicitly.
export function toGraphQLOrder(order: PrismaOrder): Order {
  return { ...order, totalAmount: order.totalAmount.toNumber() } as Order;
}

export function toGraphQLOrders(orders: PrismaOrder[]): Order[] {
  return orders.map(toGraphQLOrder);
}
