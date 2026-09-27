import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGuarantorProfession } from '../src/utils/employee-required.js';

test('allows short professions and empty draft values at the 10-byte boundary', () => {
  for (const value of ['Pvt Job', 'Govt Job', 'Farmer', 'Business', 'Teacher', 'Retired', 'Others', '0123456789', '', null, undefined]) {
    assert.doesNotThrow(() => validateGuarantorProfession({ GRNT_PROFFESSION: value }));
  }
});

test('rejects overlong and multibyte professions without truncating them', () => {
  for (const value of ['Private Service', '01234567890', 'কককক', { name: 'Business' }]) {
    const employee = { GRNT_PROFFESSION: value };
    assert.throws(() => validateGuarantorProfession(employee), error => error.status === 400);
    assert.equal(employee.GRNT_PROFFESSION, value);
  }
  assert.doesNotThrow(() => validateGuarantorProfession({ GRNT_PROFFESSION: 'ককক' }));
});
