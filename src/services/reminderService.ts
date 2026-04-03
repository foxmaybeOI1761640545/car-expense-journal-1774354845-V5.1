import type {
  CreateReminderTaskInput,
  ReminderKind,
  ReminderRingtoneConfig,
  ReminderRingtoneSourceMode,
  ReminderScheduleMode,
  ReminderStatus,
  ReminderSynthPatternConfig,
  ReminderTask,
} from '../types/reminder';
import { nowUnixSeconds } from '../utils/date';

const REMINDER_STORAGE_KEY = 'car-journal-reminders-v1';
const REMINDER_RINGTONE_STORAGE_KEY = 'car-journal-reminder-ringtone-v1';
const REMINDER_RINGTONE_SOURCE_MODE_STORAGE_KEY = 'car-journal-reminder-ringtone-source-mode-v1';
const REMINDER_SYNTH_PATTERN_STORAGE_KEY = 'car-journal-reminder-synth-pattern-v1';

const REMINDER_KIND_SET: Record<ReminderKind, true> = {
  parking: true,
  pomodoro: true,
  custom: true,
  'custom-time': true,
};

const REMINDER_STATUS_SET: Record<ReminderStatus, true> = {
  pending: true,
  fired: true,
  cancelled: true,
};

const REMINDER_SCHEDULE_MODE_SET: Record<ReminderScheduleMode, true> = {
  countdown: true,
  'date-time': true,
};

const REMINDER_RINGTONE_SOURCE_MODE_SET: Record<ReminderRingtoneSourceMode, true> = {
  auto: true,
  uploaded: true,
  'default-file': true,
  synth: true,
};

const OSCILLATOR_TYPE_SET: Record<string, true> = {
  sine: true,
  square: true,
  sawtooth: true,
  triangle: true,
};

const DEFAULT_SYNTH_PATTERN_BASE = {
  waveform: 'sine' as OscillatorType,
  frequencies: [880, 659, 880],
  toneDurationMs: 130,
  gapDurationMs: 50,
  gain: 0.2,
};

function safeParse<T>(raw: string | null): T | null {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizeReminderKind(value: unknown): ReminderKind {
  if (typeof value === 'string' && value in REMINDER_KIND_SET) {
    return value as ReminderKind;
  }
  return 'custom';
}

function normalizeReminderStatus(value: unknown): ReminderStatus {
  if (typeof value === 'string' && value in REMINDER_STATUS_SET) {
    return value as ReminderStatus;
  }
  return 'pending';
}

function normalizeReminderScheduleMode(value: unknown, kind: ReminderKind): ReminderScheduleMode {
  if (typeof value === 'string' && value in REMINDER_SCHEDULE_MODE_SET) {
    return value as ReminderScheduleMode;
  }
  return kind === 'custom-time' ? 'date-time' : 'countdown';
}

function sanitizeRepeatWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.floor(item))
    .filter((item) => item >= 1 && item <= 7);

  return Array.from(new Set<number>(normalized)).sort((a, b) => a - b);
}

function normalizeReminderTitle(value: unknown, kind: ReminderKind): string {
  if (typeof value === 'string') {
    const trimmed = value.trim().slice(0, 80);
    if (trimmed) {
      return trimmed;
    }
  }

  if (kind === 'parking') {
    return '停车提醒';
  }
  if (kind === 'pomodoro') {
    return '番茄钟提醒';
  }
  if (kind === 'custom-time') {
    return '自定义时间提醒';
  }
  if (kind === 'custom') {
    return '自定义倒计时提醒';
  }
  return '自定义提醒';
}

function normalizeOptionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || undefined;
}

function clampDurationSeconds(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  const rounded = Math.floor(parsed);
  if (rounded < 0) {
    return 0;
  }
  if (rounded > 86400 * 3660) {
    return 86400 * 3660;
  }
  return rounded;
}

function clampUnixSeconds(value: unknown, fallbackUnix: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallbackUnix;
  }

  return Math.floor(parsed);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function normalizeRingtoneSourceMode(value: unknown): ReminderRingtoneSourceMode {
  if (typeof value === 'string' && value in REMINDER_RINGTONE_SOURCE_MODE_SET) {
    return value as ReminderRingtoneSourceMode;
  }
  return 'auto';
}

function sanitizeFrequencies(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_SYNTH_PATTERN_BASE.frequencies];
  }

  const normalized = value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.floor(item))
    .filter((item) => item >= 80 && item <= 4000)
    .slice(0, 16);

  return normalized.length ? normalized : [...DEFAULT_SYNTH_PATTERN_BASE.frequencies];
}

