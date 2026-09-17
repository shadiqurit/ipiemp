import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RESPONSE_VALUES,
  buildConfirmationCard,
  buildInvitationCard,
  buildInvitationHtml,
  createInvitationIdentity,
  hashInvitationToken,
  identityMatchesInvitation,
  normalizeEmail
} from '../src/services/meeting-invitations.js';

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
