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
  for (const invalid of [[], ['MISSING'], ['IPI', 'IPI'], 'IPI']) {
    const configured = structuredClone(mapping);
    configured.up_emp.keys = invalid;
    assert.throws(() => validateMapping(configured), /Invalid column mapping/);
  }
});

test('supports existing portal-schema primary keys and preserves relational IDs', async () => {
  const configured = structuredClone(mapping);
  for (const entry of Object.values(configured)) entry.columns.EMP_ENTRY_ID = 'EMP_ENTRY_ID';
  configured.up_emp.keys = ['EMP_ENTRY_ID'];
  configured.hr_empexamdet.keys = ['EMP_ENTRY_ID', 'SLNO'];
  configured.hr_empfamilydet.keys = ['EMP_ENTRY_ID', 'CHILD_NOS'];
  configured.hr_empfamilydet.columns.FAMILY_ID = 'FAMILY_ID';
  validateMapping(configured);
  const snapshot = source();
  snapshot.hr_empfamilydet[0].FAMILY_ID = 10;
  const oracle = { async execute(sql, binds) {
    const entry = Object.values(configured).find(value => value.table === binds.tableName);
    if (sql.includes('ALL_TAB_COLS')) return { rows: Object.values(entry.columns).map(column => ({
      COLUMN_NAME: column,
      DATA_TYPE: ['EMP_ENTRY_ID', 'FAMILY_ID', 'SLNO', 'CHILD_NOS'].includes(column) ? 'NUMBER' : column === 'BIRTHDATE' ? 'DATE' : 'VARCHAR2',
      NULLABLE: column === 'EMP_ENTRY_ID' ? 'N' : 'Y', DATA_DEFAULT: null, VIRTUAL_COLUMN: 'NO', IDENTITY_COLUMN: 'NO'
    })) };
    return { rows: entry.keys.map(key => ({ CONSTRAINT_NAME: 'EXISTING_KEY', COLUMN_NAME: entry.columns[key] })) };
  } };
  const plans = await preparePlans(oracle, snapshot, { ...settings, mapping: configured });
  assert.match(plans[0].sql, /ON \(t.EMP_ENTRY_ID = s.EMP_ENTRY_ID\)/);
  assert.match(plans[1].sql, /ON \(t.EMP_ENTRY_ID = s.EMP_ENTRY_ID AND t.SLNO = s.SLNO\)/);
  assert.match(plans[2].sql, /ON \(t.EMP_ENTRY_ID = s.EMP_ENTRY_ID AND t.CHILD_NOS = s.CHILD_NOS\)/);
  assert.equal(plans[2].rows[0].b4, 10);
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

test('reads all IPI-assigned employees regardless of status and rejects missing IPI or mismatched records', async () => {
  for (const scenario of ['valid', 'pending', 'rejected', 'draftWithIpi', 'missing', 'withoutIpi', 'whitespaceIpi', 'mismatched']) {
    const data = source();
    if (scenario === 'missing') data.up_emp = [];
    if (scenario === 'pending') data.up_emp[0].APPROVAL_STATUS = 'PENDING';
    if (scenario === 'rejected') data.up_emp[0].APPROVAL_STATUS = 'REJECTED';
    if (scenario === 'draftWithIpi') data.up_emp[0].APPROVAL_STATUS = 'DRAFT';
    if (scenario === 'withoutIpi') data.up_emp[0].IPI = null;
    if (scenario === 'whitespaceIpi') data.up_emp[0].IPI = '  ';
    if (scenario === 'mismatched') data.hr_empexamdet[0].EMPCODE = 'OTHER';
    let rolledBack = false;
    const queries = [];
    const mysql = {
      async query(sql) {
        queries.push(sql);
        if (sql.startsWith('SELECT')) return [data[TABLES.find(table => sql.includes(`FROM ${table} `))]];
      },
      async rollback() { rolledBack = true; }
    };
    if (['valid', 'pending', 'rejected', 'draftWithIpi'].includes(scenario)) assert.deepEqual(await readSnapshot(mysql, ['1']), data);
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

test('portable exports and local imports include every status when IPI is assigned', () => {
  for (const status of ['APPROVED', 'PENDING', 'REJECTED', 'DRAFT']) {
    const snapshot = source();
    snapshot.up_emp[0].APPROVAL_STATUS = status;
    const packet = createExportPacket(snapshot);
    assert.equal(readExportPacket(packet).up_emp[0].APPROVAL_STATUS, status);
  }
  for (const ipi of [null, '', '  ']) {
    const snapshot = source();
    snapshot.up_emp[0].IPI = ipi;
    assert.throws(() => createExportPacket(snapshot), /assigned IPI/);
    assert.throws(() => readExportPacket({ format: 'employee-portal-oracle', version: 1, tables: snapshot }), /assigned IPI/);
  }
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
