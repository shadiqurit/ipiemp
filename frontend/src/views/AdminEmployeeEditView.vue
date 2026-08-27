<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, setAdminToken } from '../api';
import AutoCompleteSelect from '../components/AutoCompleteSelect.vue';
import DateInput from '../components/DateInput.vue';

const props = defineProps({ empEntryId: { type: String, required: true } });
const router = useRouter();
const token = localStorage.getItem('admin_token') || '';
const employee = reactive({});
const batches = ref([]);
const education = ref([]);
const batchNo = ref('');
const approvalStatus = ref('PENDING');
const message = ref('');
const loading = ref(true);
const saving = ref(false);
const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const approvalOptions = [{ value: 'PENDING', label: 'Pending' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' }];
const batchOptions = computed(() => batches.value.map(batch => ({ value: batch.BATCH_NO, label: `${batch.BATCH_NO} (${batch.STATUS})` })));

if (token) setAdminToken(token);

function blankEducation() {
  return { EXAMNAME: '', EXAMGROUP: '', BOARD: '', CLAS: '', PASSYEAR: '', REMARKS: '', INSTITUTE: '', SUBJECT_NAME: '' };
}

async function load() {
  if (!token) {
    router.replace('/admin');
    return;
  }

  loading.value = true;
  try {
    const [employeeResponse, batchResponse] = await Promise.all([
      api.get(`/admin/employees/${props.empEntryId}`),
      api.get('/admin/batches')
    ]);
    Object.assign(employee, employeeResponse.data.employee);
    batchNo.value = employeeResponse.data.employee.batch_no;
    approvalStatus.value = employeeResponse.data.employee.APPROVAL_STATUS;
    batches.value = batchResponse.data;
    education.value = employeeResponse.data.education.length
      ? employeeResponse.data.education.map(row => ({ ...blankEducation(), ...row }))
      : [blankEducation()];
  } catch (e) {
    message.value = e.response?.data?.message || e.message;
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    const { data } = await api.put(`/admin/employees/${props.empEntryId}`, {
      employee,
      batchNo: batchNo.value,
      approvalStatus: approvalStatus.value,
      education: education.value
    });
    message.value = data.message;
    await load();
  } catch (e) {
    message.value = e.response?.data?.message || e.message;
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <main class="page">
    <section class="hero">
      <div>
        <span class="badge">ADMIN</span>
        <h1>Edit Employee</h1>
        <p>Update employee information, education, batch, approval status and IPI.</p>
      </div>
    </section>

    <section class="toolbar">
      <router-link class="button-link" to="/admin">← Back to Employee List</router-link>
    </section>

    <div v-if="message" class="notice">{{ message }}</div>
    <section v-if="loading" class="card">Loading employee details…</section>

    <form v-else class="form" @submit.prevent="save">
      <section class="card">
        <div class="section-title"><div><h2>Employee Identity</h2><p class="muted">Administrators can edit identity values, assign IPI, move the employee to another batch, and change approval status.</p></div></div>
        <div class="grid">
          <div class="field"><label>Merit List ID</label><input v-model="employee.MERITLIST_ID" required /></div>
          <div class="field"><label>Class ID</label><input v-model="employee.CLASS_ID" required /></div>
          <div class="field"><label>IPI</label><input v-model="employee.IPI" placeholder="Optional" /></div>
          <div class="field"><label>Batch</label><AutoCompleteSelect v-model="batchNo" :options="batchOptions" required placeholder="Search batch" /></div>
          <div class="field"><label>Approval Status</label><AutoCompleteSelect v-model="approvalStatus" :options="approvalOptions" placeholder="Search approval status" /></div>
        </div>
      </section>

      <section class="card">
        <h2>Basic Information</h2>
        <div class="grid">
          <div class="field"><label>Employee Name</label><input v-model="employee.NAME" required /></div>
          <div class="field"><label>Birth Date</label><DateInput v-model="employee.BIRTHDATE" /></div>
          <div class="field"><label>Blood Group</label><select v-model="employee.BLD_GROUP"><option value="">Select</option><option v-for="group in bloodGroups" :key="group" :value="group">{{ group }}</option></select></div>
          <div class="field"><label>Nationality</label><input v-model="employee.NATIONALITY" /></div>
          <div class="field"><label>Height</label><input v-model="employee.HEIGHT" /></div>
          <div class="field"><label>Weight</label><input v-model="employee.WEIGHT" /></div>
          <div class="field"><label>Gender</label><select v-model="employee.GENDER"><option value="">Select</option><option value="M">Male</option><option value="F">Female</option></select></div>
          <div class="field"><label>Religion</label><select v-model="employee.RELIGION"><option value="">Select</option><option value="I">Islam</option><option value="H">Hindu</option><option value="B">Buddha</option><option value="C">Christian</option></select></div>
          <div class="field"><label>Marital Status</label><select v-model="employee.MARITAL_STATUS"><option value="">Select</option><option value="U">Unmarried</option><option value="M">Married</option></select></div>
        </div>
      </section>

      <section class="card">
        <h2>Contact &amp; Identity</h2>
        <div class="grid">
          <div class="field"><label>Email</label><input v-model="employee.EMAIL" type="email" /></div>
          <div class="field"><label>Primary Phone</label><input v-model="employee.PHONE" required /></div>
          <div class="field"><label>Alternate Phone</label><input v-model="employee.PHONE1" /></div>
          <div class="field"><label>NID</label><input v-model="employee.NID" /></div>
        </div>
      </section>

      <section class="card">
        <h2>Address Information</h2>
        <div class="address-grid">
          <div class="address-box"><h3>Permanent Address</h3><label>Village / House / Road</label><input v-model="employee.PERMANENT_VILLAGE" /><label>Post Office</label><input v-model="employee.PERMANENT_POST" /><label>Thana / Upazila</label><input v-model="employee.PERMANENT_THANA" /><label>District</label><input v-model="employee.PERMANENT_DISTRICT" /></div>
          <div class="address-box"><h3>Present Address</h3><label>Village / House / Road</label><input v-model="employee.PRESENT_VILLAGE" /><label>Post Office</label><input v-model="employee.PRESENT_POST" /><label>Thana / Upazila</label><input v-model="employee.PRESENT_THANA" /><label>District</label><input v-model="employee.PRESENT_DISTRICT" /></div>
        </div>
      </section>

      <section class="card">
        <h2>Emergency Contact</h2>
        <div class="grid"><div class="field"><label>Emergency Person</label><input v-model="employee.EMGRCNY_PERSON" /></div><div class="field"><label>Relationship</label><input v-model="employee.EMGRCNY_RELATION" /></div><div class="field"><label>Emergency Phone</label><input v-model="employee.EMGRCNY_PHONE" /></div><div class="field"><label>Emergency Address</label><input v-model="employee.EMGRCNY_ADDRESS" /></div></div>
      </section>

      <section class="card">
        <h2>Family &amp; Spouse</h2>
        <div class="grid"><div class="field"><label>Father Name</label><input v-model="employee.FATHER_NAME" /></div><div class="field"><label>Father Phone</label><input v-model="employee.FATHER_PHONE" /></div><div class="field"><label>Mother Name</label><input v-model="employee.MOTHER_NAME" /></div><div class="field"><label>Mother Phone</label><input v-model="employee.MOTHER_PHONE" /></div><div class="field"><label>Spouse Name</label><input v-model="employee.SPOUSE_NAME" /></div><div class="field"><label>Marriage Date</label><DateInput v-model="employee.SPOSE_MARRIAGE_DATE" /></div><div class="field"><label>Spouse Occupation</label><input v-model="employee.SPOSE_OCCUPATION" /></div><div class="field"><label>Spouse Phone</label><input v-model="employee.SPOUSE_PHONE" /></div></div>
      </section>

      <section class="card">
        <h2>Guarantor Information</h2>
        <div class="grid"><div class="field"><label>Guarantor Name</label><input v-model="employee.GRNT_NAME" /></div><div class="field"><label>Relationship</label><input v-model="employee.GRNT_RELE" /></div><div class="field"><label>Guarantor Father</label><input v-model="employee.GRNT_FATHER" /></div><div class="field"><label>Present Address</label><input v-model="employee.GRNT_PRESENT_ADD" /></div><div class="field"><label>Permanent Address</label><input v-model="employee.GRNT_PERMANET_ADD" /></div><div class="field"><label>Nationality</label><input v-model="employee.GRNT_NATIONALITY" /></div><div class="field"><label>Profession</label><input v-model="employee.GRNT_PROFFESSION" /></div><div class="field"><label>NID</label><input v-model="employee.GRNT_NID" /></div><div class="field"><label>Mobile</label><input v-model="employee.GRNT_MOBILE" /></div></div>
      </section>

      <section class="card">
        <div class="section-title"><h2>Education</h2><button type="button" @click="education.push(blankEducation())">+ Add Education</button></div>
        <div v-for="(item, index) in education" :key="index" class="edu">
          <div class="section-title"><b>Education #{{ index + 1 }}</b><button v-if="education.length > 1" type="button" class="danger" @click="education.splice(index, 1)">Remove</button></div>
          <div class="grid"><div class="field"><label>Exam Name</label><input v-model="item.EXAMNAME" /></div><div class="field"><label>Group</label><input v-model="item.EXAMGROUP" /></div><div class="field"><label>Board / University</label><input v-model="item.BOARD" /></div><div class="field"><label>Class / Result</label><input v-model="item.CLAS" /></div><div class="field"><label>Pass Year</label><input v-model="item.PASSYEAR" /></div><div class="field"><label>Subject</label><input v-model="item.SUBJECT_NAME" /></div><div class="field"><label>Institute</label><input v-model="item.INSTITUTE" /></div><div class="field"><label>Remarks</label><input v-model="item.REMARKS" /></div></div>
        </div>
      </section>

      <section class="sticky-actions"><router-link class="button-link" to="/admin">Cancel</router-link><button class="primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save Employee Changes' }}</button></section>
    </form>
  </main>
</template>