function sanitizeSynthPatternConfig(raw: unknown): ReminderSynthPatternConfig {
  const value = raw && typeof raw === 'object' ? (raw as Partial<ReminderSynthPatternConfig>) : {};
  const waveform =
    typeof value.waveform === 'string' && value.waveform in OSCILLATOR_TYPE_SET
      ? (value.waveform as OscillatorType)
      : DEFAULT_SYNTH_PATTERN_BASE.waveform;
  const frequencies = sanitizeFrequencies(value.frequencies);
  const toneDurationMs = Math.round(clampNumber(value.toneDurationMs, DEFAULT_SYNTH_PATTERN_BASE.toneDurationMs, 40, 2000));
  const gapDurationMs = Math.round(clampNumber(value.gapDurationMs, DEFAULT_SYNTH_PATTERN_BASE.gapDurationMs, 0, 1200));
  const gain = Number(clampNumber(value.gain, DEFAULT_SYNTH_PATTERN_BASE.gain, 0.01, 1).toFixed(3));
  const updatedAtUnix = clampUnixSeconds(value.updatedAtUnix, nowUnixSeconds());

  return {
    waveform,
    frequencies,
    toneDurationMs,
    gapDurationMs,
    gain,
    updatedAtUnix,
  };
}

function createReminderId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `rmd-${crypto.randomUUID()}`;
  }

  const random = Math.random().toString(16).slice(2);
  return `rmd-${Date.now().toString(36)}-${random}`;
}

function compareReminderAsc(a: ReminderTask, b: ReminderTask): number {
  if (a.status !== b.status) {
    if (a.status === 'pending') {
      return -1;
    }
    if (b.status === 'pending') {
      return 1;
    }
  }

  if (a.status === 'pending' && b.status === 'pending') {
    if (a.triggerAtUnix === b.triggerAtUnix) {
      return a.createdAtUnix - b.createdAtUnix;
    }
    return a.triggerAtUnix - b.triggerAtUnix;
  }

  if (a.updatedAtUnix === b.updatedAtUnix) {
    return b.createdAtUnix - a.createdAtUnix;
  }
  return b.updatedAtUnix - a.updatedAtUnix;
}

function sanitizeReminderTask(raw: unknown): ReminderTask | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw as Partial<ReminderTask>;
  if (typeof value.id !== 'string') {
    return null;
  }

  const nowUnix = nowUnixSeconds();
  const kind = normalizeReminderKind(value.kind);
  const createdAtUnix = clampUnixSeconds(value.createdAtUnix, nowUnix);
  const scheduleMode = normalizeReminderScheduleMode(value.scheduleMode, kind);
  const fallbackDurationSeconds = clampDurationSeconds(value.durationSeconds);
  const fallbackTriggerAt = createdAtUnix + fallbackDurationSeconds;
  const triggerAtUnix = Math.max(createdAtUnix, clampUnixSeconds(value.triggerAtUnix, fallbackTriggerAt));
  const durationSeconds =
    scheduleMode === 'date-time' ? Math.max(0, triggerAtUnix - createdAtUnix) : fallbackDurationSeconds;
  const repeatWeekdays = sanitizeRepeatWeekdays(value.repeatWeekdays);
  const status = normalizeReminderStatus(value.status);
  const updatedAtUnix = clampUnixSeconds(value.updatedAtUnix, createdAtUnix);
  const firedAtUnix = value.firedAtUnix === undefined ? undefined : clampUnixSeconds(value.firedAtUnix, updatedAtUnix);
  const acknowledgedAtUnix =
    value.acknowledgedAtUnix === undefined ? undefined : clampUnixSeconds(value.acknowledgedAtUnix, updatedAtUnix);
  const requiresAcknowledgement =
    status === 'fired'
      ? Boolean(value.requiresAcknowledgement) && !Number.isFinite(acknowledgedAtUnix)
      : false;
  const cancelledAtUnix =
    value.cancelledAtUnix === undefined ? undefined : clampUnixSeconds(value.cancelledAtUnix, updatedAtUnix);

  return {
    id: value.id,
    kind,
    title: normalizeReminderTitle(value.title, kind),
    note: normalizeOptionalText(value.note, 500),
    durationSeconds,
    triggerAtUnix,
    scheduleMode,
    repeatWeekdays: repeatWeekdays.length ? repeatWeekdays : undefined,
    createdAtUnix,
    updatedAtUnix,
    status,
    soundEnabled: value.soundEnabled !== false,
    notificationEnabled: value.notificationEnabled !== false,
    firedAtUnix,
    requiresAcknowledgement,
    acknowledgedAtUnix,
    cancelledAtUnix,
  };
}

