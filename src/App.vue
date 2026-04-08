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
      <button
        class="theme-switch"
        :class="{ 'theme-switch--night': isNightTheme }"
        type="button"
        role="switch"
        :aria-checked="isNightTheme"
        :aria-label="isNightTheme ? '切换到日间主题' : '切换到深夜主题'"
        @click="toggleTheme"
      >
        <span class="theme-switch__track" aria-hidden="true">
          <span class="theme-switch__thumb"></span>
        </span>
        <span class="theme-switch__label">{{ isNightTheme ? '深夜' : '日间' }}</span>
      </button>
      <button
        class="blackout-toggle"
        type="button"
        :title="`黑屏遮罩（${effectiveBlackoutShortcutLabel}）`"
        :aria-label="isBlackoutActive ? '退出黑屏遮罩' : '进入黑屏遮罩'"
        @click="toggleBlackoutByButton"
      >
        {{ isBlackoutActive ? '退出黑屏' : '黑屏' }}
      </button>
      <RouterLink class="global-guide-link" to="/guide" aria-label="打开应用说明">
        <span class="global-guide-link__icon" aria-hidden="true">i</span>
      </RouterLink>
      <RouterLink class="global-home-link" to="/" aria-label="返回首页">
        <span class="global-home-link__icon" aria-hidden="true">⌂</span>
      </RouterLink>
    </header>
    <RouterView />
    <section
      v-if="isBlackoutActive"
      class="blackout-overlay"
      role="button"
      tabindex="0"
      aria-label="黑屏遮罩，点击任意位置退出"
      @click.prevent.stop="deactivateBlackout('manual')"
      @contextmenu.prevent
      @wheel.prevent
      @touchmove.prevent
    ></section>
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
import { loadReminderTasks } from './services/reminderService';
import { applyAppTheme, loadAppTheme, setAppTheme, type AppTheme } from './services/themeService';
import { useAppStore } from './stores/appStore';
import type { ReminderTask } from './types/reminder';
import {
  DEFAULT_BLACKOUT_TOGGLE_SHORTCUT,
  matchesShortcutEvent,
  normalizeShortcutText,
  parseShortcut,
} from './utils/shortcut';
import { toLocalDateTime, unixSecondsToIsoString } from './utils/date';

const store = useAppStore();
const route = useRoute();
const toast = computed(() => store.state.toast);
const currentTheme = ref<AppTheme>(loadAppTheme());
const isNightTheme = computed(() => currentTheme.value === 'night');
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
const isBlackoutActive = ref(false);
const effectiveBlackoutShortcutLabel = computed(() =>
  normalizeShortcutText(store.state.config.blackoutToggleShortcut, DEFAULT_BLACKOUT_TOGGLE_SHORTCUT),
);
const effectiveBlackoutShortcut = computed(() => parseShortcut(effectiveBlackoutShortcutLabel.value));
const currentGlobalReminderTriggerText = computed(() => {
  if (!currentGlobalReminderTask.value) {
    return '';
  }
  return toLocalDateTime(unixSecondsToIsoString(currentGlobalReminderTask.value.triggerAtUnix));
});
let unsubscribeGlobalReminderPending: (() => void) | null = null;
let blackoutReminderProbeTicker: number | null = null;
let lastFocusedElement: HTMLElement | null = null;

applyAppTheme(currentTheme.value);

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

watch(
  globalPendingReminderTasks,
  (tasks) => {
    if (isBlackoutActive.value && tasks.length > 0) {
      deactivateBlackout('auto');
    }
  },
  { immediate: false },
);

onMounted(() => {
  unsubscribeGlobalReminderPending = subscribeGlobalAcknowledgementPendingTasks((tasks) => {
    globalPendingReminderTasks.value = tasks;
  });
  window.addEventListener('keydown', handleGlobalBlackoutKeydown, true);
});

function countAcknowledgementPendingReminders(): number {
  return loadReminderTasks().filter(
    (task) => task.status === 'fired' && task.requiresAcknowledgement && !Number.isFinite(task.acknowledgedAtUnix),
  ).length;
}

function startBlackoutReminderProbe(): void {
  if (typeof window === 'undefined' || blackoutReminderProbeTicker !== null) {
    return;
  }

  blackoutReminderProbeTicker = window.setInterval(() => {
    if (!isBlackoutActive.value) {
      return;
    }

    if (countAcknowledgementPendingReminders() > 0) {
      deactivateBlackout('auto');
    }
  }, 500);
}

function stopBlackoutReminderProbe(): void {
  if (blackoutReminderProbeTicker === null) {
    return;
  }

  clearInterval(blackoutReminderProbeTicker);
  blackoutReminderProbeTicker = null;
}

function activateBlackout(): void {
  if (isBlackoutActive.value) {
    return;
  }

  if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    lastFocusedElement = document.activeElement;
  } else {
    lastFocusedElement = null;
  }

  isBlackoutActive.value = true;
  startBlackoutReminderProbe();
}

function deactivateBlackout(reason: 'manual' | 'shortcut' | 'auto' = 'manual'): void {
  if (!isBlackoutActive.value) {
    return;
  }

  isBlackoutActive.value = false;
  stopBlackoutReminderProbe();

  if (reason === 'auto') {
    store.showToast('倒计时已到点，已自动退出黑屏。', 'info');
  }

  if (lastFocusedElement) {
    try {
      lastFocusedElement.focus({ preventScroll: true });
    } catch {
      // Ignore focus restore failures.
    }
    lastFocusedElement = null;
  }
}

function toggleBlackoutByButton(): void {
  if (isBlackoutActive.value) {
    deactivateBlackout('manual');
    return;
  }
  activateBlackout();
}

function handleGlobalBlackoutKeydown(event: KeyboardEvent): void {
  const shortcut = effectiveBlackoutShortcut.value;
  const isToggleShortcut = Boolean(shortcut && matchesShortcutEvent(event, shortcut));

  if (isToggleShortcut) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
    if (!event.repeat) {
      if (isBlackoutActive.value) {
        deactivateBlackout('shortcut');
      } else {
        activateBlackout();
      }
    }
    return;
  }

  if (!isBlackoutActive.value) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === 'function') {
    event.stopImmediatePropagation();
  }
}

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

function toggleTheme(): void {
  const nextTheme: AppTheme = currentTheme.value === 'night' ? 'day' : 'night';
  currentTheme.value = setAppTheme(nextTheme);
}

onBeforeUnmount(() => {
  deactivateBlackout('manual');
  stopBlackoutReminderProbe();
  window.removeEventListener('keydown', handleGlobalBlackoutKeydown, true);
  if (unsubscribeGlobalReminderPending) {
    unsubscribeGlobalReminderPending();
    unsubscribeGlobalReminderPending = null;
  }
  stopGlobalReminderRuntime();
});
</script>
