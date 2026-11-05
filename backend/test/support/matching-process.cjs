const { resolve } = require('node:path');

require('./database-safety.cjs');
if (process.env.RUN_DATABASE_E2E !== 'true') {
  throw new Error(
    'Matching subprocesses require the isolated database runner.',
  );
}
const role = process.argv[2];
if (!['api', 'worker'].includes(role)) throw new Error('Unknown process role');

// Label real Prisma connections so tests can observe a transaction boundary in
// pg_stat_activity. No application provider, queue or processor is replaced.
const database = new URL(process.env.DATABASE_URL);
database.searchParams.set(
  'application_name',
  `pipeline-${role}-${process.pid}`,
);
database.searchParams.set('connection_limit', '2');
process.env.DATABASE_URL = database.toString();
const root = resolve(__dirname, '../..');
require('ts-node').register({
  project: resolve(root, 'tsconfig.json'),
  transpileOnly: true,
});
require(resolve(root, role === 'api' ? 'src/main.ts' : 'src/worker.ts'));
