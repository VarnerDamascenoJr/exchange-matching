import { Request } from 'express';

export type JwtPayload = {
  sub: string;
  username: string;
};

export type AuthenticatedRequest = Request & {
  user: JwtPayload;
};
