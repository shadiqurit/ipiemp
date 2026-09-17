import { createHash, randomBytes, randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';

export const OUTLOOK_ACTIONS_APP_ID = '48af08dc-f6d2-435f-b2a7-069abd99c086';
export const RESPONSE_VALUES = Object.freeze(['YES', 'NO', 'MAYBE']);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;

export function isUuid(value) {
  return UUID_PATTERN.test(String(value || '').trim());
}

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    throw Object.assign(new Error('Enter a valid recipient email address.'), { status: 400 });
  }
  return email;
}

export function identityMatchesInvitation(invitation, identity) {
  const expectedObjectId = String(invitation.RECIPIENT_OBJECT_ID || '').trim().toLowerCase();
  const actualObjectId = String(identity?.oid || '').trim().toLowerCase();

  if (expectedObjectId) return expectedObjectId === actualObjectId;

  const expectedEmail = String(invitation.RECIPIENT_EMAIL || '').trim().toLowerCase();
  const claimedEmails = [identity?.preferred_username, identity?.upn, identity?.email]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);

  return Boolean(expectedEmail) && claimedEmails.includes(expectedEmail);
}

export function hashInvitationToken(token) {
  return createHash('sha256').update(String(token), 'utf8').digest('hex');
}

export function createInvitationIdentity() {
  const token = randomBytes(32).toString('base64url');
  return {
    inviteId: randomUUID(),
    token,
    tokenHash: hashInvitationToken(token)
  };
}

function requireSetting(name, aliases = []) {
  for (const key of [name, ...aliases]) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  throw Object.assign(new Error(`Server setting ${name} is required.`), { status: 503 });
}

function validPublicBaseUrl() {
  const raw = requireSetting('PUBLIC_BASE_URL');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw Object.assign(new Error('PUBLIC_BASE_URL is not a valid URL.'), { status: 503 });
  }

  const localDevelopment = process.env.NODE_ENV !== 'production'
    && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localDevelopment) {
    throw Object.assign(new Error('PUBLIC_BASE_URL must use HTTPS.'), { status: 503 });
  }
  return url;
}

export function getOutlookSettings() {
  const providerId = requireSetting('OUTLOOK_PROVIDER_ID');
  const tenantId = requireSetting('OUTLOOK_ENTRA_TENANT_ID');
  const audience = requireSetting('OUTLOOK_ENTRA_AUDIENCE');
  const scope = requireSetting('OUTLOOK_ENTRA_SCOPE');

  if (!isUuid(providerId)) {
    throw Object.assign(new Error('OUTLOOK_PROVIDER_ID must be a UUID.'), { status: 503 });
  }
  if (!isUuid(tenantId)) {
    throw Object.assign(new Error('OUTLOOK_ENTRA_TENANT_ID must be a UUID.'), { status: 503 });
  }

  return {
    providerId: providerId.toLowerCase(),
    tenantId: tenantId.toLowerCase(),
    audience,
    scope,
    responseUrl: new URL('/api/meeting/respond', validPublicBaseUrl()).href
  };
}

export function getOptionalOutlookSettings() {
  const required = [
    'OUTLOOK_PROVIDER_ID',
    'OUTLOOK_ENTRA_TENANT_ID',
    'OUTLOOK_ENTRA_AUDIENCE',
    'OUTLOOK_ENTRA_SCOPE',
    'PUBLIC_BASE_URL'
  ];
  if (!required.every((name) => String(process.env[name] || '').trim())) return null;
  return getOutlookSettings();
}

