import { Router } from 'express';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { pool } from '../db.js';
import { requireAdmin, signAdmin } from '../auth.js';

const router = Router();

const EMP_COLUMNS = [
  'NAME','BIRTHDATE','BLD_GROUP','GENDER','RELIGION','NATIONALITY',
  'MARITAL_STATUS','EMAIL','PHONE','PHONE1','HEIGHT','WEIGHT','NID',
  'PERMANENT_VILLAGE','PERMANENT_POST','PERMANENT_THANA','PERMANENT_DISTRICT',
  'PRESENT_VILLAGE','PRESENT_POST','PRESENT_THANA','PRESENT_DISTRICT',
  'EMGRCNY_PERSON','EMGRCNY_RELATION','EMGRCNY_ADDRESS','EMGRCNY_PHONE',
  'FATHER_NAME','FATHER_PHONE','MOTHER_NAME','MOTHER_PHONE','SPOUSE_NAME',
  'SPOSE_MARRIAGE_DATE','SPOSE_OCCUPATION','SPOUSE_PHONE','GRNT_NAME',
  'GRNT_RELE','GRNT_FATHER','GRNT_PRESENT_ADD','GRNT_PERMANET_ADD',
  'GRNT_NATIONALITY','GRNT_PROFFESSION','GRNT_NID','GRNT_MOBILE'
];

const EXAM_COLUMNS = [
  'EXAMNAME','EXAMGROUP','BOARD','CLAS','PASSYEAR',
  'REMARKS','INSTITUTE','SUBJECT_NAME'
];

function cleanObj(input, columns) {
  const result = {};
  for (const column of columns) {
    const value = input?.[column];
    result[column] = typeof value === 'string' ? value.trim() : (value ?? null);
  }
  return result;
}

function validateEmployee(employee) {
  if (!employee.NAME || !employee.PHONE) {
    throw Object.assign(new Error('Employee name and primary phone are required.'), { status: 400 });
  }

  const allowed = {
    GENDER: ['', 'M', 'F'],
    RELIGION: ['', 'I', 'H', 'B', 'C'],
    MARITAL_STATUS: ['', 'U', 'M']
  };

  for (const [field, values] of Object.entries(allowed)) {
    if (!values.includes(employee[field] || '')) {
      throw Object.assign(new Error(`Invalid ${field} value.`), { status: 400 });
    }
  }
}

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

