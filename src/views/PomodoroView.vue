<template>
  <main class="page page--pomodoro">
    <PageHeader title="番茄钟" description="独立倒计时页面，支持圆形进度环与工作/休息自动切换。" />

    <section class="pomodoro-layout">
      <article class="card pomodoro-timer-card" :class="`pomodoro-timer-card--${currentPhase}`">
        <p class="eyebrow">{{ phaseTitleText }}</p>
        <div class="pomodoro-ring-wrap" role="timer" aria-live="polite">
          <svg class="pomodoro-ring" viewBox="0 0 240 240" aria-hidden="true">
            <circle class="pomodoro-ring__track" cx="120" cy="120" :r="RING_RADIUS"></circle>
            <circle
              class="pomodoro-ring__progress"
              :class="`pomodoro-ring__progress--${currentPhase}`"
              cx="120"
              cy="120"
              :r="RING_RADIUS"
              :stroke-dasharray="RING_CIRCUMFERENCE"
              :stroke-dashoffset="ringDashOffset"
            ></circle>
            <circle class="pomodoro-ring__minute-track" cx="120" cy="120" :r="MINUTE_RING_RADIUS"></circle>
            <circle
              class="pomodoro-ring__minute-progress"
              cx="120"
              cy="120"
              :r="MINUTE_RING_RADIUS"
              :stroke-dasharray="MINUTE_RING_CIRCUMFERENCE"
              :stroke-dashoffset="minuteRingDashOffset"
            ></circle>
          </svg>
          <div class="pomodoro-ring__content">
            <strong class="pomodoro-time">{{ formattedRemaining }}</strong>
            <p class="muted">{{ phaseHintText }}</p>
          </div>
        </div>

        <div class="inline-actions">
          <button class="btn btn--primary" type="button" @click="toggleRunning">{{ startButtonText }}</button>
          <button class="btn btn--secondary" type="button" @click="resetCurrentPhase">重置当前阶段</button>
          <button class="btn btn--ghost" type="button" @click="skipPhase">跳过阶段</button>
          <button class="btn btn--ghost" type="button" @click="startSoundTestPhase">3 秒测试阶段</button>
        </div>
        <div class="inline-actions">
          <button class="btn btn--ghost" type="button" @click="requestNotificationPermission">请求系统通知权限</button>
          <RouterLink class="cross-page-link cross-page-link--reminder" to="/reminder">
            <span class="cross-page-link__eyebrow">提醒模块</span>
            <strong>返回提醒中心</strong>
          </RouterLink>
        </div>

        <p class="hint">通知权限：{{ notificationPermissionText }}</p>
      </article>

      <article class="card pomodoro-settings-card">
        <h2>阶段设置</h2>
        <form class="form-grid" @submit.prevent>
          <label>
            专注时长（分钟）
            <input
              v-model="workMinutesInput"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              :disabled="isRunning"
              @blur="commitWorkMinutesInput"
              @keydown.enter.prevent="commitWorkMinutesInput"
            />
          </label>
          <label>
            短休息（分钟）
            <input
              v-model="shortBreakMinutesInput"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              :disabled="isRunning"
              @blur="commitShortBreakMinutesInput"
              @keydown.enter.prevent="commitShortBreakMinutesInput"
            />
          </label>
          <label>
            长休息（分钟）
            <input
              v-model="longBreakMinutesInput"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              :disabled="isRunning"
              @blur="commitLongBreakMinutesInput"
              @keydown.enter.prevent="commitLongBreakMinutesInput"
            />
          </label>
          <label>
            多少轮后长休息
            <input
              v-model="longBreakEveryInput"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              :disabled="isRunning"
              @blur="commitLongBreakEveryInput"
              @keydown.enter.prevent="commitLongBreakEveryInput"
            />
          </label>
          <p class="hint full-width">已完成专注轮次：{{ completedWorkSessions }}。运行中会锁定设置，避免中途改配置。</p>
        </form>
        <section class="reminder-subsection">
          <h3>GitHub 阶段配置同步（可选）</h3>
          <div class="inline-actions">
            <button
              class="btn btn--ghost"
              type="button"
              :disabled="isRunning || syncingStageConfigToGithub || pullingStageConfigFromGithub"
              @click="syncStageSettingsToGithub"
            >
              {{ syncingStageConfigToGithub ? '同步中...' : '同步阶段配置到 GitHub' }}
            </button>
            <button
              class="btn btn--ghost"
              type="button"
              :disabled="isRunning || syncingStageConfigToGithub || pullingStageConfigFromGithub"
              @click="pullStageSettingsFromGithub"
            >
              {{ pullingStageConfigFromGithub ? '拉取中...' : '从 GitHub 拉取阶段配置' }}
            </button>
          </div>
          <p class="hint">GitHub 配置：{{ githubConfigStatusText }}</p>
          <p v-if="stageConfigSyncMessage" class="hint">{{ stageConfigSyncMessage }}</p>
        </section>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import {
  fetchPomodoroStageSettingsFromGithub,
  submitPomodoroStageSettingsToGithub,
} from '../services/githubService';
import { loadReminderDefaultAudioAsset } from '../services/reminderAudioAssetService';
import { resolveReminderRingtoneSource } from '../services/reminderRingtoneBlobStoreService';
import {
  loadPomodoroStageSettings,
  savePomodoroStageSettings,
} from '../services/pomodoroSettingsService';
import {
  loadReminderRingtoneConfig,
  loadReminderRingtoneSourceMode,
  loadReminderSynthPatternConfig,
} from '../services/reminderService';
import { useAppStore } from '../stores/appStore';
import type { PomodoroStageSettings } from '../types/pomodoro';
import type { ReminderSynthPatternConfig } from '../types/reminder';
import { nowUnixSeconds } from '../utils/date';

