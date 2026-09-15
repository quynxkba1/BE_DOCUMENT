import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';
import { User } from './user.model';

@ObjectType()
export class Order {
  @Field(() => ID)
  id: number;

  @Field(() => Int)
  userId: number;

  @Field()
  status: string;

  @Field(() => Float)
  totalAmount: number;

  @Field()
  createdAt: Date;

  // Populated by OrderResolver.user() only when a query selects this field
  @Field(() => User)
  user?: User;
}