export function buildInvitationCard(invitation, settings = getOutlookSettings()) {
  const facts = [];
  if (invitation.meetingDate) facts.push({ title: 'Date:', value: invitation.meetingDate });
  if (invitation.meetingTime) facts.push({ title: 'Time:', value: invitation.meetingTime });

  return {
    type: 'AdaptiveCard',
    version: '1.0',
    originator: settings.providerId,
    hideOriginalBody: false,
    body: [
      {
        type: 'TextBlock',
        text: 'Meeting Invitation',
        size: 'Large',
        weight: 'Bolder'
      },
      {
        type: 'TextBlock',
        text: invitation.title,
        weight: 'Bolder',
        wrap: true
      },
      {
        type: 'TextBlock',
        text: 'Do you want to join the meeting?',
        wrap: true
      },
      ...(facts.length ? [{ type: 'FactSet', facts }] : [])
    ],
    actions: RESPONSE_VALUES.map((response) => ({
      type: 'Action.Http',
      title: response === 'YES' ? 'Yes' : response === 'NO' ? 'No' : 'Maybe',
      method: 'POST',
      url: settings.responseUrl,
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      body: JSON.stringify({
        inviteId: invitation.inviteId,
        token: invitation.token,
        response
      })
    }))
  };
}

export function buildConfirmationCard(response) {
  return {
    type: 'AdaptiveCard',
    version: '1.0',
    hideOriginalBody: true,
    body: [
      {
        type: 'TextBlock',
        text: 'Meeting Invitation',
        size: 'Large',
        weight: 'Bolder'
      },
      {
        type: 'TextBlock',
        text: `Your response: ${response}`,
        weight: 'Bolder',
        wrap: true
      },
      {
        type: 'TextBlock',
        text: 'Thank you. Your response has been recorded.',
        wrap: true
      }
    ]
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildInvitationHtml(invitation, card = null) {
  // Prevent user-controlled text from ever terminating the JSON script tag.
  const cardScript = card
    ? `<script type="application/adaptivecard+json">${JSON.stringify(card).replaceAll('<', '\\u003c')}</script>`
    : '';
  const details = [
    invitation.meetingDate ? `<p><strong>Date:</strong> ${escapeHtml(invitation.meetingDate)}</p>` : '',
    invitation.meetingTime ? `<p><strong>Time:</strong> ${escapeHtml(invitation.meetingTime)}</p>` : ''
  ].join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  ${cardScript}
</head>
<body style="font-family:Arial,sans-serif;color:#17223b;line-height:1.5">
  <h2>${escapeHtml(invitation.title)}</h2>
  <p>Do you want to join the meeting?</p>
  ${details}
  <p>Open the calendar invitation in Outlook to select Accept, Tentative, or Decline.</p>
</body>
</html>`;
}

export function createMailTransport() {
  const host = requireSetting('SMTP_HOST');
  const port = Number(process.env.SMTP_PORT || 465);
  const user = requireSetting('SMTP_USER', ['GMAIL_USER']);
  const pass = requireSetting('SMTP_PASSWORD', ['GMAIL_APP_PASSWORD']);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(new Error('SMTP_PORT is invalid.'), { status: 503 });
  }

  return {
    sender: normalizeEmail(process.env.SMTP_FROM_EMAIL || user),
    transporter: nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    })
  };
}

export function describeMailTransportError(error) {
  const code = String(error?.code || '').toUpperCase();
  const responseCode = Number(error?.responseCode || 0);

  if (code === 'EAUTH' || [534, 535].includes(responseCode)) {
    return 'SMTP login failed. Verify the full mailbox username and mailbox password.';
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION') {
    return 'The SMTP server connection timed out. Verify the SMTP hostname and port.';
  }
  if (code === 'EDNS') {
    return 'The SMTP hostname could not be resolved.';
  }
  if (code === 'ESOCKET' || code === 'ETLS') {
    return 'The secure SMTP connection failed. Verify the hostname, port, and TLS settings.';
  }
  if (code === 'EENVELOPE' || responseCode === 550 || responseCode === 553) {
    return `The mail server rejected the sender or recipient${responseCode ? ` (SMTP ${responseCode})` : ''}.`;
  }
  if (responseCode) return `The mail server rejected the message (SMTP ${responseCode}).`;
  return `The mail server could not send the invitation${code ? ` (${code})` : ''}.`;
}
