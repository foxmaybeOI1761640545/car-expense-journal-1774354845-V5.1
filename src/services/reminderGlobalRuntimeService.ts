import { useAppStore } from '../stores/appStore';
import type { ReminderSynthPatternConfig, ReminderTask } from '../types/reminder';
import { nowUnixSeconds } from '../utils/date';
import { loadReminderDefaultAudioAsset, type ReminderResolvedDefaultAudioAsset } from './reminderAudioAssetService';
import {
  loadReminderRingtoneConfig,
  loadReminderRingtoneSourceMode,
  loadReminderSynthPatternConfig,
  loadReminderTasks,
  markReminderFired,
  saveReminderTasks,
} from './reminderService';

type RuntimeTargetKind = 'uploaded' | 'default-file' | 'synth';

interface RuntimeRingtoneTarget {
  kind: RuntimeTargetKind;
  label: string;
  sourceUrl?: string;
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
let syntheticLoopTimer: number | null = null;
let loopStartInProgress: Promise<void> | null = null;

let defaultAudioAsset: ReminderResolvedDefaultAudioAsset | null = null;
let defaultAudioAssetCheckedAtUnix = 0;

let soundBlockedHintShown = false;
let ringtoneFallbackHintShown = false;

let gestureUnlockBound = false;
let gestureUnlockHandler: (() => void) | null = null;

function getStore() {
  return useAppStore();
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

function resolveRingtoneTarget(): RuntimeRingtoneTarget {
  const sourceMode = loadReminderRingtoneSourceMode();
  const uploaded = loadReminderRingtoneConfig();
  const synthConfig = loadReminderSynthPatternConfig();
  const defaultReady = defaultAudioAsset;

  if (sourceMode === 'uploaded') {
    if (uploaded) {
      return {
        kind: 'uploaded',
        sourceUrl: uploaded.dataUrl,
        label: `uploaded: ${uploaded.name}`,
        synthConfig,
      };
    }

    return {
      kind: 'synth',
      label: 'synth (uploaded not configured)',
      fallbackReason: 'Uploaded ringtone is missing. Falling back to synth ringtone.',
      synthConfig,
    };
  }

  if (sourceMode === 'default-file') {
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
    return {
      kind: 'synth',
      label: 'synth',
      synthConfig,
    };
  }

  if (uploaded) {
    return {
      kind: 'uploaded',
      sourceUrl: uploaded.dataUrl,
      label: `uploaded: ${uploaded.name}`,
      synthConfig,
    };
  }

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
    throw new Error('Ringtone source URL is invalid.');
  }

  const audio = new Audio(target.sourceUrl);
  audio.preload = 'auto';
  audio.loop = true;
  await audio.play();
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
      target = resolveRingtoneTarget();
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
      body: `Trigger time: ${new Date(task.triggerAtUnix * 1000).toLocaleString()}`,
      tag: task.id,
    });
  } catch {
    // Ignore notification runtime failures.
  }
}

function emitReminderAlert(task: ReminderTask): void {
  getStore().showToast(`${task.title} is due. Please acknowledge it in Reminder Center.`, 'info');
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
      const firedTask = markReminderFired(task, now);
      dueTasks.push(firedTask);
      return firedTask;
    });

    let effectiveTasks = currentTasks;
    if (dueTasks.length > 0) {
      saveReminderTasks(nextTasks);
      effectiveTasks = nextTasks;

      dueTasks.forEach((task) => {
        try {
          emitReminderAlert(task);
        } finally {
          inFlightDueIds.delete(task.id);
        }
      });
    }

    await syncLoopingSound(effectiveTasks);
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
}