type PomodoroPhase = 'work' | 'short-break' | 'long-break' | 'sound-test';
type PomodoroRingtoneTargetKind = 'uploaded' | 'default-file' | 'synth';

interface PomodoroRingtoneTarget {
  kind: PomodoroRingtoneTargetKind;
  sourceUrl?: string;
  releaseSource?: () => void;
  synthConfig: ReminderSynthPatternConfig;
  fallbackReason?: string;
}

const DEFAULT_WORK_MINUTES = 25;
const DEFAULT_SHORT_BREAK_MINUTES = 5;
const DEFAULT_LONG_BREAK_MINUTES = 15;
const DEFAULT_LONG_BREAK_EVERY = 4;
const SOUND_TEST_SECONDS = 3;

const RING_RADIUS = 106;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const MINUTE_RING_RADIUS = 90;
const MINUTE_RING_CIRCUMFERENCE = 2 * Math.PI * MINUTE_RING_RADIUS;

const workMinutes = ref(DEFAULT_WORK_MINUTES);
const shortBreakMinutes = ref(DEFAULT_SHORT_BREAK_MINUTES);
const longBreakMinutes = ref(DEFAULT_LONG_BREAK_MINUTES);
const longBreakEvery = ref(DEFAULT_LONG_BREAK_EVERY);
const workMinutesInput = ref(String(DEFAULT_WORK_MINUTES));
const shortBreakMinutesInput = ref(String(DEFAULT_SHORT_BREAK_MINUTES));
const longBreakMinutesInput = ref(String(DEFAULT_LONG_BREAK_MINUTES));
const longBreakEveryInput = ref(String(DEFAULT_LONG_BREAK_EVERY));

const currentPhase = ref<PomodoroPhase>('work');
const totalPhaseSeconds = ref(DEFAULT_WORK_MINUTES * 60);
const remainingSeconds = ref(DEFAULT_WORK_MINUTES * 60);
const completedWorkSessions = ref(0);
const isRunning = ref(false);
const activePhaseBeforeTest = ref<PomodoroPhase>('work');
const notificationPermission = ref<'unsupported' | NotificationPermission>(
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
);
const store = useAppStore();
const syncingStageConfigToGithub = ref(false);
const pullingStageConfigFromGithub = ref(false);
const stageConfigSyncMessage = ref('');

let ticker: number | null = null;
let phaseEndAtMs = 0;
let audioContext: AudioContext | null = null;
let ringtoneFallbackHintShown = false;

