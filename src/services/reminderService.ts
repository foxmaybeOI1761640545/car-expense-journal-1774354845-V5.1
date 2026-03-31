import type {
  CreateReminderTaskInput,
  ReminderKind,
  ReminderRingtoneConfig,
  ReminderStatus,
  ReminderTask,
} from '../types/reminder';
import { nowUnixSeconds } from '../utils/date';

const REMINDER_STORAGE_KEY = 'car-journal-reminders-v1';
const REMINDER_RINGTONE_STORAGE_KEY = 'car-journal-reminder-ringtone-v1';

const REMINDER_KIND_SET: Record<ReminderKind, true> = {
  parking: true,
  pomodoro: true,
  custom: true,
};

const REMINDER_STATUS_SET: Record<ReminderStatus, true> = {
  pending: true,
  fired: true,
  cancelled: true,
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
    return 1;
  }

  const rounded = Math.floor(parsed);
  if (rounded < 1) {
    return 1;
  }
  if (rounded > 86400 * 14) {
    return 86400 * 14;
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
  const durationSeconds = clampDurationSeconds(value.durationSeconds);
  const triggerAtUnix = clampUnixSeconds(value.triggerAtUnix, createdAtUnix + durationSeconds);
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
  const durationSeconds = clampDurationSeconds(input.durationSeconds);
  const kind = normalizeReminderKind(input.kind);
  const title = normalizeReminderTitle(input.title, kind);

  return {
    id: createReminderId(),
    kind,
    title,
    note: normalizeOptionalText(input.note, 500),
    durationSeconds,
    triggerAtUnix: nowUnix + durationSeconds,
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
  return '自定义';
}

function sanitizeReminderRingtoneConfig(raw: unknown): ReminderRingtoneConfig | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw as Partial<ReminderRingtoneConfig>;
  if (typeof value.name !== 'string' || typeof value.mimeType !== 'string' || typeof value.dataUrl !== 'string') {
    return null;
  }

  const name = value.name.trim().slice(0, 120);
  const mimeType = value.mimeType.trim().toLowerCase().slice(0, 100);
  const dataUrl = value.dataUrl.trim();
  const updatedAtUnix = clampUnixSeconds(value.updatedAtUnix, nowUnixSeconds());

  if (!name || !mimeType || !dataUrl) {
    return null;
  }

  if (!mimeType.startsWith('audio/')) {
    return null;
  }

  if (!dataUrl.startsWith(`data:${mimeType}`) && !dataUrl.startsWith('data:audio/')) {
    return null;
  }

  return {
    name,
    mimeType,
    dataUrl,
    updatedAtUnix,
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
