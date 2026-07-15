import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthSessionResponse } from './dto/auth-session.response';
import { LoginDto } from './dto/login.dto';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { JwtPayload } from './auth.types';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('auth/login')
  login(@Body() loginDto: LoginDto): Promise<AuthSessionResponse> {
    return this.authService.login(loginDto.username);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@CurrentUser() currentUser: JwtPayload) {
    return this.authService.getMe(currentUser.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('wallet')
  getWallet(@CurrentUser() currentUser: JwtPayload) {
    return this.authService.getWallet(currentUser.sub);
  }
}
