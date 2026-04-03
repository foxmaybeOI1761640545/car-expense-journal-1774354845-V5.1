import { useAppStore } from '../stores/appStore';
import type { ReminderSynthPatternConfig, ReminderTask } from '../types/reminder';
import { nowUnixSeconds } from '../utils/date';
import { loadReminderDefaultAudioAsset, type ReminderResolvedDefaultAudioAsset } from './reminderAudioAssetService';
import { resolveReminderRingtoneSource } from './reminderRingtoneBlobStoreService';
import {
  acknowledgeReminderTask,
  createReminderTask,
  loadReminderRingtoneConfig,
  loadReminderRingtoneSourceMode,
  loadReminderSynthPatternConfig,
  loadReminderTasks,
  markReminderFired,
  saveReminderTasks,
  upsertReminderTask,
} from './reminderService';

type RuntimeTargetKind = 'uploaded' | 'default-file' | 'synth';

interface RuntimeRingtoneTarget {
  kind: RuntimeTargetKind;
  label: string;
  sourceUrl?: string;
  releaseSource?: () => void;
  fallbackReason?: string;
  synthConfig: ReminderSynthPatternConfig;
}

const DEFAULT_AUDIO_ASSET_CACHE_MS = 60_000;

let running = false;
let ticker: number | null = null;
let inFlightTick = false;
let inFlightDueIds = new Set<string>();

let audioContext: AudioContext | null = null;
let loopAudioElement: HTMLAudioElement | null = null;
let loopAudioSourceRelease: (() => void) | null = null;
let syntheticLoopTimer: number | null = null;
let loopStartInProgress: Promise<void> | null = null;

let defaultAudioAsset: ReminderResolvedDefaultAudioAsset | null = null;
let defaultAudioAssetCheckedAtUnix = 0;

let soundBlockedHintShown = false;
let ringtoneFallbackHintShown = false;

let gestureUnlockBound = false;
let gestureUnlockHandler: (() => void) | null = null;
const pendingAcknowledgementListeners = new Set<(tasks: ReminderTask[]) => void>();

function getStore() {
  return useAppStore();
}

function normalizeRepeatWeekdays(input: number[] | undefined): number[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const normalized = input
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.floor(item))
    .filter((item) => item >= 1 && item <= 7);

  return Array.from(new Set<number>(normalized)).sort((a, b) => a - b);
}

function weekdayFromDate(date: Date): number {
  const weekday = date.getDay();
  return weekday === 0 ? 7 : weekday;
}

function resolveNextRepeatTriggerAtUnix(baseTriggerAtUnix: number, repeatWeekdays: number[], referenceUnix: number): number {
  const normalizedRepeatWeekdays = normalizeRepeatWeekdays(repeatWeekdays);
  if (!normalizedRepeatWeekdays.length) {
    return baseTriggerAtUnix;
  }

  const baseDate = new Date(baseTriggerAtUnix * 1000);
  if (Number.isNaN(baseDate.getTime())) {
    throw new Error('Invalid base trigger time.');
  }

  const hour = baseDate.getHours();
  const minute = baseDate.getMinutes();
  const second = baseDate.getSeconds();
  const searchFrom = new Date((referenceUnix + 1) * 1000);

  for (let offset = 0; offset <= 21; offset += 1) {
    const candidate = new Date(searchFrom);
    candidate.setDate(searchFrom.getDate() + offset);
    candidate.setHours(hour, minute, second, 0);

    const weekday = weekdayFromDate(candidate);
    if (!normalizedRepeatWeekdays.includes(weekday)) {
      continue;
    }

    const candidateUnix = Math.floor(candidate.getTime() / 1000);
    if (candidateUnix > referenceUnix) {
      return candidateUnix;
    }
  }

  throw new Error('Unable to compute next repeat trigger time.');
}

function buildNextRepeatTaskIfNeeded(task: ReminderTask, referenceUnix: number): ReminderTask | null {
  if (task.scheduleMode !== 'date-time' || task.kind !== 'custom-time') {
    return null;
  }

  const repeatWeekdays = normalizeRepeatWeekdays(task.repeatWeekdays);
  if (!repeatWeekdays.length) {
    return null;
  }

  try {
    const nextTriggerAtUnix = resolveNextRepeatTriggerAtUnix(task.triggerAtUnix, repeatWeekdays, referenceUnix);
    return createReminderTask({
      kind: 'custom-time',
      title: task.title,
      note: task.note,
      durationSeconds: Math.max(0, nextTriggerAtUnix - referenceUnix),
      scheduleMode: 'date-time',
      triggerAtUnix: nextTriggerAtUnix,
      repeatWeekdays,
      soundEnabled: task.soundEnabled,
      notificationEnabled: task.notificationEnabled,
      nowUnix: referenceUnix,
    });
  } catch {
    return null;
  }
}

