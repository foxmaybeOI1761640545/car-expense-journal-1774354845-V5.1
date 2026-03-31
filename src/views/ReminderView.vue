<template>
  <main class="page page--reminder">
    <PageHeader title="提醒中心" description="支持停车提醒、番茄钟与自定义倒计时；页面保持打开时可在线提醒。" />

    <section class="reminder-grid">
      <article class="card reminder-form-card">
        <h2>创建提醒</h2>
        <form class="form-grid reminder-form" @submit.prevent="handleCreateReminder">
          <label>
            提醒类型
            <select v-model="formKind">
              <option value="parking">停车提醒</option>
              <option value="pomodoro">番茄钟</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          <label>
            倒计时分钟数
            <input v-model.number="formDurationMinutes" type="number" min="1" max="20160" step="1" />
          </label>
          <label class="full-width">
            标题（可选）
            <input v-model.trim="formTitle" type="text" maxlength="80" placeholder="留空自动按类型命名" />
          </label>
          <label class="full-width">
            备注（可选）
            <textarea v-model.trim="formNote" rows="2" maxlength="500" placeholder="例如：地库 B2，车位 A-106"></textarea>
          </label>
          <label class="checkbox-inline">
            <input v-model="formSoundEnabled" type="checkbox" />
            <span>到点播放提示音</span>
          </label>
          <label class="checkbox-inline">
            <input v-model="formNotificationEnabled" type="checkbox" :disabled="notificationPermission === 'unsupported'" />
            <span>到点系统通知</span>
          </label>
          <div class="inline-actions full-width">
            <button class="btn btn--primary" type="submit">创建提醒</button>
            <button class="btn btn--ghost" type="button" @click="applyTemplateDuration('parking')">停车 120 分钟</button>
            <button class="btn btn--ghost" type="button" @click="applyTemplateDuration('pomodoro')">番茄钟 25 分钟</button>
          </div>
        </form>
      </article>

      <article class="card reminder-channel-card">
        <h2>提醒通道状态</h2>
        <p class="muted">声音提醒通常需要先手动点击一次“测试声音”来解锁浏览器自动播放策略。</p>
        <div class="inline-actions">
          <button class="btn btn--secondary" type="button" @click="requestBrowserNotificationPermission">请求通知权限</button>
          <button class="btn btn--secondary" type="button" @click="enableSoundReminder">启用声音提醒（测试）</button>
        </div>
        <p class="hint">通知权限：{{ notificationPermissionText }}</p>
        <p class="hint">声音状态：{{ soundStatusText }}</p>
        <p class="hint">后端地址：{{ reminderApiBaseUrl || '未配置' }}</p>
        <div class="inline-actions">
          <button class="btn btn--ghost" type="button" :disabled="backendStatus === 'checking'" @click="checkBackendConnectivity">
            {{ backendStatus === 'checking' ? '检测中...' : '检测后端连通性' }}
          </button>
          <span class="tag" :class="backendStatusTagClass">{{ backendStatusText }}</span>
        </div>
        <p v-if="backendStatusMessage" class="hint">{{ backendStatusMessage }}</p>
        <p v-if="backendPingResult" class="hint">
          服务：{{ backendPingResult.service }} · 版本：{{ backendPingResult.version }} · 运行 {{ backendPingResult.uptimeSeconds }} 秒
        </p>
      </article>

      <article class="card reminder-list-card">
        <div class="list-header">
          <h2>待提醒任务（{{ pendingTasks.length }}）</h2>
        </div>
        <ul v-if="pendingTasks.length" class="reminder-list">
          <li v-for="task in pendingTasks" :key="task.id" class="reminder-item reminder-item--pending">
            <div class="reminder-item__main">
              <div class="reminder-item__title-row">
                <strong>{{ task.title }}</strong>
                <span class="tag tag--pending">{{ formatReminderKind(task.kind) }}</span>
              </div>
              <p class="hint">剩余时间：{{ formatRemainingText(task) }}</p>
              <p class="hint">到点时间：{{ toLocalDateTimeText(task.triggerAtUnix) }}</p>
              <p v-if="task.note" class="muted">{{ task.note }}</p>
            </div>
            <div class="inline-actions">
              <button class="btn btn--ghost" type="button" @click="cancelTask(task.id)">取消</button>
            </div>
          </li>
        </ul>
        <p v-else class="muted">暂无待提醒任务。</p>

        <div class="list-header">
          <h2>历史任务（{{ historyTasks.length }}）</h2>
          <button class="btn btn--ghost" type="button" :disabled="historyTasks.length === 0" @click="clearHistoryTasks">
            清空历史
          </button>
        </div>
        <ul v-if="historyTasks.length" class="reminder-list">
          <li v-for="task in historyTasks" :key="task.id" class="reminder-item">
            <div class="reminder-item__main">
              <div class="reminder-item__title-row">
                <strong>{{ task.title }}</strong>
                <span class="tag" :class="task.status === 'fired' ? 'tag--success' : 'tag--neutral'">
                  {{ task.status === 'fired' ? '已触发' : '已取消' }}
                </span>
              </div>
              <p class="hint">创建时间：{{ toLocalDateTimeText(task.createdAtUnix) }}</p>
              <p class="hint">到点时间：{{ toLocalDateTimeText(task.triggerAtUnix) }}</p>
            </div>
          </li>
        </ul>
        <p v-else class="muted">暂无历史任务。</p>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import { pingReminderBackend, type ReminderBackendPingResult } from '../services/reminderBackendService';
