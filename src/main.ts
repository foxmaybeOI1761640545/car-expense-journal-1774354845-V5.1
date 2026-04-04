import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import './assets/styles/main.css';
import { useAppStore } from './stores/appStore';
import { initializeAppTheme } from './services/themeService';

async function registerServiceWorker(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  const baseUrl = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '/');
  const serviceWorkerUrl = `${baseUrl}sw.js`;

  try {
    await navigator.serviceWorker.register(serviceWorkerUrl, { scope: baseUrl });
  } catch {
    // Ignore service worker registration errors and keep the app usable.
  }
}

async function bootstrap() {
  initializeAppTheme();
  const store = useAppStore();
  await store.initializeStore();

  createApp(App).use(router).mount('#app');
  void registerServiceWorker();
}

bootstrap();
