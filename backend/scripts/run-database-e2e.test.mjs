import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const {
  assertIsolatedDatabaseEnvironment,
} = require('../test/support/database-safety.cjs');
const runner = fileURLToPath(
  new URL('./run-database-e2e.mjs', import.meta.url),
);

// Real subprocesses exercise signal handling and exit codes without touching
// Docker. The separate database command verifies the real Compose lifecycle.
const fakeCommand = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const executable = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const mode = process.env.E2E_TEST_MODE;
const phase = executable === 'npm' ? args[1] : args[args.indexOf('--file') + 2];
const record = { executable, args, phase, pid: process.pid };
if (executable === 'npm') {
  record.env = Object.fromEntries(['NODE_ENV', 'RUN_DATABASE_E2E', 'DATABASE_URL', 'REDIS_HOST', 'REDIS_PORT', 'E2E_ISOLATION_FILE'].map(key => [key, process.env[key]]));
  record.context = JSON.parse(fs.readFileSync(process.env.E2E_ISOLATION_FILE, 'utf8'));
}
fs.appendFileSync(process.env.E2E_TEST_LOG, JSON.stringify(record) + '\\n');
if ((mode === 'fail-up' && phase === 'up') ||
    (mode === 'fail-migration' && phase === 'prisma:migrate:deploy') ||
    (mode === 'fail-tests' && phase === 'test:e2e') ||
    (mode === 'fail-cleanup' && phase === 'down')) process.exit(42);
if (phase === 'port') {
  const project = args[args.indexOf('--project-name') + 1];
  const offset = parseInt(project.slice(-4), 16) % 10000;
  console.log('127.0.0.1:' + ((args.includes('postgres') ? 20000 : 40000) + offset));
}
if ((mode === 'interrupt-up' && phase === 'up') ||
    (mode === 'interrupt-tests' && phase === 'test:e2e')) setInterval(() => {}, 1000);