import {
  cancelReminderTask,
  createReminderTask,
  formatReminderKind,
  getReminderRemainingSeconds,
  loadReminderTasks,
  markReminderFired,
  saveReminderTasks,
  upsertReminderTask,
} from '../services/reminderService';
import { useAppStore } from '../stores/appStore';
import type { ReminderKind, ReminderTask } from '../types/reminder';
import { nowUnixSeconds, toLocalDateTime, unixSecondsToIsoString } from '../utils/date';

const store = useAppStore();
const tasks = ref<ReminderTask[]>([]);
const nowUnix = ref(nowUnixSeconds());
const formKind = ref<ReminderKind>('parking');
const formTitle = ref('');
const formNote = ref('');
const formDurationMinutes = ref(120);
const formSoundEnabled = ref(true);
const formNotificationEnabled = ref(true);
const notificationPermission = ref<'unsupported' | NotificationPermission>(getNotificationPermission());
const soundPrimed = ref(false);
const backendStatus = ref<'unconfigured' | 'checking' | 'online' | 'offline'>('unconfigured');
const backendStatusMessage = ref('');
const backendPingResult = ref<ReminderBackendPingResult | null>(null);

const reminderApiBaseUrl = computed(() => store.state.config.reminderApiBaseUrl.trim());
const pendingTasks = computed(() => tasks.value.filter((task) => task.status === 'pending'));
const historyTasks = computed(() =>
  tasks.value
    .filter((task) => task.status !== 'pending')
    .sort((a, b) => b.updatedAtUnix - a.updatedAtUnix)
    .slice(0, 50),
);
const notificationPermissionText = computed(() => {
  if (notificationPermission.value === 'unsupported') {
    return '当前浏览器不支持 Notification API';
  }
  if (notificationPermission.value === 'granted') {
    return '已授权';
  }
  if (notificationPermission.value === 'denied') {
    return '已拒绝';
  }
  return '未授权';
});
const soundStatusText = computed(() => (soundPrimed.value ? '已解锁，可到点播放提示音' : '未解锁，请先点击“启用声音提醒（测试）”'));
const backendStatusText = computed(() => {
  if (backendStatus.value === 'online') {
    return '后端在线';
  }
  if (backendStatus.value === 'offline') {
    return '后端离线';
  }
  if (backendStatus.value === 'checking') {
    return '检测中';
  }
  return '未配置';
});
const backendStatusTagClass = computed(() => {
  if (backendStatus.value === 'online') {
    return 'tag--success';
  }
  if (backendStatus.value === 'offline') {
    return 'tag--pending';
  }
  return 'tag--neutral';
});

let ticker: number | null = null;
let audioContext: AudioContext | null = null;
let soundBlockedHintShown = false;
const inFlightDueIds = new Set<string>();

watch(
  reminderApiBaseUrl,
  () => {
    backendPingResult.value = null;
    backendStatusMessage.value = '';

    if (!reminderApiBaseUrl.value) {
      backendStatus.value = 'unconfigured';
      return;
    }

    void checkBackendConnectivity();
  },
  { immediate: true },
);

