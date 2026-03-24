import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import './assets/styles/main.css';
import { useAppStore } from './stores/appStore';

async function bootstrap() {
  const store = useAppStore();
  await store.initializeStore();

  createApp(App).use(router).mount('#app');
}

bootstrap();
