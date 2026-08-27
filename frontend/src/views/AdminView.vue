<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api, setAdminToken } from '../api';
import AutoCompleteSelect from '../components/AutoCompleteSelect.vue';
import DateInput from '../components/DateInput.vue';
import { formatDateTime } from '../utils/dates';

const token = ref(localStorage.getItem('admin_token') || '');
const username = ref('');
const password = ref('');
const message = ref('');
const activeSection = ref('employees');
const users = ref([]);
const batches = ref([]);
const requests = ref([]);
const employees = ref([]);
const newBatch = ref('');
const employeeBatchFilter = ref('');
const employeeSearch = ref('');
const batchFilterOptions = computed(() => batches.value.map(batch => ({ value: batch.BATCH_NO, label: `${batch.BATCH_NO} (${batch.STATUS})` })));
const newUser = reactive({ username: '', displayName: '', password: '' });
const userModalOpen = ref(false);
const passwordModalOpen = ref(false);
const selectedUser = ref(null);
const replacementPassword = ref('');
const selectedEmployeeId = ref(null);
const editLoading = ref(false);
const editBatch = ref('');
const editApprovalStatus = ref('PENDING');
const editEmployee = reactive({});
const editEducation = ref([]);

const employeeFields = [
  ['NAME', 'Employee Name'], ['BIRTHDATE', 'Birth Date', 'date'], ['BLD_GROUP', 'Blood Group'],
  ['GENDER', 'Gender'], ['RELIGION', 'Religion'], ['NATIONALITY', 'Nationality'],
  ['MARITAL_STATUS', 'Marital Status'], ['EMAIL', 'Email', 'email'], ['PHONE', 'Primary Phone'],
  ['PHONE1', 'Alternate Phone'], ['HEIGHT', 'Height'], ['WEIGHT', 'Weight'], ['NID', 'NID'],
  ['PERMANENT_VILLAGE', 'Permanent Village / House'], ['PERMANENT_POST', 'Permanent Post'],
  ['PERMANENT_THANA', 'Permanent Thana / Upazila'], ['PERMANENT_DISTRICT', 'Permanent District'],
  ['PRESENT_VILLAGE', 'Present Village / House'], ['PRESENT_POST', 'Present Post'],
  ['PRESENT_THANA', 'Present Thana / Upazila'], ['PRESENT_DISTRICT', 'Present District'],
  ['EMGRCNY_PERSON', 'Emergency Person'], ['EMGRCNY_RELATION', 'Emergency Relationship'],
  ['EMGRCNY_PHONE', 'Emergency Phone'], ['EMGRCNY_ADDRESS', 'Emergency Address'],
  ['FATHER_NAME', 'Father Name'], ['FATHER_PHONE', 'Father Phone'], ['MOTHER_NAME', 'Mother Name'],
  ['MOTHER_PHONE', 'Mother Phone'], ['SPOUSE_NAME', 'Spouse Name'],
  ['SPOSE_MARRIAGE_DATE', 'Marriage Date', 'date'], ['SPOSE_OCCUPATION', 'Spouse Occupation'],
  ['SPOUSE_PHONE', 'Spouse Phone'], ['GRNT_NAME', 'Guarantor Name'],
  ['GRNT_RELE', 'Guarantor Relationship'], ['GRNT_FATHER', 'Guarantor Father'],
  ['GRNT_PRESENT_ADD', 'Guarantor Present Address'], ['GRNT_PERMANET_ADD', 'Guarantor Permanent Address'],
  ['GRNT_NATIONALITY', 'Guarantor Nationality'], ['GRNT_PROFFESSION', 'Guarantor Profession'],
  ['GRNT_NID', 'Guarantor NID'], ['GRNT_MOBILE', 'Guarantor Mobile']
];

const educationFields = [
  ['EXAMNAME', 'Exam Name'], ['EXAMGROUP', 'Group'], ['BOARD', 'Board / University'],
  ['CLAS', 'Class / Result'], ['PASSYEAR', 'Pass Year'], ['SUBJECT_NAME', 'Subject'],
  ['INSTITUTE', 'Institute'], ['REMARKS', 'Remarks']
];

