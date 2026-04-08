export const BLACKOUT_ROUTE_PATH = '/blackout';

function readQueryValue(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw;
  }
  if (Array.isArray(raw)) {
    const first = raw[0];
    return typeof first === 'string' ? first : '';
  }
  return '';
}

export function resolveBlackoutReturnPath(raw: unknown, fallback = '/'): string {
  const normalizedFallback =
    typeof fallback === 'string' && fallback.startsWith('/') && !fallback.startsWith(BLACKOUT_ROUTE_PATH)
      ? fallback
      : '/';

  const value = readQueryValue(raw).trim();
  if (!value || !value.startsWith('/') || value.startsWith(BLACKOUT_ROUTE_PATH)) {
    return normalizedFallback;
  }

  return value;
}
