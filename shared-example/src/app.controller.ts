import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { AppService } from './app.service';
import type {
  CreateUserInput,
  ReplaceUserInput,
  UpdateUserInput,
  User,
} from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('users')
  listUsers(): User[] {
    return this.appService.listUsers();
  }

  @Get('users/:id')
  getUser(@Param('id') id: string): User | undefined {
    return this.appService.getUser(Number(id));
  }

  @Post('users')
  createUser(@Body() input: CreateUserInput): User {
    return this.appService.createUser(input);
  }

  @Put('users/:id')
  replaceUser(@Param('id') id: string, @Body() input: ReplaceUserInput): User {
    return this.appService.replaceUser(Number(id), input);
  }

  @Patch('users/:id')
  updateUser(
    @Param('id') id: string,
    @Body() input: UpdateUserInput,
  ): User | undefined {
    return this.appService.updateUser(Number(id), input);
  }

  @Delete('users/:id')
  deleteUser(@Param('id') id: string): { deleted: boolean; id: number } {
    return this.appService.deleteUser(Number(id));
  }
}