export function loadReminderTasks(): ReminderTask[] {
  const parsed = safeParse<unknown[]>(localStorage.getItem(REMINDER_STORAGE_KEY));
  if (!Array.isArray(parsed)) {
    return [];
  }

  const normalized = parsed
    .map((item) => sanitizeReminderTask(item))
    .filter((item): item is ReminderTask => item !== null)
    .sort(compareReminderAsc);

  return normalized;
}

export function saveReminderTasks(tasks: ReminderTask[]): void {
  localStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(tasks));
}

export function clearReminderTasksStorage(): void {
  localStorage.removeItem(REMINDER_STORAGE_KEY);
}

export function createReminderTask(input: CreateReminderTaskInput): ReminderTask {
  const nowUnix = Number.isFinite(input.nowUnix) ? Math.floor(Number(input.nowUnix)) : nowUnixSeconds();
  const kind = normalizeReminderKind(input.kind);
  const scheduleMode = normalizeReminderScheduleMode(input.scheduleMode, kind);
  const repeatWeekdays = sanitizeRepeatWeekdays(input.repeatWeekdays);
  const title = normalizeReminderTitle(input.title, kind);
  const fallbackDurationSeconds = clampDurationSeconds(input.durationSeconds);
  const resolvedTriggerAtUnix =
    Number.isFinite(input.triggerAtUnix) && input.triggerAtUnix !== undefined
      ? Math.floor(Number(input.triggerAtUnix))
      : nowUnix + fallbackDurationSeconds;
  const triggerAtUnix = Math.max(nowUnix, resolvedTriggerAtUnix);
  const durationSeconds =
    scheduleMode === 'date-time' ? Math.max(0, triggerAtUnix - nowUnix) : clampDurationSeconds(input.durationSeconds);

  return {
    id: createReminderId(),
    kind,
    title,
    note: normalizeOptionalText(input.note, 500),
    durationSeconds,
    triggerAtUnix,
    scheduleMode,
    repeatWeekdays: repeatWeekdays.length ? repeatWeekdays : undefined,
    createdAtUnix: nowUnix,
    updatedAtUnix: nowUnix,
    status: 'pending',
    soundEnabled: input.soundEnabled !== false,
    notificationEnabled: input.notificationEnabled !== false,
  };
}

export function upsertReminderTask(tasks: ReminderTask[], task: ReminderTask): ReminderTask[] {
  const normalized = sanitizeReminderTask(task);
  if (!normalized) {
    return tasks;
  }

  const next = [...tasks];
  const index = next.findIndex((item) => item.id === normalized.id);

  if (index < 0) {
    next.push(normalized);
  } else {
    next[index] = normalized;
  }

  return next.sort(compareReminderAsc);
}

export function cancelReminderTask(task: ReminderTask, nowUnix = nowUnixSeconds()): ReminderTask {
  if (task.status !== 'pending') {
    return task;
  }

  return {
    ...task,
    status: 'cancelled',
    updatedAtUnix: nowUnix,
    cancelledAtUnix: nowUnix,
  };
}

export function markReminderFired(task: ReminderTask, nowUnix = nowUnixSeconds()): ReminderTask {
  if (task.status !== 'pending') {
    return task;
  }

  return {
    ...task,
    status: 'fired',
    updatedAtUnix: nowUnix,
    firedAtUnix: nowUnix,
    requiresAcknowledgement: true,
    acknowledgedAtUnix: undefined,
  };
}

export function acknowledgeReminderTask(task: ReminderTask, nowUnix = nowUnixSeconds()): ReminderTask {
  if (task.status !== 'fired' || !task.requiresAcknowledgement || Number.isFinite(task.acknowledgedAtUnix)) {
    return task;
  }

  return {
    ...task,
    updatedAtUnix: nowUnix,
    requiresAcknowledgement: false,
    acknowledgedAtUnix: nowUnix,
  };
}

export function getReminderRemainingSeconds(task: ReminderTask, nowUnix = nowUnixSeconds()): number {
  return Math.max(0, task.triggerAtUnix - nowUnix);
}

export function formatReminderKind(kind: ReminderKind): string {
  if (kind === 'parking') {
    return '停车提醒';
  }
  if (kind === 'pomodoro') {
    return '番茄钟';
  }
  if (kind === 'custom-time') {
    return '自定义时间';
  }
  return '自定义倒计时';
}

