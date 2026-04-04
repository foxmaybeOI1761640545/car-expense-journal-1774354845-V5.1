import type { AppConfig } from '../types/config';
import type { DeviceMeta } from '../types/device';
import type { UserProfile } from '../types/profile';
import type { AppRecord, RecordTombstone } from '../types/records';
import type { FuelBalanceAdjustmentLog, FuelBalanceState } from '../types/store';

const APP_DATA_KEY = 'car-journal-app-data-v1';
const APP_CONFIG_KEY = 'car-journal-config-v1';
const DEVICE_META_KEY = 'car-journal-device-meta-v1';
const THEME_PREFERENCE_KEY = 'car-journal-theme-preference-v1';

export type ThemePreference = 'day' | 'night';

interface LegacyLocalConfigWithToken extends Partial<AppConfig> {
  githubToken?: unknown;
}

export interface PersistedAppData {
  userProfile: UserProfile;
  records: AppRecord[];
  recordTombstones: RecordTombstone[];
  fuelBalance: FuelBalanceState;
  fuelBalanceAdjustments: FuelBalanceAdjustmentLog[];
}

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

export function loadAppData(): Partial<PersistedAppData> {
  const parsed = safeParse<Partial<PersistedAppData>>(localStorage.getItem(APP_DATA_KEY));
  return parsed ?? {};
}

export function saveAppData(data: PersistedAppData): void {
  localStorage.setItem(APP_DATA_KEY, JSON.stringify(data));
}

export function clearAppData(): void {
  localStorage.removeItem(APP_DATA_KEY);
}

export function loadLocalConfig(): Partial<AppConfig> {
  const parsed = safeParse<Partial<AppConfig>>(localStorage.getItem(APP_CONFIG_KEY));
  return parsed ?? {};
}

export function saveLocalConfig(config: AppConfig): void {
  localStorage.setItem(APP_CONFIG_KEY, JSON.stringify(config));
}

export function clearLocalConfig(): void {
  localStorage.removeItem(APP_CONFIG_KEY);
}

export function loadDeviceMeta(): Partial<DeviceMeta> | null {
  return safeParse<Partial<DeviceMeta>>(localStorage.getItem(DEVICE_META_KEY));
}

export function saveDeviceMeta(deviceMeta: DeviceMeta): void {
  localStorage.setItem(DEVICE_META_KEY, JSON.stringify(deviceMeta));
}

export function clearDeviceMeta(): void {
  localStorage.removeItem(DEVICE_META_KEY);
}

export function loadThemePreference(): ThemePreference {
  const value = localStorage.getItem(THEME_PREFERENCE_KEY);
  return value === 'night' ? 'night' : 'day';
}

export function saveThemePreference(theme: ThemePreference): void {
  const normalized = theme === 'night' ? 'night' : 'day';
  localStorage.setItem(THEME_PREFERENCE_KEY, normalized);
}

export function clearThemePreference(): void {
  localStorage.removeItem(THEME_PREFERENCE_KEY);
}

export function loadLegacyGithubTokenFromLocalConfig(): string | null {
  const parsed = safeParse<LegacyLocalConfigWithToken>(localStorage.getItem(APP_CONFIG_KEY));
  if (!parsed || typeof parsed.githubToken !== 'string') {
    return null;
  }

  const token = parsed.githubToken.trim();
  return token ? token : null;
}

export function removeLegacyGithubTokenFromLocalConfig(): void {
  const parsed = safeParse<Record<string, unknown>>(localStorage.getItem(APP_CONFIG_KEY));
  if (!parsed || typeof parsed !== 'object' || !Object.prototype.hasOwnProperty.call(parsed, 'githubToken')) {
    return;
  }

  const next = { ...parsed };
  delete next.githubToken;
  localStorage.setItem(APP_CONFIG_KEY, JSON.stringify(next));
}