function getAcknowledgementPendingTasks(tasks: ReminderTask[]): ReminderTask[] {
  return tasks
    .filter((task) => task.status === 'fired' && task.requiresAcknowledgement && !Number.isFinite(task.acknowledgedAtUnix))
    .sort((a, b) => {
      const aKey = a.firedAtUnix ?? a.updatedAtUnix;
      const bKey = b.firedAtUnix ?? b.updatedAtUnix;
      return bKey - aKey;
    });
}

function notifyAcknowledgementPendingListeners(tasks: ReminderTask[]): void {
  const pendingTasks = getAcknowledgementPendingTasks(tasks);
  pendingAcknowledgementListeners.forEach((listener) => {
    try {
      listener(pendingTasks);
    } catch {
      // Ignore subscriber errors to keep runtime stable.
    }
  });
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
    throw new Error('Current browser does not support Web Audio.');
  }

  audioContext = new AudioContextCtor();
  return audioContext;
}

async function tryPrimeAudioContext(): Promise<void> {
  try {
    const context = ensureAudioContext();
    if (context.state === 'suspended') {
      await context.resume();
    }
  } catch {
    // Ignore browser-level priming failures.
  }
}

function bindGestureUnlock(): void {
  if (gestureUnlockBound || typeof window === 'undefined') {
    return;
  }

  gestureUnlockHandler = () => {
    void tryPrimeAudioContext();
  };

  window.addEventListener('pointerdown', gestureUnlockHandler, { passive: true });
  window.addEventListener('touchstart', gestureUnlockHandler, { passive: true });
  window.addEventListener('keydown', gestureUnlockHandler);
  gestureUnlockBound = true;
}

function unbindGestureUnlock(): void {
  if (!gestureUnlockBound || !gestureUnlockHandler || typeof window === 'undefined') {
    return;
  }

  window.removeEventListener('pointerdown', gestureUnlockHandler);
  window.removeEventListener('touchstart', gestureUnlockHandler);
  window.removeEventListener('keydown', gestureUnlockHandler);
  gestureUnlockBound = false;
  gestureUnlockHandler = null;
}

function cleanupAudioElement(audio: HTMLAudioElement): void {
  audio.pause();
  audio.currentTime = 0;
  audio.removeAttribute('src');
  audio.load();
}

function stopLoopingSound(): void {
  if (loopAudioElement) {
    cleanupAudioElement(loopAudioElement);
    loopAudioElement = null;
  }
  if (loopAudioSourceRelease) {
    loopAudioSourceRelease();
    loopAudioSourceRelease = null;
  }

  if (syntheticLoopTimer !== null) {
    clearInterval(syntheticLoopTimer);
    syntheticLoopTimer = null;
  }
}