watch(formKind, (value) => {
  if (value === 'parking') {
    formDurationMinutes.value = 120;
    if (!formTitle.value.trim()) {
      formTitle.value = '停车提醒';
    }
    return;
  }

  if (value === 'pomodoro') {
    formDurationMinutes.value = 25;
    if (!formTitle.value.trim()) {
      formTitle.value = '番茄钟提醒';
    }
    return;
  }

  formDurationMinutes.value = 10;
  if (!formTitle.value.trim()) {
    formTitle.value = '自定义提醒';
  }
});

onMounted(() => {
  tasks.value = loadReminderTasks();
  triggerDueReminders();

  ticker = window.setInterval(() => {
    nowUnix.value = nowUnixSeconds();
    triggerDueReminders();
  }, 1000);

  document.addEventListener('visibilitychange', handleVisibilityChange);
});

onBeforeUnmount(() => {
  if (ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }

  document.removeEventListener('visibilitychange', handleVisibilityChange);
});

function persistTasks(nextTasks: ReminderTask[]): void {
  tasks.value = nextTasks;
  saveReminderTasks(nextTasks);
}

function handleVisibilityChange(): void {
  if (document.visibilityState !== 'visible') {
    return;
  }

  nowUnix.value = nowUnixSeconds();
  notificationPermission.value = getNotificationPermission();
  triggerDueReminders();
}

function applyTemplateDuration(kind: ReminderKind): void {
  formKind.value = kind;
}

