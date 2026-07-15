import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthSessionResponse } from './dto/auth-session.response';
import { JwtPayload } from './auth.types';
import { toUserProfile } from '../users/user.mapper';
import { UserWithWallet, UsersService } from '../users/users.service';
import { toWalletSummary } from '../wallets/wallet.mapper';
import { WalletsService } from '../wallets/wallets.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly jwtService: JwtService,
  ) {}

  async login(username: string): Promise<AuthSessionResponse> {
    const normalizedUsername = username.trim();
    const existingUser =
      await this.usersService.findByUsername(normalizedUsername);

    if (existingUser) {
      return this.buildSession(existingUser);
    }

    try {
      const createdUser =
        await this.usersService.createWithWallet(normalizedUsername);
      return this.buildSession(createdUser);
    } catch (error) {
      if (!this.usersService.isUniqueUsernameViolation(error)) {
        throw error;
      }

      const user = await this.usersService.findByUsername(normalizedUsername);

      if (!user) {
        throw error;
      }

      return this.buildSession(user);
    }
  }

  async getMe(userId: string) {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new UnauthorizedException('User not found for token subject');
    }

    return toUserProfile(user);
  }

  async getWallet(userId: string) {
    const wallet = await this.walletsService.findByUserId(userId);

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return toWalletSummary(wallet);
  }

  private async buildSession(
    user: UserWithWallet,
  ): Promise<AuthSessionResponse> {
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: toUserProfile(user),
      wallet: toWalletSummary(user.wallet),
    };
  }
}