function getSynthLoopIntervalMs(config: ReminderSynthPatternConfig): number {
  const beepCount = config.frequencies.length;
  const totalPatternMs = beepCount * config.toneDurationMs + Math.max(0, beepCount - 1) * config.gapDurationMs;
  return Math.max(500, totalPatternMs + 220);
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

async function ensureDefaultAudioAssetReady(force = false): Promise<void> {
  const now = nowUnixSeconds();
  if (!force && defaultAudioAsset && now - defaultAudioAssetCheckedAtUnix < DEFAULT_AUDIO_ASSET_CACHE_MS / 1000) {
    return;
  }

  defaultAudioAsset = await loadReminderDefaultAudioAsset();
  defaultAudioAssetCheckedAtUnix = now;
}

async function resolveRingtoneTarget(): Promise<RuntimeRingtoneTarget> {
  const sourceMode = loadReminderRingtoneSourceMode();
  const uploaded = loadReminderRingtoneConfig();
  const uploadedSource = await resolveReminderRingtoneSource(uploaded);
  const synthConfig = loadReminderSynthPatternConfig();
  const defaultReady = defaultAudioAsset;

  if (sourceMode === 'uploaded') {
    if (uploaded && uploadedSource.sourceUrl) {
      return {
        kind: 'uploaded',
        sourceUrl: uploadedSource.sourceUrl,
        releaseSource: uploadedSource.release,
        label: `uploaded: ${uploaded.name}`,
        synthConfig,
      };
    }
    uploadedSource.release();

    return {
      kind: 'synth',
      label: 'synth (uploaded not configured)',
      fallbackReason: 'Uploaded ringtone is missing. Falling back to synth ringtone.',
      synthConfig,
    };
  }

  if (sourceMode === 'default-file') {
    uploadedSource.release();
    if (defaultReady) {
      return {
        kind: 'default-file',
        sourceUrl: defaultReady.url,
        label: `default-file: ${defaultReady.name}`,
        synthConfig,
      };
    }

    return {
      kind: 'synth',
      label: 'synth (default file unavailable)',
      fallbackReason: 'Default ringtone file is unavailable. Falling back to synth ringtone.',
      synthConfig,
    };
  }

  if (sourceMode === 'synth') {
    uploadedSource.release();
    return {
      kind: 'synth',
      label: 'synth',
      synthConfig,
    };
  }

  if (uploaded && uploadedSource.sourceUrl) {
    return {
      kind: 'uploaded',
      sourceUrl: uploadedSource.sourceUrl,
      releaseSource: uploadedSource.release,
      label: `uploaded: ${uploaded.name}`,
      synthConfig,
    };
  }
  uploadedSource.release();

  if (defaultReady) {
    return {
      kind: 'default-file',
      sourceUrl: defaultReady.url,
      label: `default-file: ${defaultReady.name}`,
      synthConfig,
    };
  }

  return {
    kind: 'synth',
    label: 'synth (auto fallback)',
    synthConfig,
  };
}

function notifyRingtoneFallbackIfNeeded(target: RuntimeRingtoneTarget): void {
  if (!target.fallbackReason) {
    ringtoneFallbackHintShown = false;
    return;
  }
  if (ringtoneFallbackHintShown) {
    return;
  }

  ringtoneFallbackHintShown = true;
  getStore().showToast(target.fallbackReason, 'info');
}

async function startLoopingForTarget(target: RuntimeRingtoneTarget): Promise<void> {
  if (target.kind === 'synth') {
    target.releaseSource?.();
    await playSyntheticToneOnce(target.synthConfig);
    const intervalMs = getSynthLoopIntervalMs(target.synthConfig);
    syntheticLoopTimer = window.setInterval(() => {
      void playSyntheticToneOnce(target.synthConfig).catch(() => {
        // Ignore one-shot oscillator errors during background throttling.
      });
    }, intervalMs);
    return;
  }

  if (!target.sourceUrl) {
    target.releaseSource?.();
    throw new Error('Ringtone source URL is invalid.');
  }

  const audio = new Audio(target.sourceUrl);
  audio.preload = 'auto';
  audio.loop = true;
  try {
    await audio.play();
  } catch (error) {
    target.releaseSource?.();
    throw error;
  }
  if (loopAudioSourceRelease) {
    loopAudioSourceRelease();
    loopAudioSourceRelease = null;
  }
  loopAudioSourceRelease = target.releaseSource ?? null;
  loopAudioElement = audio;
}

async function startLoopingSound(): Promise<void> {
  if (loopAudioElement || syntheticLoopTimer !== null) {
    return;
  }
  if (loopStartInProgress) {
    await loopStartInProgress;
    return;
  }

  loopStartInProgress = (async () => {
    let target: RuntimeRingtoneTarget | null = null;

    try {
      stopLoopingSound();
      await ensureDefaultAudioAssetReady();
      target = await resolveRingtoneTarget();
      notifyRingtoneFallbackIfNeeded(target);
      await startLoopingForTarget(target);
      soundBlockedHintShown = false;
      return;
    } catch {
      if (target && target.kind !== 'synth') {
        try {
          await startLoopingForTarget({
            kind: 'synth',
            label: 'synth (file playback fallback)',
            synthConfig: loadReminderSynthPatternConfig(),
          });
          getStore().showToast('File ringtone playback failed. Fallback to synth ringtone.', 'info');
          soundBlockedHintShown = false;
          return;
        } catch {
          // Continue to browser-blocked fallback.
        }
      }

      stopLoopingSound();
      if (!soundBlockedHintShown) {
        soundBlockedHintShown = true;
        getStore().showToast('Looping ringtone may be blocked by browser. Go to Reminder page and tap the sound test button once.', 'info');
      }
    } finally {
      loopStartInProgress = null;
    }
  })();

  await loopStartInProgress;
}

async function syncLoopingSound(tasks: ReminderTask[]): Promise<void> {
  const hasPendingLoopingSound = tasks.some(
    (task) => task.status === 'fired' && task.requiresAcknowledgement && !Number.isFinite(task.acknowledgedAtUnix) && task.soundEnabled,
  );

  if (!hasPendingLoopingSound) {
    stopLoopingSound();
    return;
  }

  await startLoopingSound();
}

function sendBrowserNotification(task: ReminderTask): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return;
  }

  try {
    new Notification(task.title, {
      body: `到点时间：${new Date(task.triggerAtUnix * 1000).toLocaleString()}`,
      tag: task.id,
    });
  } catch {
    // Ignore notification runtime failures.
  }
}

