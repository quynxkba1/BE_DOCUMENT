import { Injectable } from '@nestjs/common';

export interface User {
  id: number;
  name: string;
  email: string;
}

export type CreateUserInput = Omit<User, 'id'>;
export type ReplaceUserInput = Omit<User, 'id'>;
export type UpdateUserInput = Partial<Omit<User, 'id'>>;

@Injectable()
export class AppService {
  private users: User[] = [
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', email: 'bob@example.com' },
  ];

  private nextUserId = 3;

  getHello(): string {
    return 'Hello World!';
  }

  listUsers(): User[] {
    return this.users;
  }

  getUser(id: number): User | undefined {
    return this.users.find((user) => user.id === id);
  }

  createUser(input: CreateUserInput): User {
    const user = {
      id: this.nextUserId,
      ...input,
    };

    this.nextUserId += 1;
    this.users.push(user);

    return user;
  }

  replaceUser(id: number, input: ReplaceUserInput): User {
    const user = { id, ...input };
    const existingIndex = this.users.findIndex((item) => item.id === id);

    if (existingIndex >= 0) {
      this.users[existingIndex] = user;
      return user;
    }

    this.users.push(user);
    return user;
  }

  updateUser(id: number, input: UpdateUserInput): User | undefined {
    const user = this.getUser(id);

    if (!user) {
      return undefined;
    }

    Object.assign(user, input);
    return user;
  }

  deleteUser(id: number): { deleted: boolean; id: number } {
    const originalLength = this.users.length;
    this.users = this.users.filter((user) => user.id !== id);

    return {
      deleted: this.users.length < originalLength,
      id,
    };
  }
}
