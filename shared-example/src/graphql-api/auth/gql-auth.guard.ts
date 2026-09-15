import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { GraphQLContext } from '../context';
import { verifyToken } from './jwt';

// Protects mutations that act on behalf of a user, e.g. createOrder.
// Expects `Authorization: Bearer <token>` — obtain a token via the `login` mutation.
@Injectable()
export class GqlAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { req } =
      GqlExecutionContext.create(context).getContext<GraphQLContext>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length)
      : undefined;
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      req.user = verifyToken(token);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
