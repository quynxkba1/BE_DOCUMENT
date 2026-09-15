import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PartitioningService } from './partitioning.service';

@Module({
  providers: [PrismaService, PartitioningService],
  exports: [PartitioningService, PrismaService],
})
export class PartitioningModule {}
