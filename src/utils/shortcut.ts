export interface ParsedShortcut {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
}

export const DEFAULT_BLACKOUT_TOGGLE_SHORTCUT = 'Ctrl+Q';

const MODIFIER_TOKEN_MAP: Record<string, keyof Omit<ParsedShortcut, 'key'>> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  win: 'meta',
  windows: 'meta',
  super: 'meta',
};

const KEY_ALIAS_MAP: Record<string, string> = {
  esc: 'escape',
  escape: 'escape',
  enter: 'enter',
  return: 'enter',
  tab: 'tab',
  space: 'space',
  spacebar: 'space',
  backspace: 'backspace',
  delete: 'delete',
  del: 'delete',
  insert: 'insert',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pagedown: 'pagedown',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  arrowup: 'arrowup',
  arrowdown: 'arrowdown',
  arrowleft: 'arrowleft',
  arrowright: 'arrowright',
  plus: '+',
  minus: '-',
};

const NAMED_KEY_SET = new Set<string>([
  'escape',
  'enter',
  'tab',
  'space',
  'backspace',
  'delete',
  'insert',
  'home',
  'end',
  'pageup',
  'pagedown',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
  '+',
  '-',
]);

function normalizeKeyToken(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value) {
    return null;
  }

  if (value in KEY_ALIAS_MAP) {
    return KEY_ALIAS_MAP[value];
  }

  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/.test(value)) {
    return value;
  }

  if (value.length === 1) {
    return value;
  }

  if (NAMED_KEY_SET.has(value)) {
    return value;
  }

  return null;
}

function isModifierToken(raw: string): raw is keyof typeof MODIFIER_TOKEN_MAP {
  return raw in MODIFIER_TOKEN_MAP;
}

function normalizeEventKey(raw: string): string {
  if (raw === ' ') {
    return 'space';
  }

  const value = raw.trim().toLowerCase();
  if (!value) {
    return '';
  }

  if (value in KEY_ALIAS_MAP) {
    return KEY_ALIAS_MAP[value];
  }

  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/.test(value)) {
    return value;
  }

  if (value.length === 1) {
    return value;
  }

  return value;
}

function formatShortcutKey(key: string): string {
  if (key === 'space') {
    return 'Space';
  }
  if (key === 'escape') {
    return 'Esc';
  }
  if (key === 'enter') {
    return 'Enter';
  }
  if (key === 'tab') {
    return 'Tab';
  }
  if (key === 'backspace') {
    return 'Backspace';
  }
  if (key === 'delete') {
    return 'Delete';
  }
  if (key === 'insert') {
    return 'Insert';
  }
  if (key === 'home') {
    return 'Home';
  }
  if (key === 'end') {
    return 'End';
  }
  if (key === 'pageup') {
    return 'PageUp';
  }
  if (key === 'pagedown') {
    return 'PageDown';
  }
  if (key === 'arrowup') {
    return 'ArrowUp';
  }
  if (key === 'arrowdown') {
    return 'ArrowDown';
  }
  if (key === 'arrowleft') {
    return 'ArrowLeft';
  }
  if (key === 'arrowright') {
    return 'ArrowRight';
  }
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/.test(key)) {
    return key.toUpperCase();
  }
  if (key.length === 1) {
    return key.toUpperCase();
  }
  return key;
}

export function parseShortcut(raw: string): ParsedShortcut | null {
  const tokens = raw
    .split('+')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return null;
  }

  const parsed: ParsedShortcut = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    key: '',
  };

  for (const tokenRaw of tokens) {
    const token = tokenRaw.toLowerCase();
    if (isModifierToken(token)) {
      const modifier = MODIFIER_TOKEN_MAP[token];
      parsed[modifier] = true;
      continue;
    }

    if (parsed.key) {
      return null;
    }

    const key = normalizeKeyToken(tokenRaw);
    if (!key) {
      return null;
    }
    parsed.key = key;
  }

  if (!parsed.key) {
    return null;
  }

  return parsed;
}

export function formatShortcut(shortcut: ParsedShortcut): string {
  const parts: string[] = [];
  if (shortcut.ctrl) {
    parts.push('Ctrl');
  }
  if (shortcut.shift) {
    parts.push('Shift');
  }
  if (shortcut.alt) {
    parts.push('Alt');
  }
  if (shortcut.meta) {
    parts.push('Meta');
  }
  parts.push(formatShortcutKey(shortcut.key));
  return parts.join('+');
}

export function normalizeShortcutText(raw: string, fallback = DEFAULT_BLACKOUT_TOGGLE_SHORTCUT): string {
  const parsed = parseShortcut(raw) ?? parseShortcut(fallback);
  if (!parsed) {
    return DEFAULT_BLACKOUT_TOGGLE_SHORTCUT;
  }
  return formatShortcut(parsed);
}

export function matchesShortcutEvent(event: KeyboardEvent, shortcut: ParsedShortcut): boolean {
  if (event.ctrlKey !== shortcut.ctrl) {
    return false;
  }
  if (event.shiftKey !== shortcut.shift) {
    return false;
  }
  if (event.altKey !== shortcut.alt) {
    return false;
  }
  if (event.metaKey !== shortcut.meta) {
    return false;
  }

  return normalizeEventKey(event.key) === shortcut.key;
}
