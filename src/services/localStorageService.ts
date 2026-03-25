import type { AppConfig } from '../types/config';
import type { AppRecord } from '../types/records';
import type { FuelBalanceAdjustmentLog, FuelBalanceState } from '../types/store';

const APP_DATA_KEY = 'car-journal-app-data-v1';
const APP_CONFIG_KEY = 'car-journal-config-v1';

interface LegacyLocalConfigWithToken extends Partial<AppConfig> {
  githubToken?: unknown;
}

export interface PersistedAppData {
  records: AppRecord[];
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

export function loadLocalConfig(): Partial<AppConfig> {
  const parsed = safeParse<Partial<AppConfig>>(localStorage.getItem(APP_CONFIG_KEY));
  return parsed ?? {};
}

export function saveLocalConfig(config: AppConfig): void {
  localStorage.setItem(APP_CONFIG_KEY, JSON.stringify(config));
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
