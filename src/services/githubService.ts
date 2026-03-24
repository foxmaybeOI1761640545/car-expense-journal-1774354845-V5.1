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

export async function submitRecordToGithub(record: AppRecord, config: AppConfig): Promise<GithubSubmitResult> {
  validateGithubConfig(config);

  const unixTime = nowUnixSeconds();
  const recordsDir = normalizeRecordsDir(config.githubRecordsDir);
  const path = `${recordsDir}/${unixTime}.json`;
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubRepo)}/contents/${encodeContentPath(path)}`;

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
    headers: {
      Authorization: `Bearer ${config.githubToken}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
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
