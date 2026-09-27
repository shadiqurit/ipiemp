<script setup>
import { computed, ref } from 'vue';
import { api } from '../api';

const props = defineProps({ employees: { type: Array, required: true } });
const emit = defineEmits(['close']);
const selected = ref([]);
const busy = ref(false);
const preview = ref(null);
const error = ref('');
const result = ref(null);
const destination = ref('local');
const eligible = computed(() => props.employees.filter(employee => String(employee.IPI || '').trim()));

function resetPreview() {
  preview.value = null;
  result.value = null;
  error.value = '';
}

function selectAll() {
  selected.value = eligible.value.slice(0, 100).map(employee => employee.EMP_ENTRY_ID);
  resetPreview();
}

async function run(action) {
  busy.value = true;
  error.value = '';
  try {
    const { data } = await api.post(`/admin/oracle/${action}`, {
      employeeIds: selected.value,
      ...(action === 'transfer' ? { previewToken: preview.value.previewToken } : {})
    }, { timeout: 180000 });
    if (action === 'preview') preview.value = data;
    else {
      result.value = data;
      preview.value = null;
    }
  } catch (e) {
    error.value = e.response?.data?.message || (action === 'transfer'
      ? 'The transfer result could not be confirmed. Wait for it to finish, then preview and retry. Matching records will be updated.'
      : 'Oracle preview could not be loaded. Check the connection and try again.');
    preview.value = null;
  } finally { busy.value = false; }
}

async function downloadLocalFile() {
  busy.value = true;
  error.value = '';
  try {
    const { data } = await api.post('/admin/oracle/export', { employeeIds: selected.value }, { timeout: 180000 });
    const filename = `employee-oracle-${data.exportedAt.replace(/[:.]/g, '-')}.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    result.value = {
      downloaded: true,
      message: `Download ready: ${filename}. Import this file on your Oracle PC to save the data.`,
      tables: Object.entries(data.tables).map(([table, rows]) => ({ source: table, target: table, rows: rows.length }))
    };
    preview.value = null;
  } catch (e) {
    error.value = e.response?.data?.message || 'The export could not be downloaded. Try again.';
  } finally { busy.value = false; }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="!busy && emit('close')">
    <section class="card modal oracle-transfer-modal" role="dialog" aria-modal="true" aria-labelledby="oracle-transfer-title">
      <div class="section-title">
        <h2 id="oracle-transfer-title">Transfer to Oracle</h2>
        <button type="button" :disabled="busy" @click="emit('close')">Close</button>
      </div>
      <p>Select up to 100 employees with an assigned IPI from the current search results. Approval status does not affect transfer eligibility. Their employee, education and family records will be saved together.</p>
      <p>{{ eligible.length }} of {{ props.employees.length }} employees have an assigned IPI. {{ props.employees.length - eligible.length }} without an IPI are excluded.</p>
      <p class="muted">Existing matching records will be updated. Records removed from the portal, and records under an earlier IPI, remain in Oracle.</p>
      <label v-if="!result" class="oracle-destination">
        Destination
        <select v-model="destination" :disabled="busy" @change="resetPreview">
          <option value="local">Oracle on my local PC</option>
          <option value="server">Oracle connected to the website server</option>
        </select>
      </label>
      <p v-if="!result && destination === 'local'" class="muted">Download a transfer file, then use the local importer on the PC where Oracle is installed.</p>
      <div v-if="!result" class="oracle-selection">
        <button type="button" :disabled="busy || !eligible.length" @click="selectAll">{{ eligible.length <= 100 ? 'Select all' : 'Select first' }} {{ Math.min(100, eligible.length) }}</button>
        <button type="button" :disabled="busy || !selected.length" @click="selected = []; resetPreview()">Clear selection</button>
        <span>{{ selected.length }} selected</span>
      </div>
      <div v-if="!result" class="table-wrap oracle-selection-table">
        <table>
          <thead><tr><th>Select</th><th>IPI</th><th>Name</th><th>Batch</th></tr></thead>
          <tbody>
            <tr v-for="employee in eligible" :key="employee.EMP_ENTRY_ID">
              <td><input v-model="selected" type="checkbox" :value="employee.EMP_ENTRY_ID" :disabled="busy || (selected.length >= 100 && !selected.includes(employee.EMP_ENTRY_ID))" :aria-label="`Transfer ${employee.NAME || employee.IPI}`" @change="resetPreview" /></td>
              <td>{{ employee.IPI }}</td><td>{{ employee.NAME }}</td><td>{{ employee.batch_no }}</td>
            </tr>
            <tr v-if="!eligible.length"><td colspan="4">No employees with an assigned IPI in the current results.</td></tr>
          </tbody>
        </table>
      </div>
      <p v-if="error" class="oracle-error" role="alert">{{ error }}</p>
      <div v-if="preview || result" aria-live="polite">
        <p v-if="result" class="oracle-success" role="status">{{ result.message }}</p>
        <p v-else>Connection and table mapping checked. Review the destination and row counts, then transfer.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ result?.downloaded ? 'Downloaded table' : 'Oracle table' }}</th><th>Rows</th></tr></thead>
            <tbody><tr v-for="table in (result || preview).tables" :key="table.source"><td>{{ table.target }}</td><td>{{ table.rows }}</td></tr></tbody>
          </table>
        </div>
      </div>
      <div v-if="!result" class="modal-actions">
        <button v-if="destination === 'local'" class="primary" type="button" :disabled="busy || !selected.length" @click="downloadLocalFile">{{ busy ? 'Downloading…' : 'Download for local Oracle' }}</button>
        <button v-else type="button" :disabled="busy || !selected.length" @click="run('preview')">{{ busy ? 'Working…' : 'Preview transfer' }}</button>
        <button v-if="destination === 'server' && preview" class="primary" type="button" :disabled="busy" @click="run('transfer')">{{ busy ? 'Saving…' : 'Save to Oracle' }}</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.oracle-transfer-modal { width: min(900px, 96vw); max-height: 90vh; overflow-y: auto; }
.oracle-selection { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin: 16px 0; }
.oracle-selection-table { max-height: 300px; overflow: auto; }
.oracle-selection-table input { width: auto; }
.oracle-destination { display: block; margin: 16px 0; }
.oracle-error { color: #b42318; }
.oracle-success { color: #087443; }
</style>
