import fs from 'node:fs';
import { createHash } from 'node:crypto';
import oracledb from 'oracledb';

export const TABLES = ['up_emp', 'hr_empexamdet', 'hr_empfamilydet'];
const KEYS = { up_emp: ['IPI'], hr_empexamdet: ['EMPCODE', 'SLNO'], hr_empfamilydet: ['EMPCODE', 'CHILD_NOS'] };
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const identifier = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(value);

export function normalizeEmployeeIds(value) {
  if (!Array.isArray(value) || !value.length || value.length > 100
      || value.some(id => !/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id)))) {
    throw fail('Select between 1 and 100 employees.');
  }
  return [...new Set(value.map(String))].sort((a, b) => Number(a) - Number(b));
}

export function readOracleSettings(env = process.env) {
  if (env.ORACLE_TRANSFER_ENABLED !== 'true' || !env.ORACLE_USER || !env.ORACLE_PASSWORD
      || !env.ORACLE_CONNECT_STRING || !env.ORACLE_TRANSFER_MAPPING_PATH) {
    throw fail('Oracle transfer is not configured. Ask the server administrator to configure the Oracle connection and reviewed column mapping.', 503);
  }
  const schema = String(env.ORACLE_SCHEMA || env.ORACLE_USER).toUpperCase();
  if (!identifier(schema)) throw fail('Invalid Oracle schema configuration.', 503);
  let mapping;
  try { mapping = JSON.parse(fs.readFileSync(env.ORACLE_TRANSFER_MAPPING_PATH, 'utf8')); }
  catch { throw fail('The Oracle transfer mapping file could not be read.', 503); }
  validateMapping(mapping);
  return { schema, mapping, user: env.ORACLE_USER, password: env.ORACLE_PASSWORD, connectString: env.ORACLE_CONNECT_STRING };
}

export function validateMapping(mapping) {
  for (const table of TABLES) {
    const entry = mapping?.[table];
    if (!entry || !identifier(entry.table) || !entry.columns || Array.isArray(entry.columns)
        || !Object.keys(entry.columns).length
        || Object.entries(entry.columns).some(([source, target]) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(source) || !identifier(target))
        || new Set(Object.values(entry.columns)).size !== Object.keys(entry.columns).length
        || KEYS[table].some(key => !entry.columns[key])) {
      throw fail(`Invalid column mapping for ${table}. Map every matching key and use unique Oracle column names.`, 503);
    }
  }
  if (new Set(TABLES.map(table => mapping[table].table)).size !== TABLES.length) {
    throw fail('Each source table must map to a different Oracle table.', 503);
  }
}

export async function openOracle(settings) {
  const connection = await oracledb.getConnection({ user: settings.user, password: settings.password, connectString: settings.connectString });
  connection.callTimeout = 30000;
  return connection;
}

export async function readSnapshot(connection, ids) {
  const placeholders = ids.map(() => '?').join(',');
  await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  try {
    const [employees] = await connection.execute(`SELECT * FROM up_emp WHERE EMP_ENTRY_ID IN (${placeholders}) ORDER BY EMP_ENTRY_ID`, ids);
    if (employees.length !== ids.length) throw fail('One or more selected employees no longer exist. Refresh the list.', 409);
    if (employees.some(row => row.APPROVAL_STATUS !== 'APPROVED' || !String(row.IPI || '').trim())) {
      throw fail('Only approved employees with an assigned IPI can be transferred.', 409);
    }
    const snapshot = { up_emp: employees };
    for (const table of TABLES.slice(1)) {
      const order = table === 'hr_empexamdet' ? 'SLNO' : 'CHILD_NOS';
      const [rows] = await connection.execute(`SELECT * FROM ${table} WHERE EMP_ENTRY_ID IN (${placeholders}) ORDER BY EMP_ENTRY_ID, ${order}`, ids);
      const ipis = new Map(employees.map(row => [String(row.EMP_ENTRY_ID), row.IPI]));
      if (rows.some(row => row.EMPCODE !== ipis.get(String(row.EMP_ENTRY_ID)))) {
        throw fail(`Employee codes in ${table} do not match their assigned IPI. Correct them before transferring.`, 409);
      }
      snapshot[table] = rows;
    }
    validateSnapshot(snapshot);
    return snapshot;
  } finally { await connection.rollback(); }
}

