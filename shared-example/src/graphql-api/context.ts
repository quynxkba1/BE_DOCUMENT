import type { Request } from 'express';
import { GraphQLLoaders } from './loaders';

export interface AuthUser {
  sub: number;
  email: string;
}

export interface GraphQLContext {
  req: Request & { user?: AuthUser };
  loaders: GraphQLLoaders;
}
