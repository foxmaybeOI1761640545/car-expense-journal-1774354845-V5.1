import { resolveReminderBackendBaseUrl } from './reminderBackendUrlService';
import type { AppConfig } from '../types/config';

export interface ReminderPushGithubContext {
  githubToken: string;
  owner: string;
  repo: string;
  branch?: string;
  recordsDir: string;
}

export interface ReminderPushSubscriptionPayload {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface ReminderPushSubscriptionSyncResult {
  subscriptionId: string;
  path: string;
  updatedAtUnix: number;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function resolveAbsoluteBaseUrl(baseUrl: string): string {
  if (/^https?:\/\//i.test(baseUrl)) {
    return baseUrl;
  }
  return `http://${baseUrl}`;
}

function resolveBackendBaseUrl(config: Pick<AppConfig, 'reminderApiBaseUrl' | 'reminderApiFallbackBaseUrl'>): string {
  const value = normalizeBaseUrl(resolveReminderBackendBaseUrl(config));
  if (!value) {
    throw new Error('Reminder backend base URL is not configured.');
  }
  const resolved = normalizeBaseUrl(resolveAbsoluteBaseUrl(value));
  if (!resolved) {
    throw new Error('提醒后端地址未配置。');
  }
  return resolved;
}

function normalizeGithubContext(context: ReminderPushGithubContext): ReminderPushGithubContext {
  const githubToken = context.githubToken.trim();
  const owner = context.owner.trim();
  const repo = context.repo.trim();
  const branch = context.branch?.trim();
  const recordsDir = context.recordsDir.trim().replace(/^\/+|\/+$/g, '');

  if (!githubToken || !owner || !repo || !recordsDir) {
    throw new Error('GitHub 推送同步配置不完整。');
  }

  return {
    githubToken,
    owner,
    repo,
    branch: branch || undefined,
    recordsDir,
  };
}

function parseJsonErrorFallback(response: Response): string {
  return `请求失败（HTTP ${response.status}）。`;
}

async function parseResponseOrThrow<T>(response: Response, fallbackMessage: string): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: unknown } & T;
  if (!response.ok || body.ok !== true) {
    const message = typeof body.message === 'string' && body.message.trim() ? body.message.trim() : fallbackMessage;
    throw new Error(message);
  }
  return body;
}

export function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const normalized = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : `${normalized}${'='.repeat(4 - padding)}`;
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export function serializePushSubscription(subscription: PushSubscription): ReminderPushSubscriptionPayload {
  const json = subscription.toJSON();
  const endpoint = typeof json.endpoint === 'string' ? json.endpoint : '';
  const p256dh = typeof json.keys?.p256dh === 'string' ? json.keys.p256dh : '';
  const auth = typeof json.keys?.auth === 'string' ? json.keys.auth : '';
  const expirationTime =
    json.expirationTime === null || json.expirationTime === undefined
      ? null
      : Number.isFinite(Number(json.expirationTime))
        ? Math.floor(Number(json.expirationTime))
        : null;

  if (!endpoint || !p256dh || !auth) {
    throw new Error('无法序列化 Push 订阅信息。');
  }

  return {
    endpoint,
    expirationTime,
    keys: {
      p256dh,
      auth,
    },
  };
}

