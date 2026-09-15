import { Field, Float, InputType } from '@nestjs/graphql';

@InputType()
export class CreateOrderInput {
  @Field()
  status: string;

  @Field(() => Float)
  totalAmount: number;
}