const phaseTitleText = computed(() => {
  if (currentPhase.value === 'sound-test') {
    return '声音测试阶段';
  }
  if (currentPhase.value === 'work') {
    return '专注阶段';
  }
  if (currentPhase.value === 'long-break') {
    return '长休息阶段';
  }
  return '短休息阶段';
});

const phaseHintText = computed(() => {
  if (currentPhase.value === 'sound-test') {
    return '3 秒后播放测试提示音';
  }
  if (currentPhase.value === 'work') {
    return `第 ${completedWorkSessions.value + 1} 轮专注进行中`;
  }
  return `已完成 ${completedWorkSessions.value} 轮专注`;
});

const startButtonText = computed(() => {
  if (isRunning.value) {
    return '暂停';
  }
  return remainingSeconds.value === totalPhaseSeconds.value ? '开始' : '继续';
});

const formattedRemaining = computed(() => {
  const safeSeconds = Math.max(0, Math.floor(remainingSeconds.value));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
});

const progressRatio = computed(() => {
  if (totalPhaseSeconds.value <= 0) {
    return 0;
  }
  const ratio = remainingSeconds.value / totalPhaseSeconds.value;
  return Math.max(0, Math.min(1, ratio));
});

const ringDashOffset = computed(() => {
  const offset = RING_CIRCUMFERENCE * (1 - progressRatio.value);
  if (currentPhase.value === 'work' || currentPhase.value === 'short-break') {
    return Number((-offset).toFixed(3));
  }
  return Number(offset.toFixed(3));
});
const minuteProgressRatio = computed(() => {
  if (currentPhase.value === 'sound-test') {
    if (totalPhaseSeconds.value <= 0) {
      return 0;
    }
    const ratio = remainingSeconds.value / totalPhaseSeconds.value;
    return Math.max(0, Math.min(1, ratio));
  }

  const secondsInMinute = ((Math.ceil(remainingSeconds.value) % 60) + 60) % 60;
  if (secondsInMinute === 0 && remainingSeconds.value > 0) {
    return 1;
  }
  return Math.max(0, Math.min(1, secondsInMinute / 60));
});
const minuteRingDashOffset = computed(() => Number((-MINUTE_RING_CIRCUMFERENCE * (1 - minuteProgressRatio.value)).toFixed(3)));

const notificationPermissionText = computed(() => {
  if (notificationPermission.value === 'unsupported') {
    return '当前浏览器不支持';
  }
  if (notificationPermission.value === 'granted') {
    return '已授权';
  }
  if (notificationPermission.value === 'denied') {
    return '已拒绝';
  }
  return '未授权';
});

const githubConfigStatusText = computed(() => {
  const owner = store.state.config.githubOwner.trim();
  const repo = store.state.config.githubRepo.trim();
  const recordsDir = store.state.config.githubRecordsDir.trim();
  if (!owner || !repo || !recordsDir) {
    return 'GitHub 配置未完成（请先配置 owner/repo/recordsDir）。';
  }
  if (!store.state.githubToken.trim()) {
    return 'GitHub Token 未配置，暂不能同步阶段参数。';
  }
  return 'GitHub 配置已完成，可同步阶段参数。';
});

onMounted(() => {
  const localSettings = loadPomodoroStageSettings();
  if (localSettings) {
    applyStageSettings(localSettings);
    return;
  }

  persistStageSettingsLocally();
});

onBeforeUnmount(() => {
  stopTicker();

  if (audioContext) {
    void audioContext.close();
    audioContext = null;
  }
});

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value);
  return Math.min(max, Math.max(min, rounded));
}

function buildStageSettingsSnapshot(updatedAtUnix = nowUnixSeconds()): PomodoroStageSettings {
  return {
    workMinutes: clampInteger(workMinutes.value, 1, 180, DEFAULT_WORK_MINUTES),
    shortBreakMinutes: clampInteger(shortBreakMinutes.value, 1, 60, DEFAULT_SHORT_BREAK_MINUTES),
    longBreakMinutes: clampInteger(longBreakMinutes.value, 1, 90, DEFAULT_LONG_BREAK_MINUTES),
    longBreakEvery: clampInteger(longBreakEvery.value, 1, 12, DEFAULT_LONG_BREAK_EVERY),
    updatedAtUnix: Math.floor(updatedAtUnix),
  };
}

