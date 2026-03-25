import type { AppConfig } from '../types/config';
import type { AvatarStyle } from '../types/profile';
import type { AppRecord } from '../types/records';
import type { FuelBalanceAdjustmentLog } from '../types/store';
import { nowUnixSeconds } from '../utils/date';

interface GithubSubmitResult {
  path: string;
  sha?: string;
}

interface GithubErrorBody {
  message?: string;
}

interface GithubContentItem {
  type: string;
  path: string;
  name: string;
}

interface GithubContentFileBody {
  content?: string;
  encoding?: string;
  sha?: string;
}

interface FuelBalanceAdjustmentGithubEntry {
  id: string;
  source: 'manual' | 'records';
  recordedAt: string;
  recordedAtUnix: number;
  balanceChangedAt: string;
  balanceChangedAtUnix: number;
  remainingFuelLiters: number | null;
  autoCalculatedFuelLiters: number | null;
  manualOffsetLiters: number;
}

const LEGACY_FUEL_BALANCE_ADJUSTMENTS_FILE = 'fuel-balance-adjustments.json';
const FUEL_BALANCE_ADJUSTMENTS_DIR = 'fuel-balance-adjustments';
const USER_PROFILE_DIR = 'user-profile';
const USER_AVATAR_DIR = 'avatars';
const USER_PROFILE_FILE = 'profile.json';

export interface GithubUserProfilePayload {
  displayName: string;
  email?: string;
  phone?: string;
  location?: string;
  bio?: string;
  avatarStyle: AvatarStyle;
  avatarPath?: string;
  avatarMimeType?: string;
  avatarUpdatedAt?: string;
  updatedAt: string;
}

export interface GithubFetchedUserProfile {
  path: string;
  profile: GithubUserProfilePayload;
}

function toBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.slice(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function fromBase64Utf8(value: string): string {
  const binary = atob(value.replace(/[\r\n]/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function normalizeRecordsDir(dir: string): string {
  return dir.replace(/^\/+|\/+$/g, '');
}

function encodeContentPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function validateGithubConfig(config: AppConfig, token: string): void {
  const requiredFields: Array<keyof AppConfig> = ['githubOwner', 'githubRepo', 'githubRecordsDir'];
  const missing = requiredFields.filter((field) => !String(config[field] ?? '').trim());

  if (missing.length > 0 || !token.trim()) {
    throw new Error('GitHub 配置不完整，请先在首页设置 owner/repo/token/recordsDir。');
  }
}

function makeGithubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function makeGithubEndpoint(config: AppConfig, path: string): string {
  return `https://api.github.com/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubRepo)}/contents/${encodeContentPath(path)}`;
}

function makeRefQuery(config: AppConfig): string {
  const branch = config.githubBranch.trim();
  return branch ? `?ref=${encodeURIComponent(branch)}` : '';
}

function makePutPayload(base: { message: string; content: string; sha?: string }, config: AppConfig): {
  message: string;
  content: string;
  sha?: string;
  branch?: string;
} {
  const payload: {
    message: string;
    content: string;
    sha?: string;
    branch?: string;
  } = {
    message: base.message,
    content: base.content,
  };

  if (base.sha) {
    payload.sha = base.sha;
  }

  const branch = config.githubBranch.trim();
  if (branch) {
    payload.branch = branch;
  }

  return payload;
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeAvatarStyle(value: unknown): AvatarStyle {
  return value === 'square' ? 'square' : 'round';
}

function normalizeRecordPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === 'object') {
    const maybeWithRecords = value as { records?: unknown };

    if (Array.isArray(maybeWithRecords.records)) {
      return maybeWithRecords.records;
    }

    return [value];
  }

  return [];
}

function normalizeFuelBalanceAdjustmentPayload(value: unknown): FuelBalanceAdjustmentGithubEntry[] {
  let candidates: unknown[] = [];

  if (Array.isArray(value)) {
    candidates = value;
  } else if (value && typeof value === 'object') {
    const maybeWithAdjustments = value as { adjustments?: unknown };
    if (Array.isArray(maybeWithAdjustments.adjustments)) {
      candidates = maybeWithAdjustments.adjustments;
    }
  }

  return candidates
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const value = item as Partial<FuelBalanceAdjustmentGithubEntry>;
      const remainingFuelLiters =
        value.remainingFuelLiters === null ? null : Number.isFinite(value.remainingFuelLiters) ? Number(value.remainingFuelLiters) : undefined;
      const autoCalculatedFuelLiters =
        value.autoCalculatedFuelLiters === null
          ? null
          : Number.isFinite(value.autoCalculatedFuelLiters)
            ? Number(value.autoCalculatedFuelLiters)
            : undefined;

      if (
        typeof value.id !== 'string' ||
        (value.source !== undefined && value.source !== 'manual' && value.source !== 'records') ||
        typeof value.recordedAt !== 'string' ||
        !Number.isFinite(value.recordedAtUnix) ||
        typeof value.balanceChangedAt !== 'string' ||
        !Number.isFinite(value.balanceChangedAtUnix) ||
        remainingFuelLiters === undefined ||
        autoCalculatedFuelLiters === undefined ||
        !Number.isFinite(value.manualOffsetLiters)
      ) {
        return null;
      }

      return {
        id: value.id,
        source: value.source === 'records' ? 'records' : 'manual',
        recordedAt: value.recordedAt,
        recordedAtUnix: Number(value.recordedAtUnix),
        balanceChangedAt: value.balanceChangedAt,
        balanceChangedAtUnix: Number(value.balanceChangedAtUnix),
        remainingFuelLiters,
        autoCalculatedFuelLiters,
        manualOffsetLiters: Number(value.manualOffsetLiters),
      };
    })
    .filter((item): item is FuelBalanceAdjustmentGithubEntry => item !== null);
}

function toFuelBalanceAdjustmentGithubEntry(log: FuelBalanceAdjustmentLog): FuelBalanceAdjustmentGithubEntry {
  return {
    id: log.id,
    source: log.source,
    recordedAt: log.recordedAt,
    recordedAtUnix: log.recordedAtUnix,
    balanceChangedAt: log.balanceChangedAt,
    balanceChangedAtUnix: log.balanceChangedAtUnix,
    remainingFuelLiters: log.remainingFuelLiters,
    autoCalculatedFuelLiters: log.autoCalculatedFuelLiters,
    manualOffsetLiters: log.manualOffsetLiters,
  };
}

export async function submitRecordToGithub(record: AppRecord, config: AppConfig, token: string): Promise<GithubSubmitResult> {
  validateGithubConfig(config, token);

  const unixTime = nowUnixSeconds();
  const recordsDir = normalizeRecordsDir(config.githubRecordsDir);
  const path = `${recordsDir}/${unixTime}-${record.id}.json`;
  const endpoint = makeGithubEndpoint(config, path);

  const payload: {
    message: string;
    content: string;
    branch?: string;
  } = {
    message: `chore(records): add ${record.type} record ${unixTime}`,
    content: toBase64Utf8(JSON.stringify(record, null, 2)),
  };

  const branch = config.githubBranch.trim();
  if (branch) {
    payload.branch = branch;
  }

  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: makeGithubHeaders(token),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as GithubErrorBody;
    const message = body.message ?? `HTTP ${response.status}`;
    const lowerMessage = message.toLowerCase();
    const conflict =
      (response.status === 409 || response.status === 422) &&
      (lowerMessage.includes('exist') || (lowerMessage.includes('sha') && lowerMessage.includes('suppl')));

    if (conflict) {
      throw new Error('同一秒内重复提交，请稍后重试');
    }

    throw new Error(`GitHub 提交失败：${message}`);
  }

  const data = (await response.json()) as { content?: { path?: string; sha?: string } };

  return {
    path: data.content?.path ?? path,
    sha: data.content?.sha,
  };
}

async function fetchGithubJson<T>(endpoint: string, token: string): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: makeGithubHeaders(token),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as GithubErrorBody;
    const message = body.message ?? `HTTP ${response.status}`;
    throw new Error(`GitHub 读取失败：${message}`);
  }

  return (await response.json()) as T;
}

async function fetchGithubFileBody(
  config: AppConfig,
  token: string,
  path: string,
  options: { allowNotFound?: boolean } = {},
): Promise<GithubContentFileBody | null> {
  const refQuery = makeRefQuery(config);
  const endpoint = `${makeGithubEndpoint(config, path)}${refQuery}`;
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: makeGithubHeaders(token),
  });

  if (response.status === 404 && options.allowNotFound) {
    return null;
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as GithubErrorBody;
    const message = body.message ?? `HTTP ${response.status}`;
    throw new Error(`GitHub 读取失败：${message}`);
  }

  return (await response.json()) as GithubContentFileBody;
}

