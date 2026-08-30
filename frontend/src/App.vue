<template>
  <LanguageToggle />
  <NotificationCenter />
  <router-view />
</template>

<script setup>
import LanguageToggle from './components/LanguageToggle.vue';
import NotificationCenter from './components/NotificationCenter.vue';
</script>