`;

async function fixture(t, mode = 'success', args = []) {
  const directory = await mkdtemp(join(tmpdir(), 'exchange-e2e-runner-test-'));
  const bin = join(directory, 'bin');
  const log = join(directory, 'calls.jsonl');
  await mkdir(bin);
  await Promise.all(
    ['docker', 'npm'].map((name) =>
      writeFile(join(bin, name), fakeCommand, { mode: 0o700 }),
    ),
  );
  const child = spawn(process.execPath, [runner, ...args], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      E2E_TEST_LOG: log,
      E2E_TEST_MODE: mode,
      E2E_DATABASE_NAME: 'development',
      DATABASE_URL:
        'postgresql://developer:password@shared:5432/exchange_matching',
      REDIS_HOST: 'shared',
      REDIS_PORT: '6379',
      NODE_ENV: 'production',
      RUN_DATABASE_E2E: 'false',
      E2E_ISOLATION_FILE: '/stale/isolation.json',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const done = new Promise((resolveChild, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) =>
      resolveChild({ code, signal, output }),
    );
  });
  const calls = async () =>
    existsSync(log)
      ? (await readFile(log, 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : [];
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGTERM');
    await done;
    const records = await calls();
    const up = records.find((call) => call.phase === 'up');
    if (up)
      await rm(dirname(up.args[up.args.indexOf('--env-file') + 1]), {
        recursive: true,
        force: true,
      });
    await rm(directory, { recursive: true, force: true });
  });
  return { child, done, calls };
}

function assertCleanup(records) {
  const up = records.find((call) => call.phase === 'up');
  const down = records.find((call) => call.phase === 'down');
  assert.ok(up);
  assert.ok(down);
  assert.equal(
    down.args[down.args.indexOf('--project-name') + 1],
    up.args[up.args.indexOf('--project-name') + 1],
  );
  assert.ok(down.args.includes('--volumes'));
  return up;
}

test(
  'overrides inherited development endpoints, forwards Jest filters and removes its resources',
  { timeout: 10_000 },
  async (t) => {
    const run = await fixture(t, 'success', [
      '--runTestsByPath',
      'test/users.e2e-spec.ts',
    ]);
    assert.equal((await run.done).code, 0);
    const records = await run.calls();
    const up = assertCleanup(records);
    const migration = records.find(
      (call) => call.phase === 'prisma:migrate:deploy',
    );
    const jest = records.find((call) => call.phase === 'test:e2e');
    assert.equal(migration.env.NODE_ENV, 'test');
    assert.equal(migration.env.RUN_DATABASE_E2E, 'true');
    assert.match(
      migration.env.DATABASE_URL,
      /^postgresql:\/\/e2e:e2e@127\.0\.0\.1:\d+\/exchange_matching_e2e_[a-f0-9]{32}\?schema=public$/,
    );
    assert.equal(migration.env.REDIS_HOST, '127.0.0.1');
    assert.notEqual(migration.env.REDIS_PORT, '6379');
    assert.deepEqual(jest.env, migration.env);
    assert.deepEqual(jest.args.slice(2), [
      '--',
      '--runInBand',
      '--runTestsByPath',
      'test/users.e2e-spec.ts',
    ]);
    assert.throws(
      () => assertIsolatedDatabaseEnvironment({ ...jest.env }),
      /isolated runner context/,
    );
    assert.equal(existsSync(migration.env.E2E_ISOLATION_FILE), false);
    assert.equal(existsSync(up.args[up.args.indexOf('--env-file') + 1]), false);
  },
);

for (const mode of ['fail-up', 'fail-migration', 'fail-tests']) {
  test(
    `cleans its project and preserves the exit code after ${mode}`,
    { timeout: 10_000 },
    async (t) => {
      const run = await fixture(t, mode);
      assert.equal((await run.done).code, 42);
      const records = await run.calls();
      const up = assertCleanup(records);
      assert.equal(
        existsSync(up.args[up.args.indexOf('--env-file') + 1]),
        false,
      );
      if (mode !== 'fail-tests')
        assert.equal(
          records.some((call) => call.phase === 'test:e2e'),
          false,
        );
    },
  );
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  for (const mode of ['interrupt-up', 'interrupt-tests']) {
    test(
      `${signal} stops ${mode} and still cleans the project`,
      { timeout: 10_000 },
      async (t) => {
        const run = await fixture(t, mode);
        const phase = mode === 'interrupt-up' ? 'up' : 'test:e2e';
        let active;
        const deadline = Date.now() + 5_000;
        while (!active && Date.now() < deadline) {
          active = (await run.calls()).find((call) => call.phase === phase);
          if (!active) await delay(20);
        }
        assert.ok(
          active,
          'child command must start before signalling the runner',
        );
        run.child.kill(signal);
        assert.equal((await run.done).code, signal === 'SIGINT' ? 130 : 143);
        assertCleanup(await run.calls());
        assert.throws(() => process.kill(active.pid, 0), { code: 'ESRCH' });
      },
    );
  }
}

test(
  'cleanup failure fails the command, expires the context and retains recovery information',
  { timeout: 10_000 },
  async (t) => {
    const run = await fixture(t, 'fail-cleanup');
    const result = await run.done;
    assert.equal(result.code, 1);
    assert.match(result.output, /Cleanup failed/);
    const records = await run.calls();
    const up = assertCleanup(records);
    assert.equal(existsSync(up.args[up.args.indexOf('--env-file') + 1]), true);
    const jest = records.find((call) => call.phase === 'test:e2e');
    assert.equal(existsSync(jest.env.E2E_ISOLATION_FILE), false);
  },
);

test(
  'parallel invocations use different projects, databases and context files',
  { timeout: 10_000 },
  async (t) => {
    const runs = await Promise.all([fixture(t), fixture(t)]);
    assert.deepEqual(
      (await Promise.all(runs.map((run) => run.done))).map(
        (result) => result.code,
      ),
      [0, 0],
    );
    const records = await Promise.all(runs.map((run) => run.calls()));
    const contexts = records.map((calls) =>
      calls.find((call) => call.phase === 'test:e2e'),
    );
    assert.notEqual(contexts[0].context.runId, contexts[1].context.runId);
    assert.notEqual(contexts[0].env.DATABASE_URL, contexts[1].env.DATABASE_URL);
    assert.notEqual(
      contexts[0].env.E2E_ISOLATION_FILE,
      contexts[1].env.E2E_ISOLATION_FILE,
    );
    records.forEach(assertCleanup);
  },
);

test('database guard rejects absent, stale and mismatched runner contexts before tests execute', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'exchange-e2e-guard-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'isolation.json');
  const runId = 'a'.repeat(32);
  const context = {
    runId,
    runnerPid: process.pid,
    databaseUrl: `postgresql://e2e:e2e@127.0.0.1:32001/exchange_matching_e2e_${runId}?schema=public`,
    redisHost: '127.0.0.1',
    redisPort: '32002',
  };
  const env = {
    RUN_DATABASE_E2E: 'true',
    DATABASE_URL: context.databaseUrl,
    REDIS_HOST: context.redisHost,
    REDIS_PORT: context.redisPort,
    E2E_ISOLATION_FILE: path,
  };
  assert.throws(
    () => assertIsolatedDatabaseEnvironment({ ...env }),
    /isolated runner context/,
  );
  await writeFile(path, JSON.stringify(context));
  assert.doesNotThrow(() => assertIsolatedDatabaseEnvironment({ ...env }));
  for (const override of [
    { DATABASE_URL: 'postgresql://localhost/exchange_matching' },
    { REDIS_HOST: 'shared' },
    { REDIS_PORT: '6379' },
  ]) {
    assert.throws(
      () => assertIsolatedDatabaseEnvironment({ ...env, ...override }),
      /isolated runner context/,
    );
  }
  for (const override of [
    { databaseUrl: 'postgresql://e2e:e2e@127.0.0.1:32001/exchange_matching' },
    { redisHost: 'shared' },
    { redisPort: '0' },
    { runId: '' },
    { runnerPid: 0 },
    { runnerPid: 2147483647 },
  ]) {
    const changed = { ...context, ...override };
    await writeFile(path, JSON.stringify(changed));
    assert.throws(
      () =>
        assertIsolatedDatabaseEnvironment({
          ...env,
          DATABASE_URL: changed.databaseUrl,
          REDIS_HOST: changed.redisHost,
          REDIS_PORT: changed.redisPort,
        }),
      /isolated runner context/,
    );
  }
  await rm(path);
  assert.throws(
    () => assertIsolatedDatabaseEnvironment({ ...env }),
    /isolated runner context/,
  );
});

test('ordinary E2E force test mode and disable database access before .env is loaded', () => {
  const env = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://localhost/exchange_matching',
  };
  assertIsolatedDatabaseEnvironment(env);
  assert.equal(env.NODE_ENV, 'test');
  assert.equal(env.RUN_DATABASE_E2E, 'false');
});
