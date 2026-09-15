import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthUser, GraphQLContext } from '../context';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser | undefined => {
    const { req } =
      GqlExecutionContext.create(context).getContext<GraphQLContext>();
    return req.user;
  },
);
