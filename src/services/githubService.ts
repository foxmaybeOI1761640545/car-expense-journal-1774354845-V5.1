import type { AppConfig } from '../types/config';
import type { AvatarStyle } from '../types/profile';
import type { AppRecord, RecordTombstone, RecordType } from '../types/records';
import type { FuelBalanceAdjustmentLog } from '../types/store';

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

export interface GithubRecordTombstonePayload {
  recordId: string;
  recordType?: RecordType;
  deletedAt: string;
  deletedAtUnix: number;
  sourceDeviceId?: string;
  sourceDeviceName?: string;
}

export interface GithubRecordsBundle {
  records: unknown[];
  tombstones: GithubRecordTombstonePayload[];
  fetched: number;
}

const LEGACY_FUEL_BALANCE_ADJUSTMENTS_FILE = 'fuel-balance-adjustments.json';
const FUEL_BALANCE_ADJUSTMENTS_DIR = 'fuel-balance-adjustments';
const RECORDS_V2_DIR = 'records';
const RECORD_TOMBSTONES_DIR = 'record-tombstones';
const USER_PROFILE_DIR = 'user-profile';
const USER_PROFILE_DEVICES_DIR = 'devices';
const USER_AVATAR_DIR = 'avatars';
const USER_PROFILE_FILE = 'profile.json';

export interface GithubUserProfilePayload {
  schemaVersion?: number;
  deviceId?: string;
  deviceName?: string;
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

function normalizeDeviceId(deviceId?: string): string | undefined {
  const value = deviceId?.trim();
  return value ? value : undefined;
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
    throw new Error('GitHub 配置不完整，请先填写 owner/repo/token/recordsDir。');
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

function normalizeRecordTombstonePayload(raw: unknown): GithubRecordTombstonePayload | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw as Partial<GithubRecordTombstonePayload>;
  if (typeof value.recordId !== 'string' || typeof value.deletedAt !== 'string' || !Number.isFinite(value.deletedAtUnix)) {
    return null;
  }

  return {
    recordId: value.recordId.trim(),
    recordType: value.recordType === 'fuel' || value.recordType === 'trip' ? value.recordType : undefined,
    deletedAt: value.deletedAt.trim(),
    deletedAtUnix: Number(value.deletedAtUnix),
    sourceDeviceId: normalizeOptionalText(value.sourceDeviceId),
    sourceDeviceName: normalizeOptionalText(value.sourceDeviceName),
  };
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

async function fetchGithubDirectoryItems(
  config: AppConfig,
  token: string,
  path: string,
  options: { allowNotFound?: boolean } = {},
): Promise<GithubContentItem[]> {
  const refQuery = makeRefQuery(config);
  const endpoint = `${makeGithubEndpoint(config, path)}${refQuery}`;
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: makeGithubHeaders(token),
  });

  if (response.status === 404 && options.allowNotFound) {
    return [];
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as GithubErrorBody;
    const message = body.message ?? `HTTP ${response.status}`;
    throw new Error(`GitHub 读取失败：${message}`);
  }

