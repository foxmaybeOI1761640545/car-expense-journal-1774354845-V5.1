import type { PomodoroStageSettings } from '../types/pomodoro';
import { nowUnixSeconds } from '../utils/date';

const POMODORO_STAGE_SETTINGS_STORAGE_KEY = 'car-journal-pomodoro-stage-settings-v1';

const DEFAULT_WORK_MINUTES = 25;
const DEFAULT_SHORT_BREAK_MINUTES = 5;
const DEFAULT_LONG_BREAK_MINUTES = 15;
const DEFAULT_LONG_BREAK_EVERY = 4;

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

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const rounded = Math.floor(parsed);
  if (rounded < min) {
    return min;
  }
  if (rounded > max) {
    return max;
  }
  return rounded;
}

function sanitizePomodoroStageSettings(raw: unknown): PomodoroStageSettings | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw as Partial<PomodoroStageSettings>;
  const updatedAtUnix = clampInteger(value.updatedAtUnix, 0, 86400 * 365 * 100, nowUnixSeconds());

  return {
    workMinutes: clampInteger(value.workMinutes, 1, 180, DEFAULT_WORK_MINUTES),
    shortBreakMinutes: clampInteger(value.shortBreakMinutes, 1, 60, DEFAULT_SHORT_BREAK_MINUTES),
    longBreakMinutes: clampInteger(value.longBreakMinutes, 1, 90, DEFAULT_LONG_BREAK_MINUTES),
    longBreakEvery: clampInteger(value.longBreakEvery, 1, 12, DEFAULT_LONG_BREAK_EVERY),
    updatedAtUnix,
  };
}

export function loadPomodoroStageSettings(): PomodoroStageSettings | null {
  const parsed = safeParse<unknown>(localStorage.getItem(POMODORO_STAGE_SETTINGS_STORAGE_KEY));
  return sanitizePomodoroStageSettings(parsed);
}

export function savePomodoroStageSettings(settings: PomodoroStageSettings): void {
  const normalized = sanitizePomodoroStageSettings(settings);
  if (!normalized) {
    throw new Error('Pomodoro stage settings are invalid.');
  }

  localStorage.setItem(POMODORO_STAGE_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
}

export function clearPomodoroStageSettingsStorage(): void {
  localStorage.removeItem(POMODORO_STAGE_SETTINGS_STORAGE_KEY);
}

