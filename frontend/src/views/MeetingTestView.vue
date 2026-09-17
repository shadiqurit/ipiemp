<script setup>
import { onMounted, reactive, ref } from 'vue';
import { api, setAdminToken } from '../api';
import { formatDateTime } from '../utils/dates';
import { notifyError, notifySuccess } from '../utils/notifications';

const token = ref(localStorage.getItem('admin_token') || '');
const currentUser = ref(null);
const invitations = ref([]);
const loading = ref(false);
const sending = ref(false);
const syncing = ref(false);
const pageError = ref('');

const form = reactive({
  title: 'HRMS Project Meeting',
  meetingDate: '',
  meetingTime: '10:00',
  recipientEmail: 'shadiqur.it@ibnsinapharma.com',
  durationMinutes: 60,
  expiresInDays: 30
});

if (token.value) setAdminToken(token.value);

async function loadInvitations() {
  if (!token.value) return;
  loading.value = true;
  pageError.value = '';
  try {
    const [me, invitationResponse] = await Promise.all([
      api.get('/admin/me'),
      api.get('/admin/meetings')
    ]);
    currentUser.value = me.data;
    invitations.value = invitationResponse.data;
  } catch (error) {
    pageError.value = error.response?.data?.message || error.message;
    if (error.response?.status === 401) {
      localStorage.removeItem('admin_token');
      setAdminToken('');
      token.value = '';
    }
    notifyError(pageError.value, 'Meeting invitations could not be loaded');
  } finally {
    loading.value = false;
  }
}

async function sendInvitation() {
  sending.value = true;
  pageError.value = '';
  try {
    const { data } = await api.post('/admin/meetings/send', {
      ...form,
      expiresInDays: Number(form.expiresInDays)
    });
    notifySuccess(data.message, 'Invitation sent');
    await loadInvitations();
  } catch (error) {
    pageError.value = error.response?.data?.message || error.message;
    notifyError(pageError.value, 'Invitation could not be sent');
  } finally {
    sending.value = false;
  }
}

async function syncReplies() {
  syncing.value = true;
  pageError.value = '';
  try {
    const { data } = await api.post('/admin/meetings/sync-replies');
    notifySuccess(data.message, 'Reply sync complete');
    await loadInvitations();
  } catch (error) {
    pageError.value = error.response?.data?.message || error.message;
    notifyError(pageError.value, 'Replies could not be synchronized');
  } finally {
    syncing.value = false;
  }
}

function displayDate(value) {
  return value || '—';
}

function statusClass(status) {
  return `meeting-status meeting-status-${String(status || '').toLowerCase()}`;
}

function statusLabel(status) {
  return { YES: 'ACCEPTED', NO: 'DECLINED', MAYBE: 'TENTATIVE' }[status] || status;
}

onMounted(loadInvitations);
</script>

