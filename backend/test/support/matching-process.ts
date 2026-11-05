import { ChildProcess, fork } from 'node:child_process';
import { AddressInfo, createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function waitUntil(
  description: string,
  predicate: () => boolean | Promise<boolean>,
  timeout = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

export class MatchingProcess {
  readonly child: ChildProcess;
  readonly closed: Promise<void>;
  readonly label: string;
  private output = '';
  private failure?: Error;

  constructor(role: 'api' | 'worker', environment: NodeJS.ProcessEnv = {}) {
    this.child = fork(resolve(__dirname, 'matching-process.cjs'), [role], {
      cwd: resolve(__dirname, '../..'),
      env: { ...process.env, ...environment },
      execArgv: [],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    this.label = `pipeline-${role}-${this.child.pid}`;
    const capture = (chunk: Buffer) => {
      this.output = (this.output + chunk.toString()).slice(-16_000);
    };
    this.child.stdout?.on('data', capture);
    this.child.stderr?.on('data', capture);
    this.child.on('error', (error) => {
      this.failure = error;
    });
    this.closed = new Promise((resolveExit) => {
      this.child.once('close', () => resolveExit());
    });
  }

  assertRunning(): void {
    if (
      this.failure ||
      this.child.exitCode !== null ||
      this.child.signalCode !== null
    ) {
      throw new Error(
        `${this.label} stopped: ${this.failure?.message ?? ''}\n${this.output}`,
      );
    }
  }

  async ready(): Promise<void> {
    await waitUntil(
      `${this.label} startup`,
      () => {
        this.assertRunning();
        return this.output.includes('Worker started for queue');
      },
      30_000,
    );
  }

  async stop(signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill(signal);
    await Promise.race([this.closed, delay(8_000, undefined, { ref: false })]);
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill('SIGKILL');
      await this.closed;
    }
  }

  logs(): string {
    return this.output;
  }
}

export async function apiPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  return port;
}