function persistStageSettingsLocally(updatedAtUnix = nowUnixSeconds()): void {
  savePomodoroStageSettings(buildStageSettingsSnapshot(updatedAtUnix));
}

function applyStageSettings(settings: PomodoroStageSettings): void {
  workMinutes.value = clampInteger(settings.workMinutes, 1, 180, DEFAULT_WORK_MINUTES);
  shortBreakMinutes.value = clampInteger(settings.shortBreakMinutes, 1, 60, DEFAULT_SHORT_BREAK_MINUTES);
  longBreakMinutes.value = clampInteger(settings.longBreakMinutes, 1, 90, DEFAULT_LONG_BREAK_MINUTES);
  longBreakEvery.value = clampInteger(settings.longBreakEvery, 1, 12, DEFAULT_LONG_BREAK_EVERY);
  workMinutesInput.value = String(workMinutes.value);
  shortBreakMinutesInput.value = String(shortBreakMinutes.value);
  longBreakMinutesInput.value = String(longBreakMinutes.value);
  longBreakEveryInput.value = String(longBreakEvery.value);

  if (!isRunning.value && currentPhase.value !== 'sound-test') {
    syncCurrentPhaseDuration(true);
  }
}

function resolveGithubTokenOrThrow(): string {
  const owner = store.state.config.githubOwner.trim();
  const repo = store.state.config.githubRepo.trim();
  const recordsDir = store.state.config.githubRecordsDir.trim();
  if (!owner || !repo || !recordsDir) {
    throw new Error('请先在页面设置中完成 GitHub owner/repo/recordsDir 配置。');
  }

  const token = store.state.githubToken.trim();
  if (!token) {
    throw new Error('请先配置 GitHub Token（PAT）。');
  }

  return token;
}

function resolvePhaseSeconds(phase: PomodoroPhase): number {
  if (phase === 'sound-test') {
    return SOUND_TEST_SECONDS;
  }
  if (phase === 'work') {
    return clampInteger(workMinutes.value, 1, 180, DEFAULT_WORK_MINUTES) * 60;
  }
  if (phase === 'long-break') {
    return clampInteger(longBreakMinutes.value, 1, 90, DEFAULT_LONG_BREAK_MINUTES) * 60;
  }
  return clampInteger(shortBreakMinutes.value, 1, 60, DEFAULT_SHORT_BREAK_MINUTES) * 60;
}

function ensureTickerRunning(): void {
  if (ticker !== null) {
    return;
  }

  ticker = window.setInterval(() => {
    if (!isRunning.value) {
      return;
    }

    const nextRemaining = Math.max(0, Math.ceil((phaseEndAtMs - Date.now()) / 1000));
    if (nextRemaining === remainingSeconds.value) {
      return;
    }

    remainingSeconds.value = nextRemaining;
    if (nextRemaining > 0) {
      return;
    }

    handlePhaseCompleted();
  }, 250);
}

function stopTicker(): void {
  if (ticker === null) {
    return;
  }

  clearInterval(ticker);
  ticker = null;
}

function syncCurrentPhaseDuration(resetRemaining: boolean): void {
  const durationSeconds = resolvePhaseSeconds(currentPhase.value);
  totalPhaseSeconds.value = durationSeconds;
  if (resetRemaining) {
    remainingSeconds.value = durationSeconds;
    return;
  }
  remainingSeconds.value = Math.min(remainingSeconds.value, durationSeconds);
}

function startCountdown(): void {
  if (isRunning.value) {
    return;
  }

  if (remainingSeconds.value <= 0) {
    syncCurrentPhaseDuration(true);
  }

  isRunning.value = true;
  phaseEndAtMs = Date.now() + remainingSeconds.value * 1000;
  ensureTickerRunning();
}

function pauseCountdown(): void {
  if (!isRunning.value) {
    return;
  }

  remainingSeconds.value = Math.max(0, Math.ceil((phaseEndAtMs - Date.now()) / 1000));
  isRunning.value = false;
  stopTicker();
}

