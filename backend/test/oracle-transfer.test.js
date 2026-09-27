import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TABLES, normalizeEmployeeIds, validateMapping, readOracleSettings, bindExpression, snapshotHash, readSnapshot, preparePlans, savePlans, createExportPacket, readExportPacket } from '../src/services/oracle-transfer.js';
import { importOracleFile } from '../src/import-oracle.js';

const mapping = {
  up_emp: { table: 'UP_EMP', columns: { IPI: 'IPI', NAME: 'NAME', BIRTHDATE: 'BIRTHDATE' } },
  hr_empexamdet: { table: 'HR_EMPEXAMDET', columns: { EMPCODE: 'EMPCODE', SLNO: 'SLNO', EXAMNAME: 'EXAMNAME' } },
  hr_empfamilydet: { table: 'HR_EMPFAMILYDET', columns: { EMPCODE: 'EMPCODE', CHILD_NOS: 'CHILD_NOS', FNAME: 'FNAME' } }
};
const settings = { schema: 'HR', mapping, user: 'IMPORTER', connectString: 'example/service' };
function source() {
  return {
    up_emp: [{ EMP_ENTRY_ID: 1, IPI: 'EMP1', NAME: "O'Brien বাংলা", BIRTHDATE: '2000-01-15', APPROVAL_STATUS: 'APPROVED' }],
    hr_empexamdet: [{ EMP_ENTRY_ID: 1, EMPCODE: 'EMP1', SLNO: 1, EXAMNAME: 'SSC' }],
    hr_empfamilydet: [{ EMP_ENTRY_ID: 1, EMPCODE: 'EMP1', CHILD_NOS: 1, FNAME: 'Child' }]
  };
}
const keyColumns = { UP_EMP: ['IPI'], HR_EMPEXAMDET: ['EMPCODE', 'SLNO'], HR_EMPFAMILYDET: ['EMPCODE', 'CHILD_NOS'] };
function oracleMetadata({ missingColumn, missingConstraint, requiredExtra } = {}) {
  return { async execute(sql, binds) {
    if (sql.includes('ALL_TAB_COLS')) {
      const entry = Object.values(mapping).find(value => value.table === binds.tableName);
      const rows = Object.values(entry.columns).filter(column => column !== missingColumn).map(column => ({
        COLUMN_NAME: column, DATA_TYPE: column === 'BIRTHDATE' ? 'DATE' : ['SLNO', 'CHILD_NOS'].includes(column) ? 'NUMBER' : 'VARCHAR2',
        NULLABLE: 'Y', DATA_DEFAULT: null, VIRTUAL_COLUMN: 'NO', IDENTITY_COLUMN: 'NO'
      }));
      if (requiredExtra) rows.push({ COLUMN_NAME: 'REQUIRED_EXTRA', NULLABLE: 'N', DATA_DEFAULT: null });
      return { rows };
    }
    return { rows: missingConstraint ? [] : keyColumns[binds.tableName].map(column => ({ CONSTRAINT_NAME: 'UK_KEY', COLUMN_NAME: column })) };
  } };
}

test('limits, validates and canonicalizes employee selection', () => {
  assert.deepEqual(normalizeEmployeeIds([12, '1', 12]), ['1', '12']);
  for (const invalid of [[], null, ['1 OR 1=1'], [0], [1.5], ['9007199254740993'], Array(101).fill(1)]) {
    assert.throws(() => normalizeEmployeeIds(invalid));
  }
});

test('requires explicit configuration and prevents SQL injection through mapping', () => {
  assert.throws(() => readOracleSettings({}), /not configured/);
  validateMapping(mapping);
  const bad = structuredClone(mapping);
  bad.up_emp.table = 'UP_EMP; DROP TABLE UP_EMP';
  assert.throws(() => validateMapping(bad), /Invalid column mapping/);
  bad.up_emp = { table: 'UP_EMP', columns: { NAME: 'NAME' } };
  assert.throws(() => validateMapping(bad), /Invalid column mapping/);
});

test('keeps text and dates in bind parameters, including nulls and Unicode', () => {
  assert.deepEqual(bindExpression('VARCHAR2', 0, "O'Brien বাংলা"), { expression: ':b0', value: "O'Brien বাংলা" });
  assert.deepEqual(bindExpression('NUMBER', 0, '12'), { expression: ':b0', value: 12 });
  assert.equal(bindExpression('DATE', 1, '2000-01-15').value, '2000-01-15 00:00:00.000000');
  assert.equal(bindExpression('DATE', 1, '').value, null);
  assert.throws(() => bindExpression('DATE', 0, '0000-00-00'), /invalid/);
  assert.throws(() => bindExpression('NUMBER', 0, '9007199254740993'), /precision/);
  assert.throws(() => bindExpression('NUMBER', 0, 'abc'), /invalid/);
});

test('preview fingerprint changes with source data, destination or mapping', () => {
  const snapshot = source();
  const hash = snapshotHash(snapshot, settings);
  assert.equal(snapshotHash(source(), settings), hash);
  snapshot.hr_empfamilydet[0].FNAME = 'Updated';
  assert.notEqual(snapshotHash(snapshot, settings), hash);
  assert.notEqual(snapshotHash(source(), { ...settings, connectString: 'other/service' }), hash);
  assert.notEqual(snapshotHash(source(), { ...settings, schema: 'OTHER' }), hash);
});

