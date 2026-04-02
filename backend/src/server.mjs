import http from 'node:http';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import webpush from 'web-push';

const SERVICE_NAME = 'car-journal-reminder-backend';
const GITHUB_API_BASE = 'https://api.github.com';
const SEALED_TOKEN_PREFIX = 'pat.sealed';
const DEFAULT_PORT = 18080;
const APP_VERSION = (process.env.APP_VERSION || '0.1.0').trim();
const REQUESTED_PORT = Number(process.env.PORT) || DEFAULT_PORT;
const EXPLICIT_PORT = typeof process.env.PORT === 'string' && process.env.PORT.trim().length > 0;
const ENABLE_PORT_FALLBACK = parseBooleanEnv(process.env.ENABLE_PORT_FALLBACK, !EXPLICIT_PORT);
const MAX_PORT_FALLBACK_STEPS = clampInteger(process.env.MAX_PORT_FALLBACK_STEPS, 20, 0, 200);
const MAX_SEAL_JSON_BODY_BYTES = clampInteger(process.env.MAX_SEAL_JSON_BODY_BYTES, 32 * 1024, 1024, 256 * 1024);
const MAX_GITHUB_PROXY_BODY_BYTES = clampInteger(
  process.env.MAX_GITHUB_PROXY_BODY_BYTES,
  8 * 1024 * 1024,
  32 * 1024,
  32 * 1024 * 1024,
);
const MAX_PUSH_JSON_BODY_BYTES = clampInteger(process.env.MAX_PUSH_JSON_BODY_BYTES, 128 * 1024, 4 * 1024, 2 * 1024 * 1024);
const MAX_REMINDER_JSON_BODY_BYTES = clampInteger(
  process.env.MAX_REMINDER_JSON_BODY_BYTES,
  128 * 1024,
  4 * 1024,
  2 * 1024 * 1024,
);
const PAT_WRAP_KEY_VERSION = (process.env.PAT_WRAP_KEY_VERSION || 'v1').trim() || 'v1';
const PAT_WRAP_KEY = resolvePatWrapKey(process.env.PAT_WRAP_KEY_BASE64 || '');
const PUSH_SCHEMA_VERSION = 1;
const REMINDER_SCHEMA_VERSION = 1;
const REMINDER_DELIVERY_SCHEMA_VERSION = 1;
const VAPID_PUBLIC_KEY = normalizeNonEmptyString(process.env.VAPID_PUBLIC_KEY || '', 300);
const VAPID_PRIVATE_KEY = normalizeNonEmptyString(process.env.VAPID_PRIVATE_KEY || '', 300);
const VAPID_SUBJECT = normalizeNonEmptyString(process.env.VAPID_SUBJECT || '', 300);
const INTERNAL_TICK_TOKEN = normalizeNonEmptyString(process.env.INTERNAL_TICK_TOKEN || '', 512);
const TICK_GITHUB_TOKEN = normalizeNonEmptyString(process.env.TICK_GITHUB_TOKEN || '', 8192);
const TICK_GITHUB_OWNER = normalizeNonEmptyString(process.env.TICK_GITHUB_OWNER || '', 120);
const TICK_GITHUB_REPO = normalizeNonEmptyString(process.env.TICK_GITHUB_REPO || '', 120);
const TICK_GITHUB_BRANCH = normalizeNonEmptyString(process.env.TICK_GITHUB_BRANCH || '', 160);
const TICK_GITHUB_RECORDS_DIR = normalizeRepoPath(process.env.TICK_GITHUB_RECORDS_DIR || '');
const TICK_MAX_ENTITY_FILES = clampInteger(process.env.TICK_MAX_ENTITY_FILES, 500, 10, 5000);
const TICK_MAX_DUE_REMINDERS = clampInteger(process.env.TICK_MAX_DUE_REMINDERS, 50, 1, 1000);
const TICK_DUE_LOOKBACK_SECONDS = clampInteger(process.env.TICK_DUE_LOOKBACK_SECONDS, 7 * 24 * 3600, 60, 365 * 24 * 3600);
const TICK_PUSH_TTL_SECONDS = clampInteger(process.env.TICK_PUSH_TTL_SECONDS, 600, 60, 24 * 3600);
const DEFAULT_CORS_ORIGIN_RULES = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'https://*.github.io',
];
const CORS_ORIGINS = resolveCorsOrigins(process.env.CORS_ORIGINS || '');
const startedAt = Date.now();
let listeningPort = REQUESTED_PORT;
let pushConfigured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);

if (pushConfigured) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  } catch {
    pushConfigured = false;
  }
}

function parseCorsOrigins(raw) {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveCorsOrigins(raw) {
  const parsed = parseCorsOrigins(raw);
  if (parsed.length > 0) {
    return parsed;
  }

  return [...DEFAULT_CORS_ORIGIN_RULES];
}

function isWildcardCorsRule(rule) {
  return /^https?:\/\/\*\.[^/]+$/i.test(rule);
}

function originMatchesCorsRule(origin, rule) {
  if (rule === origin) {
    return true;
  }

  if (!isWildcardCorsRule(rule)) {
    return false;
  }

  const wildcardMatch = rule.match(/^(https?):\/\/\*\.([^/]+)$/i);
  if (!wildcardMatch) {
    return false;
  }

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  const expectedProtocol = `${wildcardMatch[1].toLowerCase()}:`;
  if (parsedOrigin.protocol.toLowerCase() !== expectedProtocol) {
    return false;
  }

  const host = parsedOrigin.hostname.toLowerCase();
  const wildcardSuffix = wildcardMatch[2].toLowerCase();
  return host === wildcardSuffix || host.endsWith(`.${wildcardSuffix}`);
}

function parseBooleanEnv(raw, fallback) {
  if (typeof raw !== 'string') {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return fallback;
}

function clampInteger(raw, fallback, min, max) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const rounded = Math.floor(parsed);
  return Math.max(min, Math.min(max, rounded));
}

function resolveCorsOrigin(origin) {
  if (CORS_ORIGINS.includes('*')) {
    return origin || '*';
  }

  if (!origin) {
    return null;
  }

  if (CORS_ORIGINS.some((rule) => originMatchesCorsRule(origin, rule))) {
    return origin;
  }

  return null;
}

function writeJson(res, statusCode, body, origin) {
  const payload = JSON.stringify(body);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  };

  const resolvedCorsOrigin = resolveCorsOrigin(origin);
  if (resolvedCorsOrigin) {
    headers['Access-Control-Allow-Origin'] = resolvedCorsOrigin;
    headers['Access-Control-Allow-Methods'] = 'GET,HEAD,POST,PATCH,OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Vary'] = 'Origin';
  }

  res.writeHead(statusCode, headers);
  res.end(payload);
}

function writeNoContent(res, origin, statusCode = 204) {
  const headers = {
    'Cache-Control': 'no-store',
  };
  const resolvedCorsOrigin = resolveCorsOrigin(origin);
  if (resolvedCorsOrigin) {
    headers['Access-Control-Allow-Origin'] = resolvedCorsOrigin;
    headers['Access-Control-Allow-Methods'] = 'GET,HEAD,POST,PATCH,OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Vary'] = 'Origin';
  }

  res.writeHead(statusCode, headers);
  res.end();
}

function getRuntimeStatus() {
  const serverTimeUnix = Math.floor(Date.now() / 1000);
  const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
  return {
    ok: true,
    service: SERVICE_NAME,
    version: APP_VERSION,
    serverTimeUnix,
    uptimeSeconds,
  };
}

function toBase64Url(value) {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : `${normalized}${'='.repeat(4 - padding)}`;
  return Buffer.from(padded, 'base64');
}

function resolvePatWrapKey(raw) {
  if (typeof raw !== 'string') {
    return null;
  }

  const normalized = raw.trim();
  if (!normalized) {
    return null;
  }

  try {
    const key = Buffer.from(normalized, 'base64');
    if (key.length !== 32) {
      return null;
    }
    return key;
  } catch {
    return null;
  }
}

