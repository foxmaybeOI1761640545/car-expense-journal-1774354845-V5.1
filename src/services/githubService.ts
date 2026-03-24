import type { AppConfig } from '../types/config';
import type { AppRecord } from '../types/records';
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

function validateGithubConfig(config: AppConfig): void {
  const requiredFields: Array<keyof AppConfig> = ['githubOwner', 'githubRepo', 'githubToken', 'githubRecordsDir'];
  const missing = requiredFields.filter((field) => !String(config[field] ?? '').trim());

  if (missing.length > 0) {
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

export async function submitRecordToGithub(record: AppRecord, config: AppConfig): Promise<GithubSubmitResult> {
  validateGithubConfig(config);

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
    headers: makeGithubHeaders(config.githubToken),
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

export async function fetchRecordsFromGithub(config: AppConfig): Promise<unknown[]> {
  validateGithubConfig(config);

  const recordsDir = normalizeRecordsDir(config.githubRecordsDir);
  const refQuery = makeRefQuery(config);
  const listEndpoint = `${makeGithubEndpoint(config, recordsDir)}${refQuery}`;
  const listBody = await fetchGithubJson<GithubContentItem[] | GithubContentItem>(listEndpoint, config.githubToken);
  const items = Array.isArray(listBody) ? listBody : [listBody];

  const jsonFiles = items
    .filter((item) => item.type === 'file' && item.name.toLowerCase().endsWith('.json'))
    .sort((a, b) => a.path.localeCompare(b.path));

  if (jsonFiles.length === 0) {
    return [];
  }

  const records: unknown[] = [];

  for (const item of jsonFiles) {
    const fileEndpoint = `${makeGithubEndpoint(config, item.path)}${refQuery}`;
    const fileBody = await fetchGithubJson<GithubContentFileBody>(fileEndpoint, config.githubToken);

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