function blankEducation() {
  return { EXAMNAME: '', EXAMGROUP: '', BOARD: '', CLAS: '', PASSYEAR: '', REMARKS: '', INSTITUTE: '', SUBJECT_NAME: '' };
}

if (token.value) setAdminToken(token.value);

async function login() {
  try {
    const { data } = await api.post('/admin/login', { username: username.value, password: password.value });
    token.value = data.token;
    localStorage.setItem('admin_token', token.value);
    setAdminToken(token.value);
    password.value = '';
    await refresh();
  } catch (e) {
    message.value = e.response?.data?.message || e.message;
  }
}

async function refresh() {
  if (!token.value) return;
  try {
    const [u, b, r, e] = await Promise.all([
      api.get('/admin/users'),
      api.get('/admin/batches'),
      api.get('/admin/update-requests'),
      api.get('/admin/employees', {
        params: {
          ...(employeeBatchFilter.value ? { batchNo: employeeBatchFilter.value } : {}),
          ...(employeeSearch.value.trim() ? { search: employeeSearch.value.trim() } : {})
        }
      })
    ]);
    users.value = u.data;
    batches.value = b.data;
    requests.value = r.data;
    employees.value = e.data;
  } catch (e) {
    message.value = e.response?.data?.message || e.message;
  }
}

async function createUser() {
  try {
    const { data } = await api.post('/admin/users', newUser);
    message.value = data.message;
    newUser.username = '';
    newUser.displayName = '';
    newUser.password = '';
    await refresh();
    userModalOpen.value = false;
    activeSection.value = 'users';
  } catch (e) {
    message.value = e.response?.data?.message || e.message;
  }
}

async function updateUserPassword() {
  if (!selectedUser.value) return;
  try {
    const { data } = await api.patch(
      `/admin/users/${selectedUser.value.USER_ID}/password`,
      { password: replacementPassword.value }
    );
    message.value = data.message;
    replacementPassword.value = '';
    selectedUser.value = null;
    passwordModalOpen.value = false;
  } catch (e) {
    message.value = e.response?.data?.message || e.message;
  }
}

async function addBatch() {
  try {
    await api.post('/admin/batches', { batchNo: newBatch.value });
    newBatch.value = '';
    await refresh();
  } catch (e) {
    message.value = e.response?.data?.message || e.message;
  }
}

async function setBatch(batchNo, status) {
  try {
    await api.patch(`/admin/batches/${encodeURIComponent(batchNo)}/status`, { status });
    await refresh();
  } catch (e) {
    message.value = e.response?.data?.message || e.message;
  }
}

async function approveEmployee(employee, approvalStatus) {
  try {
    const { data } = await api.patch(`/admin/employees/${employee.EMP_ENTRY_ID}/approval`, { approvalStatus });
    message.value = data.message;
    await refresh();
  } catch (e) {
    message.value = e.response?.data?.message || e.message;
  }
}

async function assignIpi(employee) {
  const ipi = window.prompt(`Assign IPI\nMerit List ID: ${employee.MERITLIST_ID}\nClass ID: ${employee.CLASS_ID}`, employee.IPI || '');
  if (ipi === null) return;
  try {
    const { data } = await api.patch(`/admin/employees/${employee.EMP_ENTRY_ID}/ipi`, { ipi: ipi.trim() });
    message.value = data.message;
    await refresh();
  } catch (e) {
    message.value = e.response?.data?.message || e.message;
  }
}

async function openEmployeeEditor(employee) {
  editLoading.value = true;
  try {
    const { data } = await api.get(`/admin/employees/${employee.EMP_ENTRY_ID}`);
    Object.keys(editEmployee).forEach(key => delete editEmployee[key]);
    Object.assign(editEmployee, data.employee);
    editBatch.value = data.employee.batch_no;
    editApprovalStatus.value = data.employee.APPROVAL_STATUS;
    editEducation.value = data.education.length
      ? data.education.map(row => ({ ...blankEducation(), ...row }))
      : [blankEducation()];
    selectedEmployeeId.value = employee.EMP_ENTRY_ID;
  } catch (e) {
    message.value = e.response?.data?.message || e.message;
  } finally {
    editLoading.value = false;
  }
}

