import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createOracleExportHandlers } from '../src/services/oracle-export.js';
import { readExportPacket } from '../src/services/oracle-transfer.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function snapshot(count = 1) {
  const up_emp = Array.from({ length: count }, (_, index) => ({ EMP_ENTRY_ID: index + 1, IPI: `EMP${index + 1}`, APPROVAL_STATUS: 'PENDING', NAME: "O'Brien বাংলা ".repeat(20) }));
  return {
    up_emp,
    hr_empexamdet: up_emp.map(row => ({ EMP_ENTRY_ID: row.EMP_ENTRY_ID, EMPCODE: row.IPI, SLNO: 1, EXAMNAME: 'SSC' })),
    hr_empfamilydet: up_emp.map(row => ({ EMP_ENTRY_ID: row.EMP_ENTRY_ID, EMPCODE: row.IPI, FAMILY_ID: row.EMP_ENTRY_ID, CHILD_NOS: 1, FNAME: 'Child' }))
  };
}

function connectionFor(tables) {
  const events = [];
  return {
    events,
    async query(sql) {
      events.push(sql);
      const table = Object.keys(tables).find(name => sql.includes(`FROM ${name} `));
      if (table) return [tables[table]];
    },
    async rollback() { events.push('rollback'); },
    release() { events.push('release'); },
    destroy() { events.push('destroy'); }
  };
}

async function endpoint(t, options) {
  const app = express();
  app.use(express.json());
  const authorize = (req, res, next) => req.headers.authorization === 'Bearer allowed'
    ? next() : res.status(401).json({ message: 'Admin login required.' });
  app.post('/export', ...createOracleExportHandlers({ authorize, log: () => {}, ...options }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return (ids = [1], extra = {}) => fetch(`http://127.0.0.1:${server.address().port}/export`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer allowed', ...extra.headers },
    body: JSON.stringify({ employeeIds: ids }), ...extra
  });
}

test('85-row compressed download round-trips as an importable file with three batched SELECTs', async t => {
  const tables = snapshot(85);
  const connection = connectionFor(tables);
  const request = await endpoint(t, { pool: { async getConnection() { return connection; } } });
  const response = await request(tables.up_emp.map(row => row.EMP_ENTRY_ID));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-encoding'), 'gzip');
  assert.match(response.headers.get('content-disposition'), /attachment; filename="employee-oracle-/);
  assert.match(response.headers.get('access-control-expose-headers'), /X-Oracle-Row-Counts/);
  const file = await response.text();
  assert.deepEqual(readExportPacket(JSON.parse(file)), tables);
  assert.ok(Number(response.headers.get('content-length')) < Buffer.byteLength(file) / 4);
  assert.deepEqual(JSON.parse(response.headers.get('x-oracle-row-counts')).map(table => table.rows), [85, 85, 85]);
  assert.equal(connection.events.filter(event => event.startsWith('SELECT')).length, 3);
  assert.equal(connection.events.at(-1), 'release');
});

test('uncompressed clients receive the same downloadable JSON', async t => {
  const tables = snapshot();
  const request = await endpoint(t, { pool: { async getConnection() { return connectionFor(tables); } } });
  const response = await request([1], { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer allowed', 'Accept-Encoding': 'identity' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-encoding'), null);
  assert.deepEqual(readExportPacket(await response.json()), tables);
});

test('authentication and invalid selection reject without acquiring an export connection', async t => {
  let acquisitions = 0;
  const request = await endpoint(t, { pool: { async getConnection() { acquisitions++; throw new Error('Unexpected'); } } });
  const unauthorized = await request([1], { headers: { 'Content-Type': 'application/json' } });
  assert.equal(unauthorized.status, 401);
  const invalid = await request([]);
  assert.equal(invalid.status, 400);
  assert.equal(acquisitions, 0);
});

test('pool wait times out promptly and releases a connection delivered after the deadline', async t => {
  const pending = deferred();
  const request = await endpoint(t, { timeoutMs: 30, pool: { getConnection() { return pending.promise; } } });
  const response = await request();
  assert.equal(response.status, 504);
  assert.match((await response.json()).message, /took too long/);
  const late = connectionFor(snapshot());
  pending.resolve(late);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(late.events, ['release']);
});

test('a stalled query is canceled by destroying its connection instead of keeping the pool busy', async t => {
  const pending = deferred();
  const connection = connectionFor(snapshot());
  connection.destroy = () => { connection.events.push('destroy'); pending.reject(new Error('Connection closed')); };
  const request = await endpoint(t, { timeoutMs: 30, pool: { async getConnection() { return connection; } }, read: () => pending.promise });
  assert.equal((await request()).status, 504);
  assert.deepEqual(connection.events, ['destroy']);
});

test('the deadline also covers stalled authorization', async t => {
  let acquisitions = 0;
  const request = await endpoint(t, { timeoutMs: 30, authorize: () => {}, pool: { async getConnection() { acquisitions++; } } });
  assert.equal((await request()).status, 504);
  assert.equal(acquisitions, 0);
});

test('canceling a browser request cancels its active database read', async t => {
  const started = deferred();
  const canceled = deferred();
  const pending = deferred();
  const connection = connectionFor(snapshot());
  connection.destroy = () => { connection.events.push('destroy'); pending.reject(new Error('Connection closed')); canceled.resolve(); };
  const request = await endpoint(t, { pool: { async getConnection() { return connection; } }, read: () => { started.resolve(); return pending.promise; } });
  const controller = new AbortController();
  const response = request([1], { signal: controller.signal });
  await started.promise;
  controller.abort();
  await assert.rejects(response, error => error.name === 'AbortError');
  await canceled.promise;
  assert.deepEqual(connection.events, ['destroy']);
});
