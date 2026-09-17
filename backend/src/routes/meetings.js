import { Router } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { pool } from '../db.js';
import { requireAdmin } from '../auth.js';
import {
  OUTLOOK_ACTIONS_APP_ID,
  RESPONSE_VALUES,
  buildConfirmationCard,
  buildInvitationCard,
  buildInvitationHtml,
  buildWebResponseUrls,
  createInvitationIdentity,
  createMailTransport,
  describeMailTransportError,
  getOptionalOutlookSettings,
  getOutlookSettings,
  hashInvitationToken,
  identityMatchesInvitation,
  isUuid,
  normalizeEmail
} from '../services/meeting-invitations.js';
import { buildCalendarInvitation, syncCalendarReplies } from '../services/calendar-invitations.js';

export const meetingAdminRoutes = Router();
export const meetingActionRoutes = Router();
export const meetingPublicRoutes = Router();

meetingAdminRoutes.use(requireAdmin);

function normalizeMeetingInput(body) {
  const title = String(body?.title || '').trim();
  const meetingDate = String(body?.meetingDate || '').trim();
  const meetingTime = String(body?.meetingTime || '').trim();
  const recipientEmail = normalizeEmail(body?.recipientEmail);
  const recipientObjectId = String(body?.recipientObjectId || '').trim().toLowerCase();
  const expiresInDays = Number(body?.expiresInDays || 7);
  const durationMinutes = Number(body?.durationMinutes || 60);

  if (!title || title.length > 255 || /[\r\n]/.test(title)) {
    throw Object.assign(new Error('Meeting title must be one line and no more than 255 characters.'), { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) {
    throw Object.assign(new Error('Meeting date must use YYYY-MM-DD.'), { status: 400 });
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(meetingTime)) {
    throw Object.assign(new Error('Meeting time must use 24-hour HH:MM.'), { status: 400 });
  }
  if (recipientObjectId && !isUuid(recipientObjectId)) {
    throw Object.assign(new Error('Recipient Microsoft Entra Object ID must be a UUID when provided.'), { status: 400 });
  }
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 30) {
    throw Object.assign(new Error('Invitation validity must be between 1 and 30 days.'), { status: 400 });
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 1440) {
    throw Object.assign(new Error('Meeting duration must be between 15 and 1440 minutes.'), { status: 400 });
  }

  return { title, meetingDate, meetingTime, recipientEmail, recipientObjectId: recipientObjectId || null, expiresInDays, durationMinutes };
}

meetingAdminRoutes.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT INVITE_ID, MEETING_TITLE, MEETING_DATE, MEETING_TIME,
              RECIPIENT_EMAIL, RESPONSE_STATUS, CREATED_AT, EXPIRES_AT, RESPONDED_AT
         FROM meeting_invitation
        ORDER BY CREATED_AT DESC
        LIMIT 100`
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

meetingAdminRoutes.post('/send', async (req, res, next) => {
  let inviteId;
  try {
    const meeting = normalizeMeetingInput(req.body);
    const settings = getOptionalOutlookSettings();
    const identity = createInvitationIdentity();
    inviteId = identity.inviteId;

    const { transporter, sender } = createMailTransport();
    const senderDomain = sender.split('@')[1];
    const invitation = {
      ...meeting,
      ...identity,
      calendarUid: `${identity.inviteId}@${senderDomain}`
    };
    invitation.responseUrls = buildWebResponseUrls(invitation);
    const card = settings ? buildInvitationCard(invitation, settings) : null;
    const html = buildInvitationHtml(invitation, card);
    const calendarContent = buildCalendarInvitation(invitation, sender);

    await pool.execute(
      `INSERT INTO meeting_invitation (
         INVITE_ID, MEETING_TITLE, MEETING_DATE, MEETING_TIME,
         RECIPIENT_EMAIL, RECIPIENT_OBJECT_ID, TENANT_ID, TOKEN_HASH, CALENDAR_UID,
         RESPONSE_STATUS, CREATED_BY, CREATED_AT, EXPIRES_AT
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, UTC_TIMESTAMP(),
                 DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY))`,
      [
        inviteId,
        meeting.title,
        meeting.meetingDate,
        meeting.meetingTime,
        meeting.recipientEmail,
        meeting.recipientObjectId,
        settings?.tenantId || null,
        identity.tokenHash,
        invitation.calendarUid,
        req.admin.username,
        meeting.expiresInDays
      ]
    );

    let result;
    try {
      result = await transporter.sendMail({
        from: { name: 'IBN SINA Meeting', address: sender },
        to: meeting.recipientEmail,
        subject: meeting.title,
        text: [
          meeting.title,
          'Do you want to join the meeting?',
          meeting.meetingDate ? `Date: ${meeting.meetingDate}` : '',
          meeting.meetingTime ? `Time: ${meeting.meetingTime}` : '',
          'Open this meeting invitation in Outlook to select Accept, Tentative, or Decline.'
        ].filter(Boolean).join('\n\n'),
        html,
        icalEvent: {
          filename: 'meeting-invitation.ics',
          method: 'REQUEST',
          content: calendarContent
        },
        headers: {
          'Content-Class': 'urn:content-classes:calendarmessage'
        }
      });

    } catch (mailError) {
      await pool.execute(`DELETE FROM meeting_invitation WHERE INVITE_ID = ?`, [inviteId]);
      console.error('SMTP invitation send failed:', {
        code: mailError.code || null,
        command: mailError.command || null,
        responseCode: mailError.responseCode || null
      });
      const error = new Error(describeMailTransportError(mailError));
      error.status = 502;
      throw error;
    }

    try {
      await pool.execute(
        `UPDATE meeting_invitation SET EMAIL_MESSAGE_ID = ? WHERE INVITE_ID = ?`,
        [String(result.messageId || '').slice(0, 255) || null, inviteId]
      );
    } catch (updateError) {
      // The message is already outside the system at this point. Preserve the
      // usable invitation and report only the nonessential metadata failure.
      console.error('Could not store invitation email message ID:', updateError.code || updateError.name);
    }

    res.status(201).json({
      ok: true,
      inviteId,
      message: `Invitation sent to ${meeting.recipientEmail}.`
    });
  } catch (error) {
    next(error);
  }
});

meetingAdminRoutes.post('/smtp-check', async (req, res, next) => {
  let transporter;
  try {
    ({ transporter } = createMailTransport());
    await transporter.verify();
    res.json({ ok: true, message: 'SMTP connection and mailbox login are working.' });
  } catch (mailError) {
    console.error('SMTP verification failed:', {
      code: mailError.code || null,
      command: mailError.command || null,
      responseCode: mailError.responseCode || null
    });
    const error = new Error(describeMailTransportError(mailError));
    error.status = 502;
    next(error);
  } finally {
    transporter?.close();
  }
});

meetingAdminRoutes.post('/sync-replies', async (req, res, next) => {
  try {
    const result = await syncCalendarReplies();
    res.json({
      ok: true,
      ...result,
      message: result.updated
        ? `${result.updated} Outlook response(s) synchronized.`
        : 'No new Outlook responses were found.'
    });
  } catch (error) {
    if (!error.status) {
      const wrapped = new Error('Could not read Outlook replies. Check the IMAP settings for the sender mailbox.');
      wrapped.status = 502;
      return next(wrapped);
    }
    next(error);
  }
});

function parseWebResponseRequest(req, includeResponse = false) {
  const inviteId = String(req.params?.inviteId || '').trim().toLowerCase();
  const token = String(req.method === 'GET' ? req.query?.token : req.body?.token || '');
  const response = String(req.method === 'GET' ? req.query?.response : req.body?.response || '')
    .trim()
    .toUpperCase();

  if (!isUuid(inviteId) || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw Object.assign(new Error('This meeting invitation link is invalid.'), { status: 400 });
  }
  if (includeResponse && !RESPONSE_VALUES.includes(response)) {
    throw Object.assign(new Error('Select Yes, No, or Maybe.'), { status: 400 });
  }

  return { inviteId, token, response };
}

meetingPublicRoutes.get('/:inviteId', async (req, res, next) => {
  try {
    const { inviteId, token } = parseWebResponseRequest(req);
    const [rows] = await pool.execute(
      `SELECT INVITE_ID, MEETING_TITLE,
              DATE_FORMAT(MEETING_DATE, '%Y-%m-%d') AS MEETING_DATE,
              TIME_FORMAT(MEETING_TIME, '%H:%i') AS MEETING_TIME,
              RECIPIENT_EMAIL, RESPONSE_STATUS, RESPONDED_AT,
              (EXPIRES_AT <= UTC_TIMESTAMP()) AS IS_EXPIRED
         FROM meeting_invitation
        WHERE INVITE_ID = ? AND TOKEN_HASH = ?
        LIMIT 1`,
      [inviteId, hashInvitationToken(token)]
    );

    const invitation = rows[0];
    if (!invitation) {
      return res.status(404).set('Cache-Control', 'no-store').json({ message: 'This meeting invitation link is invalid.' });
    }
    if (invitation.IS_EXPIRED) {
      return res.status(410).set('Cache-Control', 'no-store').json({ message: 'This meeting invitation has expired.' });
    }

    return res.set('Cache-Control', 'no-store').json({
      inviteId: invitation.INVITE_ID,
      title: invitation.MEETING_TITLE,
      meetingDate: invitation.MEETING_DATE,
      meetingTime: invitation.MEETING_TIME,
      recipientEmail: invitation.RECIPIENT_EMAIL,
      responseStatus: invitation.RESPONSE_STATUS,
      respondedAt: invitation.RESPONDED_AT
    });
  } catch (error) {
    next(error);
  }
});

meetingPublicRoutes.post('/:inviteId/respond', async (req, res, next) => {
  try {
    const { inviteId, token, response } = parseWebResponseRequest(req, true);
    const tokenHash = hashInvitationToken(token);
    const [result] = await pool.execute(
      `UPDATE meeting_invitation
          SET RESPONSE_STATUS = ?, RESPONDED_AT = UTC_TIMESTAMP()
        WHERE INVITE_ID = ? AND TOKEN_HASH = ?
          AND EXPIRES_AT > UTC_TIMESTAMP()
          AND RESPONSE_STATUS = 'PENDING'`,
      [response, inviteId, tokenHash]
    );

    if (!result.affectedRows) {
      const [rows] = await pool.execute(
        `SELECT RESPONSE_STATUS,
                (EXPIRES_AT <= UTC_TIMESTAMP()) AS IS_EXPIRED
           FROM meeting_invitation
          WHERE INVITE_ID = ? AND TOKEN_HASH = ?
          LIMIT 1`,
        [inviteId, tokenHash]
      );
      const invitation = rows[0];
      if (!invitation) {
        return res.status(404).set('Cache-Control', 'no-store').json({ message: 'This meeting invitation link is invalid.' });
      }
      if (invitation.IS_EXPIRED) {
        return res.status(410).set('Cache-Control', 'no-store').json({ message: 'This meeting invitation has expired.' });
      }
      if (invitation.RESPONSE_STATUS !== response) {
        return res.status(409).set('Cache-Control', 'no-store').json({ message: `A ${invitation.RESPONSE_STATUS} response has already been recorded.` });
      }
    }

    return res.set('Cache-Control', 'no-store').json({
      ok: true,
      response,
      message: 'Thank you. Your response has been recorded.'
    });
  } catch (error) {
    next(error);
  }
});

const jwksByTenant = new Map();

function jwksForTenant(tenantId) {
  if (!jwksByTenant.has(tenantId)) {
    jwksByTenant.set(
      tenantId,
      createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`))
    );
  }
  return jwksByTenant.get(tenantId);
}

