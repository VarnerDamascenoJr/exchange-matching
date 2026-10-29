# Exchange Matching

BTC/USD limit order exchange built with a separate API process and matching worker.

## Stack

- Frontend: React, TypeScript, Vite, Material UI, React Hook Form, Zod, TanStack Query, Socket.io Client
- Backend: NestJS, TypeScript, Prisma, PostgreSQL, BullMQ, Redis, Socket.io
- Database: PostgreSQL
- Queue and cross-process events: Redis

## Architecture

- `backend/src/main.ts`: HTTP API and Socket.io server
- `backend/src/worker.ts`: sequential order matching worker
- Matching workers set BullMQ global concurrency to `1` before consuming jobs, so multiple worker instances share the same processing limit.
- Matching transactions acquire a PostgreSQL advisory lock for BTC/USD before locking orders or wallets. Commit and rollback release the lock automatically, including for direct service calls outside BullMQ.
- Matching waits for locked maker orders in price-time order, then reloads and revalidates each maker. A committed cancellation removes that maker from consideration; a rolled-back cancellation preserves its priority.
- Maker candidates are fetched one at a time using price/sequence cursors, stopping when executable fills cover the taker. Required order locks are acquired before wallet updates; zero-cost dust does not count toward coverage.
- Matching and realtime outboxes persist a retry deadline after failed delivery, preventing immediate callers or other processes from retrying the same row within two seconds. Failed claim releases remain recoverable when their leases expire; other rows in the claimed batch continue processing.
- Outbox producers bound Redis connection and command waits to two seconds and recreate failed connections on the next attempt. Pollers log failures and resume on subsequent cycles; realtime maintenance retries after failure without overlapping runs.
- Shutdown stops polling and drains claimed batches and active realtime maintenance before Prisma disconnects or Redis producers close.
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

## Prerequisites

- Node.js `22.20.0` (matches CI)
- npm `10+`
- Docker with Docker Compose (recommended for local infrastructure)

## Environment

The root `.env.example` contains these default local values:

```env
NODE_ENV=development
PORT=3000

POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=exchange_matching
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/exchange_matching?schema=public

JWT_SECRET=change-me
JWT_EXPIRES_IN=1d

REDIS_HOST=localhost
REDIS_PORT=6379

VITE_API_BASE_URL=http://localhost:3000
```

## Quick start

1. Copy the environment file:

```bash
cp .env.example .env
```

2. Start PostgreSQL and Redis:

```bash
docker compose up -d
```

3. Install backend dependencies, generate Prisma client, run migrations and seed:

```bash
cd backend
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
```

4. Start the API:

```bash
cd backend
npm run start:dev
```

5. Start the worker in another terminal:

```bash
cd backend
npm run start:worker:dev
```

6. Install frontend dependencies and start the web app:

```bash
cd ../frontend
npm ci
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

Database-backed E2E tests delete their fixtures. Run them with the isolated runner on Linux, macOS or WSL, with a local Docker daemon and Docker Compose supporting `up --wait`, plus the backend dependencies and generated Prisma client from the setup above:

```bash
cd backend
npm run test:e2e:database
```

The runner creates a unique Compose project, PostgreSQL database (`exchange_matching_e2e_<run-id>`) and Redis instance on dynamically assigned loopback ports. It waits for health checks, applies migrations, then runs all E2E suites sequentially. Inherited development database/Redis settings and `.env` values are overridden. Concurrent invocations use separate infrastructure; suites within a single invocation share fixtures and run in band.

Success, startup/migration/test failures, `SIGINT` (Ctrl+C) and `SIGTERM` all remove only that run's containers, network and volumes. Data lives on temporary filesystems. The runner preserves failure exit codes and returns 130/143 on interruption. If Docker cleanup fails, the command fails and prints the project and retained Compose env file so cleanup can be retried with `docker compose --project-name <project> --env-file "<printed-env-file>" --file "<printed-compose-file>" down --volumes`. `SIGKILL` or a host crash cannot run cleanup; remaining projects can be located with `docker ps -a --filter label=com.docker.compose.project` and the `exchange-e2e-` prefix.

Direct `RUN_DATABASE_E2E=true npm run test:e2e` runs are rejected before test code loads unless the active runner context matches the dedicated endpoints. Ordinary `npm run test:e2e -- --runInBand` runs keep database scenarios disabled. CI uses the same isolated command.

To filter a database run or test the runner's failure/interruption handling without Docker:

```bash
npm run test:e2e:database -- --runTestsByPath test/users.e2e-spec.ts
npm run test:e2e:runner
```

Frontend:

```bash
cd frontend
npm run lint
npm run test -- --run
npm run build
```

## Notes

- Financial scale, rounding, minimum cost and partial-fill reservations are documented in [the decimal policy](docs/decimal-policy.md), with shared reference cases for backend and frontend tests.
- List endpoints accept decimal integer query strings for `page` (at least 1) and `pageSize` (1–100). Both inputs and the calculated offset must be safe JavaScript integers. Missing or empty parameters default to page 1 and page size 25; fractions, suffixes, non-finite values, exponent notation and repeated parameters return HTTP 400.
- The frontend offers page size options `10`, `25`, `50` and `100`
- Clicking a bid prefills the sell form
- Clicking an ask prefills the buy form
- Matching and market updates are emitted from the worker and broadcast to connected clients through Socket.io