<template>
  <main class="page meeting-page">
    <section class="hero meeting-hero">
      <div>
        <span class="badge">OUTLOOK CALENDAR RSVP</span>
        <h1>Meeting Invitation Test</h1>
        <p>Assign a recipient and send a calendar invitation from this page. The recipient responds with Accept, Tentative, or Decline inside Outlook.</p>
      </div>
      <div class="status">
        <b>{{ token ? 'ADMIN READY' : 'LOGIN REQUIRED' }}</b>
        <span>{{ currentUser?.displayName || currentUser?.username || 'Use the Admin page first' }}</span>
      </div>
    </section>

    <section v-if="!token" class="card auth meeting-auth">
      <h2>Administrator login required</h2>
      <p class="muted">Sign in through the Admin page, then return here to send and monitor invitations.</p>
      <router-link class="button-link primary-link" to="/admin">Open Admin Login</router-link>
    </section>

    <template v-else>
      <section class="meeting-toolbar">
        <router-link class="button-link" to="/admin">Back to Admin</router-link>
        <div class="meeting-toolbar-actions">
          <button :disabled="loading" @click="loadInvitations">{{ loading ? 'Refreshing…' : 'Refresh list' }}</button>
          <button class="primary" :disabled="syncing" @click="syncReplies">{{ syncing ? 'Checking mailbox…' : 'Sync Outlook replies' }}</button>
        </div>
      </section>

      <section class="card">
        <div class="section-title">
          <div>
            <h2>Send an invitation</h2>
            <p class="muted">The application sends a standard calendar request. No Microsoft Provider ID, Entra application, or recipient Object ID is required.</p>
          </div>
        </div>

        <form class="meeting-form" @submit.prevent="sendInvitation">
          <div class="field meeting-title-field">
            <label for="meeting-title">Meeting title <span class="required-mark">*</span></label>
            <input id="meeting-title" v-model.trim="form.title" maxlength="255" required />
          </div>
          <div class="field">
            <label for="meeting-date">Date</label>
            <input id="meeting-date" v-model="form.meetingDate" type="date" required />
          </div>
          <div class="field">
            <label for="meeting-time">Time</label>
            <input id="meeting-time" v-model="form.meetingTime" type="time" required />
          </div>
          <div class="field">
            <label for="meeting-recipient">Outlook recipient <span class="required-mark">*</span></label>
            <input id="meeting-recipient" v-model.trim="form.recipientEmail" type="email" autocomplete="email" required />
          </div>
          <div class="field">
            <label for="meeting-duration">Duration</label>
            <select id="meeting-duration" v-model.number="form.durationMinutes">
              <option :value="30">30 minutes</option>
              <option :value="60">1 hour</option>
              <option :value="90">1 hour 30 minutes</option>
              <option :value="120">2 hours</option>
            </select>
          </div>
          <div class="meeting-send-row">
            <p v-if="pageError" class="meeting-error" role="alert">{{ pageError }}</p>
            <button class="primary" type="submit" :disabled="sending">
              {{ sending ? 'Sending through SMTP…' : 'Send invitation' }}
            </button>
          </div>
        </form>
      </section>

      <section class="card">
        <div class="section-title">
          <div>
            <h2>Recent invitations</h2>
            <p class="muted">The latest 100 invitations and the response recorded from Outlook.</p>
          </div>
          <span>{{ invitations.length }} invitation(s)</span>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Meeting</th>
                <th>Recipient</th>
                <th>Schedule</th>
                <th>Status</th>
                <th>Sent</th>
                <th>Responded</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="invitation in invitations" :key="invitation.INVITE_ID">
                <td>{{ invitation.MEETING_TITLE }}</td>
                <td>{{ invitation.RECIPIENT_EMAIL }}</td>
                <td>{{ displayDate(invitation.MEETING_DATE) }} {{ invitation.MEETING_TIME || '' }}</td>
                <td><span :class="statusClass(invitation.RESPONSE_STATUS)">{{ statusLabel(invitation.RESPONSE_STATUS) }}</span></td>
                <td>{{ formatDateTime(invitation.CREATED_AT) }}</td>
                <td>{{ invitation.RESPONDED_AT ? formatDateTime(invitation.RESPONDED_AT) : '—' }}</td>
              </tr>
              <tr v-if="!invitations.length && !loading">
                <td colspan="6">No invitations have been sent.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.meeting-hero { min-height: 210px; }
.meeting-toolbar { display: flex; justify-content: space-between; gap: 12px; margin-top: 20px; }
.meeting-toolbar-actions { display: flex; gap: 12px; }
.meeting-form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; margin-top: 22px; }
.meeting-title-field { grid-column: span 2; }
.meeting-send-row { grid-column: 1 / -1; display: flex; align-items: center; justify-content: flex-end; gap: 18px; }
.meeting-error { flex: 1; margin: 0; color: var(--red-600); }
.meeting-status { display: inline-flex; min-width: 78px; justify-content: center; padding: 5px 9px; border-radius: 999px; background: #e9eef5; color: #52647b; font-size: .74rem; font-weight: 850; letter-spacing: .035em; }
.meeting-status-yes { color: #17603a; background: #e1f5e9; }
.meeting-status-no { color: #9d2b23; background: #fff0ee; }
.meeting-status-maybe { color: #855d10; background: #fff7dc; }
.primary-link { color: #fff; border-color: var(--blue-700); background: var(--blue-700); }
.meeting-auth .button-link { margin-top: 18px; }
@media (max-width: 820px) {
  .meeting-form { grid-template-columns: 1fr 1fr; }
  .meeting-title-field { grid-column: 1 / -1; }
}
@media (max-width: 560px) {
  .meeting-form { grid-template-columns: 1fr; }
  .meeting-title-field { grid-column: auto; }
  .meeting-send-row { align-items: stretch; flex-direction: column; }
}
</style>