router.get('/users', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT USER_ID, USERNAME, DISPLAY_NAME, ACTIVE_YN, CREATED_AT
         FROM ADMIN_USER
        ORDER BY CREATED_AT DESC, USER_ID DESC`
    );

    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/users', async (req, res, next) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const displayName = String(req.body?.displayName || '').trim();

  if (!/^[A-Za-z0-9._-]{3,100}$/.test(username)) {
    return res.status(400).json({
      message: 'Username must be 3–100 characters and use letters, numbers, dot, dash or underscore only.'
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      message: 'Password must be at least 8 characters.'
    });
  }

  try {
    const hash = await bcrypt.hash(password, 12);

    await pool.execute(
      `INSERT INTO ADMIN_USER (USERNAME, PASSWORD_HASH, DISPLAY_NAME)
       VALUES (?, ?, ?)`,
      [username, hash, displayName || username]
    );

    res.status(201).json({ ok: true, message: 'Admin user created.' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      e.status = 409;
      e.message = 'This username already exists.';
    }
    next(e);
  }
});

router.patch('/users/:userId/password', async (req, res, next) => {
  const userId = Number(req.params.userId);
  const password = String(req.body?.password || '');

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Invalid user ID.' });
  }

  if (password.length < 8) {
    return res.status(400).json({
      message: 'Password must be at least 8 characters.'
    });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute(
      `UPDATE ADMIN_USER
          SET PASSWORD_HASH = ?, ACTIVE_YN = 'Y'
        WHERE USER_ID = ?`,
      [hash, userId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: 'Admin user not found.' });
    }

    res.json({ ok: true, message: 'User password updated.' });
  } catch (e) {
    next(e);
  }
});

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
    const search = String(req.query.search || '').trim();
    const params = [];
    const conditions = [];

    if (batchNo) {
      conditions.push('e.batch_no = ?');
      params.push(batchNo);
    }

    if (search) {
      const searchValue = `%${search}%`;
      conditions.push(`(
        e.MERITLIST_ID LIKE ? OR
        e.CLASS_ID LIKE ? OR
        e.IPI LIKE ? OR
        e.NAME LIKE ? OR
        e.PHONE LIKE ?
      )`);
      params.push(searchValue, searchValue, searchValue, searchValue, searchValue);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows] = await pool.execute(
      `SELECT e.EMP_ENTRY_ID,
              e.MERITLIST_ID,
              e.CLASS_ID,
              e.IPI,
              e.APPROVAL_STATUS,
              e.APPROVED_BY,
              e.APPROVED_AT,
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

router.get('/employees/:empEntryId', async (req, res, next) => {
  const empEntryId = Number(req.params.empEntryId);

  if (!Number.isInteger(empEntryId) || empEntryId <= 0) {
    return res.status(400).json({ message: 'Invalid employee entry ID.' });
  }

  try {
    const [employees] = await pool.execute(
      `SELECT * FROM UP_EMP WHERE EMP_ENTRY_ID = ? LIMIT 1`,
      [empEntryId]
    );

    if (!employees[0]) {
      return res.status(404).json({ message: 'Employee record not found.' });
    }

    const [education] = await pool.execute(
      `SELECT SLNO, EMP_ENTRY_ID, EMPCODE, EXAMNAME, EXAMGROUP, BOARD, CLAS,
              PASSYEAR, REMARKS, INSTITUTE, SUBJECT_NAME
         FROM HR_EMPEXAMDET
        WHERE EMP_ENTRY_ID = ?
        ORDER BY SLNO`,
      [empEntryId]
    );

    res.json({ employee: employees[0], education });
  } catch (e) {
    next(e);
  }
});

router.put('/employees/:empEntryId', async (req, res, next) => {
  const empEntryId = Number(req.params.empEntryId);
  const employee = cleanObj(req.body?.employee, EMP_COLUMNS);
  const meritlistId = String(req.body?.employee?.MERITLIST_ID || '').trim();
  const classId = String(req.body?.employee?.CLASS_ID || '').trim();
  const ipi = String(req.body?.employee?.IPI || '').trim();
  const batchNo = String(req.body?.batchNo || '').trim();
  const approvalStatus = String(req.body?.approvalStatus || '').toUpperCase();
  const education = Array.isArray(req.body?.education) ? req.body.education : [];

  if (!Number.isInteger(empEntryId) || empEntryId <= 0) {
    return res.status(400).json({ message: 'Invalid employee entry ID.' });
  }

  if (!meritlistId || !classId || !batchNo) {
    return res.status(400).json({
      message: 'Merit List ID, Class ID and batch are required.'
    });
  }

  if (!['PENDING', 'APPROVED', 'REJECTED'].includes(approvalStatus)) {
    return res.status(400).json({ message: 'Invalid approval status.' });
  }

  try {
    validateEmployee(employee);
  } catch (e) {
    return next(e);
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [existing] = await conn.execute(
      `SELECT EMP_ENTRY_ID FROM UP_EMP WHERE EMP_ENTRY_ID = ? FOR UPDATE`,
      [empEntryId]
    );

    if (!existing[0]) {
      throw Object.assign(new Error('Employee record not found.'), { status: 404 });
    }

    const [batch] = await conn.execute(
      `SELECT BATCH_NO FROM HR_BATCH_CONTROL WHERE BATCH_NO = ? LIMIT 1`,
      [batchNo]
    );

    if (!batch[0]) {
      throw Object.assign(new Error('Selected batch does not exist.'), { status: 400 });
    }

    const [duplicateIdentity] = await conn.execute(
      `SELECT EMP_ENTRY_ID FROM UP_EMP
        WHERE MERITLIST_ID = ? AND CLASS_ID = ? AND EMP_ENTRY_ID <> ? LIMIT 1`,
      [meritlistId, classId, empEntryId]
    );

    if (duplicateIdentity[0]) {
      throw Object.assign(new Error('Merit List ID and Class ID are already used by another employee.'), { status: 409 });
    }

    if (ipi) {
      const [duplicateIpi] = await conn.execute(
        `SELECT EMP_ENTRY_ID FROM UP_EMP WHERE IPI = ? AND EMP_ENTRY_ID <> ? LIMIT 1`,
        [ipi, empEntryId]
      );

      if (duplicateIpi[0]) {
        throw Object.assign(new Error('This IPI is already assigned to another employee.'), { status: 409 });
      }
    }

    const setColumns = EMP_COLUMNS.map(column => `${column} = ?`).join(', ');
    const approvalAudit = approvalStatus === 'PENDING'
      ? [null, null]
      : [req.admin.username, new Date()];

    await conn.execute(
      `UPDATE UP_EMP
          SET MERITLIST_ID = ?, CLASS_ID = ?, IPI = ?, batch_no = ?,
              APPROVAL_STATUS = ?, APPROVED_BY = ?, APPROVED_AT = ?,
              ${setColumns}, UPDATED_AT = NOW()
        WHERE EMP_ENTRY_ID = ?`,
      [
        meritlistId,
        classId,
        ipi || null,
        batchNo,
        approvalStatus,
        ...approvalAudit,
        ...EMP_COLUMNS.map(column => employee[column] || null),
        empEntryId
      ]
    );

    await conn.execute(
      `DELETE FROM HR_EMPEXAMDET WHERE EMP_ENTRY_ID = ?`,
      [empEntryId]
    );

    const normalizedEducation = education
      .map(row => cleanObj(row, EXAM_COLUMNS))
      .filter(row => EXAM_COLUMNS.some(column => row[column]));

    for (const row of normalizedEducation) {
      await conn.execute(
        `INSERT INTO HR_EMPEXAMDET
         (EMP_ENTRY_ID, EMPCODE, EXAMNAME, EXAMGROUP, BOARD, CLAS,
          PASSYEAR, REMARKS, INSTITUTE, SUBJECT_NAME)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          empEntryId,
          ipi || null,
          row.EXAMNAME || null,
          row.EXAMGROUP || null,
          row.BOARD || null,
          row.CLAS || null,
          row.PASSYEAR || null,
          row.REMARKS || null,
          row.INSTITUTE || null,
          row.SUBJECT_NAME || null
        ]
      );
    }

    await conn.commit();
    res.json({ ok: true, message: 'Employee details updated.' });
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
});

router.patch('/employees/:empEntryId/approval', async (req, res, next) => {
  const empEntryId = Number(req.params.empEntryId);
  const approvalStatus = String(req.body?.approvalStatus || '').toUpperCase();

  if (!Number.isInteger(empEntryId) || empEntryId <= 0) {
    return res.status(400).json({ message: 'Invalid employee entry ID.' });
  }

  if (!['APPROVED', 'REJECTED'].includes(approvalStatus)) {
    return res.status(400).json({
      message: 'Approval status must be APPROVED or REJECTED.'
    });
  }

  try {
    const [result] = await pool.execute(
      `UPDATE UP_EMP
          SET APPROVAL_STATUS = ?,
              APPROVED_BY = ?,
              APPROVED_AT = NOW(),
              UPDATED_AT = NOW()
        WHERE EMP_ENTRY_ID = ?`,
      [approvalStatus, req.admin.username, empEntryId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: 'Employee record not found.' });
    }

    res.json({ ok: true, message: `Employee ${approvalStatus.toLowerCase()}.` });
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
