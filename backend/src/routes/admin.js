import { Router } from 'express';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { pool } from '../db.js';
import { requireAdmin, signAdmin } from '../auth.js';

const router = Router();

router.post('/login', async (req, res, next) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    const [rows] = await pool.execute(
      `SELECT *
         FROM ADMIN_USER
        WHERE USERNAME = ?
          AND ACTIVE_YN = 'Y'
        LIMIT 1`,
      [username]
    );

    const user = rows[0];

    if (!user || !(await bcrypt.compare(password, user.PASSWORD_HASH))) {
      return res.status(401).json({
        message: 'Invalid username or password.'
      });
    }

    res.json({
      token: signAdmin(user),
      user: {
        username: user.USERNAME,
        displayName: user.DISPLAY_NAME
      }
    });

  } catch (e) {
    next(e);
  }
});

router.use(requireAdmin);

router.get('/batches', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT *
         FROM HR_BATCH_CONTROL
        ORDER BY CREATED_AT DESC`
    );

    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/batches', async (req, res, next) => {
  const batchNo = String(req.body?.batchNo || '').trim();

  if (!batchNo) {
    return res.status(400).json({
      message: 'Batch number is required.'
    });
  }

  try {
    await pool.execute(
      `INSERT INTO HR_BATCH_CONTROL
       (BATCH_NO, STATUS, CREATED_BY)
       VALUES (?, 'INACTIVE', ?)`,
      [batchNo, req.admin.username]
    );

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.patch('/batches/:batchNo/status', async (req, res, next) => {
  const batchNo = req.params.batchNo;
  const status = String(req.body?.status || '').toUpperCase();

  if (!['ACTIVE','INACTIVE'].includes(status)) {
    return res.status(400).json({
      message: 'Status must be ACTIVE or INACTIVE.'
    });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    await conn.query(
      `SELECT BATCH_NO
         FROM HR_BATCH_CONTROL
        FOR UPDATE`
    );

    if (status === 'ACTIVE') {
      await conn.execute(
        `UPDATE HR_BATCH_CONTROL
            SET STATUS = 'INACTIVE',
                CLOSED_AT = NOW()
          WHERE STATUS = 'ACTIVE'
            AND BATCH_NO <> ?`,
        [batchNo]
      );

      await conn.execute(
        `UPDATE HR_BATCH_CONTROL
            SET STATUS = 'ACTIVE',
                STARTED_AT = COALESCE(STARTED_AT, NOW()),
                CLOSED_AT = NULL,
                UPDATED_AT = NOW()
          WHERE BATCH_NO = ?`,
        [batchNo]
      );

    } else {
      await conn.execute(
        `UPDATE HR_BATCH_CONTROL
            SET STATUS = 'INACTIVE',
                CLOSED_AT = NOW(),
                UPDATED_AT = NOW()
          WHERE BATCH_NO = ?`,
        [batchNo]
      );
    }

    await conn.commit();
    res.json({ ok: true });

  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
});

/**
 * List employee records so admin can assign IPI using Merit List ID + Class ID.
 */
router.get('/employees', async (req, res, next) => {
  try {
    const batchNo = String(req.query.batchNo || '').trim();
    const params = [];
    let where = '';

    if (batchNo) {
      where = 'WHERE e.batch_no = ?';
      params.push(batchNo);
    }

    const [rows] = await pool.execute(
      `SELECT e.EMP_ENTRY_ID,
              e.MERITLIST_ID,
              e.CLASS_ID,
              e.IPI,
              e.NAME,
              e.PHONE,
              e.batch_no,
              e.CREATED_AT,
              e.UPDATED_AT
         FROM UP_EMP e
         ${where}
        ORDER BY e.CREATED_AT DESC, e.EMP_ENTRY_ID DESC`,
      params
    );

    res.json(rows);

  } catch (e) {
    next(e);
  }
});

/**
 * Admin assigns or changes IPI.
 * Education EMPCODE is synchronized in the same transaction.
 */
router.patch('/employees/:empEntryId/ipi', async (req, res, next) => {
  const empEntryId = Number(req.params.empEntryId);
  const ipi = String(req.body?.ipi || '').trim();

  if (!Number.isInteger(empEntryId) || empEntryId <= 0) {
    return res.status(400).json({
      message: 'Invalid employee entry ID.'
    });
  }

  if (!ipi) {
    return res.status(400).json({
      message: 'IPI is required.'
    });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [employees] = await conn.execute(
      `SELECT EMP_ENTRY_ID, MERITLIST_ID, CLASS_ID, IPI
         FROM UP_EMP
        WHERE EMP_ENTRY_ID = ?
        FOR UPDATE`,
      [empEntryId]
    );

    if (!employees[0]) {
      throw Object.assign(
        new Error('Employee record not found.'),
        { status: 404 }
      );
    }

    const [duplicate] = await conn.execute(
      `SELECT EMP_ENTRY_ID
         FROM UP_EMP
        WHERE IPI = ?
          AND EMP_ENTRY_ID <> ?
        LIMIT 1`,
      [ipi, empEntryId]
    );

    if (duplicate[0]) {
      throw Object.assign(
        new Error('This IPI is already assigned to another employee.'),
        { status: 409 }
      );
    }

    await conn.execute(
      `UPDATE UP_EMP
          SET IPI = ?,
              UPDATED_AT = NOW()
        WHERE EMP_ENTRY_ID = ?`,
      [ipi, empEntryId]
    );

    await conn.execute(
      `UPDATE HR_EMPEXAMDET
          SET EMPCODE = ?
        WHERE EMP_ENTRY_ID = ?`,
      [ipi, empEntryId]
    );

    await conn.execute(
      `UPDATE HR_UPDATE_REQUEST
          SET IPI = ?,
              UPDATED_AT = NOW()
        WHERE EMP_ENTRY_ID = ?`,
      [ipi, empEntryId]
    );

    await conn.commit();

    res.json({
      ok: true,
      message:
        'IPI assigned successfully to Merit List ID ' +
        employees[0].MERITLIST_ID +
        ' / Class ID ' +
        employees[0].CLASS_ID +
        '.'
    });

  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
});

router.get('/update-requests', async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE HR_UPDATE_REQUEST
          SET STATUS = 'EXPIRED'
        WHERE STATUS = 'APPROVED'
          AND APPROVED_UNTIL <= NOW()`
    );

    const status = String(req.query.status || '').toUpperCase();
    const params = [];
    let where = '';

    if (['PENDING','APPROVED','REJECTED','EXPIRED'].includes(status)) {
      where = 'WHERE r.STATUS = ?';
      params.push(status);
    }

    const [rows] = await pool.execute(
      `SELECT r.*, e.NAME, e.PHONE
         FROM HR_UPDATE_REQUEST r
         JOIN UP_EMP e
           ON e.EMP_ENTRY_ID = r.EMP_ENTRY_ID
         ${where}
        ORDER BY r.REQUESTED_AT DESC`,
      params
    );

    res.json(rows);

  } catch (e) {
    next(e);
  }
});