export function validateSnapshot(snapshot) {
  if (!snapshot || TABLES.some(table => !Array.isArray(snapshot[table])
      || snapshot[table].some(row => !row || typeof row !== 'object' || Array.isArray(row)))) {
    throw fail('The export must contain employee, education and family tables.');
  }
  const ids = normalizeEmployeeIds(snapshot.up_emp.map(row => row.EMP_ENTRY_ID));
  if (ids.length !== snapshot.up_emp.length) throw fail('Duplicate employee entries found in the export.');
  const ipis = new Map(snapshot.up_emp.map(row => [String(row.EMP_ENTRY_ID), row.IPI]));
  if (snapshot.up_emp.some(row => row.APPROVAL_STATUS !== 'APPROVED' || !String(row.IPI || '').trim())) {
    throw fail('Only approved employees with an assigned IPI can be transferred.');
  }
  for (const table of TABLES.slice(1)) {
    if (snapshot[table].some(row => !ipis.has(String(row.EMP_ENTRY_ID)) || row.EMPCODE !== ipis.get(String(row.EMP_ENTRY_ID)))) {
      throw fail(`Employee codes in ${table} do not match their assigned IPI. Correct them before transferring.`);
    }
  }
  return snapshot;
}

export function createExportPacket(snapshot) {
  validateSnapshot(snapshot);
  return { format: 'employee-portal-oracle', version: 1, exportedAt: new Date().toISOString(), tables: snapshot };
}

export function readExportPacket(packet) {
  if (packet?.format !== 'employee-portal-oracle' || packet.version !== 1) {
    throw fail('This is not a supported employee portal Oracle export file.');
  }
  return validateSnapshot(packet.tables);
}

export function snapshotHash(snapshot, settings) {
  return createHash('sha256').update(JSON.stringify({ snapshot, schema: settings.schema, mapping: settings.mapping, target: settings.connectString, user: settings.user })).digest('hex');
}

export function bindExpression(type, index, value) {
  const bind = `:b${index}`;
  if (type === 'DATE' || /^TIMESTAMP(?:\(\d+\))?$/.test(type)) {
    if (value !== null && value !== undefined && value !== '') {
      const text = String(value);
      if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2}(\.\d{1,6})?)?$/.test(text)
          || text.startsWith('0000-') || text.slice(5, 7) === '00' || text.slice(8, 10) === '00') {
        throw fail('A source date is invalid for Oracle. Correct it before transferring.');
      }
    }
    const text = value ? String(value) : null;
    const normalized = text?.length === 10 ? `${text} 00:00:00` : text;
    return { expression: `TO_TIMESTAMP(${bind}, 'YYYY-MM-DD HH24:MI:SS.FF6')`, value: normalized ? (normalized.includes('.') ? normalized : `${normalized}.000000`) : null };
  }
  if (type === 'NUMBER' || type === 'FLOAT') {
    if (value !== null && value !== undefined && value !== '' && !/^[+-]?\d+(\.\d+)?$/.test(String(value))) {
      throw fail('A source number is invalid for Oracle. Correct it before transferring.');
    }
    const number = value === null || value === undefined || value === '' ? null : Number(value);
    if (number !== null && (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number)))) {
      throw fail('A source number exceeds the supported precision. Review the Oracle mapping.');
    }
    return { expression: bind, value: number };
  }
  if (!['VARCHAR2', 'NVARCHAR2', 'CHAR', 'NCHAR'].includes(type)) throw fail(`Unsupported Oracle column type: ${type}. Review the mapping.`, 409);
  return { expression: bind, value: value === null || value === undefined || value === '' ? null : String(value) };
}

