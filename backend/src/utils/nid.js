const NID_FIELDS = [
  ['NID', 'NID'],
  ['GRNT_NID', 'Guarantor NID']
];

export function normalizeAndValidateEmployeeNids(employee) {
  for (const [field, label] of NID_FIELDS) {
    const value = String(employee[field] ?? '').trim();

    if (!value) {
      employee[field] = null;
      continue;
    }

    if (!/^\d+$/.test(value) || ![10, 13, 17].includes(value.length)) {
      throw Object.assign(
        new Error(`${label} must contain only digits and be exactly 10, 13, or 17 digits.`),
        { status: 400 }
      );
    }

    employee[field] = value;
  }
}
