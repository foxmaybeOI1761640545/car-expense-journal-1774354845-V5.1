<template>
  <div class="app-shell">
    <header class="global-identity-bar">
      <RouterLink class="global-identity-link" to="/profile" aria-label="打开用户管理">
        <span :class="['global-identity-avatar', avatarShapeClass]">
          <img v-if="userAvatarDataUrl" :src="userAvatarDataUrl" alt="用户头像" />
          <span v-else>{{ userInitial }}</span>
        </span>
        <span class="global-identity-meta">
          <strong>{{ userDisplayName }}</strong>
          <small>用户管理</small>
        </span>
      </RouterLink>
    </header>
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
const userDisplayName = computed(() => {
  const value = store.state.userProfile.displayName.trim();
  return value || '未设置昵称';
});
const userInitial = computed(() => userDisplayName.value.slice(0, 1).toUpperCase());
const userAvatarDataUrl = computed(() => store.state.userProfile.avatarDataUrl.trim());
const avatarShapeClass = computed(() =>
  store.state.userProfile.avatarStyle === 'square' ? 'global-identity-avatar--square' : 'global-identity-avatar--round',
);
</script>