function toggleRunning(): void {
  if (isRunning.value) {
    pauseCountdown();
    return;
  }

  if (currentPhase.value !== 'sound-test') {
    commitWorkMinutesInput();
    commitShortBreakMinutesInput();
    commitLongBreakMinutesInput();
    commitLongBreakEveryInput();
  }

  startCountdown();
}

function resetCurrentPhase(): void {
  isRunning.value = false;
  stopTicker();

  if (currentPhase.value === 'sound-test') {
    currentPhase.value = activePhaseBeforeTest.value === 'sound-test' ? 'work' : activePhaseBeforeTest.value;
  }

  syncCurrentPhaseDuration(true);
}

function skipPhase(): void {
  const wasRunning = isRunning.value;
  isRunning.value = false;
  stopTicker();

  moveToNextPhase(currentPhase.value);

  if (wasRunning) {
    startCountdown();
  }
}

function moveToNextPhase(finishedPhase: PomodoroPhase): void {
  if (finishedPhase === 'sound-test') {
    currentPhase.value = activePhaseBeforeTest.value === 'sound-test' ? 'work' : activePhaseBeforeTest.value;
    syncCurrentPhaseDuration(true);
    return;
  }

  if (finishedPhase === 'work') {
    completedWorkSessions.value += 1;
    const cycleLength = clampInteger(longBreakEvery.value, 1, 12, DEFAULT_LONG_BREAK_EVERY);
    currentPhase.value = completedWorkSessions.value % cycleLength === 0 ? 'long-break' : 'short-break';
  } else {
    currentPhase.value = 'work';
  }

  syncCurrentPhaseDuration(true);
}

function phaseLabel(phase: PomodoroPhase): string {
  if (phase === 'sound-test') {
    return '声音测试';
  }
  if (phase === 'work') {
    return '专注';
  }
  if (phase === 'long-break') {
    return '长休息';
  }
  return '短休息';
}

function emitCompletionNotification(finishedPhase: PomodoroPhase, nextPhase: PomodoroPhase): void {
  if (notificationPermission.value !== 'granted') {
    return;
  }

  try {
    new Notification('番茄钟', {
      body: `${phaseLabel(finishedPhase)}结束，进入${phaseLabel(nextPhase)}。`,
    });
  } catch {
    // Ignore notification runtime failures to keep timer flow.
  }
}

function resolveAudioContextConstructor(): typeof AudioContext | undefined {
  return window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function ensureAudioContext(): AudioContext {
  if (audioContext) {
    return audioContext;
  }

  const AudioContextConstructor = resolveAudioContextConstructor();
  if (!AudioContextConstructor) {
    throw new Error('当前浏览器不支持 Web Audio。');
  }

  audioContext = new AudioContextConstructor();
  return audioContext;
}

async function playSyntheticToneOnce(config: ReminderSynthPatternConfig): Promise<void> {
  const context = ensureAudioContext();
  if (context.state === 'suspended') {
    await context.resume();
  }

  const toneDurationSeconds = config.toneDurationMs / 1000;
  const gapDurationSeconds = config.gapDurationMs / 1000;
  const startTime = context.currentTime + 0.02;
  let cursor = startTime;

  config.frequencies.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    const toneStart = cursor;
    const toneEnd = toneStart + toneDurationSeconds;
    const attackEnd = toneStart + Math.min(0.03, Math.max(0.005, toneDurationSeconds * 0.2));

    oscillator.type = config.waveform;
    oscillator.frequency.setValueAtTime(frequency, toneStart);

    gainNode.gain.setValueAtTime(0.0001, toneStart);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, config.gain), attackEnd);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, toneEnd);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start(toneStart);
    oscillator.stop(toneEnd + 0.01);

    if (index < config.frequencies.length - 1) {
      cursor = toneEnd + gapDurationSeconds;
    }
  });
}

function cleanupAudioElement(audio: HTMLAudioElement): void {
  audio.pause();
  audio.currentTime = 0;
  audio.removeAttribute('src');
  audio.load();
}

function waitAudioSamplePlayback(audio: HTMLAudioElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    const timer = window.setTimeout(finish, timeoutMs);
    audio.addEventListener('ended', finish, { once: true });
    audio.addEventListener('error', finish, { once: true });
  });
}