export async function fetchRecordsFromGithub(config: AppConfig, token: string): Promise<unknown[]> {
  validateGithubConfig(config, token);

  const recordsDir = normalizeRecordsDir(config.githubRecordsDir);
  const refQuery = makeRefQuery(config);
  const listEndpoint = `${makeGithubEndpoint(config, recordsDir)}${refQuery}`;
  const listBody = await fetchGithubJson<GithubContentItem[] | GithubContentItem>(listEndpoint, token);
  const items = Array.isArray(listBody) ? listBody : [listBody];

  const jsonFiles = items
    .filter(
      (item) =>
        item.type === 'file' &&
        item.name.toLowerCase().endsWith('.json') &&
        item.name.toLowerCase() !== LEGACY_FUEL_BALANCE_ADJUSTMENTS_FILE,
    )
    .sort((a, b) => a.path.localeCompare(b.path));

  if (jsonFiles.length === 0) {
    return [];
  }

  const records: unknown[] = [];

  for (const item of jsonFiles) {
    const fileEndpoint = `${makeGithubEndpoint(config, item.path)}${refQuery}`;
    const fileBody = await fetchGithubJson<GithubContentFileBody>(fileEndpoint, token);

    if (fileBody.encoding !== 'base64' || typeof fileBody.content !== 'string') {
      throw new Error(`GitHub 文件格式不支持：${item.path}`);
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(fromBase64Utf8(fileBody.content));
    } catch {
      throw new Error(`GitHub 文件不是有效 JSON：${item.path}`);
    }

    records.push(...normalizeRecordPayload(parsed));
  }

  return records;
}

function getUserProfilePath(config: AppConfig): string {
  const recordsDir = normalizeRecordsDir(config.githubRecordsDir);
  return `${recordsDir}/${USER_PROFILE_DIR}/${USER_PROFILE_FILE}`;
}

function makeUserAvatarPath(config: AppConfig, extension: string, unixTime: number): string {
  const recordsDir = normalizeRecordsDir(config.githubRecordsDir);
  return `${recordsDir}/${USER_PROFILE_DIR}/${USER_AVATAR_DIR}/avatar-${unixTime}.${extension}`;
}

function normalizeDataUrlForGithubAvatar(dataUrl: string): { base64: string; extension: string } {
  const normalized = dataUrl.trim();
  const match = /^data:(image\/(?:png|jpeg));base64,([a-z0-9+/=\r\n]+)$/i.exec(normalized);

  if (!match) {
    throw new Error('头像格式无效，仅支持 PNG/JPEG 的 base64 Data URL');
  }

  const extension = match[1].toLowerCase() === 'image/png' ? 'png' : 'jpg';

  return {
    base64: match[2].replace(/[\r\n]/g, ''),
    extension,
  };
}

function normalizeUserProfilePayload(raw: unknown): GithubUserProfilePayload | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw as Partial<GithubUserProfilePayload>;
  if (typeof value.displayName !== 'string' || typeof value.updatedAt !== 'string') {
    return null;
  }

  return {
    displayName: value.displayName.trim(),
    email: normalizeOptionalText(value.email),
    phone: normalizeOptionalText(value.phone),
    location: normalizeOptionalText(value.location),
    bio: normalizeOptionalText(value.bio),
    avatarStyle: normalizeAvatarStyle(value.avatarStyle),
    avatarPath: normalizeOptionalText(value.avatarPath),
    avatarMimeType: normalizeOptionalText(value.avatarMimeType),
    avatarUpdatedAt: normalizeOptionalText(value.avatarUpdatedAt),
    updatedAt: value.updatedAt.trim(),
  };
}

export async function uploadUserAvatarToGithub(dataUrl: string, config: AppConfig, token: string): Promise<GithubSubmitResult> {
  validateGithubConfig(config, token);

  const unixTime = nowUnixSeconds();
  const avatar = normalizeDataUrlForGithubAvatar(dataUrl);
  const path = makeUserAvatarPath(config, avatar.extension, unixTime);
  const endpoint = makeGithubEndpoint(config, path);
  const payload = makePutPayload(
    {
      message: `chore(profile): upload avatar ${unixTime}`,
      content: avatar.base64,
    },
    config,
  );

  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: makeGithubHeaders(token),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as GithubErrorBody;
    const message = body.message ?? `HTTP ${response.status}`;
    throw new Error(`GitHub 提交失败：${message}`);
  }

  const data = (await response.json()) as { content?: { path?: string; sha?: string } };

  return {
    path: data.content?.path ?? path,
    sha: data.content?.sha,
  };
}

export async function submitUserProfileToGithub(
  profile: GithubUserProfilePayload,
  config: AppConfig,
  token: string,
): Promise<GithubSubmitResult> {
  validateGithubConfig(config, token);

  const path = getUserProfilePath(config);
  const endpoint = makeGithubEndpoint(config, path);
  const currentBody = await fetchGithubFileBody(config, token, path, { allowNotFound: true });
  const payload = makePutPayload(
    {
      message: `chore(profile): update user profile ${nowUnixSeconds()}`,
      content: toBase64Utf8(JSON.stringify(profile, null, 2)),
      sha: currentBody?.sha,
    },
    config,
  );

  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: makeGithubHeaders(token),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as GithubErrorBody;
    const message = body.message ?? `HTTP ${response.status}`;
    throw new Error(`GitHub 提交失败：${message}`);
  }

  const data = (await response.json()) as { content?: { path?: string; sha?: string } };
  return {
    path: data.content?.path ?? path,
    sha: data.content?.sha,
  };
}