router.patch('/update-requests/:requestId', async (req, res, next) => {
  const status = String(req.body?.status || '').toUpperCase();
  const remark = String(req.body?.remark || '').trim();

  if (!['APPROVED','REJECTED'].includes(status)) {
    return res.status(400).json({
      message: 'Status must be APPROVED or REJECTED.'
    });
  }

  try {
    if (status === 'APPROVED') {
      await pool.execute(
        `UPDATE HR_UPDATE_REQUEST
            SET STATUS = 'APPROVED',
                APPROVED_AT = NOW(),
                APPROVED_UNTIL = DATE_ADD(NOW(), INTERVAL 24 HOUR),
                APPROVED_BY = ?,
                ADMIN_REMARKS = ?,
                UPDATED_AT = NOW()
          WHERE REQUEST_ID = ?`,
        [req.admin.username, remark || null, req.params.requestId]
      );

    } else {
      await pool.execute(
        `UPDATE HR_UPDATE_REQUEST
            SET STATUS = 'REJECTED',
                APPROVED_AT = NULL,
                APPROVED_UNTIL = NULL,
                APPROVED_BY = ?,
                ADMIN_REMARKS = ?,
                UPDATED_AT = NOW()
          WHERE REQUEST_ID = ?`,
        [req.admin.username, remark || null, req.params.requestId]
      );
    }

    res.json({ ok: true });

  } catch (e) {
    next(e);
  }
});

