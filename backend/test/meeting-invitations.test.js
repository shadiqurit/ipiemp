import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RESPONSE_VALUES,
  buildConfirmationCard,
  buildInvitationCard,
  buildInvitationHtml,
  buildWebResponseUrls,
  createInvitationIdentity,
  describeMailTransportError,
  hashInvitationToken,
  identityMatchesInvitation,
  normalizeEmail
} from '../src/services/meeting-invitations.js';
import { buildCalendarInvitation, parseCalendarReply } from '../src/services/calendar-invitations.js';

const settings = {
  providerId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  audience: 'api://meeting-test',
  scope: 'Meeting.Respond',
  responseUrl: 'https://ibnsina.shadiqur.bd/api/meeting/respond'
};

test('creates an unguessable invitation identity and stable hash', () => {
  const identity = createInvitationIdentity();
  assert.match(identity.inviteId, /^[0-9a-f-]{36}$/);
  assert.match(identity.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(identity.tokenHash.length, 64);
  assert.equal(identity.tokenHash, hashInvitationToken(identity.token));
});

test('builds one Outlook HTTP action for each response', () => {
  const invitation = {
    inviteId: '33333333-3333-4333-8333-333333333333',
    token: 'a'.repeat(43),
    title: 'HRMS Project Meeting',
    meetingDate: '2026-09-20',
    meetingTime: '10:00'
  };

  const card = buildInvitationCard(invitation, settings);
  assert.equal(card.originator, settings.providerId);
  assert.deepEqual(card.actions.map((action) => action.type), ['Action.Http', 'Action.Http', 'Action.Http']);
  assert.deepEqual(card.actions.map((action) => JSON.parse(action.body).response), RESPONSE_VALUES);
  assert.ok(card.actions.every((action) => action.url === settings.responseUrl));
});

test('escapes HTML and prevents script element termination', () => {
  const invitation = {
    inviteId: '33333333-3333-4333-8333-333333333333',
    token: 'b'.repeat(43),
    title: '</script><img src=x onerror=alert(1)>',
    meetingDate: null,
    meetingTime: null
  };
  const card = buildInvitationCard(invitation, settings);
  const html = buildInvitationHtml(invitation, card);

  assert.doesNotMatch(html, /<img src=x/);
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  assert.match(html, /\\u003c\/script>/);
});

test('builds colorful secure web response buttons', () => {
  const invitation = {
    inviteId: '33333333-3333-4333-8333-333333333333',
    token: 'b'.repeat(43),
    title: 'HRMS Project Meeting',
    meetingDate: '2026-09-20',
    meetingTime: '10:00'
  };
  invitation.responseUrls = buildWebResponseUrls(invitation, 'https://ibnsina.shadiqur.bd');
  const html = buildInvitationHtml(invitation);

  assert.match(html, /Yes, I will join/);
  assert.match(html, /No, I cannot join/);
  assert.match(html, />Maybe</);
  assert.match(html, /background:#138a62/);
  assert.match(html, /background:#c2413a/);
  assert.match(html, /background:#d18a12/);
  assert.match(html, /response=YES/);
  assert.match(html, /&amp;token=/);
});

test('normalizes valid email and rejects malformed email', () => {
  assert.equal(normalizeEmail(' User@Example.COM '), 'user@example.com');
  assert.throws(() => normalizeEmail('not an email'), /valid recipient email/);
});

test('matches a recipient by object ID when supplied', () => {
  const invitation = {
    RECIPIENT_EMAIL: 'user@example.com',
    RECIPIENT_OBJECT_ID: '33333333-3333-4333-8333-333333333333'
  };
  assert.equal(identityMatchesInvitation(invitation, {
    oid: '33333333-3333-4333-8333-333333333333',
    preferred_username: 'different@example.com'
  }), true);
  assert.equal(identityMatchesInvitation(invitation, {
    oid: '44444444-4444-4444-8444-444444444444',
    preferred_username: 'user@example.com'
  }), false);
});

test('falls back to signed email claims when object ID is omitted', () => {
  const invitation = { RECIPIENT_EMAIL: 'user@example.com', RECIPIENT_OBJECT_ID: null };
  assert.equal(identityMatchesInvitation(invitation, { preferred_username: 'USER@example.com' }), true);
  assert.equal(identityMatchesInvitation(invitation, { upn: 'other@example.com' }), false);
});

test('confirmation card contains the saved answer and no actions', () => {
  const card = buildConfirmationCard('MAYBE');
  assert.equal(card.actions, undefined);
  assert.match(JSON.stringify(card), /MAYBE/);
});

test('returns safe, useful SMTP diagnostics', () => {
  assert.match(describeMailTransportError({ code: 'EAUTH', responseCode: 535 }), /login failed/i);
  assert.match(describeMailTransportError({ code: 'ESOCKET' }), /secure SMTP connection failed/i);
  assert.match(describeMailTransportError({ responseCode: 550 }), /sender or recipient/i);
});

test('builds a standard Outlook calendar request', () => {
  process.env.MEETING_TIMEZONE = 'Asia/Dhaka';
  const invitation = {
    calendarUid: '33333333-3333-4333-8333-333333333333@shadiqur.bd',
    title: 'HRMS Project Meeting',
    meetingDate: '2026-09-20',
    meetingTime: '10:00',
    durationMinutes: 60,
    recipientEmail: 'shadiqur.it@ibnsinapharma.com'
  };
  const content = buildCalendarInvitation(invitation, 'info@shadiqur.bd');
  assert.match(content, /METHOD:REQUEST/);
  assert.match(content, /DTSTART:20260920T040000Z/);
  assert.match(content, /ORGANIZER;CN=IBN SINA Meeting:mailto:info@shadiqur.bd/);
  assert.match(content, /RSVP=TRUE:mailto:shadiqur.it@ibnsinapharma.com/);
});

test('parses an Outlook calendar reply', () => {
  const reply = parseCalendarReply([
    'BEGIN:VCALENDAR',
    'METHOD:REPLY',
    'BEGIN:VEVENT',
    'UID:33333333-3333-4333-8333-333333333333@shadiqur.bd',
    'ATTENDEE;PARTSTAT=TENTATIVE:mailto:shadiqur.it@ibnsinapharma.com',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n'));
  assert.deepEqual(reply, {
    uid: '33333333-3333-4333-8333-333333333333@shadiqur.bd',
    response: 'MAYBE'
  });
});
