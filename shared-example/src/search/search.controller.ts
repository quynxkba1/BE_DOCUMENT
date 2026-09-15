import { Controller, Get, Post, Query } from '@nestjs/common';
import { ElasticsearchService, SearchHit } from './elasticsearch.service';

@Controller('search')
export class SearchController {
  constructor(private readonly elasticsearchService: ElasticsearchService) {}

  @Post('seed')
  async seed(): Promise<{ indexed: number }> {
    return this.elasticsearchService.seed();
  }

  // e.g. GET /search/query?q=runing shoe&category=footwear&minPrice=50&maxPrice=100
  @Get('query')
  async search(
    @Query('q') q: string,
    @Query('category') category?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
  ): Promise<SearchHit[]> {
    return this.elasticsearchService.search(q, {
      category,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
    });
  }

  // e.g. GET /search/autocomplete?q=run
  @Get('autocomplete')
  async autocomplete(@Query('q') q: string): Promise<string[]> {
    return this.elasticsearchService.autocomplete(q);
  }

  @Get('facets')
  async facets(): Promise<Record<string, number>> {
    return this.elasticsearchService.facets();
  }
}
