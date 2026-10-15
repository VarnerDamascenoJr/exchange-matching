import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

describe('OrdersController', () => {
  let app: INestApplication<App>;
  const service = {
    createOrder: jest.fn(),
    getActiveOrders: jest.fn(),
    cancelOrder: jest.fn(),
  };
  const jwtService = { verifyAsync: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        { provide: OrdersService, useValue: service },
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

  it('should create orders for the authenticated user and ignore a supplied user ID', async () => {
    service.createOrder.mockResolvedValueOnce({ id: 'order-1' });
    await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', 'Bearer token')
      .send({
        side: 'BUY',
        amount: '0.5',
        price: '10000',
        userId: 'another-user',
      })
      .expect(201)
      .expect({ id: 'order-1' });
    expect(service.createOrder).toHaveBeenCalledWith(
      'user-1',
      'BUY',
      '0.5',
      '10000',
    );
  });

  it('should transform pagination and trim the order ID prefix for the authenticated user', async () => {
    const response = {
      items: [],
      pagination: { page: 2, pageSize: 10, totalItems: 0, totalPages: 0 },
    };
    service.getActiveOrders.mockResolvedValueOnce(response);
    await request(app.getHttpServer())
      .get('/orders/active')
      .query({ page: '2', pageSize: '10', id: ' order ' })
      .set('Authorization', 'Bearer token')
      .expect(200)
      .expect(response);
    expect(service.getActiveOrders).toHaveBeenCalledWith('user-1', {
      page: 2,
      pageSize: 10,
      id: 'order',
    });
  });

  it('should apply default pagination when query parameters are absent', async () => {
    service.getActiveOrders.mockResolvedValueOnce({ items: [] });
    await request(app.getHttpServer())
      .get('/orders/active')
      .set('Authorization', 'Bearer token')
      .expect(200);
    expect(service.getActiveOrders).toHaveBeenCalledWith('user-1', {
      page: 1,
      pageSize: 25,
    });
  });

  it('should cancel only through the authenticated user context', async () => {
    service.cancelOrder.mockResolvedValueOnce({
      id: 'order-1',
      status: 'CANCELLED',
    });
    await request(app.getHttpServer())
      .delete('/orders/order-1')
      .set('Authorization', 'Bearer token')
      .expect(200)
      .expect({ id: 'order-1', status: 'CANCELLED' });
    expect(service.cancelOrder).toHaveBeenCalledWith('user-1', 'order-1');
  });

  it.each([
    { side: 'INVALID', amount: '0.5', price: '10000' },
    { side: 'BUY', amount: 0.5, price: '10000' },
    { side: 'BUY', amount: '0.5' },
  ])(
    'should reject invalid creation payloads before calling the service (%j)',
    async (body) => {
      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', 'Bearer token')
        .send(body)
        .expect(400);
      expect(service.createOrder).not.toHaveBeenCalled();
    },
  );

  it.each([{ page: '0' }, { page: 'abc' }, { pageSize: '101' }])(
    'should reject invalid pagination (%j)',
    async (query) => {
      await request(app.getHttpServer())
        .get('/orders/active')
        .query(query)
        .set('Authorization', 'Bearer token')
        .expect(400);
      expect(service.getActiveOrders).not.toHaveBeenCalled();
    },
  );

  it('should require authentication for all order endpoints', async () => {
    await request(app.getHttpServer()).get('/orders/active').expect(401);
    await request(app.getHttpServer())
      .post('/orders')
      .send({ side: 'BUY', amount: '0.5', price: '10000' })
      .expect(401);
    await request(app.getHttpServer()).delete('/orders/order-1').expect(401);
    expect(service.getActiveOrders).not.toHaveBeenCalled();
    expect(service.createOrder).not.toHaveBeenCalled();
    expect(service.cancelOrder).not.toHaveBeenCalled();
  });

  it('should reject invalid tokens before accessing orders', async () => {
    jwtService.verifyAsync.mockRejectedValueOnce(new Error('Invalid token'));
    await request(app.getHttpServer())
      .get('/orders/active')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    expect(service.getActiveOrders).not.toHaveBeenCalled();
  });
});
