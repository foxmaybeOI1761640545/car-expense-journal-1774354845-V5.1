const GITHUB_TOKEN_VAULT_KEY = 'car-journal-github-token-v2';
const GITHUB_TOKEN_DEVICE_KEY = 'car-journal-github-token-device-key-v1';
const GITHUB_TOKEN_VAULT_VERSION = 'v2';
const TOKEN_PEPPER = 'car-journal-token-vault';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }

  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toBase64Url(value: string): string {
  return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  if (padding === 0) {
    return normalized;
  }

  return `${normalized}${'='.repeat(4 - padding)}`;
}

function makeRandomBytes(size: number): Uint8Array {
  const result = new Uint8Array(size);

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(result);
    return result;
  }

  for (let index = 0; index < size; index += 1) {
    result[index] = Math.floor(Math.random() * 256);
  }

  return result;
}

function getOrCreateDeviceKey(): string {
  const existing = localStorage.getItem(GITHUB_TOKEN_DEVICE_KEY)?.trim();
  if (existing) {
    return existing;
  }

  const generated = toBase64Url(bytesToBase64(makeRandomBytes(24)));
  localStorage.setItem(GITHUB_TOKEN_DEVICE_KEY, generated);
  return generated;
}

function makeSeed(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'unknown-origin';
  const deviceKey = getOrCreateDeviceKey();
  return `${origin}|${deviceKey}|${TOKEN_PEPPER}`;
}

function makeSeedCodes(seed: string): number[] {
  const codes = Array.from(seed).map((char) => char.charCodeAt(0));
  return codes.length ? codes : [131];
}

function maskByte(seedCodes: number[], index: number): number {
  return (seedCodes[index % seedCodes.length] + index * 17 + (index % 13) * 11) & 0xff;
}

function rotateLeft(value: string, shift: number): string {
  if (!value || shift <= 0) {
    return value;
  }

  const safeShift = shift % value.length;
  if (safeShift === 0) {
    return value;
  }

  return `${value.slice(safeShift)}${value.slice(0, safeShift)}`;
}

function rotateRight(value: string, shift: number): string {
  if (!value || shift <= 0) {
    return value;
  }

  const safeShift = shift % value.length;
  if (safeShift === 0) {
    return value;
  }

  return `${value.slice(value.length - safeShift)}${value.slice(0, value.length - safeShift)}`;
}

function checksum(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 131 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

function encodeToken(token: string): string {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return '';
  }

  const seed = makeSeed();
  const seedCodes = makeSeedCodes(seed);
  const input = new TextEncoder().encode(normalizedToken);
  const mixed = new Uint8Array(input.length);

  for (let index = 0; index < input.length; index += 1) {
    mixed[index] = input[index] ^ maskByte(seedCodes, index);
  }

  mixed.reverse();
  const payload = toBase64Url(bytesToBase64(mixed));
  const shift = seed.length % (payload.length || 1);
  const rotated = rotateLeft(payload, shift);
  const signed = checksum(`${GITHUB_TOKEN_VAULT_VERSION}|${seed}|${rotated}`);

  return `${GITHUB_TOKEN_VAULT_VERSION}.${signed}.${rotated}`;
}

function decodeToken(encoded: string): string | null {
  const [version, signed, rotated] = encoded.split('.');
  if (version !== GITHUB_TOKEN_VAULT_VERSION || !signed || !rotated) {
    return null;
  }

  const seed = makeSeed();
  const expected = checksum(`${version}|${seed}|${rotated}`);
  if (signed !== expected) {
    return null;
  }

  const shift = seed.length % (rotated.length || 1);
  const payload = rotateRight(rotated, shift);
  let mixed: Uint8Array;

  try {
    mixed = base64ToBytes(fromBase64Url(payload));
  } catch {
    return null;
  }

  mixed.reverse();
  const seedCodes = makeSeedCodes(seed);
  const output = new Uint8Array(mixed.length);

  for (let index = 0; index < mixed.length; index += 1) {
    output[index] = mixed[index] ^ maskByte(seedCodes, index);
  }

  try {
    return new TextDecoder().decode(output).trim();
  } catch {
    return null;
  }
}

export function loadGithubTokenFromVault(): string {
  const raw = localStorage.getItem(GITHUB_TOKEN_VAULT_KEY)?.trim();
  if (!raw) {
    return '';
  }

  const token = decodeToken(raw);
  if (!token) {
    localStorage.removeItem(GITHUB_TOKEN_VAULT_KEY);
    return '';
  }

  return token;
}

export function saveGithubTokenToVault(token: string): void {
  const encoded = encodeToken(token);

  if (!encoded) {
    localStorage.removeItem(GITHUB_TOKEN_VAULT_KEY);
    return;
  }

  localStorage.setItem(GITHUB_TOKEN_VAULT_KEY, encoded);
}

export function clearGithubTokenFromVault(): void {
  localStorage.removeItem(GITHUB_TOKEN_VAULT_KEY);
}
