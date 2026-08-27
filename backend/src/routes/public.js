import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';
import { getActiveBatch, getEmployeePermission } from '../services/access.js';

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

const allowed = {
  GENDER: ['', 'M', 'F'],
  RELIGION: ['', 'I', 'H', 'B', 'C'],
  MARITAL_STATUS: ['', 'U', 'M']
};

function normalizedPhone(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function cleanObj(input, columns) {
  const out = {};
  for (const c of columns) {
    const v = input?.[c];
    out[c] = typeof v === 'string' ? v.trim() : (v ?? null);
  }
  return out;
}

function validateEmployee(e) {
  if (!e.NAME) {
    throw Object.assign(new Error('Employee name is required.'), { status: 400 });
  }

  if (!e.PHONE) {
    throw Object.assign(new Error('Phone number is required.'), { status: 400 });
  }

  for (const key of Object.keys(allowed)) {
    if (!allowed[key].includes(e[key] || '')) {
      throw Object.assign(new Error(`Invalid ${key} value.`), { status: 400 });
    }
  }
}

async function getVerifiedEmployee(conn, meritlistId, classId, phone, lock = false) {
  const sql =
    `SELECT *
       FROM UP_EMP
      WHERE MERITLIST_ID = ?
        AND CLASS_ID = ?
        AND REPLACE(PHONE, ' ', '') = ?
      LIMIT 1` + (lock ? ' FOR UPDATE' : '');

  const [rows] = await conn.execute(
    sql,
    [meritlistId, classId, normalizedPhone(phone)]
  );

  return rows[0] || null;
}

router.get('/app-state', async (req, res, next) => {
  try {
    const conn = await pool.getConnection();

    try {
      const active = await getActiveBatch(conn);

      res.json({
        activeBatch: active?.BATCH_NO || null,
        collectionOpen: !!active
      });
    } finally {
      conn.release();
    }
  } catch (e) {
    next(e);
  }
});

/**
 * First step for employee.
 *
 * Existing employee:
 * MERITLIST_ID + CLASS_ID + PHONE must all match.
 *
 * New employee:
 * No row may already exist for MERITLIST_ID + CLASS_ID.
 * An ACTIVE batch must exist.
 */
router.post('/employee/lookup', async (req, res, next) => {
  const meritlistId = String(req.body?.meritlistId || '').trim();
  const classId = String(req.body?.classId || '').trim();
  const phone = normalizedPhone(req.body?.phone);

  if (!meritlistId || !classId || !phone) {
    return res.status(400).json({
      message: 'Merit List ID, Class ID and Phone Number are required.'
    });
  }

  const conn = await pool.getConnection();

  try {
    const employee = await getVerifiedEmployee(
      conn,
      meritlistId,
      classId,
      phone
    );

    const active = await getActiveBatch(conn);

    if (!employee) {
      // Prevent someone from creating a second row when merit/class exists
      // but the phone was typed incorrectly.
      const [sameIdentity] = await conn.execute(
        `SELECT EMP_ENTRY_ID
           FROM UP_EMP
          WHERE MERITLIST_ID = ?
            AND CLASS_ID = ?
          LIMIT 1`,
        [meritlistId, classId]
      );

      if (sameIdentity[0]) {
        return res.status(401).json({
          message: 'Merit List ID / Class ID was found, but the phone number does not match.'
        });
      }

      return res.json({
        found: false,
        canCreate: !!active,
        canEdit: !!active,
        activeBatch: active?.BATCH_NO || null,
        identity: {
          meritlistId,
          classId,
          phone
        }
      });
    }

    const permission = await getEmployeePermission(
      conn,
      employee.EMP_ENTRY_ID,
      employee.batch_no
    );

    const [education] = await conn.execute(
      `SELECT SLNO, EMP_ENTRY_ID, EMPCODE, EXAMNAME, EXAMGROUP, BOARD, CLAS,
              PASSYEAR, REMARKS, INSTITUTE, SUBJECT_NAME
         FROM HR_EMPEXAMDET
        WHERE EMP_ENTRY_ID = ?
        ORDER BY SLNO`,
      [employee.EMP_ENTRY_ID]
    );

    res.json({
      found: true,
      employee,
      education,
      batchNo: employee.batch_no,
      ...permission,
      canRequestUpdate: !permission.canEdit && !permission.pending
    });

  } catch (e) {
    next(e);
  } finally {
    conn.release();
  }
});

router.post('/employee/save', async (req, res, next) => {
  const identity = {
    meritlistId: String(req.body?.identity?.meritlistId || '').trim(),
    classId: String(req.body?.identity?.classId || '').trim(),
    phone: normalizedPhone(req.body?.identity?.phone)
  };

  if (!identity.meritlistId || !identity.classId || !identity.phone) {
    return res.status(400).json({
      message: 'Merit List ID, Class ID and Phone Number are required.'
    });
  }

  const employee = cleanObj(req.body?.employee, EMP_COLUMNS);
  employee.PHONE = normalizedPhone(employee.PHONE || identity.phone);

  const education = Array.isArray(req.body?.education)
    ? req.body.education
    : [];

  validateEmployee(employee);

  // The public form cannot change the verification phone behind the server's back.
  if (normalizedPhone(employee.PHONE) !== identity.phone) {
    return res.status(400).json({
      message: 'Primary phone cannot be changed in this session.'
    });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    let current = await getVerifiedEmployee(
      conn,
      identity.meritlistId,
      identity.classId,
      identity.phone,
      true
    );

    let empEntryId;
    let ipi = null;

    if (!current) {
      const [sameIdentity] = await conn.execute(
        `SELECT EMP_ENTRY_ID
           FROM UP_EMP
          WHERE MERITLIST_ID = ?
            AND CLASS_ID = ?
          LIMIT 1
          FOR UPDATE`,
        [identity.meritlistId, identity.classId]
      );

      if (sameIdentity[0]) {
        throw Object.assign(
          new Error('This Merit List ID and Class ID already exists. Phone verification failed.'),
          { status: 401 }
        );
      }

      const active = await getActiveBatch(conn);

      if (!active) {
        throw Object.assign(
          new Error('There is no ACTIVE batch for new submissions.'),
          { status: 409 }
        );
      }

      const insertCols = [
        'MERITLIST_ID',
        'CLASS_ID',
        ...EMP_COLUMNS,
        'batch_no'
      ];

      const values = [
        identity.meritlistId,
        identity.classId,
        ...EMP_COLUMNS.map(c => employee[c] || null),
        active.BATCH_NO
      ];

      const [result] = await conn.execute(
        `INSERT INTO UP_EMP
         (${insertCols.join(',')}, CREATED_AT)
         VALUES (${insertCols.map(() => '?').join(',')}, NOW())`,
        values
      );

      empEntryId = result.insertId;

    } else {
      empEntryId = current.EMP_ENTRY_ID;
      ipi = current.IPI || null;

      const permission = await getEmployeePermission(
        conn,
        current.EMP_ENTRY_ID,
        current.batch_no
      );

      if (!permission.canEdit) {
        throw Object.assign(
          new Error(
            'This record is locked. Admin approval is required for an inactive batch.'
          ),
          { status: 403 }
        );
      }

      const updateCols = EMP_COLUMNS.filter(c => c !== 'PHONE');
      const setSql = updateCols.map(c => `${c} = ?`).join(',');

      await conn.execute(
        `UPDATE UP_EMP
            SET ${setSql},
                UPDATED_AT = NOW()
          WHERE EMP_ENTRY_ID = ?`,
        [
          ...updateCols.map(c => employee[c] || null),
          current.EMP_ENTRY_ID
        ]
      );

      await conn.execute(
        `DELETE FROM HR_EMPEXAMDET
          WHERE EMP_ENTRY_ID = ?`,
        [current.EMP_ENTRY_ID]
      );
    }

    const normalizedEducation = education
      .map(x => cleanObj(x, EXAM_COLUMNS))
      .filter(x => EXAM_COLUMNS.some(c => x[c]));

    for (const row of normalizedEducation) {
      await conn.execute(
        `INSERT INTO HR_EMPEXAMDET
         (EMP_ENTRY_ID, EMPCODE, EXAMNAME, EXAMGROUP, BOARD, CLAS,
          PASSYEAR, REMARKS, INSTITUTE, SUBJECT_NAME)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          empEntryId,
          ipi,
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

    res.json({
      ok: true,
      empEntryId,
      ipi,
      message: current
        ? 'Employee information updated successfully.'
        : 'Employee information submitted successfully.'
    });

  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
});

router.post('/employee/update-request', async (req, res, next) => {
  const meritlistId = String(req.body?.meritlistId || '').trim();
  const classId = String(req.body?.classId || '').trim();
  const phone = normalizedPhone(req.body?.phone);
  const note = String(req.body?.note || '').trim();

  if (!meritlistId || !classId || !phone) {
    return res.status(400).json({
      message: 'Merit List ID, Class ID and Phone Number are required.'
    });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const employee = await getVerifiedEmployee(
      conn,
      meritlistId,
      classId,
      phone,
      true
    );

    if (!employee) {
      throw Object.assign(
        new Error('Employee verification failed.'),
        { status: 401 }
      );
    }

    const permission = await getEmployeePermission(
      conn,
      employee.EMP_ENTRY_ID,
      employee.batch_no
    );

    if (permission.canEdit) {
      await conn.rollback();
      return res.json({
        ok: true,
        message: 'You already have update access.'
      });
    }

    if (permission.pending) {
      await conn.rollback();
      return res.json({
        ok: true,
        message: 'An update request is already pending.'
      });
    }

    await conn.execute(
      `INSERT INTO HR_UPDATE_REQUEST
       (REQUEST_ID, EMP_ENTRY_ID, IPI, MERITLIST_ID, CLASS_ID,
        BATCH_NO, REQUEST_NOTE, STATUS, REQUESTED_AT)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', NOW())`,
      [
        uuidv4(),
        employee.EMP_ENTRY_ID,
        employee.IPI || null,
        employee.MERITLIST_ID,
        employee.CLASS_ID,
        employee.batch_no,
        note || null
      ]
    );

    await conn.commit();

    res.json({
      ok: true,
      message: 'Update request submitted for admin approval.'
    });

  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
});

export default router;
