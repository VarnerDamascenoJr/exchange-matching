import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { TradesController } from './trades.controller';
import { TradesService } from './trades.service';

describe('TradesController', () => {
  let app: INestApplication<App>;
  const service = { getUserHistory: jest.fn() };
  const jwtService = { verifyAsync: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TradesController],
      providers: [
        { provide: TradesService, useValue: service },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      username: 'alice',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should use the authenticated user, transform pagination and trim the ID prefix', async () => {
    const response = {
      items: [],
      pagination: { page: 2, pageSize: 10, totalItems: 0, totalPages: 0 },
    };
    service.getUserHistory.mockResolvedValueOnce(response);
    await request(app.getHttpServer())
      .get('/trades/history')
      .query({
        page: '2',
        pageSize: '10',
        id: ' trade ',
        userId: 'another-user',
      })
      .set('Authorization', 'Bearer token')
      .expect(200)
      .expect(response);
    expect(service.getUserHistory).toHaveBeenCalledWith(
      'user-1',
      2,
      10,
      'trade',
    );
  });

  it('should use default pagination and no ID filter when queries are absent', async () => {
    service.getUserHistory.mockResolvedValueOnce({ items: [] });
    await request(app.getHttpServer())
      .get('/trades/history')
      .set('Authorization', 'Bearer token')
      .expect(200);
    expect(service.getUserHistory).toHaveBeenCalledWith(
      'user-1',
      1,
      25,
      undefined,
    );
  });

  it.each([
    { page: '0' },
    { page: 'abc' },
    { pageSize: '0' },
    { pageSize: '101' },
  ])(
    'should reject invalid pagination before accessing history (%j)',
    async (query) => {
      await request(app.getHttpServer())
        .get('/trades/history')
        .query(query)
        .set('Authorization', 'Bearer token')
        .expect(400);
      expect(service.getUserHistory).not.toHaveBeenCalled();
    },
  );

  it('should require authentication before accessing trade history', async () => {
    await request(app.getHttpServer()).get('/trades/history').expect(401);
    expect(service.getUserHistory).not.toHaveBeenCalled();
  });

  it('should reject invalid tokens before accessing trade history', async () => {
    jwtService.verifyAsync.mockRejectedValueOnce(new Error('Invalid token'));
    await request(app.getHttpServer())
      .get('/trades/history')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    expect(service.getUserHistory).not.toHaveBeenCalled();
  });
});