async function saveEmployeeDetails() {
  if (!selectedEmployeeId.value) return;
  editLoading.value = true;
  try {
    const { data } = await api.put(`/admin/employees/${selectedEmployeeId.value}`, {
      employee: editEmployee,
      batchNo: editBatch.value,
      approvalStatus: editApprovalStatus.value,
      education: editEducation.value
    });
    message.value = data.message;
    selectedEmployeeId.value = null;
    await refresh();
  } catch (e) {
    message.value = e.response?.data?.message || e.message;
  } finally {
    editLoading.value = false;
  }
}

function closeEmployeeEditor() {
  selectedEmployeeId.value = null;
}

async function decide(id, status) {
  const remark = window.prompt('Admin remarks (optional)') || '';
  try {
    await api.patch(`/admin/update-requests/${id}`, { status, remark });
    await refresh();
  } catch (e) {
    message.value = e.response?.data?.message || e.message;
  }
}

async function exportBatch(batchNo) {
  try {
    const response = await api.get(`/admin/export/${encodeURIComponent(batchNo)}`, { responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Employee_Data_${batchNo}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
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

function openUserModal() {
  newUser.username = '';
  newUser.displayName = '';
  newUser.password = '';
  userModalOpen.value = true;
}

function openPasswordModal(user) {
  selectedUser.value = user;
  replacementPassword.value = '';
  passwordModalOpen.value = true;
}

onMounted(refresh);
</script>

<template>
  <main class="page">
    <section class="hero">
      <div>
        <span class="badge">ADMIN</span>
        <h1>Employee Portal Admin</h1>
        <p v-if="token">Manage administrator access, employees and update requests.</p>
      </div>
    </section>

    <div v-if="message" class="notice">{{ message }}</div>

    <section v-if="!token" class="card auth">
      <h2>Admin Login</h2>
      <label>Username</label><input v-model="username" autocomplete="username" />
      <label>Password</label><input v-model="password" type="password" autocomplete="current-password" @keyup.enter="login" />
      <button class="primary" @click="login">Login</button>
    </section>

    <template v-else>
      <section class="toolbar">
        <router-link to="/">Public Form</router-link>
        <button @click="refresh">Refresh</button>
        <button @click="logout">Logout</button>
      </section>

      <nav class="admin-menu" aria-label="Admin menu">
        <button :class="{ active: activeSection === 'users' }" @click="activeSection = 'users'">User List</button>
        <button :class="{ active: activeSection === 'batches' }" @click="activeSection = 'batches'">Batch Control</button>
        <button :class="{ active: activeSection === 'employees' }" @click="activeSection = 'employees'">Employee List</button>
        <button :class="{ active: activeSection === 'requests' }" @click="activeSection = 'requests'">Update Requests</button>
      </nav>

      <section v-if="activeSection === 'users'" class="card">
        <div class="section-title"><div><h2>User List</h2><span>{{ users.length }} administrator(s)</span></div><button class="primary" @click="openUserModal">Create User</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Username</th><th>Display Name</th><th>Status</th><th>Created</th><th>Action</th></tr></thead>
          <tbody>
            <tr v-for="user in users" :key="user.USER_ID"><td>{{ user.USERNAME }}</td><td>{{ user.DISPLAY_NAME }}</td><td>{{ user.ACTIVE_YN === 'Y' ? 'Active' : 'Inactive' }}</td><td>{{ formatDateTime(user.CREATED_AT) }}</td><td><button @click="openPasswordModal(user)">Update Password</button></td></tr>
            <tr v-if="!users.length"><td colspan="5">No administrators found.</td></tr>
          </tbody>
        </table></div>
      </section>

      <div v-if="userModalOpen" class="modal-backdrop" @click.self="userModalOpen = false">
        <section class="card modal" role="dialog" aria-modal="true" aria-labelledby="create-user-title">
          <div class="section-title"><h2 id="create-user-title">Create Admin User</h2><button type="button" @click="userModalOpen = false">Close</button></div>
          <p class="muted">Usernames can contain letters, numbers, dot, dash and underscore. Passwords need at least 8 characters.</p>
          <label>Username</label><input v-model="newUser.username" autocomplete="username" />
          <label>Display Name</label><input v-model="newUser.displayName" autocomplete="name" />
          <label>Password</label><input v-model="newUser.password" type="password" autocomplete="new-password" @keyup.enter="createUser" />
          <div class="modal-actions"><button type="button" @click="userModalOpen = false">Cancel</button><button class="primary" @click="createUser">Create User</button></div>
        </section>
      </div>

      <div v-if="passwordModalOpen" class="modal-backdrop" @click.self="passwordModalOpen = false">
        <section class="card modal" role="dialog" aria-modal="true" aria-labelledby="update-password-title">
          <div class="section-title"><h2 id="update-password-title">Update Password</h2><button type="button" @click="passwordModalOpen = false">Close</button></div>
          <p class="muted">Set a new password for <b>{{ selectedUser?.USERNAME }}</b>. It must have at least 8 characters.</p>
          <label>New Password</label><input v-model="replacementPassword" type="password" autocomplete="new-password" @keyup.enter="updateUserPassword" />
          <div class="modal-actions"><button type="button" @click="passwordModalOpen = false">Cancel</button><button class="primary" @click="updateUserPassword">Update Password</button></div>
        </section>
      </div>

      <section v-if="activeSection === 'batches'" class="card">
        <h2>Batch Control</h2>
        <p class="muted">Activate a batch to accept new employee entries and let approved employees update their data without an admin request.</p>
        <div class="inline"><input v-model="newBatch" placeholder="BATCH-2026-01" /><button @click="addBatch">Create Batch</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Batch</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="batch in batches" :key="batch.BATCH_NO"><td>{{ batch.BATCH_NO }}</td><td>{{ batch.STATUS }}</td><td class="actions-cell"><button v-if="batch.STATUS !== 'ACTIVE'" @click="setBatch(batch.BATCH_NO, 'ACTIVE')">Activate</button><button v-else @click="setBatch(batch.BATCH_NO, 'INACTIVE')">Deactivate</button><button @click="exportBatch(batch.BATCH_NO)">Excel</button></td></tr>
            <tr v-if="!batches.length"><td colspan="3">No batches found.</td></tr>
          </tbody>
        </table></div>
      </section>

      <section v-if="activeSection === 'employees'" class="card">
          <div class="section-title"><div><h2>Employee List</h2><p class="muted">New submissions must be approved before an employee can update their data.</p></div><div class="employee-filters"><input v-model="employeeSearch" placeholder="Search name, ID, IPI or phone" @keyup.enter="refresh" /><AutoCompleteSelect v-model="employeeBatchFilter" :options="batchFilterOptions" placeholder="Search batch" /><button @click="refresh">Search</button></div></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Merit List ID</th><th>Class ID</th><th>Name</th><th>Phone</th><th>Batch</th><th>Approval</th><th>IPI</th><th>Actions</th></tr></thead>
            <tbody>
              <tr v-for="employee in employees" :key="employee.EMP_ENTRY_ID"><td>{{ employee.MERITLIST_ID }}</td><td>{{ employee.CLASS_ID }}</td><td>{{ employee.NAME }}</td><td>{{ employee.PHONE }}</td><td>{{ employee.batch_no }}</td><td>{{ employee.APPROVAL_STATUS }}</td><td>{{ employee.IPI || 'Not assigned' }}</td><td class="actions-cell"><router-link class="button-link" :to="{ name: 'admin-employee-edit', params: { empEntryId: employee.EMP_ENTRY_ID } }">Edit Details</router-link><button v-if="employee.APPROVAL_STATUS !== 'APPROVED'" class="primary" @click="approveEmployee(employee, 'APPROVED')">Approve</button><button v-if="employee.APPROVAL_STATUS === 'PENDING'" class="danger" @click="approveEmployee(employee, 'REJECTED')">Reject</button><button @click="assignIpi(employee)">{{ employee.IPI ? 'Change IPI' : 'Assign IPI' }}</button></td></tr>
              <tr v-if="!employees.length"><td colspan="8">No employees found.</td></tr>
            </tbody>
          </table></div>
      </section>

      <form v-if="activeSection === 'employees' && selectedEmployeeId" class="form" @submit.prevent="saveEmployeeDetails">
        <section class="card">
          <div class="section-title"><div><h2>Employee Identity</h2><p class="muted">Administrators can edit identity values, assign IPI, move the employee to another batch, and change approval status.</p></div><button type="button" @click="closeEmployeeEditor">Close</button></div>
          <div class="grid">
            <div class="field"><label>Merit List ID</label><input v-model="editEmployee.MERITLIST_ID" required /></div>
            <div class="field"><label>Class ID</label><input v-model="editEmployee.CLASS_ID" required /></div>
            <div class="field"><label>IPI</label><input v-model="editEmployee.IPI" placeholder="Optional" /></div>
            <div class="field"><label>Batch</label><select v-model="editBatch" required><option v-for="batch in batches" :key="batch.BATCH_NO" :value="batch.BATCH_NO">{{ batch.BATCH_NO }} ({{ batch.STATUS }})</option></select></div>
            <div class="field"><label>Approval Status</label><select v-model="editApprovalStatus"><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></select></div>
          </div>
        </section>

        <section class="card">
          <h2>Basic Information</h2>
          <div class="grid">
            <div class="field"><label>Employee Name</label><input v-model="editEmployee.NAME" /></div>
            <div class="field"><label>Birth Date</label><DateInput v-model="editEmployee.BIRTHDATE" /></div>
            <div class="field"><label>Blood Group</label><input v-model="editEmployee.BLD_GROUP" /></div>
            <div class="field"><label>Nationality</label><input v-model="editEmployee.NATIONALITY" /></div>
            <div class="field"><label>Height</label><input v-model="editEmployee.HEIGHT" /></div>
            <div class="field"><label>Weight</label><input v-model="editEmployee.WEIGHT" /></div>
            <div class="field"><label>Gender</label><select v-model="editEmployee.GENDER"><option value="">Select</option><option value="M">Male</option><option value="F">Female</option></select></div>
            <div class="field"><label>Religion</label><select v-model="editEmployee.RELIGION"><option value="">Select</option><option value="I">Islam</option><option value="H">Hindu</option><option value="B">Buddha</option><option value="C">Christian</option></select></div>
            <div class="field"><label>Marital Status</label><select v-model="editEmployee.MARITAL_STATUS"><option value="">Select</option><option value="U">Unmarried</option><option value="M">Married</option></select></div>
          </div>
        </section>

        <section class="card">
          <h2>Contact &amp; Identity</h2>
          <div class="grid">
            <div class="field"><label>Email</label><input v-model="editEmployee.EMAIL" type="email" /></div>
            <div class="field"><label>Primary Phone</label><input v-model="editEmployee.PHONE" /></div>
            <div class="field"><label>Alternate Phone</label><input v-model="editEmployee.PHONE1" /></div>
            <div class="field"><label>NID</label><input v-model="editEmployee.NID" /></div>
          </div>
        </section>

        <section class="card">
          <h2>Address Information</h2>
          <div class="address-grid">
            <div class="address-box">
              <h3>Permanent Address</h3>
              <label>Village / House / Road</label><input v-model="editEmployee.PERMANENT_VILLAGE" />
              <label>Post Office</label><input v-model="editEmployee.PERMANENT_POST" />
              <label>Thana / Upazila</label><input v-model="editEmployee.PERMANENT_THANA" />
              <label>District</label><input v-model="editEmployee.PERMANENT_DISTRICT" />
            </div>
            <div class="address-box">
              <h3>Present Address</h3>
              <label>Village / House / Road</label><input v-model="editEmployee.PRESENT_VILLAGE" />
              <label>Post Office</label><input v-model="editEmployee.PRESENT_POST" />
              <label>Thana / Upazila</label><input v-model="editEmployee.PRESENT_THANA" />
              <label>District</label><input v-model="editEmployee.PRESENT_DISTRICT" />
            </div>
          </div>
        </section>

        <section class="card">
          <h2>Emergency Contact</h2>
          <div class="grid">
            <div class="field"><label>Emergency Person</label><input v-model="editEmployee.EMGRCNY_PERSON" /></div>
            <div class="field"><label>Relationship</label><input v-model="editEmployee.EMGRCNY_RELATION" /></div>
            <div class="field"><label>Emergency Phone</label><input v-model="editEmployee.EMGRCNY_PHONE" /></div>
            <div class="field"><label>Emergency Address</label><input v-model="editEmployee.EMGRCNY_ADDRESS" /></div>
          </div>
        </section>

        <section class="card">
          <h2>Family &amp; Spouse</h2>
          <div class="grid">
            <div class="field"><label>Father Name</label><input v-model="editEmployee.FATHER_NAME" /></div>
            <div class="field"><label>Father Phone</label><input v-model="editEmployee.FATHER_PHONE" /></div>
            <div class="field"><label>Mother Name</label><input v-model="editEmployee.MOTHER_NAME" /></div>
            <div class="field"><label>Mother Phone</label><input v-model="editEmployee.MOTHER_PHONE" /></div>
            <div class="field"><label>Spouse Name</label><input v-model="editEmployee.SPOUSE_NAME" /></div>
            <div class="field"><label>Marriage Date</label><DateInput v-model="editEmployee.SPOSE_MARRIAGE_DATE" /></div>
            <div class="field"><label>Spouse Occupation</label><input v-model="editEmployee.SPOSE_OCCUPATION" /></div>
            <div class="field"><label>Spouse Phone</label><input v-model="editEmployee.SPOUSE_PHONE" /></div>
          </div>
        </section>

        <section class="card">
          <h2>Guarantor Information</h2>
          <div class="grid">
            <div class="field"><label>Guarantor Name</label><input v-model="editEmployee.GRNT_NAME" /></div>
            <div class="field"><label>Relationship</label><input v-model="editEmployee.GRNT_RELE" /></div>
            <div class="field"><label>Guarantor Father</label><input v-model="editEmployee.GRNT_FATHER" /></div>
            <div class="field"><label>Present Address</label><input v-model="editEmployee.GRNT_PRESENT_ADD" /></div>
            <div class="field"><label>Permanent Address</label><input v-model="editEmployee.GRNT_PERMANET_ADD" /></div>
            <div class="field"><label>Nationality</label><input v-model="editEmployee.GRNT_NATIONALITY" /></div>
            <div class="field"><label>Profession</label><input v-model="editEmployee.GRNT_PROFFESSION" /></div>
            <div class="field"><label>NID</label><input v-model="editEmployee.GRNT_NID" /></div>
            <div class="field"><label>Mobile</label><input v-model="editEmployee.GRNT_MOBILE" /></div>
          </div>
        </section>

        <section class="card">
          <div class="section-title"><h2>Education</h2><button type="button" @click="editEducation.push(blankEducation())">+ Add Education</button></div>
          <div v-for="(education, index) in editEducation" :key="index" class="edu">
            <div class="section-title"><b>Education #{{ index + 1 }}</b><button v-if="editEducation.length > 1" type="button" class="danger" @click="editEducation.splice(index, 1)">Remove</button></div>
            <div class="grid"><div v-for="[key, label] in educationFields" :key="key" class="field"><label>{{ label }}</label><input v-model="education[key]" /></div></div>
          </div>
        </section>

        <section class="sticky-actions"><button type="button" @click="closeEmployeeEditor">Cancel</button><button class="primary" type="submit" :disabled="editLoading">{{ editLoading ? 'Saving…' : 'Save Employee Changes' }}</button></section>
      </form>

      <section v-if="activeSection === 'requests'" class="card">
        <h2>Update Requests</h2>
        <p class="muted">Requests are only needed when an approved employee's batch is inactive. Active batches allow updates immediately.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Merit List</th><th>Class ID</th><th>IPI</th><th>Name</th><th>Batch</th><th>Note</th><th>Status</th><th>Until</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="request in requests" :key="request.REQUEST_ID"><td>{{ request.MERITLIST_ID }}</td><td>{{ request.CLASS_ID }}</td><td>{{ request.IPI || '-' }}</td><td>{{ request.NAME }}</td><td>{{ request.BATCH_NO }}</td><td>{{ request.REQUEST_NOTE }}</td><td>{{ request.STATUS }}</td><td>{{ formatDateTime(request.APPROVED_UNTIL) }}</td><td v-if="request.STATUS === 'PENDING'" class="actions-cell"><button class="primary" @click="decide(request.REQUEST_ID, 'APPROVED')">Approve 24h</button><button class="danger" @click="decide(request.REQUEST_ID, 'REJECTED')">Reject</button></td><td v-else>-</td></tr>
            <tr v-if="!requests.length"><td colspan="9">No update requests found.</td></tr>
          </tbody>
        </table></div>
      </section>
    </template>
  </main>
</template>
