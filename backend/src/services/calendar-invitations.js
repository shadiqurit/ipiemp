import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { DateTime } from 'luxon';
import { pool } from '../db.js';

const PARTSTAT_TO_RESPONSE = Object.freeze({
  ACCEPTED: 'YES',
  DECLINED: 'NO',
  TENTATIVE: 'MAYBE'
});

function requireSetting(name, fallback = '') {
  const value = String(process.env[name] || fallback).trim();
  if (value) return value;
  throw Object.assign(new Error(`Server setting ${name} is required.`), { status: 503 });
}

function escapeIcs(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replace(/\r?\n/g, '\\n');
}

function calendarTimestamp(value) {
  return value.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
}

export function buildCalendarInvitation(invitation, sender) {
  const zone = String(process.env.MEETING_TIMEZONE || 'Asia/Dhaka').trim();
  const start = DateTime.fromISO(`${invitation.meetingDate}T${invitation.meetingTime}`, { zone });
  const durationMinutes = Number(invitation.durationMinutes || 60);

  if (!start.isValid) {
    throw Object.assign(new Error('Meeting date, time, or time zone is invalid.'), { status: 400 });
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 1440) {
    throw Object.assign(new Error('Meeting duration must be between 15 and 1440 minutes.'), { status: 400 });
  }

  const now = DateTime.utc();
  const end = start.plus({ minutes: durationMinutes });
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//IBN SINA//Meeting Invitation//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${escapeIcs(invitation.calendarUid)}`,
    `DTSTAMP:${calendarTimestamp(now)}`,
    `DTSTART:${calendarTimestamp(start)}`,
    `DTEND:${calendarTimestamp(end)}`,
    `SUMMARY:${escapeIcs(invitation.title)}`,
    'DESCRIPTION:Do you want to join the meeting?',
    `ORGANIZER;CN=IBN SINA Meeting:mailto:${sender}`,
    `ATTENDEE;CN=${escapeIcs(invitation.recipientEmail)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${invitation.recipientEmail}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ];

  return lines.join('\r\n');
}

function unfoldCalendar(content) {
  return String(content || '').replace(/\r?\n[ \t]/g, '');
}

function calendarProperty(content, name) {
  const line = unfoldCalendar(content)
    .split(/\r?\n/)
    .find((candidate) => candidate.toUpperCase().startsWith(`${name.toUpperCase()}:`)
      || candidate.toUpperCase().startsWith(`${name.toUpperCase()};`));
  if (!line) return '';
  const separator = line.indexOf(':');
  return separator >= 0 ? line.slice(separator + 1).trim() : '';
}

export function parseCalendarReply(content) {
  const unfolded = unfoldCalendar(content);
  if (!/(^|\r?\n)METHOD:REPLY(\r?\n|$)/i.test(unfolded)) return null;

  const attendeeLine = unfolded
    .split(/\r?\n/)
    .find((line) => /^ATTENDEE[;:]/i.test(line));
  const partstat = /(?:^|;)PARTSTAT=([^;:]+)/i.exec(attendeeLine || '')?.[1]?.toUpperCase();
  const response = PARTSTAT_TO_RESPONSE[partstat];
  const uid = calendarProperty(unfolded, 'UID');

  if (!uid || !response) return null;
  return { uid, response };
}

function imapSettings() {
  const smtpUser = String(process.env.SMTP_USER || '').trim();
  const smtpPassword = String(process.env.SMTP_PASSWORD || '').trim();
  const port = Number(process.env.IMAP_PORT || 993);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(new Error('IMAP_PORT is invalid.'), { status: 503 });
  }
  return {
    host: requireSetting('IMAP_HOST'),
    port,
    secure: String(process.env.IMAP_SECURE || 'true').toLowerCase() !== 'false',
    user: requireSetting('IMAP_USER', smtpUser),
    pass: requireSetting('IMAP_PASSWORD', smtpPassword)
  };
}

function messageCalendarContent(mail) {
  const part = mail.attachments?.find((attachment) => (
    attachment.contentType === 'text/calendar'
      || String(attachment.filename || '').toLowerCase().endsWith('.ics')
  ));
  return part?.content?.toString('utf8') || '';
}

export async function syncCalendarReplies() {
  const settings = imapSettings();
  const client = new ImapFlow({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: settings.user, pass: settings.pass },
    logger: false
  });

  let inspected = 0;
  let matched = 0;
  let updated = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - (45 * 24 * 60 * 60 * 1000));
      const found = await client.search({ since });
      const messageIds = found.slice(-250);
      if (!messageIds.length) return { inspected, matched, updated };

      for await (const message of client.fetch(messageIds, { source: true, envelope: true })) {
        inspected += 1;
        const mail = await simpleParser(message.source);
        const reply = parseCalendarReply(messageCalendarContent(mail));
        const from = String(mail.from?.value?.[0]?.address || '').trim().toLowerCase();
        if (!reply || !from) continue;
        matched += 1;

        const [result] = await pool.execute(
          `UPDATE meeting_invitation
              SET RESPONSE_STATUS = ?, RESPONDED_AT = UTC_TIMESTAMP()
            WHERE CALENDAR_UID = ?
              AND LOWER(RECIPIENT_EMAIL) = ?`,
          [reply.response, reply.uid, from]
        );
        updated += result.affectedRows;
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return { inspected, matched, updated };
}