function formatRemainingText(task: ReminderTask): string {
  const remaining = getReminderRemainingSeconds(task, nowUnix.value);
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`;
}

function toLocalDateTimeText(unixSeconds: number): string {
  return toLocalDateTime(unixSecondsToIsoString(unixSeconds));
}

function handleCreateReminder(): void {
  const parsedMinutes = Number(formDurationMinutes.value);
  if (!Number.isFinite(parsedMinutes)) {
    store.showToast('倒计时分钟数无效。', 'error');
    return;
  }

  const minutes = Math.floor(parsedMinutes);
  if (minutes < 1 || minutes > 20160) {
    store.showToast('倒计时分钟数需在 1 到 20160 之间。', 'error');
    return;
  }

  const task = createReminderTask({
    kind: formKind.value,
    title: formTitle.value,
    note: formNote.value,
    durationSeconds: minutes * 60,
    soundEnabled: formSoundEnabled.value,
    notificationEnabled: formNotificationEnabled.value,
  });

  persistTasks(upsertReminderTask(tasks.value, task));
  store.showToast(`提醒已创建：${task.title}，将在 ${minutes} 分钟后触发。`, 'success');

  formTitle.value = '';
  formNote.value = '';
  nowUnix.value = nowUnixSeconds();
}

function cancelTask(taskId: string): void {
  const nextNow = nowUnixSeconds();
  let changed = false;

  const nextTasks = tasks.value.map((task) => {
    if (task.id !== taskId) {
      return task;
    }

    const nextTask = cancelReminderTask(task, nextNow);
    changed = nextTask !== task;
    return nextTask;
  });

  if (!changed) {
    return;
  }

  persistTasks(nextTasks);
  store.showToast('提醒已取消。', 'info');
}

function clearHistoryTasks(): void {
  if (!historyTasks.value.length) {
    return;
  }

  if (!window.confirm('确认清空历史任务吗？此操作不可恢复。')) {
    return;
  }

  const nextTasks = tasks.value.filter((task) => task.status === 'pending');
  persistTasks(nextTasks);
  store.showToast('历史任务已清空。', 'success');
}

function getNotificationPermission(): 'unsupported' | NotificationPermission {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }

  return Notification.permission;
}

async function requestBrowserNotificationPermission(): Promise<void> {
  if (notificationPermission.value === 'unsupported') {
    store.showToast('当前浏览器不支持系统通知。', 'error');
    return;
  }

  const permission = await Notification.requestPermission();
  notificationPermission.value = permission;

  if (permission === 'granted') {
    store.showToast('通知权限已授权。', 'success');
    return;
  }

  if (permission === 'denied') {
    store.showToast('通知权限被拒绝，可在浏览器设置中手动开启。', 'error');
    return;
  }

  store.showToast('通知权限保持未授权。', 'info');
}

function resolveAudioContextCtor(): typeof AudioContext | null {
  if (typeof globalThis === 'undefined') {
    return null;
  }

  const maybeGlobal = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  return maybeGlobal.AudioContext ?? maybeGlobal.webkitAudioContext ?? null;
}

function ensureAudioContext(): AudioContext {
  if (audioContext) {
    return audioContext;
  }

  const AudioContextCtor = resolveAudioContextCtor();
  if (!AudioContextCtor) {
    throw new Error('当前浏览器不支持 Web Audio。');
  }

  audioContext = new AudioContextCtor();
  return audioContext;
}

async function playReminderTone(): Promise<void> {
  const context = ensureAudioContext();

  if (context.state === 'suspended') {
    await context.resume();
  }

  const frequencies = [880, 659, 880];
  const startTime = context.currentTime + 0.02;

  frequencies.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    const beepStart = startTime + index * 0.18;
    const beepEnd = beepStart + 0.13;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, beepStart);

    gainNode.gain.setValueAtTime(0.0001, beepStart);
    gainNode.gain.exponentialRampToValueAtTime(0.2, beepStart + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, beepEnd);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start(beepStart);
    oscillator.stop(beepEnd);
  });
}

async function enableSoundReminder(): Promise<void> {
  try {
    await playReminderTone();
    soundPrimed.value = true;
    soundBlockedHintShown = false;
    store.showToast('声音提醒已启用。', 'success');
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '启用声音提醒失败。', 'error');
  }
}

function sendBrowserNotification(task: ReminderTask): void {
  if (notificationPermission.value !== 'granted') {
    return;
  }

  try {
    const body = `到点时间：${toLocalDateTimeText(task.triggerAtUnix)}`;
    new Notification(task.title, {
      body,
      tag: task.id,
    });
  } catch {
    // Ignore notification runtime failures and keep toast fallback.
  }
}

async function emitReminderAlert(task: ReminderTask): Promise<void> {
  const summary = `${task.title} 已到点`;
  store.showToast(summary, 'info');

  if (task.notificationEnabled) {
    sendBrowserNotification(task);
  }

  if (!task.soundEnabled) {
    return;
  }

  try {
    await playReminderTone();
    soundPrimed.value = true;
  } catch {
    if (!soundBlockedHintShown) {
      soundBlockedHintShown = true;
      store.showToast('声音提醒可能被浏览器拦截，请点击“启用声音提醒（测试）”。', 'info');
    }
  }
}

function triggerDueReminders(): void {
  const dueTasks: ReminderTask[] = [];
  const nextTasks = tasks.value.map((task) => {
    if (task.status !== 'pending') {
      return task;
    }

    if (task.triggerAtUnix > nowUnix.value) {
      return task;
    }

    if (inFlightDueIds.has(task.id)) {
      return task;
    }

    inFlightDueIds.add(task.id);
    const firedTask = markReminderFired(task, nowUnix.value);
    dueTasks.push(firedTask);
    return firedTask;
  });

  if (dueTasks.length === 0) {
    return;
  }

  persistTasks(nextTasks);

  dueTasks.forEach((task) => {
    void emitReminderAlert(task).finally(() => {
      inFlightDueIds.delete(task.id);
    });
  });
}

async function checkBackendConnectivity(): Promise<void> {
  if (!reminderApiBaseUrl.value) {
    backendStatus.value = 'unconfigured';
    backendStatusMessage.value = '未配置提醒后端地址。';
    backendPingResult.value = null;
    return;
  }

  backendStatus.value = 'checking';
  backendStatusMessage.value = '';
  backendPingResult.value = null;

  try {
    const result = await pingReminderBackend(reminderApiBaseUrl.value);
    backendStatus.value = 'online';
    backendPingResult.value = result;
    backendStatusMessage.value = `后端时间：${toLocalDateTimeText(result.serverTimeUnix)}`;
  } catch (error) {
    backendStatus.value = 'offline';
    backendStatusMessage.value = error instanceof Error ? error.message : '后端连接失败。';
  }
}
</script>
