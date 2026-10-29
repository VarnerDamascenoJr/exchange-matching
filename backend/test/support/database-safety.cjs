const { readFileSync } = require('node:fs');

function assertIsolatedDatabaseEnvironment(environment) {
  // Keep an ordinary E2E run disconnected, even when .env enables database E2E.
  environment.NODE_ENV = 'test';
  if (environment.RUN_DATABASE_E2E !== 'true') {
    environment.RUN_DATABASE_E2E = 'false';
    return;
  }

  const fail = () => {
    throw new Error(
      'Database E2E require a live isolated runner context. Use npm run test:e2e:database; development or shared DATABASE_URL/Redis settings are not accepted.',
    );
  };
  let context;
  let database;
  try {
    context = JSON.parse(readFileSync(environment.E2E_ISOLATION_FILE, 'utf8'));
    database = new URL(context.databaseUrl);
    if (!Number.isSafeInteger(context.runnerPid) || context.runnerPid <= 0)
      fail();
    process.kill(context.runnerPid, 0);
  } catch {
    fail();
  }
  if (
    !/^[a-f0-9]{32}$/.test(context.runId) ||
    database.protocol !== 'postgresql:' ||
    database.hostname !== '127.0.0.1' ||
    database.pathname !== `/exchange_matching_e2e_${context.runId}` ||
    Number(database.port) < 1024 ||
    context.redisHost !== '127.0.0.1' ||
    !/^\d+$/.test(context.redisPort) ||
    Number(context.redisPort) < 1024 ||
    Number(context.redisPort) > 65535 ||
    environment.DATABASE_URL !== context.databaseUrl ||
    environment.REDIS_HOST !== context.redisHost ||
    environment.REDIS_PORT !== context.redisPort
  )
    fail();
}

module.exports = { assertIsolatedDatabaseEnvironment };
assertIsolatedDatabaseEnvironment(process.env);
