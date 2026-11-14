import process from 'node:process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const mode = process.argv[2];
if (!['rules', 'e2e', 'all'].includes(mode)) throw new Error('Expected rules, e2e or all');
// Refuse to attach to an existing service: never clear somebody else's emulator.
for (const port of [19000, 19099, 14400, 14401, 14402, 4177]) {
  await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`QA port ${port} is occupied; stop the conflicting service first`)));
    server.listen(port, '127.0.0.1', () => server.close(resolvePort));
  });
}
mkdirSync('.qa/empty-env', { recursive: true });
writeFileSync('.qa/firebase.json', JSON.stringify({
  database: { rules: resolve('database.rules.json') },
  emulators: {
    auth: { host: '127.0.0.1', port: 19099 },
    database: { host: '127.0.0.1', port: 19000 },
    hub: { host: '127.0.0.1', port: 14400 },
    logging: { host: '127.0.0.1', port: 14401 },
    ui: { enabled: false }, singleProjectMode: true,
  },
}));
const command = mode === 'rules' ? 'npx vitest run tests/rules' : mode === 'e2e' ? 'npx playwright test' : 'npx vitest run && npx playwright test';
const env = { ...process.env, VITE_USE_EMULATORS: '1', VITE_DATABASE_EMULATOR_PORT: '19000', VITE_AUTH_EMULATOR_PORT: '19099', VITE_BASE_PATH: '/', QA_ISOLATED: '1' };
// No Firebase credentials are needed by a demo project.
delete env.GOOGLE_APPLICATION_CREDENTIALS;
delete env.FIREBASE_TOKEN;
const result = spawnSync(resolve('node_modules/.bin/firebase'), [
  'emulators:exec', '--config', resolve('.qa/firebase.json'), '--only', 'auth,database',
  '--project', 'demo-hidden-pictures', command,
], { stdio: 'inherit', env });
process.exit(result.status ?? 1);
