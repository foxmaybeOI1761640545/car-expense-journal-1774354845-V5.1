import type { AppConfig } from '../types/config';
import { DEFAULT_APP_CONFIG } from '../types/config';
import { parsePositiveNumber, roundTo } from '../utils/number';

function sanitizePartialConfig(raw: Partial<AppConfig>): Partial<AppConfig> {
  const next: Partial<AppConfig> = {};

  if (typeof raw.pageTitle === 'string' && raw.pageTitle.trim()) {
    next.pageTitle = raw.pageTitle.trim();
  }
  if (typeof raw.pageFavicon === 'string' && raw.pageFavicon.trim()) {
    next.pageFavicon = raw.pageFavicon.trim();
  }

  if (typeof raw.defaultProvince === 'string') {
    next.defaultProvince = raw.defaultProvince;
  }
  if (parsePositiveNumber(raw.defaultFuelType) !== null) {
    next.defaultFuelType = Math.round(Number(raw.defaultFuelType));
  }
  if (parsePositiveNumber(raw.defaultFuelPrice) !== null) {
    next.defaultFuelPrice = roundTo(Number(raw.defaultFuelPrice), 2);
  }
  if (parsePositiveNumber(raw.defaultAverageFuelConsumptionPer100Km) !== null) {
    next.defaultAverageFuelConsumptionPer100Km = roundTo(Number(raw.defaultAverageFuelConsumptionPer100Km), 2);
  }
  if (parsePositiveNumber(raw.defaultDistanceKm) !== null) {
    next.defaultDistanceKm = roundTo(Number(raw.defaultDistanceKm), 2);
  }

  if (typeof raw.defaultTripNote === 'string') {
    next.defaultTripNote = raw.defaultTripNote;
  }
  if (typeof raw.defaultFuelNote === 'string') {
    next.defaultFuelNote = raw.defaultFuelNote;
  }

  if (typeof raw.githubOwner === 'string') {
    next.githubOwner = raw.githubOwner.trim();
  }
  if (typeof raw.githubRepo === 'string') {
    next.githubRepo = raw.githubRepo.trim();
  }
  if (typeof raw.githubBranch === 'string') {
    next.githubBranch = raw.githubBranch.trim();
  }
  if (typeof raw.githubRecordsDir === 'string' && raw.githubRecordsDir.trim()) {
    next.githubRecordsDir = raw.githubRecordsDir.trim();
  }
  if (typeof raw.preferConfigOverLocalStorage === 'boolean') {
    next.preferConfigOverLocalStorage = raw.preferConfigOverLocalStorage;
  }

  return next;
}

export async function loadConfigFile(): Promise<Partial<AppConfig>> {
  const url = `${import.meta.env.BASE_URL}config/app-config.json`;

  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      return {};
    }

    const json = (await response.json()) as Partial<AppConfig>;
    return sanitizePartialConfig(json);
  } catch {
    return {};
  }
}

export function resolveAppConfig(fileConfig: Partial<AppConfig>, localConfig: Partial<AppConfig>): AppConfig {
  const safeFile = sanitizePartialConfig(fileConfig);
  const safeLocal = sanitizePartialConfig(localConfig);

  const preferConfig =
    typeof safeFile.preferConfigOverLocalStorage === 'boolean'
      ? safeFile.preferConfigOverLocalStorage
      : typeof safeLocal.preferConfigOverLocalStorage === 'boolean'
        ? safeLocal.preferConfigOverLocalStorage
        : DEFAULT_APP_CONFIG.preferConfigOverLocalStorage;

  const merged = preferConfig
    ? { ...DEFAULT_APP_CONFIG, ...safeLocal, ...safeFile }
    : { ...DEFAULT_APP_CONFIG, ...safeFile, ...safeLocal };

  merged.preferConfigOverLocalStorage = preferConfig;

  return merged;
}