  const body = (await response.json()) as GithubContentItem[] | GithubContentItem;
  return Array.isArray(body) ? body : [body];
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

async function fetchAndParseJsonFile(config: AppConfig, token: string, path: string): Promise<unknown> {
  const refQuery = makeRefQuery(config);
  const endpoint = `${makeGithubEndpoint(config, path)}${refQuery}`;
  const fileBody = await fetchGithubJson<GithubContentFileBody>(endpoint, token);

  if (fileBody.encoding !== 'base64' || typeof fileBody.content !== 'string') {
    throw new Error(`GitHub 文件格式不支持：${path}`);
  }

  try {
    return JSON.parse(fromBase64Utf8(fileBody.content));
  } catch {
    throw new Error(`GitHub 文件不是有效 JSON：${path}`);
  }
}

function getLegacyUserProfilePath(config: AppConfig): string {
  const recordsDir = normalizeRecordsDir(config.githubRecordsDir);
  return `${recordsDir}/${USER_PROFILE_DIR}/${USER_PROFILE_FILE}`;
}

function getDeviceUserProfilePath(config: AppConfig, deviceId: string): string {
  const recordsDir = normalizeRecordsDir(config.githubRecordsDir);
  return `${recordsDir}/${USER_PROFILE_DIR}/${USER_PROFILE_DEVICES_DIR}/${deviceId}/${USER_PROFILE_FILE}`;
}

function makeUserAvatarPath(config: AppConfig, extension: string, unixTime: number, deviceId?: string): string {
  const recordsDir = normalizeRecordsDir(config.githubRecordsDir);
  const normalizedDeviceId = normalizeDeviceId(deviceId);

  if (normalizedDeviceId) {
    return `${recordsDir}/${USER_PROFILE_DIR}/${USER_PROFILE_DEVICES_DIR}/${normalizedDeviceId}/${USER_AVATAR_DIR}/avatar-${unixTime}.${extension}`;
  }

  return `${recordsDir}/${USER_PROFILE_DIR}/${USER_AVATAR_DIR}/avatar-${unixTime}.${extension}`;
}

function getRecordPath(config: AppConfig, recordId: string): string {
  const recordsDir = normalizeRecordsDir(config.githubRecordsDir);
  return `${recordsDir}/${RECORDS_V2_DIR}/${recordId}.json`;
}

function getRecordTombstonePath(config: AppConfig, recordId: string): string {
  const recordsDir = normalizeRecordsDir(config.githubRecordsDir);
  return `${recordsDir}/${RECORD_TOMBSTONES_DIR}/${recordId}.json`;
}

function normalizeDataUrlForGithubAvatar(dataUrl: string): { base64: string; extension: string } {
  const normalized = dataUrl.trim();
  const match = /^data:(image\/(?:png|jpeg));base64,([a-z0-9+/=\r\n]+)$/i.exec(normalized);

  if (!match) {
    throw new Error('头像格式无效，仅支持 PNG/JPEG 的 base64 Data URL。');
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

  const schemaVersion = Number.isFinite(value.schemaVersion) ? Number(value.schemaVersion) : undefined;

  return {
    schemaVersion: schemaVersion === undefined ? undefined : Math.max(1, Math.floor(schemaVersion)),
    deviceId: normalizeOptionalText(value.deviceId),
    deviceName: normalizeOptionalText(value.deviceName),
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

export async function submitRecordToGithub(record: AppRecord, config: AppConfig, token: string): Promise<GithubSubmitResult> {
  validateGithubConfig(config, token);

  const path = getRecordPath(config, record.id);
  const endpoint = makeGithubEndpoint(config, path);
  const currentBody = await fetchGithubFileBody(config, token, path, { allowNotFound: true });
  const payload = makePutPayload(
    {
      message: `chore(records): upsert ${record.type} record ${record.id}`,
      content: toBase64Utf8(JSON.stringify(record, null, 2)),
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

export async function submitRecordTombstoneToGithub(
  tombstone: RecordTombstone,
  config: AppConfig,
  token: string,
): Promise<GithubSubmitResult> {
  validateGithubConfig(config, token);

  const path = getRecordTombstonePath(config, tombstone.recordId);
  const endpoint = makeGithubEndpoint(config, path);
  const currentBody = await fetchGithubFileBody(config, token, path, { allowNotFound: true });

  let currentSha = currentBody?.sha;
  if (currentBody?.encoding === 'base64' && typeof currentBody.content === 'string') {
    try {
      const parsed = JSON.parse(fromBase64Utf8(currentBody.content));
      const existing = normalizeRecordTombstonePayload(parsed);
      if (existing && existing.deletedAtUnix > tombstone.deletedAtUnix) {
        return {
          path,
          sha: currentSha,
        };
      }
    } catch {
      // ignore invalid current content and overwrite with normalized tombstone payload
    }
  }

  const payload = makePutPayload(
    {
      message: `chore(records): tombstone ${tombstone.recordId}`,
      content: toBase64Utf8(
        JSON.stringify(
          {
            recordId: tombstone.recordId,
            recordType: tombstone.recordType,
            deletedAt: tombstone.deletedAt,
            deletedAtUnix: tombstone.deletedAtUnix,
            sourceDeviceId: tombstone.sourceDeviceId,
            sourceDeviceName: tombstone.sourceDeviceName,
          },
          null,
          2,
        ),
      ),
      sha: currentSha,
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

export async function fetchRecordsFromGithub(config: AppConfig, token: string): Promise<GithubRecordsBundle> {
  validateGithubConfig(config, token);

  const recordsDir = normalizeRecordsDir(config.githubRecordsDir);
  const rootItems = await fetchGithubDirectoryItems(config, token, recordsDir, { allowNotFound: true });

  const legacyRecordFiles = rootItems.filter(
    (item) => item.type === 'file' && item.name.toLowerCase().endsWith('.json') && item.name.toLowerCase() !== LEGACY_FUEL_BALANCE_ADJUSTMENTS_FILE,
  );

  const v2RecordDirPath = `${recordsDir}/${RECORDS_V2_DIR}`;
  const v2RecordItems = await fetchGithubDirectoryItems(config, token, v2RecordDirPath, { allowNotFound: true });
  const v2RecordFiles = v2RecordItems.filter((item) => item.type === 'file' && item.name.toLowerCase().endsWith('.json'));

  const recordFiles = [...legacyRecordFiles, ...v2RecordFiles].sort((a, b) => a.path.localeCompare(b.path));
  const records: unknown[] = [];

  for (const item of recordFiles) {
    const parsed = await fetchAndParseJsonFile(config, token, item.path);
    records.push(...normalizeRecordPayload(parsed));
  }

  const tombstonesDirPath = `${recordsDir}/${RECORD_TOMBSTONES_DIR}`;
  const tombstoneItems = await fetchGithubDirectoryItems(config, token, tombstonesDirPath, { allowNotFound: true });
  const tombstoneFiles = tombstoneItems.filter((item) => item.type === 'file' && item.name.toLowerCase().endsWith('.json'));
  const tombstones: GithubRecordTombstonePayload[] = [];

  for (const item of tombstoneFiles) {
    const parsed = await fetchAndParseJsonFile(config, token, item.path);
    const normalized = normalizeRecordTombstonePayload(parsed);
    if (normalized) {
      tombstones.push(normalized);
    }
  }

  return {
    records,
    tombstones,
    fetched: records.length,
  };
}

export async function uploadUserAvatarToGithub(
  dataUrl: string,
  config: AppConfig,
  token: string,
  deviceId?: string,
): Promise<GithubSubmitResult> {
  validateGithubConfig(config, token);

  const unixTime = Math.floor(Date.now() / 1000);
  const avatar = normalizeDataUrlForGithubAvatar(dataUrl);
  const path = makeUserAvatarPath(config, avatar.extension, unixTime, deviceId);
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
  deviceId?: string,
): Promise<GithubSubmitResult> {
  validateGithubConfig(config, token);

  const normalizedDeviceId = normalizeDeviceId(deviceId);
  const path = normalizedDeviceId ? getDeviceUserProfilePath(config, normalizedDeviceId) : getLegacyUserProfilePath(config);
  const endpoint = makeGithubEndpoint(config, path);
  const currentBody = await fetchGithubFileBody(config, token, path, { allowNotFound: true });
  const payload = makePutPayload(
    {
      message: `chore(profile): update user profile ${Math.floor(Date.now() / 1000)}`,
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

export async function fetchUserProfileFromGithub(
  config: AppConfig,
  token: string,
  deviceId?: string,
): Promise<GithubFetchedUserProfile | null> {
  validateGithubConfig(config, token);

  const normalizedDeviceId = normalizeDeviceId(deviceId);
  const path = normalizedDeviceId ? getDeviceUserProfilePath(config, normalizedDeviceId) : getLegacyUserProfilePath(config);
  const body = await fetchGithubFileBody(config, token, path, { allowNotFound: true });
  if (!body) {
    return null;
  }

  if (body.encoding !== 'base64' || typeof body.content !== 'string') {
    throw new Error(`GitHub 用户资料文件格式不支持：${path}`);
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
    throw new Error('头像路径不能为空。');
  }

  const body = await fetchGithubFileBody(config, token, normalizedPath);
  if (!body || body.encoding !== 'base64' || typeof body.content !== 'string') {
    throw new Error(`GitHub 头像文件读取失败：${normalizedPath}`);
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
  const payload = makePutPayload(
    {
      message: `chore(fuel-balance): append adjustment ${adjustment.recordedAtUnix}`,
      content: toBase64Utf8(JSON.stringify(payloadEntries, null, 2)),
      sha,
    },
    config,
  );

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
