import { Module } from '@nestjs/common';
import { ElasticsearchService } from './elasticsearch.service';
import { SearchController } from './search.controller';

@Module({
  controllers: [SearchController],
  providers: [ElasticsearchService],
})
export class SearchModule {}
