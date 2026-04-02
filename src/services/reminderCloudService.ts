import { resolveReminderBackendBaseUrl } from './reminderBackendUrlService';
import type { AppConfig } from '../types/config';
import type { ReminderTask } from '../types/reminder';

export interface ReminderGithubContext {
  githubToken: string;
  owner: string;
  repo: string;
  branch?: string;
  recordsDir: string;
}

export interface ReminderCloudSyncResult {
  reminderId: string;
  path: string;
  status: string;
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
    throw new Error('Reminder backend base URL is not configured.');
  }
  return resolved;
}

function normalizeGithubContext(context: ReminderGithubContext): ReminderGithubContext {
  const githubToken = context.githubToken.trim();
  const owner = context.owner.trim();
  const repo = context.repo.trim();
  const branch = context.branch?.trim();
  const recordsDir = context.recordsDir.trim().replace(/^\/+|\/+$/g, '');

  if (!githubToken || !owner || !repo || !recordsDir) {
    throw new Error('GitHub sync context is incomplete.');
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
  return `Request failed (HTTP ${response.status}).`;
}

async function parseResponseOrThrow<T>(response: Response, fallbackMessage: string): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: unknown } & T;
  if (!response.ok || body.ok !== true) {
    const message = typeof body.message === 'string' && body.message.trim() ? body.message.trim() : fallbackMessage;
    throw new Error(message);
  }
  return body;
}

function serializeReminderTask(task: ReminderTask): Record<string, unknown> {
  return {
    id: task.id,
    kind: task.kind,
    title: task.title,
    note: task.note,
    durationSeconds: task.durationSeconds,
    triggerAtUnix: task.triggerAtUnix,
    scheduleMode: task.scheduleMode,
    repeatWeekdays: task.repeatWeekdays,
    createdAtUnix: task.createdAtUnix,
    updatedAtUnix: task.updatedAtUnix,
    status: task.status,
    soundEnabled: task.soundEnabled,
    notificationEnabled: task.notificationEnabled,
    firedAtUnix: task.firedAtUnix,
    requiresAcknowledgement: task.requiresAcknowledgement,
    acknowledgedAtUnix: task.acknowledgedAtUnix,
    cancelledAtUnix: task.cancelledAtUnix,
  };
}

export async function upsertReminderToCloud(
  config: Pick<AppConfig, 'reminderApiBaseUrl' | 'reminderApiFallbackBaseUrl'>,
  githubContextRaw: ReminderGithubContext,
  deviceId: string,
  task: ReminderTask,
): Promise<ReminderCloudSyncResult> {
  const backendBaseUrl = resolveBackendBaseUrl(config);
  const githubContext = normalizeGithubContext(githubContextRaw);
  const normalizedDeviceId = deviceId.trim();
  if (!normalizedDeviceId) {
    throw new Error('Device ID is invalid.');
  }

  const response = await fetch(`${backendBaseUrl}/api/reminders/upsert`, {
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
      reminder: serializeReminderTask(task),
    }),
  });

  const payload = await parseResponseOrThrow<{
    reminderId?: unknown;
    path?: unknown;
    status?: unknown;
    updatedAtUnix?: unknown;
  }>(response, parseJsonErrorFallback(response));

  const reminderId = typeof payload.reminderId === 'string' ? payload.reminderId.trim() : '';
  const path = typeof payload.path === 'string' ? payload.path.trim() : '';
  const status = typeof payload.status === 'string' ? payload.status.trim() : '';
  const updatedAtUnix = Number(payload.updatedAtUnix);
  if (!reminderId || !path || !status || !Number.isFinite(updatedAtUnix)) {
    throw new Error('Invalid reminder upsert result from backend.');
  }

  return {
    reminderId,
    path,
    status,
    updatedAtUnix: Math.floor(updatedAtUnix),
  };
}

export async function cancelReminderInCloud(
  config: Pick<AppConfig, 'reminderApiBaseUrl' | 'reminderApiFallbackBaseUrl'>,
  githubContextRaw: ReminderGithubContext,
  deviceId: string,
  reminderIdRaw: string,
): Promise<ReminderCloudSyncResult> {
  const backendBaseUrl = resolveBackendBaseUrl(config);
  const githubContext = normalizeGithubContext(githubContextRaw);
  const normalizedDeviceId = deviceId.trim();
  const reminderId = reminderIdRaw.trim();
  if (!normalizedDeviceId || !reminderId) {
    throw new Error('Reminder cancel parameters are invalid.');
  }

  const response = await fetch(`${backendBaseUrl}/api/reminders/${encodeURIComponent(reminderId)}/cancel`, {
    method: 'PATCH',
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
      reminderId,
    }),
  });

  const payload = await parseResponseOrThrow<{
    reminderId?: unknown;
    path?: unknown;
    status?: unknown;
    updatedAtUnix?: unknown;
  }>(response, parseJsonErrorFallback(response));

  const resolvedReminderId = typeof payload.reminderId === 'string' ? payload.reminderId.trim() : '';
  const path = typeof payload.path === 'string' ? payload.path.trim() : '';
  const status = typeof payload.status === 'string' ? payload.status.trim() : '';
  const updatedAtUnix = Number(payload.updatedAtUnix);
  if (!resolvedReminderId || !path || !status || !Number.isFinite(updatedAtUnix)) {
    throw new Error('Invalid reminder cancel result from backend.');
  }

  return {
    reminderId: resolvedReminderId,
    path,
    status,
    updatedAtUnix: Math.floor(updatedAtUnix),
  };
}
