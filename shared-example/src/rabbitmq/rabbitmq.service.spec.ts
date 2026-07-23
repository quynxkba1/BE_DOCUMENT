import type { Channel, ConsumeMessage } from 'amqplib';
import { RabbitmqService } from './rabbitmq.service';

describe('RabbitmqService', () => {
  const queueName = 'email_jobs';

  function createChannelMock() {
    return {
      assertQueue: jest.fn().mockResolvedValue(undefined),
      sendToQueue: jest.fn().mockReturnValue(true),
      prefetch: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn().mockResolvedValue(undefined),
      ack: jest.fn(),
      nack: jest.fn(),
    } as unknown as jest.Mocked<Channel>;
  }

  it('publishes durable persistent email jobs', async () => {
    const channel = createChannelMock();
    const service = new RabbitmqService();

    await service.publishEmailJob(channel, {
      type: 'send_welcome_email',
      userId: 123,
      email: 'alice@example.com',
    });

    expect(channel.assertQueue).toHaveBeenCalledWith(queueName, {
      durable: true,
    });
    expect(channel.sendToQueue).toHaveBeenCalledWith(
      queueName,
      Buffer.from(
        JSON.stringify({
          type: 'send_welcome_email',
          userId: 123,
          email: 'alice@example.com',
        }),
      ),
      { persistent: true },
    );
  });

  it('consumes email jobs with prefetch and manual acknowledgement', async () => {
    const channel = createChannelMock();
    const service = new RabbitmqService();
    const handleJob = jest.fn().mockResolvedValue(undefined);

    await service.consumeEmailJobs(channel, handleJob);

    expect(channel.assertQueue).toHaveBeenCalledWith(queueName, {
      durable: true,
    });
    expect(channel.prefetch).toHaveBeenCalledWith(10);
    expect(channel.consume).toHaveBeenCalledWith(
      queueName,
      expect.any(Function),
      { noAck: false },
    );
  });

  it('acks a message after successful processing', async () => {
    const channel = createChannelMock();
    const service = new RabbitmqService();
    const handleJob = jest.fn().mockResolvedValue(undefined);
    const message = {
      content: Buffer.from(
        JSON.stringify({
          type: 'send_welcome_email',
          userId: 123,
          email: 'alice@example.com',
        }),
      ),
    } as ConsumeMessage;

    await service.consumeEmailJobs(channel, handleJob);
    const [, onMessage] = (channel.consume as jest.Mock).mock.calls[0];

    await onMessage(message);

    expect(handleJob).toHaveBeenCalledWith({
      type: 'send_welcome_email',
      userId: 123,
      email: 'alice@example.com',
    });
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('nacks and requeues a message after failed processing', async () => {
    const channel = createChannelMock();
    const service = new RabbitmqService();
    const handleJob = jest.fn().mockRejectedValue(new Error('SMTP down'));
    const message = {
      content: Buffer.from(
        JSON.stringify({
          type: 'send_welcome_email',
          userId: 123,
          email: 'alice@example.com',
        }),
      ),
    } as ConsumeMessage;

    await service.consumeEmailJobs(channel, handleJob);
    const [, onMessage] = (channel.consume as jest.Mock).mock.calls[0];

    await onMessage(message);

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(message, false, true);
  });
});
