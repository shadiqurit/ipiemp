<script setup>
import { computed } from 'vue';
import { formatDate } from '../utils/dates';
import { t } from '../i18n';

const props = defineProps({
  modelValue: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  required: { type: Boolean, default: false }
});

const emit = defineEmits(['update:modelValue']);
const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
const displayValue = computed(() => {
  const value = String(props.modelValue || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value) : value;
});

function update(event) {
  const value = event.target.value.trim().toUpperCase();
  const match = value.match(/^(\d{2})-([A-Z]{3})-(\d{4})$/);
  if (match && MONTHS[match[2]]) {
    emit('update:modelValue', `${match[3]}-${MONTHS[match[2]]}-${match[1]}`);
  } else {
    emit('update:modelValue', value);
  }
}
</script>

<template>
  <input :value="displayValue" type="text" :placeholder="t('DD-MON-YYYY')" :disabled="disabled" :required="required" @input="update" />
</template>
