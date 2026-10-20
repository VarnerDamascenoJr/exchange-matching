import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { User, Wallet } from '@prisma/client';
import { UsersRepository } from './users.repository';

export type UserWithWallet = User & {
  wallet: Wallet;
};

type UserWithOptionalWallet = User & {
  wallet: Wallet | null;
};

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async findById(id: string): Promise<UserWithWallet | null> {
    const user = await this.usersRepository.findById(id);

    return user ? this.ensureWallet(user) : null;
  }

  async findByUsername(username: string): Promise<UserWithWallet | null> {
    const user = await this.usersRepository.findByUsername(username);

    return user ? this.ensureWallet(user) : null;
  }

  async createWithWallet(username: string): Promise<UserWithWallet> {
    const user = await this.usersRepository.createWithWallet(username);

    return this.ensureWallet(user);
  }

  isUniqueUsernameViolation(error: unknown): boolean {
    return this.usersRepository.isUniqueUsernameViolation(error);
  }

  private ensureWallet(user: UserWithOptionalWallet): UserWithWallet {
    if (!user.wallet) {
      throw new InternalServerErrorException('Wallet not found for user');
    }

    return user as UserWithWallet;
  }
}
