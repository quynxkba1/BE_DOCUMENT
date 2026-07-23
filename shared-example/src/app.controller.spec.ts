import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('users REST example', () => {
    it('lists users with GET /users without changing state', () => {
      expect(appController.listUsers()).toEqual([
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ]);

      expect(appController.listUsers()).toEqual([
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ]);
    });

    it('creates a new user with POST /users and repeated calls create different users', () => {
      const first = appController.createUser({
        name: 'Chris',
        email: 'chris@example.com',
      });
      const second = appController.createUser({
        name: 'Chris',
        email: 'chris@example.com',
      });

      expect(first).toEqual({
        id: 3,
        name: 'Chris',
        email: 'chris@example.com',
      });
      expect(second).toEqual({
        id: 4,
        name: 'Chris',
        email: 'chris@example.com',
      });
    });

    it('replaces a user with PUT /users/:id and repeated calls keep the same final state', () => {
      const replacement = {
        name: 'Alice Nguyen',
        email: 'alice.nguyen@example.com',
      };

      expect(appController.replaceUser('1', replacement)).toEqual({
        id: 1,
        ...replacement,
      });
      expect(appController.replaceUser('1', replacement)).toEqual({
        id: 1,
        ...replacement,
      });
      expect(appController.getUser('1')).toEqual({
        id: 1,
        ...replacement,
      });
    });

    it('partially updates a user with PATCH /users/:id', () => {
      expect(appController.updateUser('2', { name: 'Bobby' })).toEqual({
        id: 2,
        name: 'Bobby',
        email: 'bob@example.com',
      });
    });

    it('deletes a user with DELETE /users/:id and repeated calls keep the resource deleted', () => {
      expect(appController.deleteUser('2')).toEqual({
        deleted: true,
        id: 2,
      });
      expect(appController.deleteUser('2')).toEqual({
        deleted: false,
        id: 2,
      });
      expect(appController.getUser('2')).toBeUndefined();
    });
  });
});
