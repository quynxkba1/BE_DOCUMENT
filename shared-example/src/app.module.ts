import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DexScannerModule } from './dex-scanner/dex-scanner.module';
import { GraphqlApiModule } from './graphql-api/graphql-api.module';
import { RabbitmqModule } from './rabbitmq/rabbitmq.module';
import { SearchModule } from './search/search.module';

@Module({
  imports: [RabbitmqModule, DexScannerModule, SearchModule, GraphqlApiModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