function sealPatToken(pat) {
  if (!PAT_WRAP_KEY) {
    throw new Error('PAT_WRAP_KEY_MISSING');
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', PAT_WRAP_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(pat, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = {
    iat: Math.floor(Date.now() / 1000),
    iv: toBase64Url(iv),
    tag: toBase64Url(tag),
    ciphertext: toBase64Url(encrypted),
  };
  const payloadEncoded = toBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${SEALED_TOKEN_PREFIX}.${PAT_WRAP_KEY_VERSION}.${payloadEncoded}`;
}

function unsealPatToken(sealedToken) {
  if (!PAT_WRAP_KEY) {
    throw new Error('PAT_WRAP_KEY_MISSING');
  }

  if (typeof sealedToken !== 'string') {
    throw new Error('SEALED_TOKEN_INVALID');
  }

  const trimmed = sealedToken.trim();
  const segments = trimmed.split('.');
  if (segments.length !== 4 || segments[0] !== 'pat' || segments[1] !== 'sealed') {
    throw new Error('SEALED_TOKEN_INVALID');
  }

  const payloadEncoded = segments[3];
  let payload;
  try {
    payload = JSON.parse(fromBase64Url(payloadEncoded).toString('utf8'));
  } catch {
    throw new Error('SEALED_TOKEN_INVALID');
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof payload.iv !== 'string' ||
    typeof payload.tag !== 'string' ||
    typeof payload.ciphertext !== 'string'
  ) {
    throw new Error('SEALED_TOKEN_INVALID');
  }

  let iv;
  let tag;
  let ciphertext;
  try {
    iv = fromBase64Url(payload.iv);
    tag = fromBase64Url(payload.tag);
    ciphertext = fromBase64Url(payload.ciphertext);
  } catch {
    throw new Error('SEALED_TOKEN_INVALID');
  }

  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error('SEALED_TOKEN_INVALID');
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', PAT_WRAP_KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8').trim();
    if (!decrypted) {
      throw new Error('SEALED_TOKEN_INVALID');
    }
    return decrypted;
  } catch {
    throw new Error('SEALED_TOKEN_INVALID');
  }
}

function normalizeNonEmptyString(value, maxLength = 200) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

function normalizeRepoPath(rawPath) {
  const path = normalizeNonEmptyString(rawPath, 1000).replace(/^\/+/, '');
  if (!path || path.includes('..') || path.includes('\\')) {
    return '';
  }
  return path;
}

function normalizePathSegment(rawValue, fallback = 'unknown', maxLength = 120) {
  const normalized = normalizeNonEmptyString(rawValue, maxLength)
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}

function toBase64Utf8(value) {
  return Buffer.from(value, 'utf8').toString('base64');
}

function fromBase64Utf8(value) {
  return Buffer.from(value.replace(/[\r\n]/g, ''), 'base64').toString('utf8');
}

function makeReminderPushSubscriptionId(endpoint) {
  const hash = createHash('sha256').update(endpoint, 'utf8').digest('hex');
  return `push-${hash.slice(0, 24)}`;
}

function normalizeSubscriptionEndpoint(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const endpoint = value.trim();
  if (!endpoint || endpoint.length > 4000) {
    return '';
  }

  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'https:') {
      return '';
    }
  } catch {
    return '';
  }

  return endpoint;
}

function normalizeSubscriptionKey(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 4096) {
    return '';
  }
  return normalized;
}

function normalizePushSubscription(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw;
  const endpoint = normalizeSubscriptionEndpoint(value.endpoint);
  const keysRaw = value.keys && typeof value.keys === 'object' ? value.keys : {};
  const p256dh = normalizeSubscriptionKey(keysRaw.p256dh);
  const auth = normalizeSubscriptionKey(keysRaw.auth);

  if (!endpoint || !p256dh || !auth) {
    return null;
  }

  const expirationTime =
    value.expirationTime === null || value.expirationTime === undefined
      ? null
      : Number.isFinite(Number(value.expirationTime))
        ? Math.floor(Number(value.expirationTime))
        : null;

  return {
    endpoint,
    expirationTime,
    keys: {
      p256dh,
      auth,
    },
  };
}

function extractGithubTokenCandidate(body) {
  const sealedToken = normalizeNonEmptyString(body?.sealedToken, 8192);
  if (sealedToken) {
    return sealedToken;
  }

  return normalizeNonEmptyString(body?.githubToken, 8192);
}

function resolveGithubPatToken(tokenCandidate) {
  if (!tokenCandidate) {
    throw new Error('Missing GitHub token.');
  }
  if (/^pat\.sealed\./.test(tokenCandidate)) {
    return unsealPatToken(tokenCandidate);
  }
  return tokenCandidate;
}

function parsePushGithubContext(body) {
  const tokenCandidate = extractGithubTokenCandidate(body);
  const owner = normalizeNonEmptyString(body?.owner, 120);
  const repo = normalizeNonEmptyString(body?.repo, 120);
  const branch = normalizeNonEmptyString(body?.branch, 160);
  const recordsDir = normalizeRepoPath(body?.recordsDir);

  if (!tokenCandidate || !owner || !repo || !recordsDir) {
    return null;
  }

  return {
    tokenCandidate,
    owner,
    repo,
    branch,
    recordsDir,
  };
}

function parseGithubJsonFileContent(fileBody) {
  if (!fileBody || typeof fileBody !== 'object') {
    return null;
  }

  const content = typeof fileBody.content === 'string' ? fileBody.content : '';
  const encoding = typeof fileBody.encoding === 'string' ? fileBody.encoding.toLowerCase() : '';
  if (!content || encoding !== 'base64') {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Utf8(content));
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parsePushSubscriptionFileContent(fileBody) {
  const parsed = parseGithubJsonFileContent(fileBody);
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  return parsed;
}

function buildPushSubscriptionFilePath(recordsDir, deviceId, subscriptionId) {
  const safeDeviceId = normalizePathSegment(deviceId, 'device', 120);
  const safeSubscriptionId = normalizePathSegment(subscriptionId, 'subscription', 120);
  return `${recordsDir}/reminders/subscriptions/${safeDeviceId}/${safeSubscriptionId}.json`;
}

function normalizeReminderStatus(value) {
  if (value === 'pending' || value === 'fired' || value === 'cancelled' || value === 'failed') {
    return value;
  }
  return 'pending';
}

function normalizeReminderKind(value) {
  if (value === 'custom' || value === 'custom-time' || value === 'parking' || value === 'pomodoro') {
    return value;
  }
  return 'custom';
}

function normalizeReminderScheduleMode(value, kind) {
  if (value === 'date-time' || value === 'countdown') {
    return value;
  }
  return kind === 'custom-time' ? 'date-time' : 'countdown';
}

function sanitizeReminderRepeatWeekdays(raw) {
  if (!Array.isArray(raw)) {
    return undefined;
  }

  const unique = new Set();
  for (const item of raw) {
    const weekday = Math.floor(Number(item));
    if (!Number.isFinite(weekday) || weekday < 1 || weekday > 7) {
      continue;
    }
    unique.add(weekday);
  }

  if (unique.size === 0) {
    return undefined;
  }
  return Array.from(unique).sort((a, b) => a - b);
}

function normalizeReminderEntityInput(raw, fallbackDeviceId = '') {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw;
  const nowUnix = Math.floor(Date.now() / 1000);
  const id = normalizeNonEmptyString(value.id, 180);
  if (!id) {
    return null;
  }

  const kind = normalizeReminderKind(normalizeNonEmptyString(value.kind, 40));
  const scheduleMode = normalizeReminderScheduleMode(normalizeNonEmptyString(value.scheduleMode, 40), kind);
  const title = normalizeNonEmptyString(value.title, 120) || '提醒中心';
  const note = normalizeNonEmptyString(value.note, 500) || undefined;
  const status = normalizeReminderStatus(normalizeNonEmptyString(value.status, 30));
  const triggerAtUnix = Math.floor(Number(value.triggerAtUnix));
  if (!Number.isFinite(triggerAtUnix) || triggerAtUnix <= 0) {
    return null;
  }

  const createdAtUnixRaw = Math.floor(Number(value.createdAtUnix));
  const updatedAtUnixRaw = Math.floor(Number(value.updatedAtUnix));
  const createdAtUnix = Number.isFinite(createdAtUnixRaw) && createdAtUnixRaw > 0 ? createdAtUnixRaw : nowUnix;
  const updatedAtUnix = Number.isFinite(updatedAtUnixRaw) && updatedAtUnixRaw > 0 ? Math.max(updatedAtUnixRaw, createdAtUnix) : nowUnix;
  const durationSecondsRaw = Math.floor(Number(value.durationSeconds));
  const durationSeconds =
    Number.isFinite(durationSecondsRaw) && durationSecondsRaw >= 0
      ? durationSecondsRaw
      : Math.max(0, triggerAtUnix - createdAtUnix);
  const repeatWeekdays = sanitizeReminderRepeatWeekdays(value.repeatWeekdays);
  const soundEnabled = value.soundEnabled !== false;
  const notificationEnabled = value.notificationEnabled !== false;
  const requiresAcknowledgement = Boolean(value.requiresAcknowledgement);
  const firedAtUnixRaw = Math.floor(Number(value.firedAtUnix));
  const acknowledgedAtUnixRaw = Math.floor(Number(value.acknowledgedAtUnix));
  const cancelledAtUnixRaw = Math.floor(Number(value.cancelledAtUnix));
  const failedAtUnixRaw = Math.floor(Number(value.failedAtUnix));
  const deviceId = normalizeNonEmptyString(value.deviceId, 160) || normalizeNonEmptyString(fallbackDeviceId, 160);
  if (!deviceId) {
    return null;
  }

  return {
    schemaVersion: REMINDER_SCHEMA_VERSION,
    id,
    deviceId,
    kind,
    title,
    note,
    durationSeconds,
    triggerAtUnix,
    scheduleMode,
    repeatWeekdays,
    status,
    soundEnabled,
    notificationEnabled,
    requiresAcknowledgement,
    createdAtUnix,
    updatedAtUnix,
    firedAtUnix: Number.isFinite(firedAtUnixRaw) ? firedAtUnixRaw : undefined,
    acknowledgedAtUnix: Number.isFinite(acknowledgedAtUnixRaw) ? acknowledgedAtUnixRaw : undefined,
    cancelledAtUnix: Number.isFinite(cancelledAtUnixRaw) ? cancelledAtUnixRaw : undefined,
    failedAtUnix: Number.isFinite(failedAtUnixRaw) ? failedAtUnixRaw : undefined,
    lastError: normalizeNonEmptyString(value.lastError, 500) || undefined,
    lastTickAtUnix: Number.isFinite(Math.floor(Number(value.lastTickAtUnix))) ? Math.floor(Number(value.lastTickAtUnix)) : undefined,
    retryCount: Number.isFinite(Math.floor(Number(value.retryCount))) ? Math.max(0, Math.floor(Number(value.retryCount))) : 0,
    source: normalizeNonEmptyString(value.source, 80) || 'frontend',
  };
}

function parseReminderEntityFileContent(fileBody) {
  const parsed = parseGithubJsonFileContent(fileBody);
  if (!parsed) {
    return null;
  }
  return normalizeReminderEntityInput(parsed);
}

function parseReminderDeliveryFileContent(fileBody) {
  const parsed = parseGithubJsonFileContent(fileBody);
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  return parsed;
}

function normalizeStoredPushSubscriptionRecord(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const endpoint = normalizeSubscriptionEndpoint(raw.endpoint);
  const keysRaw = raw.keys && typeof raw.keys === 'object' ? raw.keys : {};
  const p256dh = normalizeSubscriptionKey(keysRaw.p256dh);
  const auth = normalizeSubscriptionKey(keysRaw.auth);
  if (!endpoint || !p256dh || !auth) {
    return null;
  }

  const id = normalizeNonEmptyString(raw.id, 160) || makeReminderPushSubscriptionId(endpoint);
  const deviceId = normalizeNonEmptyString(raw.deviceId, 160);
  const enabled = raw.enabled !== false;
  const updatedAtUnix = Math.floor(Number(raw.updatedAtUnix));
  const createdAtUnix = Math.floor(Number(raw.createdAtUnix));

  return {
    schemaVersion: PUSH_SCHEMA_VERSION,
    id,
    deviceId,
    endpoint,
    expirationTime:
      raw.expirationTime === null || raw.expirationTime === undefined
        ? null
        : Number.isFinite(Number(raw.expirationTime))
          ? Math.floor(Number(raw.expirationTime))
          : null,
    keys: {
      p256dh,
      auth,
    },
    enabled,
    createdAtUnix: Number.isFinite(createdAtUnix) && createdAtUnix > 0 ? createdAtUnix : undefined,
    updatedAtUnix: Number.isFinite(updatedAtUnix) && updatedAtUnix > 0 ? updatedAtUnix : undefined,
    removedAtUnix: Number.isFinite(Math.floor(Number(raw.removedAtUnix))) ? Math.floor(Number(raw.removedAtUnix)) : undefined,
    lastError: normalizeNonEmptyString(raw.lastError, 500) || undefined,
  };
}

function buildReminderEntityFilePath(recordsDir, reminderId) {
  const safeReminderId = normalizePathSegment(reminderId, 'reminder', 180);
  return `${recordsDir}/reminders/entities/${safeReminderId}.json`;
}

function buildReminderSubscriptionsDirectoryPath(recordsDir, deviceId) {
  const safeDeviceId = normalizePathSegment(deviceId, 'device', 120);
  return `${recordsDir}/reminders/subscriptions/${safeDeviceId}`;
}

function buildReminderDeliveryFilePath(recordsDir, reminderId) {
  const safeReminderId = normalizePathSegment(reminderId, 'reminder', 180);
  return `${recordsDir}/reminders/deliveries/${safeReminderId}/push.json`;
}

function encodeContentPath(path) {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function makeGithubContentsEndpoint({ owner, repo, path, branch }) {
  const refQuery = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  return `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeContentPath(path)}${refQuery}`;
}

async function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let exceededLimit = false;

    req.on('data', (chunk) => {
      if (exceededLimit) {
        return;
      }

      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        exceededLimit = true;
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (exceededLimit) {
        const error = new Error('JSON body too large');
        error.code = 'BODY_TOO_LARGE';
        reject(error);
        return;
      }

      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        const error = new Error('Invalid JSON');
        error.code = 'INVALID_JSON';
        reject(error);
      }
    });

    req.on('error', (error) => {
      reject(error);
    });
  });
}

async function parseGithubResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      message: text.slice(0, 2000),
    };
  }
}

async function proxyGithubContentsRequest({ method, pat, owner, repo, branch, path, payload }) {
  const endpoint = makeGithubContentsEndpoint({
    owner,
    repo,
    path,
    branch: method === 'GET' ? branch : '',
  });
  const headers = {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const init = {
    method,
    headers,
  };

  if (method === 'PUT') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(payload);
  }

  const upstreamResponse = await fetch(endpoint, init);
  const body = await parseGithubResponseBody(upstreamResponse);
  return {
    status: upstreamResponse.status,
    body,
  };
}

function extractGithubErrorMessage(body, fallback) {
  if (body && typeof body === 'object' && typeof body.message === 'string' && body.message.trim()) {
    return body.message.trim();
  }
  return fallback;
}

async function fetchGithubFileBodyByPat({ pat, owner, repo, branch, path, allowNotFound = false }) {
  const response = await proxyGithubContentsRequest({
    method: 'GET',
    pat,
    owner,
    repo,
    branch,
    path,
  });

  if (response.status === 404 && allowNotFound) {
    return null;
  }

  if (response.status !== 200) {
    const fallback = `GitHub GET failed (HTTP ${response.status}).`;
    throw new Error(extractGithubErrorMessage(response.body, fallback));
  }

  if (!response.body || typeof response.body !== 'object') {
    throw new Error('GitHub GET returned invalid payload.');
  }

  return response.body;
}

async function listGithubDirectoryByPat({ pat, owner, repo, branch, path, allowNotFound = false }) {
  const response = await proxyGithubContentsRequest({
    method: 'GET',
    pat,
    owner,
    repo,
    branch,
    path,
  });

  if (response.status === 404 && allowNotFound) {
    return [];
  }

  if (response.status !== 200) {
    const fallback = `GitHub LIST failed (HTTP ${response.status}).`;
    throw new Error(extractGithubErrorMessage(response.body, fallback));
  }

  if (!Array.isArray(response.body)) {
    throw new Error('GitHub LIST returned invalid payload.');
  }

  return response.body;
}

async function putGithubFileByPat({ pat, owner, repo, branch, path, message, content, sha }) {
  const payload = {
    message,
    content,
    sha,
    branch: branch || undefined,
  };

  const response = await proxyGithubContentsRequest({
    method: 'PUT',
    pat,
    owner,
    repo,
    branch,
    path,
    payload,
  });

  if (response.status !== 200 && response.status !== 201) {
    const fallback = `GitHub PUT failed (HTTP ${response.status}).`;
    throw new Error(extractGithubErrorMessage(response.body, fallback));
  }

  return response.body;
}

function validatePushSubscriptionUpsertBody(body) {
  const github = parsePushGithubContext(body);
  const deviceId = normalizeNonEmptyString(body?.deviceId, 160);
  const subscription = normalizePushSubscription(body?.subscription);
  if (!github || !deviceId || !subscription) {
    return {
      ok: false,
      message: 'Invalid push subscription upsert request.',
    };
  }

  return {
    ok: true,
    github,
    deviceId,
    subscription,
  };
}

function validatePushSubscriptionRemoveBody(body) {
  const github = parsePushGithubContext(body);
  const deviceId = normalizeNonEmptyString(body?.deviceId, 160);
  const subscriptionIdRaw = normalizeNonEmptyString(body?.subscriptionId, 160);
  const endpoint = normalizeSubscriptionEndpoint(body?.endpoint);
  const subscriptionId = subscriptionIdRaw || (endpoint ? makeReminderPushSubscriptionId(endpoint) : '');

  if (!github || !deviceId || !subscriptionId) {
    return {
      ok: false,
      message: 'Invalid push subscription remove request.',
    };
  }

  return {
    ok: true,
    github,
    deviceId,
    subscriptionId,
    endpoint: endpoint || undefined,
  };
}

function validatePushTestSendBody(body) {
  const subscription = normalizePushSubscription(body?.subscription);
  if (!subscription) {
    return {
      ok: false,
      message: 'Invalid push subscription.',
    };
  }

  const title = normalizeNonEmptyString(body?.title, 120) || '提醒中心';
  const message = normalizeNonEmptyString(body?.message, 500) || '到时提醒';
  const tag = normalizeNonEmptyString(body?.tag, 120) || 'reminder-test';
  const url = normalizeNonEmptyString(body?.url, 400) || '/#/reminder';

  return {
    ok: true,
    subscription,
    payload: {
      title,
      body: message,
      tag,
      url,
      source: 'backend-test',
      triggeredAtUnix: Math.floor(Date.now() / 1000),
    },
  };
}

function validateReminderUpsertBody(body) {
  const github = parsePushGithubContext(body);
  const deviceId = normalizeNonEmptyString(body?.deviceId, 160);
  const reminder = normalizeReminderEntityInput(body?.reminder, deviceId);

  if (!github || !deviceId || !reminder) {
    return {
      ok: false,
      message: 'Invalid reminder upsert request.',
    };
  }

  return {
    ok: true,
    github,
    deviceId,
    reminder: {
      ...reminder,
      deviceId,
    },
  };
}

function validateReminderCancelBody(body, reminderIdFromPath = '') {
  const github = parsePushGithubContext(body);
  const deviceId = normalizeNonEmptyString(body?.deviceId, 160);
  const reminderId = normalizeNonEmptyString(reminderIdFromPath || body?.reminderId, 180);

  if (!github || !deviceId || !reminderId) {
    return {
      ok: false,
      message: 'Invalid reminder cancel request.',
    };
  }

  return {
    ok: true,
    github,
    deviceId,
    reminderId,
  };
}

function resolveTickGithubContextFromUrl(url) {
  const tokenCandidate =
    normalizeNonEmptyString(url.searchParams.get('sealedToken') || '', 8192) ||
    normalizeNonEmptyString(url.searchParams.get('githubToken') || '', 8192) ||
    TICK_GITHUB_TOKEN;
  const owner = normalizeNonEmptyString(url.searchParams.get('owner') || '', 120) || TICK_GITHUB_OWNER;
  const repo = normalizeNonEmptyString(url.searchParams.get('repo') || '', 120) || TICK_GITHUB_REPO;
  const branch = normalizeNonEmptyString(url.searchParams.get('branch') || '', 160) || TICK_GITHUB_BRANCH;
  const recordsDir = normalizeRepoPath(url.searchParams.get('recordsDir') || '') || TICK_GITHUB_RECORDS_DIR;

  if (!tokenCandidate || !owner || !repo || !recordsDir) {
    return null;
  }

  return {
    tokenCandidate,
    owner,
    repo,
    branch,
    recordsDir,
  };
}

function buildReminderPushPayload(reminder, nowUnix) {
  const title = normalizeNonEmptyString(reminder.title, 120) || '提醒中心';
  const body = normalizeNonEmptyString(reminder.note, 500) || '提醒已到点，请打开提醒中心确认。';
  return {
    title,
    body,
    tag: `reminder-${reminder.id}`,
    url: '/#/reminder',
    source: 'internal-tick',
    reminderId: reminder.id,
    deviceId: reminder.deviceId,
    triggerAtUnix: reminder.triggerAtUnix,
    triggeredAtUnix: nowUnix,
  };
}

function shouldDisableSubscriptionByError(error) {
  const statusCode = Number(error?.statusCode);
  return statusCode === 404 || statusCode === 410 || statusCode === 403;
}

async function loadEnabledSubscriptionsForDevice({ pat, owner, repo, branch, recordsDir, deviceId }) {
  const directoryPath = buildReminderSubscriptionsDirectoryPath(recordsDir, deviceId);
  const entries = await listGithubDirectoryByPat({
    pat,
    owner,
    repo,
    branch,
    path: directoryPath,
    allowNotFound: true,
  });

  const fileEntries = entries.filter(
    (item) => item && item.type === 'file' && typeof item.path === 'string' && item.path.endsWith('.json'),
  );

  const results = [];
  for (const entry of fileEntries) {
    const fileBody = await fetchGithubFileBodyByPat({
      pat,
      owner,
      repo,
      branch,
      path: entry.path,
      allowNotFound: true,
    });
    if (!fileBody) {
      continue;
    }

    const parsed = parsePushSubscriptionFileContent(fileBody);
    const normalized = normalizeStoredPushSubscriptionRecord(parsed);
    if (!normalized || !normalized.enabled) {
      continue;
    }

    results.push({
      path: entry.path,
      sha: typeof fileBody.sha === 'string' ? fileBody.sha : typeof entry.sha === 'string' ? entry.sha : undefined,
      subscription: normalized,
    });
  }

  return results;
}

async function disableStoredSubscription({
  pat,
  owner,
  repo,
  branch,
  path,
  sha,
  existingSubscription,
  nowUnix,
  reason,
}) {
  const nextPayload = {
    ...existingSubscription,
    schemaVersion: PUSH_SCHEMA_VERSION,
    enabled: false,
    removedAtUnix: nowUnix,
    updatedAtUnix: nowUnix,
    lastError: normalizeNonEmptyString(reason, 500) || 'Push subscription disabled by internal tick.',
  };

  await putGithubFileByPat({
    pat,
    owner,
    repo,
    branch,
    path,
    message: `chore(reminder-push): disable stale subscription ${existingSubscription.id}`,
    content: toBase64Utf8(JSON.stringify(nextPayload, null, 2)),
    sha,
  });
}

async function upsertReminderEntityByPat({
  pat,
  owner,
  repo,
  branch,
  path,
  sha,
  reminder,
  commitMessage,
}) {
  await putGithubFileByPat({
    pat,
    owner,
    repo,
    branch,
    path,
    message: commitMessage,
    content: toBase64Utf8(JSON.stringify(reminder, null, 2)),
    sha,
  });
}

function normalizeErrorMessage(error, fallback = 'Unknown error.') {
  if (error instanceof Error) {
    const message = normalizeNonEmptyString(error.message, 500);
    if (message) {
      return message;
    }
  }
  return fallback;
}

function resolveGithubPatForRequest(tokenCandidate) {
  try {
    return resolveGithubPatToken(tokenCandidate);
  } catch {
    throw new Error('Invalid GitHub token.');
  }
}

async function handlePushVapidPublicKeyRequest(req, res, origin) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    writeJson(res, 405, { ok: false, message: 'Method Not Allowed' }, origin);
    return;
  }

  if (req.method === 'HEAD') {
    writeNoContent(res, origin, 200);
    return;
  }

  if (!pushConfigured || !VAPID_PUBLIC_KEY) {
    writeJson(
      res,
      503,
      {
        ok: false,
        message: 'Push VAPID is not configured.',
      },
      origin,
    );
    return;
  }

  writeJson(
    res,
    200,
    {
      ok: true,
      vapidPublicKey: VAPID_PUBLIC_KEY,
      subject: VAPID_SUBJECT,
    },
    origin,
  );
}

async function handlePushSubscriptionUpsertRequest(req, res, origin) {
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, message: 'Method Not Allowed' }, origin);
    return;
  }

  try {
    const body = await readJsonBody(req, MAX_PUSH_JSON_BODY_BYTES);
    const validated = validatePushSubscriptionUpsertBody(body);
    if (!validated.ok) {
      writeJson(res, 400, { ok: false, message: validated.message }, origin);
      return;
    }

    const pat = resolveGithubPatForRequest(validated.github.tokenCandidate);
    const subscriptionId = makeReminderPushSubscriptionId(validated.subscription.endpoint);
    const nowUnix = Math.floor(Date.now() / 1000);
    const path = buildPushSubscriptionFilePath(validated.github.recordsDir, validated.deviceId, subscriptionId);
    const existingFile = await fetchGithubFileBodyByPat({
      pat,
      owner: validated.github.owner,
      repo: validated.github.repo,
      branch: validated.github.branch,
      path,
      allowNotFound: true,
    });
    const existingPayload = parsePushSubscriptionFileContent(existingFile);
    const payload = {
      schemaVersion: PUSH_SCHEMA_VERSION,
      id: subscriptionId,
      deviceId: validated.deviceId,
      endpoint: validated.subscription.endpoint,
      expirationTime: validated.subscription.expirationTime,
      keys: {
        p256dh: validated.subscription.keys.p256dh,
        auth: validated.subscription.keys.auth,
      },
      enabled: true,
      createdAtUnix: Number.isFinite(Number(existingPayload?.createdAtUnix))
        ? Math.floor(Number(existingPayload.createdAtUnix))
        : nowUnix,
      updatedAtUnix: nowUnix,
      lastSeenAtUnix: nowUnix,
    };
    const content = toBase64Utf8(JSON.stringify(payload, null, 2));

    await putGithubFileByPat({
      pat,
      owner: validated.github.owner,
      repo: validated.github.repo,
      branch: validated.github.branch,
      path,
      message: `chore(reminder-push): upsert subscription ${subscriptionId}`,
      content,
      sha: typeof existingFile?.sha === 'string' ? existingFile.sha : undefined,
    });

    writeJson(
      res,
      200,
      {
        ok: true,
        subscriptionId,
        path,
        updatedAtUnix: nowUnix,
      },
      origin,
    );
  } catch (error) {
    if (error && error.code === 'BODY_TOO_LARGE') {
      writeJson(res, 413, { ok: false, message: 'JSON body too large.' }, origin);
      return;
    }
    if (error && error.code === 'INVALID_JSON') {
      writeJson(res, 400, { ok: false, message: 'Invalid JSON.' }, origin);
      return;
    }
    writeJson(
      res,
      502,
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to upsert push subscription.',
      },
      origin,
    );
  }
}

async function handlePushSubscriptionRemoveRequest(req, res, origin) {
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, message: 'Method Not Allowed' }, origin);
    return;
  }

  try {
    const body = await readJsonBody(req, MAX_PUSH_JSON_BODY_BYTES);
    const validated = validatePushSubscriptionRemoveBody(body);
    if (!validated.ok) {
      writeJson(res, 400, { ok: false, message: validated.message }, origin);
      return;
    }

    const pat = resolveGithubPatForRequest(validated.github.tokenCandidate);
    const nowUnix = Math.floor(Date.now() / 1000);
    const path = buildPushSubscriptionFilePath(validated.github.recordsDir, validated.deviceId, validated.subscriptionId);
    const existingFile = await fetchGithubFileBodyByPat({
      pat,
      owner: validated.github.owner,
      repo: validated.github.repo,
      branch: validated.github.branch,
      path,
      allowNotFound: true,
    });

    if (!existingFile) {
      writeJson(
        res,
        200,
        {
          ok: true,
          removed: false,
          subscriptionId: validated.subscriptionId,
          path,
        },
        origin,
      );
      return;
    }

    const existingPayload = parsePushSubscriptionFileContent(existingFile);
    const nextPayload = {
      ...(existingPayload && typeof existingPayload === 'object' ? existingPayload : {}),
      schemaVersion: PUSH_SCHEMA_VERSION,
      id: validated.subscriptionId,
      deviceId: validated.deviceId,
      endpoint:
        validated.endpoint ||
        (existingPayload && typeof existingPayload.endpoint === 'string' ? existingPayload.endpoint : undefined),
      enabled: false,
      updatedAtUnix: nowUnix,
      removedAtUnix: nowUnix,
    };
    const content = toBase64Utf8(JSON.stringify(nextPayload, null, 2));

    await putGithubFileByPat({
      pat,
      owner: validated.github.owner,
      repo: validated.github.repo,
      branch: validated.github.branch,
      path,
      message: `chore(reminder-push): disable subscription ${validated.subscriptionId}`,
      content,
      sha: typeof existingFile.sha === 'string' ? existingFile.sha : undefined,
    });

    writeJson(
      res,
      200,
      {
        ok: true,
        removed: true,
        subscriptionId: validated.subscriptionId,
        path,
        updatedAtUnix: nowUnix,
      },
      origin,
    );
  } catch (error) {
    if (error && error.code === 'BODY_TOO_LARGE') {
      writeJson(res, 413, { ok: false, message: 'JSON body too large.' }, origin);
      return;
    }
    if (error && error.code === 'INVALID_JSON') {
      writeJson(res, 400, { ok: false, message: 'Invalid JSON.' }, origin);
      return;
    }
    writeJson(
      res,
      502,
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to remove push subscription.',
      },
      origin,
    );
  }
}

async function handlePushTestSendRequest(req, res, origin) {
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, message: 'Method Not Allowed' }, origin);
    return;
  }

  if (!pushConfigured) {
    writeJson(res, 503, { ok: false, message: 'Push VAPID is not configured.' }, origin);
    return;
  }

  try {
    const body = await readJsonBody(req, MAX_PUSH_JSON_BODY_BYTES);
    const validated = validatePushTestSendBody(body);
    if (!validated.ok) {
      writeJson(res, 400, { ok: false, message: validated.message }, origin);
      return;
    }

    const sendResult = await webpush.sendNotification(validated.subscription, JSON.stringify(validated.payload), {
      TTL: 300,
      urgency: 'high',
    });

    writeJson(
      res,
      200,
      {
        ok: true,
        statusCode: sendResult?.statusCode ?? 200,
      },
      origin,
    );
  } catch (error) {
    const statusCode = Number(error?.statusCode);
    writeJson(
      res,
      Number.isFinite(statusCode) && statusCode >= 400 ? statusCode : 502,
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Push test send failed.',
      },
      origin,
    );
  }
}

async function handleReminderUpsertRequest(req, res, origin) {
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, message: 'Method Not Allowed' }, origin);
    return;
  }

  try {
    const body = await readJsonBody(req, MAX_REMINDER_JSON_BODY_BYTES);
    const validated = validateReminderUpsertBody(body);
    if (!validated.ok) {
      writeJson(res, 400, { ok: false, message: validated.message }, origin);
      return;
    }

    const pat = resolveGithubPatForRequest(validated.github.tokenCandidate);
    const nowUnix = Math.floor(Date.now() / 1000);
    const path = buildReminderEntityFilePath(validated.github.recordsDir, validated.reminder.id);
    const existingFile = await fetchGithubFileBodyByPat({
      pat,
      owner: validated.github.owner,
      repo: validated.github.repo,
      branch: validated.github.branch,
      path,
      allowNotFound: true,
    });
    const existingReminder = parseReminderEntityFileContent(existingFile);
    const nextReminder = {
      ...(existingReminder && typeof existingReminder === 'object' ? existingReminder : {}),
      ...validated.reminder,
      schemaVersion: REMINDER_SCHEMA_VERSION,
      id: validated.reminder.id,
      deviceId: validated.deviceId,
      createdAtUnix:
        existingReminder && Number.isFinite(Number(existingReminder.createdAtUnix))
          ? Math.floor(Number(existingReminder.createdAtUnix))
          : validated.reminder.createdAtUnix,
      updatedAtUnix: nowUnix,
      source: 'frontend',
      lastTickAtUnix: Number.isFinite(Number(existingReminder?.lastTickAtUnix))
        ? Math.floor(Number(existingReminder.lastTickAtUnix))
        : undefined,
      retryCount: Number.isFinite(Number(existingReminder?.retryCount)) ? Math.max(0, Math.floor(Number(existingReminder.retryCount))) : 0,
      lastError: undefined,
    };

    if (nextReminder.status === 'fired' && !Number.isFinite(Number(nextReminder.firedAtUnix))) {
      nextReminder.firedAtUnix = nowUnix;
    }
    if (nextReminder.status === 'cancelled' && !Number.isFinite(Number(nextReminder.cancelledAtUnix))) {
      nextReminder.cancelledAtUnix = nowUnix;
    }

    await upsertReminderEntityByPat({
      pat,
      owner: validated.github.owner,
      repo: validated.github.repo,
      branch: validated.github.branch,
      path,
      sha: typeof existingFile?.sha === 'string' ? existingFile.sha : undefined,
      reminder: nextReminder,
      commitMessage: `chore(reminder-push): upsert reminder ${validated.reminder.id}`,
    });

    writeJson(
      res,
      200,
      {
        ok: true,
        reminderId: validated.reminder.id,
        path,
        status: nextReminder.status,
        triggerAtUnix: nextReminder.triggerAtUnix,
        updatedAtUnix: nowUnix,
      },
      origin,
    );
  } catch (error) {
    if (error && error.code === 'BODY_TOO_LARGE') {
      writeJson(res, 413, { ok: false, message: 'JSON body too large.' }, origin);
      return;
    }
    if (error && error.code === 'INVALID_JSON') {
      writeJson(res, 400, { ok: false, message: 'Invalid JSON.' }, origin);
      return;
    }
    writeJson(
      res,
      502,
      {
        ok: false,
        message: normalizeErrorMessage(error, 'Failed to upsert reminder.'),
      },
      origin,
    );
  }
}

async function handleReminderCancelRequest(req, res, origin, reminderIdFromPath = '') {
  if (req.method !== 'PATCH' && req.method !== 'POST') {
    writeJson(res, 405, { ok: false, message: 'Method Not Allowed' }, origin);
    return;
  }

  try {
    const body = await readJsonBody(req, MAX_REMINDER_JSON_BODY_BYTES);
    const validated = validateReminderCancelBody(body, reminderIdFromPath);
    if (!validated.ok) {
      writeJson(res, 400, { ok: false, message: validated.message }, origin);
      return;
    }

    const pat = resolveGithubPatForRequest(validated.github.tokenCandidate);
    const nowUnix = Math.floor(Date.now() / 1000);
    const path = buildReminderEntityFilePath(validated.github.recordsDir, validated.reminderId);
    const existingFile = await fetchGithubFileBodyByPat({
      pat,
      owner: validated.github.owner,
      repo: validated.github.repo,
      branch: validated.github.branch,
      path,
      allowNotFound: true,
    });
    const existingReminder = parseReminderEntityFileContent(existingFile);
    const nextReminder = {
      ...(existingReminder && typeof existingReminder === 'object'
        ? existingReminder
        : {
            schemaVersion: REMINDER_SCHEMA_VERSION,
            id: validated.reminderId,
            deviceId: validated.deviceId,
            kind: 'custom',
            title: '已取消提醒',
            note: undefined,
            durationSeconds: 0,
            triggerAtUnix: nowUnix,
            scheduleMode: 'countdown',
            status: 'pending',
            soundEnabled: true,
            notificationEnabled: true,
            requiresAcknowledgement: false,
            createdAtUnix: nowUnix,
            retryCount: 0,
            source: 'frontend',
          }),
      schemaVersion: REMINDER_SCHEMA_VERSION,
      id: validated.reminderId,
      deviceId: validated.deviceId,
      status: 'cancelled',
      cancelledAtUnix: nowUnix,
      updatedAtUnix: nowUnix,
      source: 'frontend-cancel',
      lastError: undefined,
      lastTickAtUnix: Number.isFinite(Number(existingReminder?.lastTickAtUnix))
        ? Math.floor(Number(existingReminder.lastTickAtUnix))
        : undefined,
      retryCount: Number.isFinite(Number(existingReminder?.retryCount)) ? Math.max(0, Math.floor(Number(existingReminder.retryCount))) : 0,
    };

    await upsertReminderEntityByPat({
      pat,
      owner: validated.github.owner,
      repo: validated.github.repo,
      branch: validated.github.branch,
      path,
      sha: typeof existingFile?.sha === 'string' ? existingFile.sha : undefined,
      reminder: nextReminder,
      commitMessage: `chore(reminder-push): cancel reminder ${validated.reminderId}`,
    });

    writeJson(
      res,
      200,
      {
        ok: true,
        reminderId: validated.reminderId,
        path,
        status: 'cancelled',
        updatedAtUnix: nowUnix,
      },
      origin,
    );
  } catch (error) {
    if (error && error.code === 'BODY_TOO_LARGE') {
      writeJson(res, 413, { ok: false, message: 'JSON body too large.' }, origin);
      return;
    }
    if (error && error.code === 'INVALID_JSON') {
      writeJson(res, 400, { ok: false, message: 'Invalid JSON.' }, origin);
      return;
    }
    writeJson(
      res,
      502,
      {
        ok: false,
        message: normalizeErrorMessage(error, 'Failed to cancel reminder.'),
      },
      origin,
    );
  }
}

async function handleInternalTickRequest(req, res, origin, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    writeJson(res, 405, { ok: false, message: 'Method Not Allowed' }, origin);
    return;
  }

  if (!INTERNAL_TICK_TOKEN) {
    writeJson(res, 503, { ok: false, message: 'INTERNAL_TICK_TOKEN is not configured.' }, origin);
    return;
  }

  const token = normalizeNonEmptyString(url.searchParams.get('token') || '', 512);
  if (!token || token !== INTERNAL_TICK_TOKEN) {
    writeJson(res, 401, { ok: false, message: 'Invalid tick token.' }, origin);
    return;
  }

  if (req.method === 'HEAD') {
    writeNoContent(res, origin, 200);
    return;
  }

  if (!pushConfigured) {
    writeJson(res, 503, { ok: false, message: 'Push VAPID is not configured.' }, origin);
    return;
  }

  const tickGithub = resolveTickGithubContextFromUrl(url);
  if (!tickGithub) {
    writeJson(res, 400, { ok: false, message: 'Tick GitHub context is incomplete.' }, origin);
    return;
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  const summary = {
    nowUnix,
    entityFiles: 0,
    scannedEntities: 0,
    invalidEntities: 0,
    nonPendingEntities: 0,
    futureEntities: 0,
    staleEntities: 0,
    disabledNotificationEntities: 0,
    dueCandidates: 0,
    processed: 0,
    delivered: 0,
    alreadyDelivered: 0,
    failedDeliveries: 0,
    noSubscription: 0,
    updatedReminders: 0,
    updateFailures: 0,
    disabledSubscriptions: 0,
    errors: [],
  };

  try {
    const pat = resolveGithubPatForRequest(tickGithub.tokenCandidate);
    const entitiesDirectoryPath = `${tickGithub.recordsDir}/reminders/entities`;
    const entityEntries = await listGithubDirectoryByPat({
      pat,
      owner: tickGithub.owner,
      repo: tickGithub.repo,
      branch: tickGithub.branch,
      path: entitiesDirectoryPath,
      allowNotFound: true,
    });
    const entityFiles = entityEntries.filter(
      (item) => item && item.type === 'file' && typeof item.path === 'string' && item.path.endsWith('.json'),
    );
    summary.entityFiles = entityFiles.length;

    const dueCandidates = [];
    for (const entry of entityFiles.slice(0, TICK_MAX_ENTITY_FILES)) {
      const fileBody = await fetchGithubFileBodyByPat({
        pat,
        owner: tickGithub.owner,
        repo: tickGithub.repo,
        branch: tickGithub.branch,
        path: entry.path,
        allowNotFound: true,
      });
      if (!fileBody) {
        continue;
      }

      summary.scannedEntities += 1;
      const reminder = parseReminderEntityFileContent(fileBody);
      if (!reminder) {
        summary.invalidEntities += 1;
        continue;
      }
      if (reminder.status !== 'pending') {
        summary.nonPendingEntities += 1;
        continue;
      }
      if (!reminder.notificationEnabled) {
        summary.disabledNotificationEntities += 1;
        continue;
      }
      if (reminder.triggerAtUnix > nowUnix) {
        summary.futureEntities += 1;
        continue;
      }
      if (reminder.triggerAtUnix < nowUnix - TICK_DUE_LOOKBACK_SECONDS) {
        summary.staleEntities += 1;
        continue;
      }

      dueCandidates.push({
        path: entry.path,
        sha: typeof fileBody.sha === 'string' ? fileBody.sha : typeof entry.sha === 'string' ? entry.sha : undefined,
        reminder,
      });
    }

    dueCandidates.sort((a, b) => a.reminder.triggerAtUnix - b.reminder.triggerAtUnix);
    const dueReminders = dueCandidates.slice(0, TICK_MAX_DUE_REMINDERS);
    summary.dueCandidates = dueReminders.length;

    for (const item of dueReminders) {
      summary.processed += 1;

      const deliveryPath = buildReminderDeliveryFilePath(tickGithub.recordsDir, item.reminder.id);
      const existingDeliveryFile = await fetchGithubFileBodyByPat({
        pat,
        owner: tickGithub.owner,
        repo: tickGithub.repo,
        branch: tickGithub.branch,
        path: deliveryPath,
        allowNotFound: true,
      });
      if (existingDeliveryFile && parseReminderDeliveryFileContent(existingDeliveryFile)) {
        summary.alreadyDelivered += 1;
        try {
          await upsertReminderEntityByPat({
            pat,
            owner: tickGithub.owner,
            repo: tickGithub.repo,
            branch: tickGithub.branch,
            path: item.path,
            sha: item.sha,
            reminder: {
              ...item.reminder,
              schemaVersion: REMINDER_SCHEMA_VERSION,
              status: 'fired',
              firedAtUnix: Number.isFinite(Number(item.reminder.firedAtUnix)) ? Math.floor(Number(item.reminder.firedAtUnix)) : nowUnix,
              updatedAtUnix: nowUnix,
              lastTickAtUnix: nowUnix,
              source: 'internal-tick',
            },
            commitMessage: `chore(reminder-push): mark delivered reminder ${item.reminder.id}`,
          });
          summary.updatedReminders += 1;
        } catch (error) {
          summary.updateFailures += 1;
          summary.errors.push(`update-delivered:${item.reminder.id}:${normalizeErrorMessage(error)}`);
        }
        continue;
      }

      const subscriptions = await loadEnabledSubscriptionsForDevice({
        pat,
        owner: tickGithub.owner,
        repo: tickGithub.repo,
        branch: tickGithub.branch,
        recordsDir: tickGithub.recordsDir,
        deviceId: item.reminder.deviceId,
      });
      if (subscriptions.length === 0) {
        summary.noSubscription += 1;
        try {
          await upsertReminderEntityByPat({
            pat,
            owner: tickGithub.owner,
            repo: tickGithub.repo,
            branch: tickGithub.branch,
            path: item.path,
            sha: item.sha,
            reminder: {
              ...item.reminder,
              schemaVersion: REMINDER_SCHEMA_VERSION,
              status: 'failed',
              failedAtUnix: nowUnix,
              updatedAtUnix: nowUnix,
              lastTickAtUnix: nowUnix,
              lastError: 'No enabled push subscriptions for this device.',
              retryCount: Math.max(0, Number(item.reminder.retryCount) || 0) + 1,
              source: 'internal-tick',
            },
            commitMessage: `chore(reminder-push): no subscription for reminder ${item.reminder.id}`,
          });
          summary.updatedReminders += 1;
        } catch (error) {
          summary.updateFailures += 1;
          summary.errors.push(`update-no-subscription:${item.reminder.id}:${normalizeErrorMessage(error)}`);
        }
        continue;
      }

      const payload = buildReminderPushPayload(item.reminder, nowUnix);
      let successCount = 0;
      let failedCount = 0;
      let firstErrorMessage = '';
      const statusCodes = [];
      const failures = [];

      for (const subscriptionEntry of subscriptions) {
        try {
          const sendResult = await webpush.sendNotification(
            {
              endpoint: subscriptionEntry.subscription.endpoint,
              expirationTime: subscriptionEntry.subscription.expirationTime,
              keys: {
                p256dh: subscriptionEntry.subscription.keys.p256dh,
                auth: subscriptionEntry.subscription.keys.auth,
              },
            },
            JSON.stringify(payload),
            {
              TTL: TICK_PUSH_TTL_SECONDS,
              urgency: 'high',
            },
          );
          successCount += 1;
          statusCodes.push(Number(sendResult?.statusCode) || 200);
        } catch (error) {
          failedCount += 1;
          const errorMessage = normalizeErrorMessage(error, 'Push send failed.');
          if (!firstErrorMessage) {
            firstErrorMessage = errorMessage;
          }
          failures.push({
            subscriptionId: subscriptionEntry.subscription.id,
            message: errorMessage,
            statusCode: Number(error?.statusCode) || undefined,
          });

          if (shouldDisableSubscriptionByError(error)) {
            try {
              await disableStoredSubscription({
                pat,
                owner: tickGithub.owner,
                repo: tickGithub.repo,
                branch: tickGithub.branch,
                path: subscriptionEntry.path,
                sha: subscriptionEntry.sha,
                existingSubscription: subscriptionEntry.subscription,
                nowUnix,
                reason: errorMessage,
              });
              summary.disabledSubscriptions += 1;
            } catch (disableError) {
              summary.errors.push(
                `disable-subscription:${subscriptionEntry.subscription.id}:${normalizeErrorMessage(disableError)}`,
              );
            }
          }
        }
      }

      if (successCount > 0) {
        try {
          const existingDeliverySha = typeof existingDeliveryFile?.sha === 'string' ? existingDeliveryFile.sha : undefined;
          await putGithubFileByPat({
            pat,
            owner: tickGithub.owner,
            repo: tickGithub.repo,
            branch: tickGithub.branch,
            path: deliveryPath,
            message: `chore(reminder-push): delivery ${item.reminder.id}`,
            content: toBase64Utf8(
              JSON.stringify(
                {
                  schemaVersion: REMINDER_DELIVERY_SCHEMA_VERSION,
                  reminderId: item.reminder.id,
                  deviceId: item.reminder.deviceId,
                  channel: 'push',
                  sentAtUnix: nowUnix,
                  attemptedSubscriptions: subscriptions.length,
                  successSubscriptions: successCount,
                  failedSubscriptions: failedCount,
                  statusCodes,
                  failures,
                },
                null,
                2,
              ),
            ),
            sha: existingDeliverySha,
          });
        } catch (error) {
          summary.errors.push(`write-delivery:${item.reminder.id}:${normalizeErrorMessage(error)}`);
        }

        try {
          await upsertReminderEntityByPat({
            pat,
            owner: tickGithub.owner,
            repo: tickGithub.repo,
            branch: tickGithub.branch,
            path: item.path,
            sha: item.sha,
            reminder: {
              ...item.reminder,
              schemaVersion: REMINDER_SCHEMA_VERSION,
              status: 'fired',
              firedAtUnix: nowUnix,
              updatedAtUnix: nowUnix,
              lastTickAtUnix: nowUnix,
              lastError: undefined,
              source: 'internal-tick',
            },
            commitMessage: `chore(reminder-push): fire reminder ${item.reminder.id}`,
          });
          summary.updatedReminders += 1;
          summary.delivered += 1;
        } catch (error) {
          summary.updateFailures += 1;
          summary.errors.push(`update-fired:${item.reminder.id}:${normalizeErrorMessage(error)}`);
        }
      } else {
        summary.failedDeliveries += 1;
        try {
          await upsertReminderEntityByPat({
            pat,
            owner: tickGithub.owner,
            repo: tickGithub.repo,
            branch: tickGithub.branch,
            path: item.path,
            sha: item.sha,
            reminder: {
              ...item.reminder,
              schemaVersion: REMINDER_SCHEMA_VERSION,
              status: 'pending',
              updatedAtUnix: nowUnix,
              lastTickAtUnix: nowUnix,
              lastError: firstErrorMessage || 'Push delivery failed.',
              retryCount: Math.max(0, Number(item.reminder.retryCount) || 0) + 1,
              source: 'internal-tick',
            },
            commitMessage: `chore(reminder-push): retry reminder ${item.reminder.id}`,
          });
          summary.updatedReminders += 1;
        } catch (error) {
          summary.updateFailures += 1;
          summary.errors.push(`update-retry:${item.reminder.id}:${normalizeErrorMessage(error)}`);
        }
      }
    }

    writeJson(
      res,
      200,
      {
        ok: true,
        ...summary,
      },
      origin,
    );
  } catch (error) {
    writeJson(
      res,
      502,
      {
        ok: false,
        message: normalizeErrorMessage(error, 'Internal tick failed.'),
        ...summary,
      },
      origin,
    );
  }
}

function validateSealRequestBody(body) {
  const pat = normalizeNonEmptyString(body?.pat, 2048);
  if (!pat) {
    return {
      ok: false,
      message: 'Invalid PAT.',
    };
  }

  return {
    ok: true,
    pat,
  };
}

function validateGithubProxyBody(body, requirePayload = false) {
  const sealedToken = normalizeNonEmptyString(body?.sealedToken, 8192);
  const owner = normalizeNonEmptyString(body?.owner, 120);
  const repo = normalizeNonEmptyString(body?.repo, 120);
  const branch = normalizeNonEmptyString(body?.branch, 160);
  const path = normalizeRepoPath(body?.path);

  if (!sealedToken || !owner || !repo || !path) {
    return {
      ok: false,
      message: 'Invalid GitHub proxy request.',
    };
  }

  if (!requirePayload) {
    return {
      ok: true,
      sealedToken,
      owner,
      repo,
      branch,
      path,
    };
  }

  const payload = body?.payload;
  if (!payload || typeof payload !== 'object') {
    return {
      ok: false,
      message: 'Invalid GitHub payload.',
    };
  }

  const message = normalizeNonEmptyString(payload.message, 300);
  const content = typeof payload.content === 'string' ? payload.content : '';
  const sha = normalizeNonEmptyString(payload.sha, 120);
  const payloadBranch = normalizeNonEmptyString(payload.branch, 160);

  if (!message || !content.trim()) {
    return {
      ok: false,
      message: 'Invalid GitHub payload.',
    };
  }

  return {
    ok: true,
    sealedToken,
    owner,
    repo,
    branch,
    path,
    payload: {
      message,
      content,
      sha: sha || undefined,
      branch: payloadBranch || undefined,
    },
  };
}

async function handleTokenSealRequest(req, res, origin) {
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, message: 'Method Not Allowed' }, origin);
    return;
  }

  if (!PAT_WRAP_KEY) {
    writeJson(res, 503, { ok: false, message: 'PAT sealing is not configured.' }, origin);
    return;
  }

  try {
    const body = await readJsonBody(req, MAX_SEAL_JSON_BODY_BYTES);
    const validated = validateSealRequestBody(body);
    if (!validated.ok) {
      writeJson(res, 400, { ok: false, message: validated.message }, origin);
      return;
    }

    const sealedToken = sealPatToken(validated.pat);
    writeJson(
      res,
      200,
      {
        ok: true,
        keyVersion: PAT_WRAP_KEY_VERSION,
        sealedToken,
      },
      origin,
    );
  } catch (error) {
    if (error && error.code === 'BODY_TOO_LARGE') {
      writeJson(res, 413, { ok: false, message: 'JSON body too large.' }, origin);
      return;
    }
    if (error && error.code === 'INVALID_JSON') {
      writeJson(res, 400, { ok: false, message: 'Invalid JSON.' }, origin);
      return;
    }
    writeJson(res, 500, { ok: false, message: 'Failed to seal token.' }, origin);
  }
}

async function handleGithubContentsProxyRequest(req, res, origin, mode) {
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, message: 'Method Not Allowed' }, origin);
    return;
  }

  if (!PAT_WRAP_KEY) {
    writeJson(res, 503, { ok: false, message: 'GitHub proxy is not configured.' }, origin);
    return;
  }

  try {
    const body = await readJsonBody(req, MAX_GITHUB_PROXY_BODY_BYTES);
    const validated = validateGithubProxyBody(body, mode === 'put');
    if (!validated.ok) {
      writeJson(res, 400, { ok: false, message: validated.message }, origin);
      return;
    }

    let pat = '';
    try {
      pat = unsealPatToken(validated.sealedToken);
    } catch {
      writeJson(res, 400, { ok: false, message: 'Invalid sealed token.' }, origin);
      return;
    }

    const result = await proxyGithubContentsRequest({
      method: mode === 'put' ? 'PUT' : 'GET',
      pat,
      owner: validated.owner,
      repo: validated.repo,
      branch: validated.branch,
      path: validated.path,
      payload: mode === 'put' ? validated.payload : undefined,
    });
    writeJson(res, result.status, result.body, origin);
  } catch (error) {
    if (error && error.code === 'BODY_TOO_LARGE') {
      writeJson(res, 413, { ok: false, message: 'JSON body too large.' }, origin);
      return;
    }
    if (error && error.code === 'INVALID_JSON') {
      writeJson(res, 400, { ok: false, message: 'Invalid JSON.' }, origin);
      return;
    }
    writeJson(res, 502, { ok: false, message: 'GitHub proxy request failed.' }, origin);
  }
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  const host = req.headers.host || `127.0.0.1:${listeningPort}`;

  if (!req.url || !req.method) {
    writeJson(res, 400, { ok: false, message: 'Invalid request.' }, origin);
    return;
  }

  let pathname = '/';
  let requestUrl = null;

  try {
    requestUrl = new URL(req.url, `http://${host}`);
    pathname = requestUrl.pathname;
  } catch {
    writeJson(res, 400, { ok: false, message: 'Malformed URL.' }, origin);
    return;
  }

  if (req.method === 'OPTIONS') {
    writeNoContent(res, origin);
    return;
  }

  if (pathname === '/healthz') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      writeJson(res, 405, { ok: false, message: 'Method Not Allowed' }, origin);
      return;
    }

    if (req.method === 'HEAD') {
      writeNoContent(res, origin, 200);
      return;
    }

    writeJson(
      res,
      200,
      {
        ...getRuntimeStatus(),
        health: 'ok',
      },
      origin,
    );
    return;
  }

  if (pathname === '/api/ping') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      writeJson(res, 405, { ok: false, message: 'Method Not Allowed' }, origin);
      return;
    }

    if (req.method === 'HEAD') {
      writeNoContent(res, origin, 200);
      return;
    }

    writeJson(res, 200, getRuntimeStatus(), origin);
    return;
  }

  if (pathname === '/api/token/seal') {
    void handleTokenSealRequest(req, res, origin);
    return;
  }

  if (pathname === '/api/push/vapid-public-key') {
    void handlePushVapidPublicKeyRequest(req, res, origin);
    return;
  }

  if (pathname === '/api/push/subscriptions/upsert') {
    void handlePushSubscriptionUpsertRequest(req, res, origin);
    return;
  }

  if (pathname === '/api/push/subscriptions/remove') {
    void handlePushSubscriptionRemoveRequest(req, res, origin);
    return;
  }

  if (pathname === '/api/push/test-send') {
    void handlePushTestSendRequest(req, res, origin);
    return;
  }

  if (pathname === '/api/reminders' || pathname === '/api/reminders/upsert') {
    void handleReminderUpsertRequest(req, res, origin);
    return;
  }

  if (pathname === '/internal/tick') {
    void handleInternalTickRequest(req, res, origin, requestUrl);
    return;
  }

  const reminderCancelMatch = pathname.match(/^\/api\/reminders\/([^/]+)\/cancel$/);
  if (reminderCancelMatch) {
    let reminderId = '';
    try {
      reminderId = decodeURIComponent(reminderCancelMatch[1]);
    } catch {
      writeJson(res, 400, { ok: false, message: 'Invalid reminder id.' }, origin);
      return;
    }
    void handleReminderCancelRequest(req, res, origin, reminderId);
    return;
  }

  if (pathname === '/api/github/contents/get') {
    void handleGithubContentsProxyRequest(req, res, origin, 'get');
    return;
  }

  if (pathname === '/api/github/contents/list') {
    void handleGithubContentsProxyRequest(req, res, origin, 'list');
    return;
  }

  if (pathname === '/api/github/contents/put') {
    void handleGithubContentsProxyRequest(req, res, origin, 'put');
    return;
  }

  writeJson(
    res,
    404,
    {
      ok: false,
      message: 'Not Found',
      path: pathname,
    },
    origin,
  );
});

