import { Injectable, OnModuleDestroy } from '@nestjs/common';
import amqp, { Channel, ChannelModel, ConsumeMessage } from 'amqplib';

export interface EmailJob {
  type: 'send_welcome_email' | 'send_order_confirmation';
  userId: number;
  email: string;
}

type EmailJobHandler = (job: EmailJob) => Promise<void>;

@Injectable()
export class RabbitmqService implements OnModuleDestroy {
  private readonly queueName = 'email_jobs';
  private connection?: ChannelModel;
  private channel?: Channel;

  async publishEmailJob(channel: Channel, job: EmailJob): Promise<void> {
    await channel.assertQueue(this.queueName, { durable: true });

    channel.sendToQueue(
      this.queueName,
      Buffer.from(JSON.stringify(job)),
      { persistent: true },
    );
  }

  async consumeEmailJobs(
    channel: Channel,
    handleJob: EmailJobHandler,
  ): Promise<void> {
    await channel.assertQueue(this.queueName, { durable: true });
    await channel.prefetch(10);

    await channel.consume(
      this.queueName,
      async (message) => {
        if (!message) return;

        await this.handleMessage(channel, message, handleJob);
      },
      { noAck: false },
    );
  }

  async publishWelcomeEmailJob(
    job: EmailJob,
  ): Promise<{ queued: true; job: EmailJob }> {
    const channel = await this.getChannel();

    await this.publishEmailJob(channel, job);

    return { queued: true, job };
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }

  private async handleMessage(
    channel: Channel,
    message: ConsumeMessage,
    handleJob: EmailJobHandler,
  ): Promise<void> {
    try {
      const job = JSON.parse(message.content.toString()) as EmailJob;

      await handleJob(job);
      channel.ack(message);
    } catch {
      channel.nack(message, false, true);
    }
  }

  private async getChannel(): Promise<Channel> {
    if (this.channel) {
      return this.channel;
    }

    const url = process.env.RABBITMQ_URL ?? 'amqp://localhost';

    const connection = await amqp.connect(url);
    const channel = await connection.createChannel();

    this.connection = connection;
    this.channel = channel;

    return channel;
  }
}