export async function fetchReminderPushVapidPublicKey(
  config: Pick<AppConfig, 'reminderApiBaseUrl' | 'reminderApiFallbackBaseUrl'>,
): Promise<string> {
  const backendBaseUrl = resolveBackendBaseUrl(config);
  const response = await fetch(`${backendBaseUrl}/api/push/vapid-public-key`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  const payload = (await parseResponseOrThrow<{ vapidPublicKey?: unknown }>(response, parseJsonErrorFallback(response))) ?? {};
  const key = typeof payload.vapidPublicKey === 'string' ? payload.vapidPublicKey.trim() : '';
  if (!key) {
    throw new Error('后端未返回有效的 VAPID 公钥。');
  }
  return key;
}

export async function upsertReminderPushSubscription(
  config: Pick<AppConfig, 'reminderApiBaseUrl' | 'reminderApiFallbackBaseUrl'>,
  githubContextRaw: ReminderPushGithubContext,
  deviceId: string,
  subscription: ReminderPushSubscriptionPayload,
): Promise<ReminderPushSubscriptionSyncResult> {
  const backendBaseUrl = resolveBackendBaseUrl(config);
  const githubContext = normalizeGithubContext(githubContextRaw);
  const normalizedDeviceId = deviceId.trim();
  if (!normalizedDeviceId) {
    throw new Error('设备 ID 无效。');
  }

  const response = await fetch(`${backendBaseUrl}/api/push/subscriptions/upsert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sealedToken: githubContext.githubToken,
      owner: githubContext.owner,
      repo: githubContext.repo,
      branch: githubContext.branch,
      recordsDir: githubContext.recordsDir,
      deviceId: normalizedDeviceId,
      subscription,
    }),
  });

  const payload = await parseResponseOrThrow<{ subscriptionId?: unknown; path?: unknown; updatedAtUnix?: unknown }>(
    response,
    parseJsonErrorFallback(response),
  );

  const subscriptionId = typeof payload.subscriptionId === 'string' ? payload.subscriptionId.trim() : '';
  const path = typeof payload.path === 'string' ? payload.path.trim() : '';
  const updatedAtUnix = Number(payload.updatedAtUnix);
  if (!subscriptionId || !path || !Number.isFinite(updatedAtUnix)) {
    throw new Error('后端返回的订阅同步结果无效。');
  }

  return {
    subscriptionId,
    path,
    updatedAtUnix: Math.floor(updatedAtUnix),
  };
}

export async function removeReminderPushSubscription(
  config: Pick<AppConfig, 'reminderApiBaseUrl' | 'reminderApiFallbackBaseUrl'>,
  githubContextRaw: ReminderPushGithubContext,
  deviceId: string,
  payload: { subscriptionId?: string; endpoint?: string },
): Promise<{ removed: boolean; subscriptionId: string; path: string }> {
  const backendBaseUrl = resolveBackendBaseUrl(config);
  const githubContext = normalizeGithubContext(githubContextRaw);
  const normalizedDeviceId = deviceId.trim();
  const subscriptionId = payload.subscriptionId?.trim();
  const endpoint = payload.endpoint?.trim();

  if (!normalizedDeviceId || (!subscriptionId && !endpoint)) {
    throw new Error('订阅移除参数无效。');
  }

  const response = await fetch(`${backendBaseUrl}/api/push/subscriptions/remove`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sealedToken: githubContext.githubToken,
      owner: githubContext.owner,
      repo: githubContext.repo,
      branch: githubContext.branch,
      recordsDir: githubContext.recordsDir,
      deviceId: normalizedDeviceId,
      subscriptionId,
      endpoint,
    }),
  });

  const body = await parseResponseOrThrow<{ removed?: unknown; subscriptionId?: unknown; path?: unknown }>(
    response,
    parseJsonErrorFallback(response),
  );
  const resolvedSubscriptionId = typeof body.subscriptionId === 'string' ? body.subscriptionId.trim() : '';
  const path = typeof body.path === 'string' ? body.path.trim() : '';
  if (!resolvedSubscriptionId || !path) {
    throw new Error('后端返回的订阅移除结果无效。');
  }

  return {
    removed: body.removed === true,
    subscriptionId: resolvedSubscriptionId,
    path,
  };
}

export async function sendReminderPushTest(
  config: Pick<AppConfig, 'reminderApiBaseUrl' | 'reminderApiFallbackBaseUrl'>,
  subscription: ReminderPushSubscriptionPayload,
): Promise<void> {
  const backendBaseUrl = resolveBackendBaseUrl(config);

  const response = await fetch(`${backendBaseUrl}/api/push/test-send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      subscription,
      title: '提醒中心测试通知',
      message: '这是一条锁屏通知测试消息。',
      tag: 'reminder-push-test',
      url: '/#/reminder',
    }),
  });

  await parseResponseOrThrow(response, parseJsonErrorFallback(response));
}
