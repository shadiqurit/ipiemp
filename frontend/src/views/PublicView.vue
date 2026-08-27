<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../api';

const EXAMS = [
  'Class Five','Class Eight','JSC/JDC','SSC / Dakhil','HSC / Alim','Diploma',
  'Fazil','Kamil','BA','MA','BBA','MBA','B.Com','M.Com','BBS','MBS','BSS',
  'MSS','B.Sc','M.Sc','B.Pharm','M.Pharm','B.Ed','M.Ed','LLB','LLM','MBBS',
  'BAMS','BHMS','BUMS','M.Phil','Ph.D','CA','FCA','CMA / ACMA','PGD','Others'
];

const state = ref({ collectionOpen:false, activeBatch:null });

const credentials = reactive({
  meritlistId: '',
  classId: '',
  phone: ''
});

const verifiedIdentity = reactive({
  meritlistId: '',
  classId: '',
  phone: ''
});

const mode = ref('');
const message = ref('');
const canRequestUpdate = ref(false);
const requestPending = ref(false);
const busy = ref(false);
const sameAddress = ref(false);
const batchNo = ref('');
const assignedIpi = ref('');

const employee = reactive({
  NAME:'',BIRTHDATE:'',BLD_GROUP:'',GENDER:'',RELIGION:'',NATIONALITY:'',
  MARITAL_STATUS:'',EMAIL:'',PHONE:'',PHONE1:'',HEIGHT:'',WEIGHT:'',NID:'',
  PERMANENT_VILLAGE:'',PERMANENT_POST:'',PERMANENT_THANA:'',PERMANENT_DISTRICT:'',
  PRESENT_VILLAGE:'',PRESENT_POST:'',PRESENT_THANA:'',PRESENT_DISTRICT:'',
  EMGRCNY_PERSON:'',EMGRCNY_RELATION:'',EMGRCNY_ADDRESS:'',EMGRCNY_PHONE:'',
  FATHER_NAME:'',FATHER_PHONE:'',MOTHER_NAME:'',MOTHER_PHONE:'',
  SPOUSE_NAME:'',SPOSE_MARRIAGE_DATE:'',SPOSE_OCCUPATION:'',SPOUSE_PHONE:'',
  GRNT_NAME:'',GRNT_RELE:'',GRNT_FATHER:'',GRNT_PRESENT_ADD:'',
  GRNT_PERMANET_ADD:'',GRNT_NATIONALITY:'',GRNT_PROFFESSION:'',GRNT_NID:'',GRNT_MOBILE:''
});

const education = ref([]);

const editable = computed(() => ['NEW','EDIT'].includes(mode.value));

const basicFields = [
  ['NAME','Employee Name'],['BIRTHDATE','Birth Date','date'],['BLD_GROUP','Blood Group'],
  ['NATIONALITY','Nationality'],['HEIGHT','Height'],['WEIGHT','Weight']
];

const contactFields = [
  ['EMAIL','Email','email'],['PHONE','Primary Phone'],['PHONE1','Alternate Phone'],['NID','NID']
];

const emergencyFields = [
  ['EMGRCNY_PERSON','Emergency Person'],['EMGRCNY_RELATION','Relationship'],
  ['EMGRCNY_PHONE','Emergency Phone'],['EMGRCNY_ADDRESS','Emergency Address']
];

const familyFields = [
  ['FATHER_NAME','Father Name'],['FATHER_PHONE','Father Phone'],['MOTHER_NAME','Mother Name'],
  ['MOTHER_PHONE','Mother Phone'],['SPOUSE_NAME','Spouse Name'],
  ['SPOSE_MARRIAGE_DATE','Marriage Date','date'],['SPOSE_OCCUPATION','Spouse Occupation'],
  ['SPOUSE_PHONE','Spouse Phone']
];

const guarantorFields = [
  ['GRNT_NAME','Guarantor Name'],['GRNT_RELE','Relationship'],['GRNT_FATHER','Guarantor Father'],
  ['GRNT_PRESENT_ADD','Present Address'],['GRNT_PERMANET_ADD','Permanent Address'],
  ['GRNT_NATIONALITY','Nationality'],['GRNT_PROFFESSION','Profession'],
  ['GRNT_NID','NID'],['GRNT_MOBILE','Mobile']
];

function blankEducation() {
  return {
    EXAMNAME:'',EXAMGROUP:'',BOARD:'',CLAS:'',
    PASSYEAR:'',REMARKS:'',INSTITUTE:'',SUBJECT_NAME:''
  };
}

