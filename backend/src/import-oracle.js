import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { readExportPacket, readOracleSettings, openOracle, preparePlans, savePlans } from './services/oracle-transfer.js';

const usage = 'Usage: npm run oracle:import -- "path/to/employee-oracle-file.json" [--preview | --save]';

export async function importOracleFile(filename, { save = false, settings = readOracleSettings(), connect = openOracle, log = console.log } = {}) {
  const stats = fs.statSync(filename);
  if (!stats.isFile() || stats.size > 50 * 1024 * 1024) throw new Error('Choose an export file no larger than 50 MB.');
  const snapshot = readExportPacket(JSON.parse(fs.readFileSync(filename, 'utf8')));
  const oracle = await connect(settings);
  try {
    const plans = await preparePlans(oracle, snapshot, settings);
    for (const plan of plans) log(`${settings.schema}.${plan.table}: ${plan.rows.length} rows`);
    if (save) {
      await savePlans(oracle, plans);
      log('Saved all three tables to Oracle.');
    } else log('Preview complete. Run this command with --save to import these rows.');
    return plans.map(plan => ({ table: plan.table, rows: plan.rows.length }));
  } finally { await oracle.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [filename, mode = '--preview', ...extra] = process.argv.slice(2);
  if (!filename || filename.startsWith('--') || !['--preview', '--save'].includes(mode) || extra.length) {
    console.error(usage);
    process.exitCode = 1;
  } else {
    // Credentials stay on the local Oracle PC. No MySQL credentials are needed.
    dotenv.config({ path: path.resolve('.env.oracle'), quiet: true });
    try { await importOracleFile(path.resolve(filename), { save: mode === '--save' }); }
    catch (error) {
      console.error(error.status ? error.message : `Import could not be confirmed (${error.code || 'FILE_OR_CONNECTION_ERROR'}). Check the export file and Oracle connection. Preview and retry with the same file; matching rows will be updated.`);
      process.exitCode = 1;
    }
  }
}
