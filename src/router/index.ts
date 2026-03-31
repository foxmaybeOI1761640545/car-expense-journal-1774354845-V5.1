import { createRouter, createWebHashHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import FuelView from '../views/FuelView.vue';
import TripView from '../views/TripView.vue';
import TripDetailView from '../views/TripDetailView.vue';
import GuideView from '../views/GuideView.vue';
import ProfileView from '../views/ProfileView.vue';
import SettingsView from '../views/SettingsView.vue';
import ReminderView from '../views/ReminderView.vue';

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/fuel',
      name: 'fuel',
      component: FuelView,
    },
    {
      path: '/trip',
      name: 'trip',
      component: TripView,
    },
    {
      path: '/trip/:recordId',
      name: 'trip-detail',
      component: TripDetailView,
    },
    {
      path: '/guide',
      name: 'guide',
      component: GuideView,
    },
    {
      path: '/profile',
      name: 'profile',
      component: ProfileView,
    },
    {
      path: '/settings',
      name: 'settings',
      component: SettingsView,
    },
    {
      path: '/reminder',
      name: 'reminder',
      component: ReminderView,
    },
  ],
});

export default router;

