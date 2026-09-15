import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import type { Request } from 'express';
import depthLimit from 'graphql-depth-limit';
import { join } from 'path';
import { IndexingModule } from '../database-indexing/indexing.module';
import { PrismaService } from '../database-indexing/prisma.service';
import { createLoaders } from './loaders';
import { AuthResolver } from './resolvers/auth.resolver';
import { OrderResolver } from './resolvers/order.resolver';
import { UserResolver } from './resolvers/user.resolver';

@Module({
  imports: [
    IndexingModule,
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [IndexingModule],
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => ({
        // Generates schema.gql from the @ObjectType/@Field decorators on save
        autoSchemaFile: join(process.cwd(), 'src/graphql-api/schema.gql'),
        sortSchema: true,
        // Rejects queries nested more than 5 levels deep — a cheap guard
        // against abusive/expensive queries before they hit any resolver.
        validationRules: [depthLimit(5)],
        // Fresh DataLoader instances per request so batched results never
        // leak between requests, plus the raw req for the auth guard.
        context: ({ req }: { req: Request }) => ({
          req,
          loaders: createLoaders(prisma),
        }),
      }),
    }),
  ],
  providers: [UserResolver, OrderResolver, AuthResolver],
})
export class GraphqlApiModule {}