function resetEmployee() {
  Object.keys(employee).forEach(k => employee[k] = '');
  education.value = [blankEducation()];
  batchNo.value = '';
  assignedIpi.value = '';
  sameAddress.value = false;
}

function copyPermanent() {
  employee.PRESENT_VILLAGE = employee.PERMANENT_VILLAGE;
  employee.PRESENT_POST = employee.PERMANENT_POST;
  employee.PRESENT_THANA = employee.PERMANENT_THANA;
  employee.PRESENT_DISTRICT = employee.PERMANENT_DISTRICT;
}

function toggleSame() {
  if (sameAddress.value) copyPermanent();
}

function onPermanentInput() {
  if (sameAddress.value) copyPermanent();
}

async function loadState() {
  const { data } = await api.get('/public/app-state');
  state.value = data;
}

async function lookup() {
  if (!credentials.meritlistId.trim() ||
      !credentials.classId.trim() ||
      !credentials.phone.trim()) {
    message.value = 'Merit List ID, Class ID and Phone Number are required.';
    return;
  }

  busy.value = true;

  try {
    const { data } = await api.post('/public/employee/lookup', {
      meritlistId: credentials.meritlistId.trim(),
      classId: credentials.classId.trim(),
      phone: credentials.phone.trim()
    });

    verifiedIdentity.meritlistId = credentials.meritlistId.trim();
    verifiedIdentity.classId = credentials.classId.trim();
    verifiedIdentity.phone = credentials.phone.replace(/\s+/g, '').trim();

    resetEmployee();

    if (!data.found) {
      if (!data.canCreate) {
        mode.value = '';
        message.value = 'No record found and there is no ACTIVE batch.';
        return;
      }

      mode.value = 'NEW';
      batchNo.value = data.activeBatch || '';
      employee.PHONE = verifiedIdentity.phone;
      education.value = [blankEducation()];
      canRequestUpdate.value = false;
      requestPending.value = false;

      message.value =
        'New employee entry. Merit List ID, Class ID and Phone are verified for this session.';

      return;
    }

    Object.keys(employee).forEach(k => {
      employee[k] = data.employee[k] ?? '';
    });

    batchNo.value = data.batchNo || '';
    assignedIpi.value = data.employee.IPI || '';

    education.value = data.education?.length
      ? data.education.map(x => ({ ...blankEducation(), ...x }))
      : [blankEducation()];

    mode.value = data.canEdit ? 'EDIT' : 'VIEW';
    canRequestUpdate.value = !!data.canRequestUpdate;
    requestPending.value = !!data.pending;

    if (data.reason === 'TEMP_APPROVAL') {
      message.value =
        `Identity verified. Admin approved temporary update access until ${data.approvedUntil}.`;

    } else if (data.canEdit) {
      message.value =
        'Identity verified. Your batch is ACTIVE, so you can update this record.';

    } else if (data.pending) {
      message.value =
        'Identity verified. Update request is pending admin approval.';

    } else {
      message.value =
        'Identity verified. Your batch is INACTIVE, so the record is view-only.';
    }

  } catch (e) {
    mode.value = '';
    message.value = e.response?.data?.message || e.message;

  } finally {
    busy.value = false;
  }
}

async function save() {
  busy.value = true;

  try {
    const { data } = await api.post('/public/employee/save', {
      identity: verifiedIdentity,
      employee,
      education: education.value
    });

    message.value = data.message || 'Employee information saved successfully.';
    await lookup();

  } catch (e) {
    message.value = e.response?.data?.message || e.message;

  } finally {
    busy.value = false;
  }
}

async function requestUpdate() {
  const note = window.prompt(
    'Why do you need to update your information?'
  ) ?? '';

  busy.value = true;

  try {
    const { data } = await api.post(
      '/public/employee/update-request',
      {
        ...verifiedIdentity,
        note
      }
    );

    message.value = data.message;
    await lookup();

  } catch (e) {
    message.value = e.response?.data?.message || e.message;

  } finally {
    busy.value = false;
  }
}

function startOver() {
  mode.value = '';
  message.value = '';
  canRequestUpdate.value = false;
  requestPending.value = false;
  credentials.meritlistId = '';
  credentials.classId = '';
  credentials.phone = '';
  verifiedIdentity.meritlistId = '';
  verifiedIdentity.classId = '';
  verifiedIdentity.phone = '';
  resetEmployee();
}

onMounted(async () => {
  education.value = [blankEducation()];
  await loadState();
});
</script>

