<template>
  <div class="app-shell">
    <RouterView />
    <AppToast
      :visible="toast.visible"
      :message="toast.message"
      :type="toast.type"
      @close="store.hideToast"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AppToast from './components/AppToast.vue';
import { useAppStore } from './stores/appStore';

const store = useAppStore();
const toast = computed(() => store.state.toast);
</script>
