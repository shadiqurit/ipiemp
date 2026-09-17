<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api.js';

const route = useRoute();
const invitation = ref(null);
const loading = ref(true);
const saving = ref(false);
const saved = ref(false);
const error = ref('');

const inviteId = String(route.query.invite || '').trim();
const token = String(route.query.token || '');
const response = String(route.query.response || '').trim().toUpperCase();
const allowedResponses = ['YES', 'NO', 'MAYBE'];

const responseLabel = computed(() => ({
  YES: 'Yes, I will join',
  NO: 'No, I cannot join',
  MAYBE: 'Maybe'
}[response] || 'Unknown response'));

const responseClass = computed(() => `response-${response.toLowerCase()}`);

function messageFrom(errorValue, fallback) {
  return errorValue?.response?.data?.message || fallback;
}

async function loadInvitation() {
  if (!inviteId || !token || !allowedResponses.includes(response)) {
    error.value = 'This meeting invitation link is invalid.';
    loading.value = false;
    return;
  }

  try {
    const { data } = await api.get(`/public/meetings/${encodeURIComponent(inviteId)}`, {
      params: { token }
    });
    invitation.value = data;
    if (data.responseStatus !== 'PENDING') {
      if (data.responseStatus === response) saved.value = true;
      else error.value = `A ${data.responseStatus} response has already been recorded.`;
    }
  } catch (loadError) {
    error.value = messageFrom(loadError, 'The invitation could not be loaded.');
  } finally {
    loading.value = false;
  }
}

async function confirmResponse() {
  if (saving.value || saved.value) return;
  saving.value = true;
  error.value = '';

  try {
    await api.post(`/public/meetings/${encodeURIComponent(inviteId)}/respond`, {
      token,
      response
    });
    saved.value = true;
    invitation.value.responseStatus = response;
    window.history.replaceState({}, '', '/meeting-response');
  } catch (saveError) {
    error.value = messageFrom(saveError, 'Your response could not be saved.');
  } finally {
    saving.value = false;
  }
}

onMounted(loadInvitation);
</script>

<template>
  <main class="meeting-response-page">
    <section class="response-card">
      <header class="response-header">
        <span>IBN SINA</span>
        <h1>Meeting Invitation</h1>
      </header>

      <div class="response-body">
        <div v-if="loading" class="response-state">Loading your invitation…</div>

        <template v-else-if="invitation">
          <div v-if="saved" class="response-success" role="status">
            <span aria-hidden="true">✓</span>
            <div>
              <strong>Your response: {{ responseLabel }}</strong>
              <p>Thank you. Your response has been recorded.</p>
            </div>
          </div>

          <template v-else>
            <h2>{{ invitation.title }}</h2>
            <p class="response-question">Please confirm your meeting response.</p>

            <dl class="response-details">
              <template v-if="invitation.meetingDate">
                <dt>Date</dt><dd>{{ invitation.meetingDate }}</dd>
              </template>
              <template v-if="invitation.meetingTime">
                <dt>Time</dt><dd>{{ invitation.meetingTime }}</dd>
              </template>
              <dt>Invited email</dt><dd>{{ invitation.recipientEmail }}</dd>
            </dl>

            <div class="response-choice" :class="responseClass">
              Selected response: <strong>{{ responseLabel }}</strong>
            </div>

            <p v-if="error" class="response-error" role="alert">{{ error }}</p>
            <button
              class="response-confirm"
              :class="responseClass"
              :disabled="saving || invitation.responseStatus !== 'PENDING'"
              @click="confirmResponse"
            >
              {{ saving ? 'Saving response…' : `Confirm: ${responseLabel}` }}
            </button>
          </template>
        </template>

        <div v-else class="response-state response-error" role="alert">{{ error }}</div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.meeting-response-page {
  display: grid;
  min-height: 100vh;
  padding: 72px 18px 40px;
  place-items: center;
}
.response-card {
  width: min(100%, 620px);
  overflow: hidden;
  border: 1px solid #d7e2ed;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 24px 70px rgb(16 42 67 / 18%);
}
.response-header { padding: 30px 34px; color: #fff; background: linear-gradient(125deg, #102a43, #1f5fbf 72%, #0f8b8d); }
.response-header span { color: #c7def7; font-size: .72rem; font-weight: 850; letter-spacing: .13em; }
.response-header h1 { margin: 6px 0 0; font-size: clamp(1.7rem, 5vw, 2.25rem); }
.response-body { padding: 32px 34px 36px; }
.response-body h2 { margin: 0; color: #102a43; font-size: 1.4rem; }
.response-question { margin: 8px 0 22px; color: #66758b; }
.response-details { display: grid; grid-template-columns: 112px 1fr; padding: 14px 18px; margin: 0 0 22px; border: 1px solid #dbe7f3; border-radius: 12px; background: #f7faff; }
.response-details dt, .response-details dd { padding: 7px 0; margin: 0; overflow-wrap: anywhere; }
.response-details dt { color: #66758b; }
.response-details dd { color: #17223b; font-weight: 750; }
.response-choice { padding: 14px 16px; border: 1px solid; border-radius: 11px; text-align: center; }
.response-yes { color: #08704e; border-color: #a9dfca; background: #ecfbf5; }
.response-no { color: #a52e29; border-color: #efc2bf; background: #fff3f2; }
.response-maybe { color: #976006; border-color: #edd39d; background: #fff8e9; }
.response-confirm { width: 100%; margin-top: 16px; color: #fff; border: 0; }
.response-confirm.response-yes { background: #138a62; }
.response-confirm.response-no { background: #c2413a; }
.response-confirm.response-maybe { background: #d18a12; }
.response-error { padding: 13px 15px; margin: 16px 0 0; color: #9b302b; border: 1px solid #efc2bf; border-radius: 10px; background: #fff3f2; }
.response-state { color: #66758b; text-align: center; }
.response-success { display: flex; align-items: flex-start; gap: 16px; padding: 20px; color: #08704e; border: 1px solid #a9dfca; border-radius: 13px; background: #ecfbf5; }
.response-success > span { display: grid; width: 35px; height: 35px; flex: 0 0 35px; place-items: center; color: #fff; border-radius: 50%; background: #138a62; font-weight: 900; }
.response-success strong { display: block; font-size: 1.05rem; }
.response-success p { margin: 5px 0 0; color: #39735f; }
@media (max-width: 520px) {
  .meeting-response-page { padding: 66px 8px 20px; }
  .response-card { border-radius: 14px; }
  .response-header, .response-body { padding: 25px 20px; }
  .response-details { grid-template-columns: 1fr; }
  .response-details dt { padding-bottom: 0; }
}
</style>
