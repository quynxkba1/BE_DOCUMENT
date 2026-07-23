import { Body, Controller, Post } from '@nestjs/common';
import type { EmailJob } from './rabbitmq.service';
import { RabbitmqService } from './rabbitmq.service';

@Controller('rabbitmq')
export class RabbitmqController {
  constructor(private readonly rabbitmqService: RabbitmqService) {}

  @Post('email-jobs')
  publishEmailJob(
    @Body() job: EmailJob,
  ): Promise<{ queued: true; job: EmailJob }> {
    return this.rabbitmqService.publishWelcomeEmailJob(job);
  }
}
