import { UseGuards } from '@nestjs/common';
import {
  Args,
  Context,
  Int,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { PrismaService } from '../../database-indexing/prisma.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import type { AuthUser, GraphQLContext } from '../context';
import { CreateOrderInput } from '../dto/create-order.input';
import { Order } from '../models/order.model';
import { User } from '../models/user.model';
import { toGraphQLOrder, toGraphQLOrders } from '../order.mapper';

@Resolver(() => Order)
export class OrderResolver {
  constructor(private readonly prisma: PrismaService) {}

  // Mirrors indexing.service.ts's findOrdersByUser / findPaidOrdersSince —
  // the same indexed SQL predicates, exposed as GraphQL query arguments.
  @Query(() => [Order])
  async orders(
    @Args('userId', { type: () => Int, nullable: true }) userId?: number,
    @Args('status', { nullable: true }) status?: string,
    @Args('since', { nullable: true }) since?: Date,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 20 })
    limit?: number,
    @Args('offset', { type: () => Int, nullable: true, defaultValue: 0 })
    offset?: number,
  ): Promise<Order[]> {
    const orders = await this.prisma.order.findMany({
      where: {
        ...(userId !== undefined && { userId }),
        ...(status !== undefined && { status }),
        ...(since !== undefined && { createdAt: { gte: since } }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
    return toGraphQLOrders(orders);
  }

  @Query(() => Order, { nullable: true })
  async order(
    @Args('id', { type: () => Int }) id: number,
  ): Promise<Order | null> {
    const order = await this.prisma.order.findUnique({ where: { id } });
    return order ? toGraphQLOrder(order) : null;
  }

  // Requires a bearer token (see AuthResolver.login) — the order is created
  // for the calling user, not whichever userId a client might pass in.
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Order)
  async createOrder(
    @Args('input') input: CreateOrderInput,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<Order> {
    const order = await this.prisma.order.create({
      data: { ...input, userId: currentUser.sub },
    });
    return toGraphQLOrder(order);
  }

  @UseGuards(GqlAuthGuard)
  @Mutation(() => Order)
  async updateOrderStatus(
    @Args('id', { type: () => Int }) id: number,
    @Args('status') status: string,
  ): Promise<Order> {
    const order = await this.prisma.order.update({
      where: { id },
      data: { status },
    });
    return toGraphQLOrder(order);
  }

  // Only runs when a query actually asks for `user` on an Order — routed
  // through the DataLoader so a list of orders batches into one user query.
  @ResolveField(() => User)
  user(
    @Parent() order: Order,
    @Context() ctx: GraphQLContext,
  ): Promise<User | null> {
    return ctx.loaders.userById.load(order.userId);
  }
}
