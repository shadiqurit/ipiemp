export const REQUIRED_EMPLOYEE_FIELDS = [
  ['NAME', 'Employee name'],
  ['BIRTHDATE', 'Birth date'],
  ['BLD_GROUP', 'Blood group'],
  ['GENDER', 'Gender'],
  ['RELIGION', 'Religion'],
  ['NATIONALITY', 'Nationality'],
  ['MARITAL_STATUS', 'Marital status'],
  ['HEIGHT', 'Height'],
  ['WEIGHT', 'Weight'],
  ['NID', 'NID'],
  ['PERMANENT_VILLAGE', 'Permanent address: Village / House / Road'],
  ['PERMANENT_POST', 'Permanent address: Post Office'],
  ['PERMANENT_THANA', 'Permanent address: Thana / Upazila'],
  ['PERMANENT_DISTRICT', 'Permanent address: District'],
  ['PRESENT_VILLAGE', 'Present address: Village / House / Road'],
  ['PRESENT_POST', 'Present address: Post Office'],
  ['PRESENT_THANA', 'Present address: Thana / Upazila'],
  ['PRESENT_DISTRICT', 'Present address: District'],
  ['EMGRCNY_PERSON', 'Emergency person'],
  ['EMGRCNY_RELATION', 'Emergency relationship'],
  ['EMGRCNY_ADDRESS', 'Emergency address'],
  ['EMGRCNY_PHONE', 'Emergency phone'],
  ['FATHER_NAME', 'Father name'],
  ['MOTHER_NAME', 'Mother name'],
  ['GRNT_NAME', 'Guarantor name'],
  ['GRNT_RELE', 'Guarantor relationship'],
  ['GRNT_FATHER', 'Guarantor father'],
  ['GRNT_PRESENT_ADD', 'Guarantor present address'],
  ['GRNT_PERMANET_ADD', 'Guarantor permanent address'],
  ['GRNT_NATIONALITY', 'Guarantor nationality'],
  ['GRNT_PROFFESSION', 'Guarantor profession'],
  ['GRNT_NID', 'Guarantor NID'],
  ['GRNT_MOBILE', 'Guarantor mobile']
];

export function validateRequiredEmployeeFields(employee) {
  for (const [field, label] of REQUIRED_EMPLOYEE_FIELDS) {
    if (!employee[field]) {
      throw Object.assign(new Error(`${label} is required.`), { status: 400 });
    }
  }
}

export function validateGuarantorProfession(employee) {
  const value = employee.GRNT_PROFFESSION;
  if (value === null || value === undefined || value === '') return;
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 10) {
    throw Object.assign(new Error('Select a short guarantor profession from the list (maximum 10 bytes).'), { status: 400 });
  }
}

export function validateGuarantorAddresses(employee) {
  for (const [field, label] of [
    ['GRNT_PRESENT_ADD', 'Guarantor present address'],
    ['GRNT_PERMANET_ADD', 'Guarantor permanent address']
  ]) {
    const value = employee[field];
    if (value === null || value === undefined || value === '') continue;
    if (typeof value !== 'string' || Array.from(value).length > 100) {
      throw Object.assign(new Error(`${label}: keep it within 100 characters.`), { status: 400 });
    }
  }
}
