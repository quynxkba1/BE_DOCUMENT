import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { Product, PRODUCTS_INDEX, SAMPLE_PRODUCTS } from './types';

export interface SearchFilters {
  category?: string;
  minPrice?: number;
  maxPrice?: number;
}

export interface SearchHit extends Product {
  score: number;
}

@Injectable()
export class ElasticsearchService implements OnModuleInit {
  private readonly logger = new Logger(ElasticsearchService.name);
  private readonly client = new Client({ node: 'http://localhost:9200' });

  async onModuleInit(): Promise<void> {
    await this.ensureIndex();
    this.logger.log(`Elasticsearch ready — "${PRODUCTS_INDEX}" index exists`);
  }

  private async ensureIndex(): Promise<void> {
    const exists = await this.client.indices.exists({ index: PRODUCTS_INDEX });
    if (exists) return;

    await this.client.indices.create({
      index: PRODUCTS_INDEX,
      settings: {
        analysis: {
          // Splits "shoes" into "s", "sh", "sho", "shoe", "shoes" at index time,
          // so a partial prefix like "sho" can match at query time (autocomplete).
          tokenizer: {
            autocomplete_tokenizer: {
              type: 'edge_ngram',
              min_gram: 1,
              max_gram: 20,
              token_chars: ['letter', 'digit'],
            },
          },
          analyzer: {
            autocomplete_analyzer: {
              type: 'custom',
              tokenizer: 'autocomplete_tokenizer',
              filter: ['lowercase'],
            },
          },
        },
      },
      mappings: {
        properties: {
          name: {
            type: 'text',
            fields: {
              // name.suggest -> indexed with edge n-grams, used for autocomplete
              suggest: {
                type: 'text',
                analyzer: 'autocomplete_analyzer',
                search_analyzer: 'standard',
              },
            },
          },
          description: { type: 'text' },
          category: { type: 'keyword' },
          price: { type: 'float' },
          tags: { type: 'keyword' },
        },
      },
    });
  }

  // Bulk-indexes the sample catalog. Idempotent — re-running just overwrites by id.
  async seed(): Promise<{ indexed: number }> {
    const operations = SAMPLE_PRODUCTS.flatMap((product) => [
      { index: { _index: PRODUCTS_INDEX, _id: product.id } },
      product,
    ]);

    await this.client.bulk({ refresh: true, operations });
    return { indexed: SAMPLE_PRODUCTS.length };
  }

  // Full-text relevance search, ranked by BM25, with optional structured filters.
  async search(
    query: string,
    filters: SearchFilters = {},
  ): Promise<SearchHit[]> {
    const filter: object[] = [];
    if (filters.category) filter.push({ term: { category: filters.category } });
    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      filter.push({
        range: {
          price: {
            ...(filters.minPrice !== undefined && { gte: filters.minPrice }),
            ...(filters.maxPrice !== undefined && { lte: filters.maxPrice }),
          },
        },
      });
    }

    const result = await this.client.search<Product>({
      index: PRODUCTS_INDEX,
      query: {
        bool: {
          must: {
            multi_match: {
              query,
              fields: ['name^3', 'description'], // name matches weighted 3x higher than description
              fuzziness: 'AUTO', // tolerates typos, e.g. "runing" still matches "running"
            },
          },
          filter,
        },
      },
    });

    return result.hits.hits.map((hit) => ({
      ...(hit._source as Product),
      score: hit._score ?? 0,
    }));
  }

  // Prefix search for as-you-type suggestions, powered by the edge-ngram field.
  async autocomplete(prefix: string): Promise<string[]> {
    const result = await this.client.search<Product>({
      index: PRODUCTS_INDEX,
      query: { match: { 'name.suggest': prefix } },
      size: 5,
    });

    return result.hits.hits.map((hit) => (hit._source as Product).name);
  }

  // Faceted search — counts per category, used to render filter sidebars.
  async facets(): Promise<Record<string, number>> {
    const result = await this.client.search({
      index: PRODUCTS_INDEX,
      size: 0,
      aggs: {
        by_category: { terms: { field: 'category' } },
      },
    });

    const buckets = (
      result.aggregations?.by_category as {
        buckets: { key: string; doc_count: number }[];
      }
    ).buckets;
    return Object.fromEntries(
      buckets.map((bucket) => [bucket.key, bucket.doc_count]),
    );
  }
}
