import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import PublicView from './views/PublicView.vue';
import AdminView from './views/AdminView.vue';
import AdminEmployeeEditView from './views/AdminEmployeeEditView.vue';
import MeetingResponseView from './views/MeetingResponseView.vue';
import './style.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: PublicView },
    { path: '/admin', component: AdminView },
    { path: '/meeting-test', redirect: '/admin' },
    { path: '/meeting-response', component: MeetingResponseView },
    {
      path: '/admin/employees/:empEntryId/edit',
      name: 'admin-employee-edit',
      component: AdminEmployeeEditView,
      props: true
    }
  ]
});

createApp(App).use(router).mount('#app');