async function verifyMicrosoftIdentity(req, settings) {
  const authorization = String(req.get('Authorization') || '');
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);
  if (!match) throw Object.assign(new Error('Microsoft authentication is required.'), { status: 401 });

  const { payload } = await jwtVerify(match[1], jwksForTenant(settings.tenantId), {
    issuer: `https://login.microsoftonline.com/${settings.tenantId}/v2.0`,
    audience: settings.audience,
    algorithms: ['RS256'],
    requiredClaims: ['exp', 'iat', 'nbf', 'tid', 'oid', 'azp', 'scp']
  });

  const scopes = typeof payload.scp === 'string' ? payload.scp.split(/\s+/) : [];
  if (
    payload.ver !== '2.0'
    || String(payload.tid).toLowerCase() !== settings.tenantId
    || String(payload.azp).toLowerCase() !== OUTLOOK_ACTIONS_APP_ID
    || !isUuid(payload.oid)
    || !scopes.includes(settings.scope)
  ) {
    throw Object.assign(new Error('Microsoft identity is not authorized for this action.'), { status: 401 });
  }
  return payload;
}

function actionError(res, status, message) {
  return res
    .set('Cache-Control', 'no-store')
    .set('CARD-ACTION-STATUS', message)
    .status(status)
    .json({ message });
}

