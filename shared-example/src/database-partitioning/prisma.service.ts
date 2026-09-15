import { PrismaPg } from '@prisma/adapter-pg';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    // Prisma 7 requires an explicit driver adapter instead of reading
    // DATABASE_URL implicitly from the schema's datasource block.
    super({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
