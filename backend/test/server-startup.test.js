import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('API modules load successfully without opening a listener', () => {
  const env = { ...process.env, VERCEL: '1' };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/server.js'); const { pool } = await import('./src/db.js'); await pool.end();"], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env,
    encoding: 'utf8',
    timeout: 10000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