async function playAudioSourceOnce(sourceUrl: string): Promise<void> {
  const audio = new Audio(sourceUrl);
  audio.preload = 'auto';

  try {
    await audio.play();
    await waitAudioSamplePlayback(audio, 1500);
  } finally {
    cleanupAudioElement(audio);
  }
}

function notifyRingtoneFallbackIfNeeded(target: PomodoroRingtoneTarget): void {
  if (!target.fallbackReason) {
    ringtoneFallbackHintShown = false;
    return;
  }
  if (ringtoneFallbackHintShown) {
    return;
  }

  ringtoneFallbackHintShown = true;
  store.showToast(target.fallbackReason, 'info');
}

async function resolvePomodoroRingtoneTarget(): Promise<PomodoroRingtoneTarget> {
  const sourceMode = loadReminderRingtoneSourceMode();
  const uploaded = loadReminderRingtoneConfig();
  const uploadedSource = await resolveReminderRingtoneSource(uploaded);
  const synthConfig = loadReminderSynthPatternConfig();
  const defaultAudioAsset = await loadReminderDefaultAudioAsset();

  if (sourceMode === 'uploaded') {
    if (uploaded && uploadedSource.sourceUrl) {
      return {
        kind: 'uploaded',
        sourceUrl: uploadedSource.sourceUrl,
        releaseSource: uploadedSource.release,
        synthConfig,
      };
    }
    uploadedSource.release();

    return {
      kind: 'synth',
      fallbackReason: '上传铃声未配置，已自动回退到合成铃声。',
      synthConfig,
    };
  }

  if (sourceMode === 'default-file') {
    uploadedSource.release();
    if (defaultAudioAsset) {
      return {
        kind: 'default-file',
        sourceUrl: defaultAudioAsset.url,
        synthConfig,
      };
    }

    return {
      kind: 'synth',
      fallbackReason: '默认铃声文件不可用，已自动回退到合成铃声。',
      synthConfig,
    };
  }

  if (sourceMode === 'synth') {
    uploadedSource.release();
    return {
      kind: 'synth',
      synthConfig,
    };
  }

  if (uploaded && uploadedSource.sourceUrl) {
    return {
      kind: 'uploaded',
      sourceUrl: uploadedSource.sourceUrl,
      releaseSource: uploadedSource.release,
      synthConfig,
    };
  }
  uploadedSource.release();

  if (defaultAudioAsset) {
    return {
      kind: 'default-file',
      sourceUrl: defaultAudioAsset.url,
      synthConfig,
    };
  }

  return {
    kind: 'synth',
    synthConfig,
  };
}

async function playCompletionTone(): Promise<void> {
  const target = await resolvePomodoroRingtoneTarget();
  notifyRingtoneFallbackIfNeeded(target);

  try {
    if (target.kind === 'synth') {
      await playSyntheticToneOnce(target.synthConfig);
      return;
    }

    if (!target.sourceUrl) {
      await playSyntheticToneOnce(target.synthConfig);
      return;
    }

    try {
      await playAudioSourceOnce(target.sourceUrl);
    } catch {
      await playSyntheticToneOnce(target.synthConfig);
      store.showToast('文件铃声播放失败，已回退到合成铃声。', 'info');
    }
  } finally {
    target.releaseSource?.();
  }
}

function handlePhaseCompleted(): void {
  const finishedPhase = currentPhase.value;
  isRunning.value = false;
  stopTicker();
  void playCompletionTone().catch(() => undefined);
  moveToNextPhase(finishedPhase);
  if (finishedPhase === 'sound-test') {
    return;
  }
  emitCompletionNotification(finishedPhase, currentPhase.value);
  startCountdown();
}

function parseSettingInput(raw: string, min: number, max: number, fallback: number): number {
  const digitsOnly = raw.replace(/[^\d]/g, '');
  if (!digitsOnly) {
    return fallback;
  }

  const parsed = Number(digitsOnly);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clampInteger(parsed, min, max, fallback);
}

function commitWorkMinutesInput(): void {
  const normalized = parseSettingInput(workMinutesInput.value, 1, 180, workMinutes.value);
  workMinutes.value = normalized;
  workMinutesInput.value = String(normalized);
  persistStageSettingsLocally();
  if (!isRunning.value && currentPhase.value === 'work') {
    syncCurrentPhaseDuration(true);
  }
}