router.get('/export/:batchNo', async (req, res, next) => {
  try {
    const batchNo = req.params.batchNo;

    const [employees] = await pool.execute(
      `SELECT
          IPI,
          NAME,
          batch_no,
          BIRTHDATE,
          BLD_GROUP,
          GENDER,
          RELIGION,
          NATIONALITY,
          MARITAL_STATUS,
          EMAIL,
          PHONE,
          PHONE1,
          HEIGHT,
          WEIGHT,
          NID,
          PERMANENT_VILLAGE,
          PERMANENT_POST,
          PERMANENT_THANA,
          PERMANENT_DISTRICT,
          PRESENT_VILLAGE,
          PRESENT_POST,
          PRESENT_THANA,
          PRESENT_DISTRICT,
          EMGRCNY_PERSON,
          EMGRCNY_RELATION,
          EMGRCNY_ADDRESS,
          EMGRCNY_PHONE,
          FATHER_NAME,
          FATHER_PHONE,
          MOTHER_NAME,
          MOTHER_PHONE,
          SPOUSE_NAME,
          SPOSE_MARRIAGE_DATE,
          SPOSE_OCCUPATION,
          SPOUSE_PHONE,
          GRNT_NAME,
          GRNT_RELE,
          GRNT_FATHER,
          GRNT_PRESENT_ADD,
          GRNT_PERMANET_ADD,
          GRNT_NATIONALITY,
          GRNT_PROFFESSION,
          GRNT_NID,
          GRNT_MOBILE,
          CREATED_AT,
          UPDATED_AT
        FROM UP_EMP
       WHERE batch_no = ?
       ORDER BY MERITLIST_ID, CLASS_ID`,
      [batchNo]
    );

    const [exams] = await pool.execute(
      `SELECT
          d.SLNO,
          d.EMPCODE,
          d.EXAMNAME,
          d.EXAMGROUP,
          d.BOARD,
          d.CLAS,
          d.PASSYEAR,
          d.REMARKS,
          d.INSTITUTE,
          d.SUBJECT_NAME
        FROM HR_EMPEXAMDET d
        JOIN UP_EMP e
          ON e.EMP_ENTRY_ID = d.EMP_ENTRY_ID
       WHERE e.batch_no = ?
       ORDER BY e.MERITLIST_ID, e.CLASS_ID, d.SLNO`,
      [batchNo]
    );

    const workbook = new ExcelJS.Workbook();
    const empSheet = workbook.addWorksheet('UP_EMP');
    const examSheet = workbook.addWorksheet('HR_EMPEXAMDET');

    if (employees.length) {
      empSheet.columns = Object.keys(employees[0]).map(k => ({
        header: k,
        key: k,
        width: 18
      }));
      employees.forEach(r => empSheet.addRow(r));
    } else {
      empSheet.addRow(['No data']);
    }

    if (exams.length) {
      examSheet.columns = Object.keys(exams[0]).map(k => ({
        header: k,
        key: k,
        width: 18
      }));
      exams.forEach(r => examSheet.addRow(r));
    } else {
      examSheet.addRow(['No data']);
    }

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Employee_Data_${batchNo}.xlsx"`
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (e) {
    next(e);
  }
});

export default router;
