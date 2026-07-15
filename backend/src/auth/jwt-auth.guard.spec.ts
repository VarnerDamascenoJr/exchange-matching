import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';

const createExecutionContext = (authorization?: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authorization ? { authorization } : {},
      }),
    }),
  }) as ExecutionContext;

describe('JwtAuthGuard', () => {
  let jwtService: jest.Mocked<JwtService>;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    jwtService = {
      verifyAsync: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;
    guard = new JwtAuthGuard(jwtService);
  });

  it('should reject requests without an Authorization header', async () => {
    await expect(
      guard.canActivate(createExecutionContext()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should reject requests with an invalid bearer header', async () => {
    await expect(
      guard.canActivate(createExecutionContext('Token abc')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should attach the jwt payload to the request for valid bearer tokens', async () => {
    const request = {
      headers: { authorization: 'Bearer valid-jwt' },
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;

    jwtService.verifyAsync.mockResolvedValueOnce({
      sub: 'user-1',
      username: 'alice',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request).toEqual({
      headers: { authorization: 'Bearer valid-jwt' },
      user: { sub: 'user-1', username: 'alice' },
    });
  });
});
