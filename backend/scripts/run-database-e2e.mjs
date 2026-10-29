import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontend = resolve(backend, '../frontend');
const browserRun = process.argv[2] === '--browser';
const testArgs = process.argv.slice(browserRun ? 3 : 2);
const runId = randomUUID().replaceAll('-', '');
const project = `exchange-e2e-${runId}`;
const database = `exchange_matching_e2e_${runId}`;
const directory = await mkdtemp(join(tmpdir(), `${project}-`));
const envFile = join(directory, 'compose.env');
const contextFile = join(directory, 'isolation.json');
await writeFile(envFile, `E2E_DATABASE_NAME=${database}\n`, { mode: 0o600 });
const compose = [
  'compose',
  '--project-name',
  project,
  '--env-file',
  envFile,
  '--file',
  resolve(backend, '../docker-compose.e2e.yml'),
];
// Compose must use the generated env file, even if the caller exported this key.
const environment = { ...process.env };
delete environment.E2E_DATABASE_NAME;
let activeChild;
let interrupted = 0;
let started = false;
let cleanupFailed = false;
let exitCode = 0;

function stopChild(child) {
  if (!child.pid) return;
  const kill = (signal) => {
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  kill('SIGTERM');
  const timer = setTimeout(() => kill('SIGKILL'), 5_000);
  timer.unref();
  child.once('close', () => clearTimeout(timer));
}

function onSignal(signal) {
  if (interrupted) return;
  interrupted = signal === 'SIGINT' ? 130 : 143;
  console.error(`\n${signal}: stopping tests and cleaning ${project}.`);
  if (activeChild?.cancellable) stopChild(activeChild.child);
}
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

async function command(
  executable,
  args,
  { capture = false, cleanup = false, timeout = 0, cwd = backend } = {},
) {
  if (interrupted && !cleanup) throw new Error('Run interrupted');
  return new Promise((resolveCommand, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: environment,
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      detached: process.platform !== 'win32',
    });
    activeChild = { child, cancellable: !cleanup };
    let output = '';
    let timedOut = false;
    child.stdout?.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
    });
    const timer = timeout
      ? setTimeout(() => {
          timedOut = true;
          stopChild(child);
        }, timeout)
      : undefined;
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      activeChild = undefined;
      if (code === 0 && !timedOut && (!interrupted || cleanup))
        resolveCommand(output.trim());
      else
        reject(
          Object.assign(
            new Error(
              `${executable} ${args[0]} ${timedOut ? 'timed out' : `failed (${signal ?? code})`}`,
            ),
            { exitCode: code || 1 },
          ),
        );
    });
  });
}

async function publishedPort(service, port) {
  const output = await command(
    'docker',
    [...compose, 'port', service, String(port)],
    { capture: true, timeout: 15_000 },
  );
  const match = /^127\.0\.0\.1:(\d+)$/.exec(output);
  const published = Number(match?.[1]);
  if (!Number.isInteger(published) || published < 1024 || published > 65535) {
    throw new Error(`Expected an ephemeral loopback port for ${service}`);
  }
  return published;
}

async function browserPorts() {
  const servers = [createServer(), createServer()];
  try {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise((resolveListen, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolveListen);
          }),
      ),
    );
    return servers.map((server) => server.address().port);
  } finally {
    await Promise.all(
      servers.map(
        (server) => new Promise((resolveClose) => server.close(resolveClose)),
      ),
    );
  }
}

try {
  console.log(`Starting isolated E2E project ${project}.`);
  started = true;
  await command(
    'docker',
    [...compose, 'up', '--detach', '--wait', '--wait-timeout', '60'],
    { timeout: 180_000 },
  );
  const postgresPort = await publishedPort('postgres', 5432);
  const redisPort = await publishedPort('redis', 6379);
  const context = {
    runId,
    runnerPid: process.pid,
    databaseUrl: `postgresql://e2e:e2e@127.0.0.1:${postgresPort}/${database}?schema=public`,
    redisHost: '127.0.0.1',
    redisPort: String(redisPort),
  };
  await writeFile(contextFile, JSON.stringify(context), { mode: 0o600 });
  Object.assign(environment, {
    NODE_ENV: 'test',
    RUN_DATABASE_E2E: 'true',
    DATABASE_URL: context.databaseUrl,
    REDIS_HOST: context.redisHost,
    REDIS_PORT: context.redisPort,
    E2E_ISOLATION_FILE: contextFile,
  });
  await command('npm', ['run', 'prisma:migrate:deploy'], { timeout: 120_000 });
  if (browserRun) {
    const [apiPort, webPort] = await browserPorts();
    Object.assign(environment, {
      E2E_API_PORT: String(apiPort),
      E2E_WEB_PORT: String(webPort),
      PORT: String(apiPort),
      VITE_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
      JWT_SECRET: 'isolated-browser-e2e-secret',
      JWT_EXPIRES_IN: '1h',
    });
    await command('npm', ['run', 'test:e2e:browser', '--', ...testArgs], {
      cwd: frontend,
    });
  } else {
    await command('npm', ['run', 'test:e2e', '--', '--runInBand', ...testArgs]);
  }
} catch (error) {
  exitCode = interrupted || error.exitCode || 1;
  console.error(error.message);
} finally {
  // Cleanup cannot be cancelled by a repeated signal. Only this UUID's project
  // is removed; no development services, shared volumes or global prune commands.
  if (started) {
    try {
      await command(
        'docker',
        [...compose, 'down', '--volumes', '--timeout', '5'],
        { cleanup: true, timeout: 30_000 },
      );
    } catch (error) {
      cleanupFailed = true;
      console.error(
        `Cleanup failed: ${error.message}. Retry using this project's compose env file: ${envFile}`,
      );
      console.error(
        `Project: ${project}; compose file: ${resolve(backend, '../docker-compose.e2e.yml')}`,
      );
      if (!exitCode) exitCode = 1;
    }
  }
  // Expire the safety context even if Docker cleanup failed.
  await rm(contextFile, { force: true });
  if (!cleanupFailed) await rm(directory, { recursive: true, force: true });
  process.removeListener('SIGINT', onSignal);
  process.removeListener('SIGTERM', onSignal);
}
process.exitCode = interrupted || exitCode;