test('reads a consistent source snapshot and rejects missing, unapproved or mismatched records', async () => {
  for (const scenario of ['valid', 'missing', 'draft', 'mismatched']) {
    const data = source();
    if (scenario === 'missing') data.up_emp = [];
    if (scenario === 'draft') data.up_emp[0].APPROVAL_STATUS = 'DRAFT';
    if (scenario === 'mismatched') data.hr_empexamdet[0].EMPCODE = 'OTHER';
    let rolledBack = false;
    const queries = [];
    const mysql = {
      async query(sql) { queries.push(sql); },
      async execute(sql) { return [data[TABLES.find(table => sql.includes(`FROM ${table} `))]]; },
      async rollback() { rolledBack = true; }
    };
    if (scenario === 'valid') assert.deepEqual(await readSnapshot(mysql, ['1']), data);
    else await assert.rejects(readSnapshot(mysql, ['1']));
    assert.ok(queries.includes('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'));
    assert.ok(rolledBack);
  }
});

test('preflight rejects missing columns, required unmapped columns and non-unique matching keys', async () => {
  for (const options of [{ missingColumn: 'NAME' }, { missingConstraint: true }, { requiredExtra: true }]) {
    await assert.rejects(preparePlans(oracleMetadata(options), source(), settings));
  }
  const duplicate = source();
  duplicate.hr_empexamdet.push({ ...duplicate.hr_empexamdet[0] });
  await assert.rejects(preparePlans(oracleMetadata(), duplicate, settings), /Duplicate/);
});

test('plans use parent-first MERGE with stable composite child keys and bound values', async () => {
  const plans = await preparePlans(oracleMetadata(), source(), settings);
  assert.deepEqual(plans.map(plan => plan.source), TABLES);
  assert.match(plans[0].sql, /MERGE INTO HR.UP_EMP/);
  assert.match(plans[1].sql, /ON \(t.EMPCODE = s.EMPCODE AND t.SLNO = s.SLNO\)/);
  assert.match(plans[2].sql, /ON \(t.EMPCODE = s.EMPCODE AND t.CHILD_NOS = s.CHILD_NOS\)/);
  assert.ok(!plans[0].sql.includes("O'Brien"));
  assert.equal(plans[0].rows[0].b1, "O'Brien বাংলা");
  assert.match(plans[0].sql, /WHEN MATCHED THEN UPDATE/);
  assert.match(plans[0].sql, /WHEN NOT MATCHED THEN INSERT/);
});

test('commits only after all three tables and rolls back if a child write fails', async () => {
  const plans = await preparePlans(oracleMetadata(), source(), settings);
  for (const shouldFail of [false, true]) {
    const events = [];
    const oracle = {
      async executeMany(sql, rows, options) {
        assert.equal(options.autoCommit, false);
        assert.equal(options.batchErrors, false);
        events.push(sql.match(/MERGE INTO HR\.(\w+)/)[1]);
        if (shouldFail && events.length === 3) throw new Error('Child write failed');
      },
      async commit() { events.push('commit'); },
      async rollback() { events.push('rollback'); }
    };
    if (shouldFail) await assert.rejects(savePlans(oracle, plans), /Child write failed/);
    else await savePlans(oracle, plans);
    assert.deepEqual(events, ['UP_EMP', 'HR_EMPEXAMDET', 'HR_EMPFAMILYDET', shouldFail ? 'rollback' : 'commit']);
  }
});

test('empty child tables do not execute empty batches', async () => {
  const snapshot = source();
  snapshot.hr_empexamdet = [];
  snapshot.hr_empfamilydet = [];
  const plans = await preparePlans(oracleMetadata(), snapshot, settings);
  let writes = 0;
  await savePlans({ async executeMany() { writes++; }, async commit() {}, async rollback() {} }, plans);
  assert.equal(writes, 1);
});

test('portable export retains all three tables and rejects unsupported or broken employee relations', () => {
  const packet = createExportPacket(source());
  assert.deepEqual(readExportPacket(JSON.parse(JSON.stringify(packet))), source());
  assert.equal(packet.version, 1);
  assert.ok(!Object.hasOwn(packet, 'password'));
  assert.throws(() => readExportPacket({ ...packet, version: 2 }), /not a supported/);
  const orphan = structuredClone(packet);
  orphan.tables.hr_empfamilydet[0].EMP_ENTRY_ID = 2;
  assert.throws(() => readExportPacket(orphan), /do not match/);
  const duplicate = structuredClone(packet);
  duplicate.tables.up_emp.push({ ...duplicate.tables.up_emp[0] });
  assert.throws(() => readExportPacket(duplicate), /Duplicate employee/);
  const empty = structuredClone(packet);
  delete empty.tables.hr_empfamilydet;
  assert.throws(() => readExportPacket(empty), /must contain/);
});

test('local importer previews without writing, saves all tables, and closes on a failed import', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-import-test-'));
  const filename = path.join(folder, 'employees.json');
  t.after(() => { fs.unlinkSync(filename); fs.rmdirSync(folder); });
  fs.writeFileSync(filename, JSON.stringify(createExportPacket(source())));
  for (const mode of ['preview', 'save', 'failure']) {
    const events = [];
    const oracle = {
      ...oracleMetadata(),
      async executeMany() {
        events.push('write');
        if (mode === 'failure') throw new Error('Unavailable');
      },
      async commit() { events.push('commit'); },
      async rollback() { events.push('rollback'); },
      async close() { events.push('close'); }
    };
    const options = { settings, save: mode !== 'preview', connect: async () => oracle, log: () => {} };
    if (mode === 'failure') await assert.rejects(importOracleFile(filename, options), /Unavailable/);
    else assert.equal((await importOracleFile(filename, options)).length, 3);
    assert.deepEqual(events, mode === 'preview' ? ['close'] : mode === 'save' ? ['write', 'write', 'write', 'commit', 'close'] : ['write', 'rollback', 'close']);
  }
});
