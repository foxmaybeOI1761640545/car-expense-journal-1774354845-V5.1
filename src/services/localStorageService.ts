import type { AppConfig } from '../types/config';
import type { AppRecord } from '../types/records';
import type { FuelBalanceState } from '../types/store';

const APP_DATA_KEY = 'car-journal-app-data-v1';
const APP_CONFIG_KEY = 'car-journal-config-v1';

export interface PersistedAppData {
  records: AppRecord[];
  fuelBalance: FuelBalanceState;
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
