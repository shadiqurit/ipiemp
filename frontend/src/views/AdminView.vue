<script setup>
import { onMounted, ref } from 'vue';
import { api, setAdminToken } from '../api';

const token = ref(localStorage.getItem('admin_token') || '');
const username = ref('');
const password = ref('');
const message = ref('');
const batches = ref([]);
const requests = ref([]);
const employees = ref([]);
const newBatch = ref('');
const employeeBatchFilter = ref('');

if (token.value) setAdminToken(token.value);

async function login() {
  try {
    const { data } = await api.post(
      '/admin/login',
      {
        username: username.value,
        password: password.value
      }
    );

    token.value = data.token;
    localStorage.setItem('admin_token', token.value);
    setAdminToken(token.value);
    await refresh();

  } catch (e) {
    message.value = e.response?.data?.message || e.message;
  }
}

async function refresh() {
  if (!token.value) return;

  try {
    const [b, r, e] = await Promise.all([
      api.get('/admin/batches'),
      api.get('/admin/update-requests'),
      api.get('/admin/employees', {
        params: employeeBatchFilter.value
          ? { batchNo: employeeBatchFilter.value }
          : {}
      })
    ]);

    batches.value = b.data;
    requests.value = r.data;
    employees.value = e.data;

  } catch (e) {
    message.value = e.response?.data?.message || e.message;
  }
}

async function addBatch() {
  try {
    await api.post('/admin/batches', {
      batchNo: newBatch.value
    });

    newBatch.value = '';
    await refresh();

  } catch (e) {
    message.value = e.response?.data?.message || e.message;
  }
}

async function setBatch(batchNo, status) {
  try {
    await api.patch(
      `/admin/batches/${encodeURIComponent(batchNo)}/status`,
      { status }
    );

    await refresh();

  } catch (e) {
    message.value = e.response?.data?.message || e.message;
  }
}

async function assignIpi(emp) {
  const newIpi = window.prompt(
    `Assign IPI\nMerit List ID: ${emp.MERITLIST_ID}\nClass ID: ${emp.CLASS_ID}`,
    emp.IPI || ''
  );

  if (newIpi === null) return;

  try {
    const { data } = await api.patch(
      `/admin/employees/${emp.EMP_ENTRY_ID}/ipi`,
      { ipi: newIpi.trim() }
    );

    message.value = data.message;
    await refresh();

  } catch (e) {
    message.value = e.response?.data?.message || e.message;
  }
}

async function decide(id, status) {
  const remark = window.prompt('Admin remarks (optional)') || '';

  try {
    await api.patch(
      `/admin/update-requests/${id}`,
      { status, remark }
    );

    await refresh();

  } catch (e) {
    message.value = e.response?.data?.message || e.message;
  }
}

async function exportBatch(batchNo) {
  try {
    const response = await api.get(
      `/admin/export/${encodeURIComponent(batchNo)}`,
      { responseType: 'blob' }
    );

    const url = URL.createObjectURL(response.data);
    const a = document.createElement('a');

    a.href = url;
    a.download = `Employee_Data_${batchNo}.xlsx`;

    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

  } catch (e) {
    message.value = e.response?.data?.message || e.message;
  }
}

function logout() {
  token.value = '';
  localStorage.removeItem('admin_token');
  setAdminToken('');
}

onMounted(refresh);
</script>

<template>
  <main class="page">
    <section class="hero">
      <div>
        <span class="badge">ADMIN</span>
        <h1>Employee Portal Admin</h1>
      </div>
    </section>

    <div v-if="message" class="notice">{{ message }}</div>

    <section v-if="!token" class="card auth">
      <h2>Admin Login</h2>

      <label>Username</label>
      <input v-model="username" />

      <label>Password</label>
      <input
        v-model="password"
        type="password"
        @keyup.enter="login"
      />

      <button class="primary" @click="login">
        Login
      </button>
    </section>

    <template v-else>
      <section class="toolbar">
        <router-link to="/">Public Form</router-link>
        <button @click="refresh">Refresh</button>
        <button @click="logout">Logout</button>
      </section>

      <section class="card">
        <h2>Batch Control</h2>

        <div class="inline">
          <input
            v-model="newBatch"
            placeholder="BATCH-2026-01"
          />

          <button @click="addBatch">
            Create Batch
          </button>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              <tr
                v-for="b in batches"
                :key="b.BATCH_NO"
              >
                <td>{{ b.BATCH_NO }}</td>
                <td>{{ b.STATUS }}</td>

                <td class="actions-cell">
                  <button
                    v-if="b.STATUS !== 'ACTIVE'"
                    @click="setBatch(b.BATCH_NO,'ACTIVE')"
                  >
                    Activate
                  </button>

                  <button
                    v-else
                    @click="setBatch(b.BATCH_NO,'INACTIVE')"
                  >
                    Deactivate
                  </button>

                  <button @click="exportBatch(b.BATCH_NO)">
                    Excel
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <div class="section-title">
          <div>
            <h2>Employee List / Assign IPI</h2>
            <p class="muted">
              IPI is assigned by admin after employee submits using Merit List ID + Class ID.
            </p>
          </div>

          <div class="inline">
            <select
              v-model="employeeBatchFilter"
              @change="refresh"
            >
              <option value="">All Batches</option>
              <option
                v-for="b in batches"
                :key="b.BATCH_NO"
                :value="b.BATCH_NO"
              >
                {{ b.BATCH_NO }}
              </option>
            </select>
          </div>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Merit List ID</th>
                <th>Class ID</th>
                <th>IPI</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Batch</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              <tr
                v-for="e in employees"
                :key="e.EMP_ENTRY_ID"
              >
                <td>{{ e.MERITLIST_ID }}</td>
                <td>{{ e.CLASS_ID }}</td>
                <td>{{ e.IPI || 'Not assigned' }}</td>
                <td>{{ e.NAME }}</td>
                <td>{{ e.PHONE }}</td>
                <td>{{ e.batch_no }}</td>

                <td>
                  <button @click="assignIpi(e)">
                    {{ e.IPI ? 'Change IPI' : 'Assign IPI' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <h2>Update Requests</h2>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Merit List</th>
                <th>Class ID</th>
                <th>IPI</th>
                <th>Name</th>
                <th>Batch</th>
                <th>Note</th>
                <th>Status</th>
                <th>Until</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              <tr
                v-for="r in requests"
                :key="r.REQUEST_ID"
              >
                <td>{{ r.MERITLIST_ID }}</td>
                <td>{{ r.CLASS_ID }}</td>
                <td>{{ r.IPI || '-' }}</td>
                <td>{{ r.NAME }}</td>
                <td>{{ r.BATCH_NO }}</td>
                <td>{{ r.REQUEST_NOTE }}</td>
                <td>{{ r.STATUS }}</td>
                <td>{{ r.APPROVED_UNTIL }}</td>

                <td
                  class="actions-cell"
                  v-if="r.STATUS === 'PENDING'"
                >
                  <button @click="decide(r.REQUEST_ID,'APPROVED')">
                    Approve 24h
                  </button>

                  <button
                    class="danger"
                    @click="decide(r.REQUEST_ID,'REJECTED')"
                  >
                    Reject
                  </button>
                </td>

                <td v-else>-</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </main>
</template>
