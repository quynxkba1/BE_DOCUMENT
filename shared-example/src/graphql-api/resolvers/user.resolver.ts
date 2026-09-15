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
import type { GraphQLContext } from '../context';
import { CreateUserInput } from '../dto/create-user.input';
import { Order } from '../models/order.model';
import { User } from '../models/user.model';
import { toGraphQLOrders } from '../order.mapper';

@Resolver(() => User)
export class UserResolver {
  constructor(private readonly prisma: PrismaService) {}

  @Query(() => [User])
  users(
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 20 })
    limit: number,
    @Args('offset', { type: () => Int, nullable: true, defaultValue: 0 })
    offset: number,
  ): Promise<User[]> {
    return this.prisma.user.findMany({ take: limit, skip: offset });
  }

  @Query(() => User, { nullable: true })
  user(@Args('id', { type: () => Int }) id: number): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  @Mutation(() => User)
  createUser(@Args('input') input: CreateUserInput): Promise<User> {
    return this.prisma.user.create({ data: input });
  }

  // Only runs when a query actually asks for `orders` on a User — this is
  // GraphQL resolving a relation on demand instead of always joining like SQL.
  // Goes through the request-scoped DataLoader so N users in one query still
  // issue a single batched `findMany` instead of N separate queries.
  @ResolveField(() => [Order])
  async orders(
    @Parent() user: User,
    @Context() ctx: GraphQLContext,
  ): Promise<Order[]> {
    const orders = await ctx.loaders.ordersByUserId.load(user.id);
    return toGraphQLOrders(orders);
  }
}