function emitReminderAlert(task: ReminderTask): void {
  getStore().showToast(`${task.title} 已到点，可直接在弹窗点击“收到”。`, 'info');
  if (task.notificationEnabled) {
    sendBrowserNotification(task);
  }
}

async function tickRuntime(): Promise<void> {
  if (!running || inFlightTick) {
    return;
  }

  inFlightTick = true;
  try {
    await ensureDefaultAudioAssetReady();

    const now = nowUnixSeconds();
    const dueTasks: ReminderTask[] = [];
    const nextRepeatTasks: ReminderTask[] = [];
    const currentTasks = loadReminderTasks();
    const nextTasks = currentTasks.map((task) => {
      if (task.status !== 'pending') {
        return task;
      }
      if (task.triggerAtUnix > now) {
        return task;
      }
      if (inFlightDueIds.has(task.id)) {
        return task;
      }

      inFlightDueIds.add(task.id);
      const nextRepeatTask = buildNextRepeatTaskIfNeeded(task, now);
      if (nextRepeatTask) {
        nextRepeatTasks.push(nextRepeatTask);
      }

      const firedTask = markReminderFired(task, now);
      dueTasks.push(firedTask);
      return firedTask;
    });

    let effectiveTasks = currentTasks;
    if (dueTasks.length > 0) {
      const withRepeatTasks = nextRepeatTasks.reduce((tasksAcc, repeatTask) => upsertReminderTask(tasksAcc, repeatTask), nextTasks);
      saveReminderTasks(withRepeatTasks);
      effectiveTasks = withRepeatTasks;

      dueTasks.forEach((task) => {
        try {
          emitReminderAlert(task);
        } finally {
          inFlightDueIds.delete(task.id);
        }
      });
    }

    await syncLoopingSound(effectiveTasks);
    notifyAcknowledgementPendingListeners(effectiveTasks);
  } finally {
    inFlightTick = false;
  }
}

function handleVisibilityChange(): void {
  if (document.visibilityState !== 'visible') {
    return;
  }

  void tickRuntime();
}

export function subscribeGlobalAcknowledgementPendingTasks(listener: (tasks: ReminderTask[]) => void): () => void {
  pendingAcknowledgementListeners.add(listener);
  listener(getAcknowledgementPendingTasks(loadReminderTasks()));

  return () => {
    pendingAcknowledgementListeners.delete(listener);
  };
}

export function acknowledgeGlobalReminderTask(taskId: string): boolean {
  const now = nowUnixSeconds();
  let changed = false;

  const currentTasks = loadReminderTasks();
  const nextTasks = currentTasks.map((task) => {
    if (task.id !== taskId) {
      return task;
    }

    const acknowledgedTask = acknowledgeReminderTask(task, now);
    changed = changed || acknowledgedTask !== task;
    return acknowledgedTask;
  });

  if (!changed) {
    notifyAcknowledgementPendingListeners(currentTasks);
    return false;
  }

  saveReminderTasks(nextTasks);
  notifyAcknowledgementPendingListeners(nextTasks);
  void syncLoopingSound(nextTasks);
  return true;
}

export function acknowledgeAllGlobalReminderTasks(): number {
  const now = nowUnixSeconds();
  let changedCount = 0;
  const currentTasks = loadReminderTasks();
  const nextTasks = currentTasks.map((task) => {
    const acknowledgedTask = acknowledgeReminderTask(task, now);
    if (acknowledgedTask !== task) {
      changedCount += 1;
    }
    return acknowledgedTask;
  });

  if (changedCount <= 0) {
    notifyAcknowledgementPendingListeners(currentTasks);
    return 0;
  }

  saveReminderTasks(nextTasks);
  notifyAcknowledgementPendingListeners(nextTasks);
  void syncLoopingSound(nextTasks);
  return changedCount;
}

export function startGlobalReminderRuntime(): void {
  if (running || typeof window === 'undefined') {
    return;
  }

  running = true;
  soundBlockedHintShown = false;
  ringtoneFallbackHintShown = false;
  bindGestureUnlock();

  document.addEventListener('visibilitychange', handleVisibilityChange);
  ticker = window.setInterval(() => {
    void tickRuntime();
  }, 1000);
  notifyAcknowledgementPendingListeners(loadReminderTasks());
  void tickRuntime();
}

export function stopGlobalReminderRuntime(): void {
  if (!running) {
    return;
  }

  running = false;
  inFlightTick = false;
  inFlightDueIds = new Set<string>();

  if (ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }

  document.removeEventListener('visibilitychange', handleVisibilityChange);
  unbindGestureUnlock();
  stopLoopingSound();
  notifyAcknowledgementPendingListeners([]);
}