function listenOnPort(port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };

    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

async function startServer() {
  let port = REQUESTED_PORT;
  let fallbackSteps = 0;

  while (fallbackSteps <= MAX_PORT_FALLBACK_STEPS) {
    try {
      await listenOnPort(port);
      listeningPort = port;
      const fallbackUsed = port !== REQUESTED_PORT;

      console.log(`[${SERVICE_NAME}] listening on port ${port}`);
      console.log(`[${SERVICE_NAME}] cors origins: ${CORS_ORIGINS.join(', ')}`);
      console.log(`[${SERVICE_NAME}] pat sealing: ${PAT_WRAP_KEY ? `enabled (${PAT_WRAP_KEY_VERSION})` : 'disabled'}`);
      console.log(`[${SERVICE_NAME}] push vapid: ${pushConfigured ? 'enabled' : 'disabled'}`);
      console.log(`[${SERVICE_NAME}] internal tick token: ${INTERNAL_TICK_TOKEN ? 'configured' : 'missing'}`);
      console.log(
        `[${SERVICE_NAME}] internal tick github defaults: ${
          TICK_GITHUB_TOKEN && TICK_GITHUB_OWNER && TICK_GITHUB_REPO && TICK_GITHUB_RECORDS_DIR ? 'configured' : 'missing'
        }`,
      );
      if (fallbackUsed) {
        console.warn(`[${SERVICE_NAME}] requested port ${REQUESTED_PORT} is busy, fallback to ${port}`);
      }
      return;
    } catch (error) {
      if (error && error.code === 'EADDRINUSE') {
        if (ENABLE_PORT_FALLBACK && fallbackSteps < MAX_PORT_FALLBACK_STEPS) {
          fallbackSteps += 1;
          port += 1;
          continue;
        }

        console.error(`[${SERVICE_NAME}] port ${port} is already in use.`);
        console.error(`[${SERVICE_NAME}] hint: set PORT to another value, or stop existing process using this port.`);
        process.exitCode = 1;
        return;
      }

      console.error(`[${SERVICE_NAME}] failed to start server:`, error);
      process.exitCode = 1;
      return;
    }
  }

  console.error(`[${SERVICE_NAME}] failed to find available port after ${MAX_PORT_FALLBACK_STEPS} fallback attempts.`);
  process.exitCode = 1;
}

void startServer();