<template>
  <main class="page">
    <section class="hero">
      <div>
        <span class="badge">HR DATA COLLECTION</span>
        <h1>Employee Information Portal</h1>
        <p>Enter Merit List ID, Class ID and Phone Number to continue.</p>
      </div>

      <div class="status">
        <b>{{ state.collectionOpen ? 'ACTIVE' : 'INACTIVE' }}</b>
        <span v-if="state.activeBatch">Batch: {{ state.activeBatch }}</span>
      </div>
    </section>

    <section class="card">
      <h2>Verify Employee</h2>
      <p class="muted">
        For an existing record, all three values must match exactly.
      </p>

      <div class="grid">
        <div class="field">
          <label>Merit List ID</label>
          <input
            v-model="credentials.meritlistId"
            :disabled="!!mode"
            placeholder="Enter Merit List ID"
          />
        </div>

        <div class="field">
          <label>Class ID</label>
          <input
            v-model="credentials.classId"
            :disabled="!!mode"
            placeholder="Enter Class ID"
          />
        </div>

        <div class="field">
          <label>Phone Number</label>
          <input
            v-model="credentials.phone"
            :disabled="!!mode"
            placeholder="Enter primary phone"
            @keyup.enter="lookup"
          />
        </div>
      </div>

      <div class="lookup-actions">
        <button
          v-if="!mode"
          class="primary"
          :disabled="busy"
          @click="lookup"
        >
          Verify / Continue
        </button>

        <button
          v-else
          type="button"
          @click="startOver"
        >
          Use Another Employee
        </button>
      </div>
    </section>

    <div v-if="message" class="notice">{{ message }}</div>

    <form v-if="mode" class="form" @submit.prevent="save">
      <section class="card">
        <div class="section-title">
          <h2>Employee Identity</h2>
          <span>Batch: {{ batchNo }}</span>
        </div>

        <div class="grid">
          <div class="field">
            <label>Merit List ID</label>
            <input :value="verifiedIdentity.meritlistId" readonly />
          </div>

          <div class="field">
            <label>Class ID</label>
            <input :value="verifiedIdentity.classId" readonly />
          </div>

          <div class="field">
            <label>IPI</label>
            <input
              :value="assignedIpi || 'Not assigned by admin yet'"
              readonly
            />
          </div>
        </div>
      </section>

      <section class="card">
        <div class="section-title">
          <h2>Basic Information</h2>
        </div>

        <div class="grid">
          <div
            v-for="[key,label,type] in basicFields"
            :key="key"
            class="field"
          >
            <label>{{ label }}</label>
            <input
              v-model="employee[key]"
              :type="type || 'text'"
              :disabled="!editable"
            />
          </div>

          <div class="field">
            <label>Gender</label>
            <select v-model="employee.GENDER" :disabled="!editable">
              <option value="">Select</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
            </select>
          </div>

          <div class="field">
            <label>Religion</label>
            <select v-model="employee.RELIGION" :disabled="!editable">
              <option value="">Select</option>
              <option value="I">Islam</option>
              <option value="H">Hindu</option>
              <option value="B">Buddha</option>
              <option value="C">Christian</option>
            </select>
          </div>

          <div class="field">
            <label>Marital Status</label>
            <select v-model="employee.MARITAL_STATUS" :disabled="!editable">
              <option value="">Select</option>
              <option value="U">Single</option>
              <option value="M">Married</option>
            </select>
          </div>
        </div>
      </section>

      <section class="card">
        <h2>Contact & Identity</h2>

        <div class="grid">
          <div
            v-for="[key,label,type] in contactFields"
            :key="key"
            class="field"
          >
            <label>{{ label }}</label>
            <input
              v-model="employee[key]"
              :type="type || 'text'"
              :disabled="!editable || key === 'PHONE'"
            />
          </div>
        </div>

        <p class="muted">
          Primary phone is part of employee verification and cannot be changed from this public session.
        </p>
      </section>

      <section class="card">
        <h2>Address Information</h2>

        <div class="address-grid">
          <div class="address-box">
            <h3>Permanent Address</h3>

            <label>Village / House / Road</label>
            <input
              v-model="employee.PERMANENT_VILLAGE"
              :disabled="!editable"
              @input="onPermanentInput"
            />

            <label>Post Office</label>
            <input
              v-model="employee.PERMANENT_POST"
              :disabled="!editable"
              @input="onPermanentInput"
            />

            <label>Thana / Upazila</label>
            <input
              v-model="employee.PERMANENT_THANA"
              :disabled="!editable"
              @input="onPermanentInput"
            />

            <label>District</label>
            <input
              v-model="employee.PERMANENT_DISTRICT"
              :disabled="!editable"
              @input="onPermanentInput"
            />
          </div>

          <div class="address-box">
            <h3>Present Address</h3>

            <label>Village / House / Road</label>
            <input
              v-model="employee.PRESENT_VILLAGE"
              :disabled="!editable || sameAddress"
            />

            <label>Post Office</label>
            <input
              v-model="employee.PRESENT_POST"
              :disabled="!editable || sameAddress"
            />

            <label>Thana / Upazila</label>
            <input
              v-model="employee.PRESENT_THANA"
              :disabled="!editable || sameAddress"
            />

            <label>District</label>
            <input
              v-model="employee.PRESENT_DISTRICT"
              :disabled="!editable || sameAddress"
            />
          </div>
        </div>

        <div class="copybar" v-if="editable">
          <label class="check">
            <input
              type="checkbox"
              v-model="sameAddress"
              @change="toggleSame"
            />
            Same as Permanent Address
          </label>

          <button type="button" @click="copyPermanent">
            Copy Permanent → Present
          </button>
        </div>
      </section>

      <section class="card">
        <h2>Emergency Contact</h2>

        <div class="grid">
          <div
            v-for="[key,label] in emergencyFields"
            :key="key"
            class="field"
          >
            <label>{{ label }}</label>
            <input v-model="employee[key]" :disabled="!editable" />
          </div>
        </div>
      </section>

      <section class="card">
        <h2>Family & Spouse</h2>

        <div class="grid">
          <div
            v-for="[key,label,type] in familyFields"
            :key="key"
            class="field"
          >
            <label>{{ label }}</label>
            <input
              v-model="employee[key]"
              :type="type || 'text'"
              :disabled="!editable"
            />
          </div>
        </div>
      </section>

      <section class="card">
        <h2>Guarantor Information</h2>

        <div class="grid">
          <div
            v-for="[key,label] in guarantorFields"
            :key="key"
            class="field"
          >
            <label>{{ label }}</label>
            <input v-model="employee[key]" :disabled="!editable" />
          </div>
        </div>
      </section>

      <section class="card">
        <div class="section-title">
          <h2>Education</h2>

          <button
            v-if="editable"
            type="button"
            @click="education.push(blankEducation())"
          >
            + Add Education
          </button>
        </div>

        <div
          v-for="(edu,i) in education"
          :key="i"
          class="edu"
        >
          <div class="section-title">
            <b>Education #{{ i+1 }}</b>

            <button
              v-if="editable && education.length > 1"
              type="button"
              class="danger"
              @click="education.splice(i,1)"
            >
              Remove
            </button>
          </div>

          <div class="grid">
            <div class="field">
              <label>Exam Name</label>

              <select v-model="edu.EXAMNAME" :disabled="!editable">
                <option value="">Select</option>
                <option
                  v-for="x in EXAMS"
                  :key="x"
                  :value="x"
                >
                  {{ x }}
                </option>
              </select>
            </div>

            <div class="field">
              <label>Group</label>
              <input v-model="edu.EXAMGROUP" :disabled="!editable" />
            </div>

            <div class="field">
              <label>Board / University</label>
              <input v-model="edu.BOARD" :disabled="!editable" />
            </div>

            <div class="field">
              <label>Class / Result</label>
              <input v-model="edu.CLAS" :disabled="!editable" />
            </div>

            <div class="field">
              <label>Pass Year</label>
              <input v-model="edu.PASSYEAR" :disabled="!editable" />
            </div>

            <div class="field">
              <label>Subject</label>
              <input v-model="edu.SUBJECT_NAME" :disabled="!editable" />
            </div>

            <div class="field">
              <label>Institute</label>
              <input v-model="edu.INSTITUTE" :disabled="!editable" />
            </div>

            <div class="field">
              <label>Remarks</label>
              <input v-model="edu.REMARKS" :disabled="!editable" />
            </div>
          </div>
        </div>
      </section>

      <section class="sticky-actions">
        <button
          v-if="canRequestUpdate"
          type="button"
          @click="requestUpdate"
        >
          Request Update Access
        </button>

        <button
          v-if="requestPending"
          type="button"
          disabled
        >
          Request Pending
        </button>

        <button
          v-if="editable"
          class="primary"
          :disabled="busy"
          type="submit"
        >
          {{ mode === 'EDIT' ? 'Update Employee' : 'Submit Employee Data' }}
        </button>
      </section>
    </form>

    <footer>
      <router-link to="/admin">Admin</router-link>
    </footer>
  </main>
</template>
