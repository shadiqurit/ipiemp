import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { normalizeEmployeeIds, readSnapshot, createExportPacket, TABLES } from './oracle-transfer.js';

const compress = promisify(gzip);

export function acquireExportConnection(pool, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    let abandoned = false;
    const cancel = () => { abandoned = true; reject(signal.reason); };
    signal.addEventListener('abort', cancel, { once: true });
    pool.getConnection().then(connection => {
      signal.removeEventListener('abort', cancel);
      if (abandoned || signal.aborted) { connection.release(); return; }
      resolve(connection);
    }, error => {
      signal.removeEventListener('abort', cancel);
      if (!abandoned) reject(error);
    });
  });
}

export function createOracleExportHandlers({ pool, authorize, timeoutMs = 20000, read = readSnapshot, log = console.info }) {
  const deadline = (req, res, next) => {
    const controller = new AbortController();
    const state = { controller, stage: 'authorization', started: performance.now() };
    req.oracleExport = state;
    const timer = setTimeout(() => {
      const error = Object.assign(new Error('The database export took too long. Please retry; if it persists, ask the server administrator to check the MySQL connection.'), { status: 504 });
      controller.abort(error);
      log('Oracle export timed out', { stage: state.stage, milliseconds: Math.round(performance.now() - state.started) });
      if (!res.headersSent && !res.destroyed) res.status(504).json({ message: error.message });
    }, timeoutMs);
    res.once('finish', () => clearTimeout(timer));
    res.once('close', () => {
      clearTimeout(timer);
      if (!res.writableFinished) controller.abort(new Error('Download canceled.'));
    });
    next();
  };

  const download = async (req, res) => {
    const state = req.oracleExport;
    const signal = state.controller.signal;
    if (signal.aborted) return;
    let connection;
    const cancelRead = () => connection?.destroy();
    try {
      const ids = normalizeEmployeeIds(req.body?.employeeIds);
      state.stage = 'waiting for MySQL';
      connection = await acquireExportConnection(pool, signal);
      signal.addEventListener('abort', cancelRead, { once: true });
      if (signal.aborted) { connection.destroy(); return; }
      state.stage = 'reading employee tables';
      const snapshot = await read(connection, ids);
      signal.removeEventListener('abort', cancelRead);
      if (signal.aborted) return;
      connection.release();
      connection = null;
      state.stage = 'preparing file';
      const packet = createExportPacket(snapshot);
      const counts = TABLES.map(table => ({ source: table, rows: snapshot[table].length }));
      const payload = Buffer.from(JSON.stringify(packet));
      const useGzip = payload.length >= 1024 && req.acceptsEncodings('gzip') === 'gzip';
      const body = useGzip ? await compress(payload) : payload;
      if (signal.aborted || res.destroyed) return;
      res.setHeader('Content-Disposition', `attachment; filename="employee-oracle-${packet.exportedAt.replace(/[:.]/g, '-')}.json"`);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Oracle-Row-Counts', JSON.stringify(counts));
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Oracle-Row-Counts');
      res.vary('Accept-Encoding');
      if (useGzip) res.setHeader('Content-Encoding', 'gzip');
      res.type('application/json').send(body);
      log('Oracle export completed', { milliseconds: Math.round(performance.now() - state.started), bytes: payload.length, transmittedBytes: body.length, tables: counts });
    } catch (error) {
      if (!signal.aborted && !res.headersSent && !res.destroyed) {
        if (!error.status) log('Oracle export failed', { code: error.code || 'UNKNOWN', stage: state.stage });
        res.status(error.status || 502).json({ message: error.status ? error.message : 'The export could not read MySQL. Check the database connection and try again.' });
      }
    } finally {
      signal.removeEventListener('abort', cancelRead);
      if (connection && !signal.aborted) connection.release();
    }
  };
  return [deadline, authorize, download];
}