export async function preparePlans(oracle, snapshot, settings) {
  const plans = [];
  for (const source of TABLES) {
    const mapping = settings.mapping[source];
    const binds = { owner: settings.schema, tableName: mapping.table };
    const { rows: metadata } = await oracle.execute(
      `SELECT COLUMN_NAME, DATA_TYPE, NULLABLE, DATA_DEFAULT, VIRTUAL_COLUMN, IDENTITY_COLUMN
       FROM ALL_TAB_COLS WHERE OWNER = :owner AND TABLE_NAME = :tableName AND HIDDEN_COLUMN = 'NO'`, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    if (!metadata.length) throw fail(`Oracle table ${mapping.table} was not found or is not accessible.`, 409);
    const columns = Object.entries(mapping.columns);
    const targetColumns = new Set(columns.map(([, target]) => target));
    for (const [, target] of columns) {
      const meta = metadata.find(row => row.COLUMN_NAME === target);
      if (!meta || meta.VIRTUAL_COLUMN === 'YES' || meta.IDENTITY_COLUMN === 'YES') {
        throw fail(`Oracle column ${mapping.table}.${target} is missing or generated. Review the mapping.`, 409);
      }
    }
    const required = metadata.filter(row => row.NULLABLE === 'N' && !row.DATA_DEFAULT && row.VIRTUAL_COLUMN !== 'YES' && row.IDENTITY_COLUMN !== 'YES' && !targetColumns.has(row.COLUMN_NAME));
    if (required.length) throw fail(`Map required Oracle columns in ${mapping.table}: ${required.map(row => row.COLUMN_NAME).join(', ')}.`, 409);
    const keys = KEYS[source].map(key => mapping.columns[key]);
    const { rows: constraints } = await oracle.execute(
      `SELECT c.CONSTRAINT_NAME, cc.COLUMN_NAME FROM ALL_CONSTRAINTS c
       JOIN ALL_CONS_COLUMNS cc ON cc.OWNER = c.OWNER AND cc.CONSTRAINT_NAME = c.CONSTRAINT_NAME AND cc.TABLE_NAME = c.TABLE_NAME
       WHERE c.OWNER = :owner AND c.TABLE_NAME = :tableName AND c.CONSTRAINT_TYPE IN ('P','U') AND c.STATUS = 'ENABLED' AND c.VALIDATED = 'VALIDATED'`, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const groups = new Map();
    for (const row of constraints) groups.set(row.CONSTRAINT_NAME, [...(groups.get(row.CONSTRAINT_NAME) || []), row.COLUMN_NAME]);
    if (![...groups.values()].some(group => group.length === keys.length && keys.every(key => group.includes(key)))) {
      throw fail(`Oracle ${mapping.table} needs a validated unique constraint on (${keys.join(', ')}) for repeatable transfers.`, 409);
    }
    const types = columns.map(([, target]) => metadata.find(row => row.COLUMN_NAME === target).DATA_TYPE);
    const expressions = types.map((type, index) => bindExpression(type, index, null).expression);
    const sourceRows = snapshot[source];
    const seen = new Set();
    const rows = sourceRows.map(row => {
      if (columns.some(([column]) => !Object.hasOwn(row, column))) throw fail(`Source columns for ${source} do not match the configured mapping.`, 409);
      const key = KEYS[source].map(column => row[column]);
      if (key.some(value => value === null || value === undefined || String(value).trim() === '')) throw fail(`A matching key is empty in ${source}.`, 409);
      const serializedKey = JSON.stringify(key);
      if (seen.has(serializedKey)) throw fail(`Duplicate matching keys found in ${source}.`, 409);
      seen.add(serializedKey);
      return Object.fromEntries(columns.map(([column], index) => [`b${index}`, bindExpression(types[index], index, row[column]).value]));
    });
    const updates = columns.filter(([, target]) => !keys.includes(target)).map(([, target]) => `t.${target} = s.${target}`);
    const sql = `MERGE INTO ${settings.schema}.${mapping.table} t
      USING (SELECT ${columns.map(([, target], index) => `${expressions[index]} ${target}`).join(', ')} FROM DUAL) s
      ON (${keys.map(key => `t.${key} = s.${key}`).join(' AND ')})
      ${updates.length ? `WHEN MATCHED THEN UPDATE SET ${updates.join(', ')}` : ''}
      WHEN NOT MATCHED THEN INSERT (${columns.map(([, target]) => target).join(', ')})
      VALUES (${columns.map(([, target]) => `s.${target}`).join(', ')})`;
    plans.push({ source, table: mapping.table, keys, sql, rows, columns: mapping.columns });
  }
  return plans;
}

export async function savePlans(oracle, plans) {
  try {
    for (const plan of plans) {
      for (let offset = 0; offset < plan.rows.length; offset += 200) {
        await oracle.executeMany(plan.sql, plan.rows.slice(offset, offset + 200), { autoCommit: false, batchErrors: false });
      }
    }
    await oracle.commit();
  } catch (error) {
    await oracle.rollback().catch(() => {});
    throw error;
  }
}