meetingActionRoutes.post('/respond', async (req, res) => {
  const inviteId = String(req.body?.inviteId || '').trim().toLowerCase();
  const token = String(req.body?.token || '');
  const response = String(req.body?.response || '').trim().toUpperCase();

  if (!isUuid(inviteId) || !/^[A-Za-z0-9_-]{43}$/.test(token) || !RESPONSE_VALUES.includes(response)) {
    return actionError(res, 400, 'Invalid meeting response.');
  }

  try {
    const settings = getOutlookSettings();
    const identity = await verifyMicrosoftIdentity(req, settings);
    const key = [inviteId, hashInvitationToken(token), settings.tenantId];
    const [rows] = await pool.execute(
      `SELECT RECIPIENT_EMAIL, RECIPIENT_OBJECT_ID, RESPONSE_STATUS
         FROM meeting_invitation
        WHERE INVITE_ID = ? AND TOKEN_HASH = ? AND TENANT_ID = ?
          AND EXPIRES_AT > UTC_TIMESTAMP()
        LIMIT 1`,
      key
    );

    const invitation = rows[0];
    if (!invitation || !identityMatchesInvitation(invitation, identity)) {
      return actionError(res, 403, 'This invitation is invalid, expired, or belongs to another user.');
    }
    if (invitation.RESPONSE_STATUS !== 'PENDING') {
      if (invitation.RESPONSE_STATUS !== response) {
        return actionError(res, 409, 'A different response has already been recorded.');
      }
    } else {
      const [result] = await pool.execute(
        `UPDATE meeting_invitation
            SET RESPONSE_STATUS = ?, RESPONDED_AT = UTC_TIMESTAMP()
          WHERE INVITE_ID = ? AND TOKEN_HASH = ? AND TENANT_ID = ?
            AND EXPIRES_AT > UTC_TIMESTAMP()
            AND RESPONSE_STATUS = 'PENDING'`,
        [response, ...key]
      );

      if (!result.affectedRows) {
        const [latestRows] = await pool.execute(
          `SELECT RESPONSE_STATUS FROM meeting_invitation WHERE INVITE_ID = ? LIMIT 1`,
          [inviteId]
        );
        if (latestRows[0]?.RESPONSE_STATUS !== response) {
          return actionError(res, 409, 'A different response has already been recorded.');
        }
      }
    }

    return res
      .set('Cache-Control', 'no-store')
      .set('CARD-UPDATE-IN-BODY', 'true')
      .set('CARD-ACTION-STATUS', 'Your response has been recorded.')
      .status(200)
      .json(buildConfirmationCard(response));
  } catch (error) {
    if (error.status) return actionError(res, error.status, error.message);
    console.error('Outlook meeting response failed:', error.code || error.name);
    return actionError(res, 401, 'Microsoft authentication failed.');
  }
});
