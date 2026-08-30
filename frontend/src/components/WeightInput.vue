<script setup>
const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  disabled: { type: Boolean, default: false }
});

const emit = defineEmits(['update:modelValue']);

function onInput(event) {
  const cleaned = event.target.value.replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  const value = dot < 0
    ? cleaned
    : `${cleaned.slice(0, dot + 1)}${cleaned.slice(dot + 1).replace(/\./g, '')}`;

  event.target.value = value;
  emit('update:modelValue', value);
}
</script>

<template>
  <div class="weight-input">
    <input
      :value="props.modelValue"
      type="text"
      inputmode="decimal"
      pattern="[0-9]+(?:\.[0-9]+)?"
      placeholder="70"
      :disabled="disabled"
      @input="onInput"
    />
    <span aria-hidden="true">kg</span>
  </div>
</template>

<style scoped>
.weight-input {
  display: flex;
  align-items: stretch;
  width: 100%;
}

.weight-input input {
  min-width: 0;
  border-radius: 0.55rem 0 0 0.55rem;
}

.weight-input span {
  display: flex;
  align-items: center;
  padding: 0 0.75rem;
  border: 1px solid #cbd5e1;
  border-left: 0;
  border-radius: 0 0.55rem 0.55rem 0;
  background: #f1f5f9;
  color: #334155;
  font-weight: 700;
}
</style>
