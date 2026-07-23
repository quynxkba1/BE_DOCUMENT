import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { IndexingService } from './indexing.service';

@Module({
  providers: [PrismaService, IndexingService],
  exports: [IndexingService],
})
export class IndexingModule {}
