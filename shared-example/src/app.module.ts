import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DexScannerModule } from './dex-scanner/dex-scanner.module';
import { RabbitmqModule } from './rabbitmq/rabbitmq.module';

@Module({
  imports: [RabbitmqModule, DexScannerModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