export async function fetchUserProfileFromGithub(config: AppConfig, token: string): Promise<GithubFetchedUserProfile | null> {
  validateGithubConfig(config, token);

  const path = getUserProfilePath(config);
  const body = await fetchGithubFileBody(config, token, path, { allowNotFound: true });
  if (!body) {
    return null;
  }

  if (body.encoding !== 'base64' || typeof body.content !== 'string') {
    throw new Error(`GitHub 鏂囦欢鏍煎紡涓嶆敮鎸侊細${path}`);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(fromBase64Utf8(body.content));
  } catch {
    throw new Error(`GitHub 文件不是有效 JSON：${path}`);
  }

  const normalized = normalizeUserProfilePayload(parsed);
  if (!normalized) {
    throw new Error(`GitHub 用户资料格式无效：${path}`);
  }

  return {
    path,
    profile: normalized,
  };
}

export async function fetchUserAvatarDataUrlFromGithub(avatarPath: string, config: AppConfig, token: string): Promise<string> {
  validateGithubConfig(config, token);

  const normalizedPath = avatarPath.trim();
  if (!normalizedPath) {
    throw new Error('头像路径不能为空');
  }

  const body = await fetchGithubFileBody(config, token, normalizedPath);
  if (!body || body.encoding !== 'base64' || typeof body.content !== 'string') {
    throw new Error(`GitHub 鏂囦欢鏍煎紡涓嶆敮鎸侊細${normalizedPath}`);
  }

  const lowerPath = normalizedPath.toLowerCase();
  const mimeType = lowerPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const base64 = body.content.replace(/[\r\n]/g, '');
  return `data:${mimeType};base64,${base64}`;
}

function getFuelBalanceAdjustmentPath(config: AppConfig, adjustment: FuelBalanceAdjustmentLog): string {
  const recordsDir = normalizeRecordsDir(config.githubRecordsDir);
  return `${recordsDir}/${FUEL_BALANCE_ADJUSTMENTS_DIR}/${adjustment.recordedAtUnix}-${adjustment.id}.json`;
}

export async function appendFuelBalanceAdjustmentToGithub(
  adjustment: FuelBalanceAdjustmentLog,
  config: AppConfig,
  token: string,
): Promise<GithubSubmitResult> {
  validateGithubConfig(config, token);

  const path = getFuelBalanceAdjustmentPath(config, adjustment);
  const endpoint = makeGithubEndpoint(config, path);
  const refQuery = makeRefQuery(config);
  const headers = makeGithubHeaders(token);

  let sha: string | undefined;
  let currentEntries: FuelBalanceAdjustmentGithubEntry[] = [];
  const currentResponse = await fetch(`${endpoint}${refQuery}`, {
    method: 'GET',
    headers,
  });

  if (currentResponse.status === 404) {
    currentEntries = [];
  } else if (!currentResponse.ok) {
    const body = (await currentResponse.json().catch(() => ({}))) as GithubErrorBody;
    const message = body.message ?? `HTTP ${currentResponse.status}`;
    throw new Error(`GitHub 读取失败：${message}`);
  } else {
    const body = (await currentResponse.json()) as GithubContentFileBody;
    sha = typeof body.sha === 'string' ? body.sha : undefined;

    if (body.encoding !== 'base64' || typeof body.content !== 'string') {
      throw new Error(`GitHub 文件格式不支持：${path}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(fromBase64Utf8(body.content));
    } catch {
      throw new Error(`GitHub 文件不是有效 JSON：${path}`);
    }

    currentEntries = normalizeFuelBalanceAdjustmentPayload(parsed);
  }

  const exists = currentEntries.some((entry) => entry.id === adjustment.id);
  if (exists) {
    return {
      path,
      sha,
    };
  }

  const payloadEntries = [...currentEntries, toFuelBalanceAdjustmentGithubEntry(adjustment)];
  const payload: {
    message: string;
    content: string;
    sha?: string;
    branch?: string;
  } = {
    message: `chore(fuel-balance): append adjustment ${adjustment.recordedAtUnix}`,
    content: toBase64Utf8(JSON.stringify(payloadEntries, null, 2)),
  };

  if (sha) {
    payload.sha = sha;
  }

  const branch = config.githubBranch.trim();
  if (branch) {
    payload.branch = branch;
  }

  const response = await fetch(endpoint, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as GithubErrorBody;
    const message = body.message ?? `HTTP ${response.status}`;
    throw new Error(`GitHub 提交失败：${message}`);
  }

  const data = (await response.json()) as { content?: { path?: string; sha?: string } };

  return {
    path: data.content?.path ?? path,
    sha: data.content?.sha,
  };
}
