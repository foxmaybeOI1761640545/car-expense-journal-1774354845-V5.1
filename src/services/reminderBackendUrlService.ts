import type { AppConfig } from '../types/config';

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function resolveReminderBackendBaseUrl(
  config: Pick<AppConfig, 'reminderApiBaseUrl' | 'reminderApiFallbackBaseUrl'>,
): string {
  const explicitBaseUrl = normalizeBaseUrl(config.reminderApiBaseUrl);
  if (explicitBaseUrl) {
    return explicitBaseUrl;
  }

  return normalizeBaseUrl(config.reminderApiFallbackBaseUrl);
}
