<template>
  <div class="app-shell">
    <header class="global-identity-bar">
      <RouterLink :class="['global-identity-link', { 'global-identity-link--named': hasLocalDisplayName }]" to="/profile" aria-label="打开用户管理">
        <span :class="['global-identity-avatar', avatarShapeClass]">
          <img v-if="userAvatarDataUrl" :src="userAvatarDataUrl" alt="用户头像" />
          <span v-else>{{ userInitial }}</span>
        </span>
        <span class="global-identity-meta">
          <strong>{{ userDisplayName }}</strong>
          <small>用户管理</small>
        </span>
      </RouterLink>
      <RouterLink class="global-guide-link" to="/guide" aria-label="打开应用说明">
        <span class="global-guide-link__icon" aria-hidden="true">i</span>
      </RouterLink>
      <RouterLink class="global-home-link" to="/" aria-label="返回首页">
        <span class="global-home-link__icon" aria-hidden="true">⌂</span>
      </RouterLink>
    </header>
    <RouterView />
    <transition name="global-reminder-popup-fade">
      <section
        v-if="showGlobalReminderPopup && currentGlobalReminderTask"
        class="global-reminder-popup"
        role="alertdialog"
        aria-live="assertive"
        aria-label="到点提醒"
      >
        <p class="eyebrow">到点提醒</p>
        <h3>{{ currentGlobalReminderTask.title }}</h3>
        <p class="hint">到点时间：{{ currentGlobalReminderTriggerText }}</p>
        <p v-if="currentGlobalReminderTask.note" class="muted">{{ currentGlobalReminderTask.note }}</p>
        <p v-if="globalPendingReminderTasks.length > 1" class="hint">还有 {{ globalPendingReminderTasks.length - 1 }} 条待确认提醒。</p>
        <div class="inline-actions">
          <button class="btn btn--primary" type="button" @click="acknowledgeCurrentGlobalReminder">收到</button>
          <button class="btn btn--ghost" type="button" @click="acknowledgeAllGlobalReminders">全部收到</button>
          <RouterLink class="btn btn--ghost" to="/reminder">去提醒中心</RouterLink>
        </div>
      </section>
    </transition>
    <AppToast
      :visible="toast.visible"
      :message="toast.message"
      :type="toast.type"
      @close="store.hideToast"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AppToast from './components/AppToast.vue';
import {
  acknowledgeAllGlobalReminderTasks,
  acknowledgeGlobalReminderTask,
  startGlobalReminderRuntime,
  stopGlobalReminderRuntime,
  subscribeGlobalAcknowledgementPendingTasks,
} from './services/reminderGlobalRuntimeService';
import { useAppStore } from './stores/appStore';
import type { ReminderTask } from './types/reminder';
import { toLocalDateTime, unixSecondsToIsoString } from './utils/date';

const store = useAppStore();
const route = useRoute();
const toast = computed(() => store.state.toast);
const hasLocalDisplayName = computed(() => store.state.userProfile.displayName.trim().length > 0);
const userDisplayName = computed(() => {
  const value = store.state.userProfile.displayName.trim();
  return value || '未设置昵称';
});
const userInitial = computed(() => userDisplayName.value.slice(0, 1).toUpperCase());
const userAvatarDataUrl = computed(() => store.state.userProfile.avatarDataUrl.trim());
const avatarShapeClass = computed(() =>
  store.state.userProfile.avatarStyle === 'square' ? 'global-identity-avatar--square' : 'global-identity-avatar--round',
);
const globalPendingReminderTasks = ref<ReminderTask[]>([]);
const currentGlobalReminderTask = computed(() => globalPendingReminderTasks.value[0] ?? null);
const showGlobalReminderPopup = computed(() => route.name !== 'reminder' && currentGlobalReminderTask.value !== null);
const currentGlobalReminderTriggerText = computed(() => {
  if (!currentGlobalReminderTask.value) {
    return '';
  }
  return toLocalDateTime(unixSecondsToIsoString(currentGlobalReminderTask.value.triggerAtUnix));
});
let unsubscribeGlobalReminderPending: (() => void) | null = null;

watch(
  () => route.name,
  (name) => {
    if (name === 'reminder') {
      stopGlobalReminderRuntime();
      return;
    }
    startGlobalReminderRuntime();
  },
  { immediate: true },
);

onMounted(() => {
  unsubscribeGlobalReminderPending = subscribeGlobalAcknowledgementPendingTasks((tasks) => {
    globalPendingReminderTasks.value = tasks;
  });
});

function acknowledgeCurrentGlobalReminder(): void {
  const task = currentGlobalReminderTask.value;
  if (!task) {
    return;
  }

  const changed = acknowledgeGlobalReminderTask(task.id);
  if (changed) {
    store.showToast('已确认提醒。', 'success');
  }
}

function acknowledgeAllGlobalReminders(): void {
  const changedCount = acknowledgeAllGlobalReminderTasks();
  if (changedCount > 0) {
    store.showToast(`已确认 ${changedCount} 条提醒。`, 'success');
  }
}

onBeforeUnmount(() => {
  if (unsubscribeGlobalReminderPending) {
    unsubscribeGlobalReminderPending();
    unsubscribeGlobalReminderPending = null;
  }
  stopGlobalReminderRuntime();
});
</script>
