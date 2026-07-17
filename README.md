# Wisiex Order Matching Challenge

BTC/USD limit order matching challenge implemented with a separate API process and worker.

## Stack

- Frontend: React, TypeScript, Vite, Material UI, React Hook Form, Zod, TanStack Query, Socket.io Client
- Backend: NestJS, TypeScript, Prisma, PostgreSQL, BullMQ, Redis, Socket.io
- Database: PostgreSQL
- Queue and cross-process events: Redis

## Architecture

- `backend/src/main.ts`: HTTP API and Socket.io server
- `backend/src/worker.ts`: sequential order matching worker
- PostgreSQL is the source of truth for users, wallets, orders and trades
- Redis is used for BullMQ jobs and realtime exchange events

## Features

- Username-only authentication with JWT
- Automatic user creation with starter balances:
  - `100 BTC`
  - `100000 USD`
- Limit order creation with balance reservation
- Order cancellation with balance release
- Sequential matching engine with:
  - price-time priority
  - partial fills
  - multiple makers
  - maker fee `0.5%`
  - taker fee `0.3%`
- Exchange interface with:
  - market statistics
  - buy and sell forms
  - bid and ask order book
  - global matches
  - my active orders
  - my trade history
  - realtime refresh via Socket.io
- Paginated GET list endpoints using `page` and `pageSize`

## Environment

Copy the root environment example:

```bash
cp .env.example .env
```

The default local values are:

```env
NODE_ENV=development
PORT=3000

POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=wisiex_order_matching
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wisiex_order_matching?schema=public

JWT_SECRET=change-me
JWT_EXPIRES_IN=1d

REDIS_HOST=localhost
REDIS_PORT=6379

VITE_API_BASE_URL=http://localhost:3000
```

## Running with Docker

The root `docker-compose.yml` starts PostgreSQL and Redis:

```bash
docker compose up -d
```

## Backend setup

```bash
cd backend
npm install
npm run prisma:generate
npx prisma migrate deploy
npm run prisma:seed
```

Run the API:

```bash
cd backend
npm run start:dev
```

Run the worker in another terminal:

```bash
cd backend
npm run start:worker:dev
```

## Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Frontend default URL:

- `http://localhost:5173`

Backend default URL:

- `http://localhost:3000`

## API summary

### Auth

- `POST /auth/login`
- `GET /me`
- `GET /wallet`

### Orders

- `POST /orders`
- `GET /orders/active?page=1&pageSize=10&id=...`
- `DELETE /orders/:id`

### Market

- `GET /market/stats`
- `GET /market/order-book?side=BUY&page=1&pageSize=10&price=...`
- `GET /market/matches?page=1&pageSize=10&id=...`

### Trades

- `GET /trades/history?page=1&pageSize=10&id=...`

## Tests

Backend:

```bash
cd backend
npm run lint
NODE_ENV=test npm run test -- --runInBand
NODE_ENV=test npm run test:e2e -- --runInBand
npm run build
```

Para executar os cenarios E2E que usam PostgreSQL e Redis reais, inicie a
infraestrutura local e aplique as migrations antes da suite:

```bash
docker compose up -d
cd backend
npm run prisma:migrate:deploy
NODE_ENV=test RUN_DATABASE_E2E=true \
  DATABASE_URL='postgresql://postgres:postgres@localhost:5432/wisiex_order_matching?schema=public' \
  REDIS_HOST=localhost REDIS_PORT=6379 \
  npm run test:e2e -- --runInBand
```

Frontend:

```bash
cd frontend
npm run lint
npm run test -- --run
npm run build
```

## Notes

- List endpoints support pagination with `page` and `pageSize`
- The frontend offers page size options `10`, `25`, `50` and `100`
- Clicking a bid prefills the sell form
- Clicking an ask prefills the buy form
- Matching and market updates are emitted from the worker and broadcast to connected clients through Socket.io
