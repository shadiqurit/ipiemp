import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { requireAdmin } from '../auth.js';
import { normalizeEmployeeIds, readOracleSettings, openOracle, readSnapshot, snapshotHash, preparePlans, savePlans, createExportPacket } from '../services/oracle-transfer.js';

const router = Router();
router.use(requireAdmin);

// This download needs only the site's MySQL connection. Import on the Oracle PC.
router.post('/export', async (req, res, next) => {
  let mysql;
  try {
    const ids = normalizeEmployeeIds(req.body?.employeeIds);
    mysql = await pool.getConnection();
    const snapshot = await readSnapshot(mysql, ids);
    const filename = `employee-oracle-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.json(createExportPacket(snapshot));
  } catch (error) { next(error); }
  finally { mysql?.release(); }
});

// A signed preview binds this admin, source snapshot and destination together.
router.post('/:action', async (req, res, next) => {
  let mysql;
  let oracle;
  let locked = false;
  try {
    if (!['preview', 'transfer'].includes(req.params.action)) return res.sendStatus(404);
    const ids = normalizeEmployeeIds(req.body?.employeeIds);
    const settings = readOracleSettings();
    let preview;
    if (req.params.action === 'transfer') {
      try {
        preview = jwt.verify(req.body?.previewToken || '', process.env.JWT_SECRET, { audience: 'oracle-transfer', algorithms: ['HS256'] });
        if (preview.sub !== String(req.admin.userId) || JSON.stringify(preview.ids) !== JSON.stringify(ids)) throw new Error('Mismatch');
      } catch {
        return res.status(409).json({ message: 'The transfer preview expired or changed. Preview again before transferring.' });
      }
    }
    mysql = await pool.getConnection();
    // Serialize transfers across API processes sharing this source database.
    const [[lock]] = await mysql.query("SELECT GET_LOCK('employee_portal_oracle_transfer', 0) AS acquired");
    locked = Number(lock.acquired) === 1;
    if (!locked) return res.status(409).json({ message: 'Another Oracle transfer is running. Try again when it finishes.' });
    const snapshot = await readSnapshot(mysql, ids);
    const hash = snapshotHash(snapshot, settings);
    if (preview && preview.hash !== hash) return res.status(409).json({ message: 'Employee data or the Oracle destination changed. Preview again before transferring.' });
    oracle = await openOracle(settings);
    const plans = await preparePlans(oracle, snapshot, settings);
    const tables = plans.map(plan => ({ source: plan.source, target: `${settings.schema}.${plan.table}`, rows: plan.rows.length, keys: plan.keys, columns: plan.columns }));
    if (!preview) {
      return res.json({ tables, previewToken: jwt.sign({ ids, hash }, process.env.JWT_SECRET, { subject: String(req.admin.userId), audience: 'oracle-transfer', expiresIn: '10m', algorithm: 'HS256' }) });
    }
    await savePlans(oracle, plans);
    console.info('Oracle transfer committed', { adminUserId: req.admin.userId, tables: tables.map(({ target, rows }) => ({ target, rows })) });
    res.json({ tables, message: 'Selected employees and their education and family records were saved to Oracle.' });
  } catch (error) {
    if (error.status) return next(error);
    // Driver messages can contain connection details and employee data.
    console.error('Oracle transfer failed', { code: error.code || 'UNKNOWN' });
    res.status(502).json({ message: 'Oracle transfer could not be confirmed. Check the server connection, table definitions and data. Preview and retry; matching rows will be updated.' });
  } finally {
    if (oracle) await oracle.close().catch(() => {});
    if (mysql) {
      if (locked) {
        try { await mysql.query("SELECT RELEASE_LOCK('employee_portal_oracle_transfer')"); }
        catch { mysql.destroy(); mysql = null; }
      }
      mysql?.release();
    }
  }
});

export default router;