function sanitizeReminderRingtoneConfig(raw: unknown): ReminderRingtoneConfig | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw as Partial<ReminderRingtoneConfig>;
  if (typeof value.name !== 'string' || typeof value.mimeType !== 'string') {
    return null;
  }

  const name = value.name.trim().slice(0, 120);
  const mimeType = value.mimeType.trim().toLowerCase().slice(0, 100);
  const storageMode = value.storageMode === 'idb-blob' ? 'idb-blob' : 'data-url';
  const dataUrl = typeof value.dataUrl === 'string' ? value.dataUrl.trim() : '';
  const blobStorageId = typeof value.blobStorageId === 'string' ? value.blobStorageId.trim().slice(0, 120) : '';
  const sizeBytesRaw = Number(value.sizeBytes);
  const sizeBytes = Number.isFinite(sizeBytesRaw) && sizeBytesRaw >= 0 ? Math.floor(sizeBytesRaw) : undefined;
  const updatedAtUnix = clampUnixSeconds(value.updatedAtUnix, nowUnixSeconds());
  const githubPath = typeof value.githubPath === 'string' ? value.githubPath.trim().slice(0, 400) : undefined;
  const githubSyncedAtUnix =
    value.githubSyncedAtUnix === undefined ? undefined : clampUnixSeconds(value.githubSyncedAtUnix, updatedAtUnix);

  if (!name || !mimeType) {
    return null;
  }

  if (!mimeType.startsWith('audio/')) {
    return null;
  }

  if (storageMode === 'idb-blob') {
    if (!blobStorageId) {
      return null;
    }
    return {
      name,
      mimeType,
      storageMode,
      blobStorageId,
      sizeBytes,
      updatedAtUnix,
      githubPath: githubPath || undefined,
      githubSyncedAtUnix: Number.isFinite(githubSyncedAtUnix) ? githubSyncedAtUnix : undefined,
    };
  }

  if (!dataUrl) {
    return null;
  }

  if (!dataUrl.startsWith(`data:${mimeType}`) && !dataUrl.startsWith('data:audio/')) {
    return null;
  }

  return {
    name,
    mimeType,
    storageMode: 'data-url',
    dataUrl,
    sizeBytes,
    updatedAtUnix,
    githubPath: githubPath || undefined,
    githubSyncedAtUnix: Number.isFinite(githubSyncedAtUnix) ? githubSyncedAtUnix : undefined,
  };
}

export function loadReminderRingtoneConfig(): ReminderRingtoneConfig | null {
  const parsed = safeParse<unknown>(localStorage.getItem(REMINDER_RINGTONE_STORAGE_KEY));
  return sanitizeReminderRingtoneConfig(parsed);
}

export function saveReminderRingtoneConfig(config: ReminderRingtoneConfig): void {
  const normalized = sanitizeReminderRingtoneConfig(config);
  if (!normalized) {
    throw new Error('铃声配置无效，无法保存。');
  }

  localStorage.setItem(REMINDER_RINGTONE_STORAGE_KEY, JSON.stringify(normalized));
}

export function clearReminderRingtoneConfig(): void {
  localStorage.removeItem(REMINDER_RINGTONE_STORAGE_KEY);
}

export function loadReminderRingtoneSourceMode(): ReminderRingtoneSourceMode {
  return normalizeRingtoneSourceMode(localStorage.getItem(REMINDER_RINGTONE_SOURCE_MODE_STORAGE_KEY));
}

export function saveReminderRingtoneSourceMode(mode: ReminderRingtoneSourceMode): void {
  const normalized = normalizeRingtoneSourceMode(mode);
  localStorage.setItem(REMINDER_RINGTONE_SOURCE_MODE_STORAGE_KEY, normalized);
}

export function clearReminderRingtoneSourceModeStorage(): void {
  localStorage.removeItem(REMINDER_RINGTONE_SOURCE_MODE_STORAGE_KEY);
}

export function getDefaultReminderSynthPatternConfig(nowUnix = nowUnixSeconds()): ReminderSynthPatternConfig {
  return {
    ...DEFAULT_SYNTH_PATTERN_BASE,
    frequencies: [...DEFAULT_SYNTH_PATTERN_BASE.frequencies],
    updatedAtUnix: Math.floor(nowUnix),
  };
}

export function loadReminderSynthPatternConfig(): ReminderSynthPatternConfig {
  const parsed = safeParse<unknown>(localStorage.getItem(REMINDER_SYNTH_PATTERN_STORAGE_KEY));
  return sanitizeSynthPatternConfig(parsed);
}

export function saveReminderSynthPatternConfig(config: ReminderSynthPatternConfig): void {
  const normalized = sanitizeSynthPatternConfig(config);
  localStorage.setItem(REMINDER_SYNTH_PATTERN_STORAGE_KEY, JSON.stringify(normalized));
}

export function clearReminderSynthPatternConfigStorage(): void {
  localStorage.removeItem(REMINDER_SYNTH_PATTERN_STORAGE_KEY);
}
