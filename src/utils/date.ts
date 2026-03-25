export function toLocalDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function nowIsoString(): string {
  return new Date().toISOString();
}

export function nowUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function unixSecondsToIsoString(unixSeconds: number): string {
  const date = new Date(Math.floor(unixSeconds) * 1000);

  if (Number.isNaN(date.getTime())) {
    return nowIsoString();
  }

  return date.toISOString();
}

export function parseDateTimeLocalToUnix(value: string): number | undefined {
  const text = value.trim();
  if (!text) {
    return undefined;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return Math.floor(date.getTime() / 1000);
}

export function toDateTimeLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  const local = new Date(date.getTime() - offsetMs);
  return local.toISOString().slice(0, 16);
}
