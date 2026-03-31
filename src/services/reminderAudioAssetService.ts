import type { ReminderDefaultAudioFileConfig } from '../types/reminder';

interface ReminderAudioConfigFilePayload {
  schemaVersion?: number;
  defaultRingtone?: {
    name?: unknown;
    path?: unknown;
    mimeType?: unknown;
  };
}

export interface ReminderResolvedDefaultAudioAsset extends ReminderDefaultAudioFileConfig {
  url: string;
}

const REMINDER_AUDIO_CONFIG_RELATIVE_PATH = 'config/reminder-audio-config.json';

function normalizeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || undefined;
}

function normalizeAudioPath(value: unknown): string | undefined {
  const path = normalizeText(value, 300);
  if (!path) {
    return undefined;
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  if (path.startsWith('//')) {
    return undefined;
  }

  return path.replace(/^\/+/, '');
}

function resolvePublicAssetUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const basePath = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '/');
  return `${basePath}${path.replace(/^\/+/, '')}`;
}

async function fetchReminderAudioConfigFile(): Promise<ReminderAudioConfigFilePayload | null> {
  const configUrl = resolvePublicAssetUrl(REMINDER_AUDIO_CONFIG_RELATIVE_PATH);

  try {
    const response = await fetch(configUrl, { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as ReminderAudioConfigFilePayload;
  } catch {
    return null;
  }
}

export async function loadReminderDefaultAudioAsset(): Promise<ReminderResolvedDefaultAudioAsset | null> {
  const parsed = await fetchReminderAudioConfigFile();
  if (!parsed || !parsed.defaultRingtone || typeof parsed.defaultRingtone !== 'object') {
    return null;
  }

  const name = normalizeText(parsed.defaultRingtone.name, 120) ?? '默认提醒音';
  const path = normalizeAudioPath(parsed.defaultRingtone.path);
  const mimeType = normalizeText(parsed.defaultRingtone.mimeType, 80)?.toLowerCase();

  if (!path) {
    return null;
  }

  return {
    name,
    path,
    mimeType,
    url: resolvePublicAssetUrl(path),
  };
}

