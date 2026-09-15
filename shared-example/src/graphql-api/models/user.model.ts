import { Field, ID, ObjectType } from '@nestjs/graphql';
import { Order } from './order.model';

@ObjectType()
export class User {
  @Field(() => ID)
  id: number;

  @Field()
  name: string;

  @Field()
  email: string;

  @Field()
  isActive: boolean;

  @Field()
  createdAt: Date;

  // Populated by UserResolver.orders() only when a query selects this field
  @Field(() => [Order])
  orders?: Order[];
}
