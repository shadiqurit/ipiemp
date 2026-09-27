import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGuarantorAddresses } from '../src/utils/employee-required.js';

test('both guarantor addresses accept 100 characters, including Bengali and Unicode', () => {
  for (const value of ['A'.repeat(100), 'ক'.repeat(100), '🏠'.repeat(100), '', null, undefined]) {
    assert.doesNotThrow(() => validateGuarantorAddresses({ GRNT_PRESENT_ADD: value, GRNT_PERMANET_ADD: value }));
  }
});

test('both guarantor addresses reject overflow without silently truncating the address', () => {
  for (const field of ['GRNT_PRESENT_ADD', 'GRNT_PERMANET_ADD']) {
    for (const value of ['A'.repeat(101), 'ক'.repeat(101), '🏠'.repeat(101), { address: 'Dhaka' }]) {
      const employee = { [field]: value };
      assert.throws(() => validateGuarantorAddresses(employee), error => error.status === 400 && error.message.includes('100 characters'));
      assert.equal(employee[field], value);
    }
  }
});