function commitShortBreakMinutesInput(): void {
  const normalized = parseSettingInput(shortBreakMinutesInput.value, 1, 60, shortBreakMinutes.value);
  shortBreakMinutes.value = normalized;
  shortBreakMinutesInput.value = String(normalized);
  persistStageSettingsLocally();
  if (!isRunning.value && currentPhase.value === 'short-break') {
    syncCurrentPhaseDuration(true);
  }
}

function commitLongBreakMinutesInput(): void {
  const normalized = parseSettingInput(longBreakMinutesInput.value, 1, 90, longBreakMinutes.value);
  longBreakMinutes.value = normalized;
  longBreakMinutesInput.value = String(normalized);
  persistStageSettingsLocally();
  if (!isRunning.value && currentPhase.value === 'long-break') {
    syncCurrentPhaseDuration(true);
  }
}

function commitLongBreakEveryInput(): void {
  const normalized = parseSettingInput(longBreakEveryInput.value, 1, 12, longBreakEvery.value);
  longBreakEvery.value = normalized;
  longBreakEveryInput.value = String(normalized);
  persistStageSettingsLocally();
}

function startSoundTestPhase(): void {
  commitWorkMinutesInput();
  commitShortBreakMinutesInput();
  commitLongBreakMinutesInput();
  commitLongBreakEveryInput();

  activePhaseBeforeTest.value = currentPhase.value;
  isRunning.value = false;
  stopTicker();
  currentPhase.value = 'sound-test';
  syncCurrentPhaseDuration(true);
  startCountdown();
}

async function syncStageSettingsToGithub(): Promise<void> {
  if (syncingStageConfigToGithub.value) {
    return;
  }

  try {
    const token = resolveGithubTokenOrThrow();
    syncingStageConfigToGithub.value = true;
    stageConfigSyncMessage.value = '正在同步阶段配置到 GitHub...';
    const settings = buildStageSettingsSnapshot();
    persistStageSettingsLocally(settings.updatedAtUnix);

    const result = await submitPomodoroStageSettingsToGithub(
      {
        ...settings,
        deviceId: store.state.deviceMeta.deviceId,
        inUse: true,
      },
      store.state.config,
      token,
    );

    stageConfigSyncMessage.value = `已同步阶段配置：${result.path}`;
    store.showToast('番茄钟阶段配置已同步到 GitHub。', 'success');
  } catch (error) {
    stageConfigSyncMessage.value = '';
    store.showToast(error instanceof Error ? error.message : '同步番茄钟阶段配置失败。', 'error');
  } finally {
    syncingStageConfigToGithub.value = false;
  }
}

async function pullStageSettingsFromGithub(): Promise<void> {
  if (pullingStageConfigFromGithub.value) {
    return;
  }

  try {
    const token = resolveGithubTokenOrThrow();
    pullingStageConfigFromGithub.value = true;
    stageConfigSyncMessage.value = '正在从 GitHub 拉取阶段配置...';

    const pulled = await fetchPomodoroStageSettingsFromGithub(store.state.config, token, store.state.deviceMeta.deviceId);
    if (!pulled) {
      throw new Error('GitHub 中未找到番茄钟阶段配置文件。');
    }

    applyStageSettings(pulled.settings);
    persistStageSettingsLocally(pulled.settings.updatedAtUnix);
    stageConfigSyncMessage.value = `已拉取阶段配置：${pulled.path}`;
    store.showToast('已从 GitHub 拉取番茄钟阶段配置。', 'success');
  } catch (error) {
    stageConfigSyncMessage.value = '';
    store.showToast(error instanceof Error ? error.message : '拉取番茄钟阶段配置失败。', 'error');
  } finally {
    pullingStageConfigFromGithub.value = false;
  }
}

async function requestNotificationPermission(): Promise<void> {
  if (typeof Notification === 'undefined') {
    notificationPermission.value = 'unsupported';
    return;
  }

  try {
    notificationPermission.value = await Notification.requestPermission();
  } catch {
    notificationPermission.value = Notification.permission;
  }
}
</script>
