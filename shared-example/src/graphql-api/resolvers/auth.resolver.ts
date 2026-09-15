import { NotFoundException } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { PrismaService } from '../../database-indexing/prisma.service';
import { signToken } from '../auth/jwt';
import { AuthPayload } from '../models/auth-payload.model';

@Resolver()
export class AuthResolver {
  constructor(private readonly prisma: PrismaService) {}

  // Demo-only: issues a token for any existing user's email, no password check.
  // A real app would verify a hashed password (or an external IdP) here.
  @Mutation(() => AuthPayload)
  async login(@Args('email') email: string): Promise<AuthPayload> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new NotFoundException(`No user with email ${email}`);
    }
    const token = signToken({ sub: user.id, email: user.email });
    return { token, user };
  }
}
