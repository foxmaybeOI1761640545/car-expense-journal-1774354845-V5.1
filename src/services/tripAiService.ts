import type { AppConfig } from '../types/config';
import { resolveReminderBackendBaseUrl } from './reminderBackendUrlService';

export interface TripAiExtractResult {
  averageFuelConsumptionPer100Km: number | null;
  distanceKm: number | null;
  savedImagePath?: string;
  savedImageUrl?: string;
  rawText?: string;
}

interface TripAiExtractPayload {
  ok?: unknown;
  message?: unknown;
  averageFuelConsumptionPer100Km?: unknown;
  distanceKm?: unknown;
  savedImagePath?: unknown;
  savedImageUrl?: unknown;
  rawText?: unknown;
}

interface TripAiExtractRequestBody {
  imageDataUrl: string;
  imageFileName?: string;
  sealedToken?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  recordsDir?: string;
}

const UNSAFE_BROWSER_PORTS = new Set<number>([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111,
  113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540,
  548, 554, 556, 563, 587, 601, 636, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666,
  6667, 6668, 6669, 6679, 6697, 10080,
]);

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function resolveAbsoluteBaseUrl(baseUrl: string): string {
  if (/^https?:\/\//i.test(baseUrl)) {
    return baseUrl;
  }

  return `http://${baseUrl}`;
}

function assertSafePort(baseUrl: string): void {
  let parsed: URL;

  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('后端地址格式无效，请填写 http://host:port 形式。');
  }

  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  if (!Number.isFinite(port)) {
    throw new Error('后端地址端口无效。');
  }

  if (UNSAFE_BROWSER_PORTS.has(port)) {
    throw new Error(`浏览器会拦截端口 ${port}（ERR_UNSAFE_PORT），请改用 18080、10081、8080 等安全端口。`);
  }
}

function normalizeImageDataUrl(dataUrl: string): string {
  const normalized = dataUrl.trim();
  if (!/^data:[^;,]+;base64,[a-z0-9+/=\r\n]+$/i.test(normalized)) {
    throw new Error('图片数据无效，请重新选择图片后重试。');
  }

  return normalized;
}

function parseOptionalFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function parseOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function parseTripAiExtractPayload(payload: unknown): TripAiExtractResult {
  if (!payload || typeof payload !== 'object') {
    throw new Error('后端返回数据格式无效。');
  }

  const value = payload as TripAiExtractPayload;
  if (value.ok !== true) {
    throw new Error(parseOptionalText(value.message) ?? 'AI 识别失败。');
  }

  return {
    averageFuelConsumptionPer100Km: parseOptionalFiniteNumber(value.averageFuelConsumptionPer100Km),
    distanceKm: parseOptionalFiniteNumber(value.distanceKm),
    savedImagePath: parseOptionalText(value.savedImagePath),
    savedImageUrl: parseOptionalText(value.savedImageUrl),
    rawText: parseOptionalText(value.rawText),
  };
}

async function tryReadResponseMessage(response: Response): Promise<string | null> {
  try {
    const payload = (await response.json()) as TripAiExtractPayload;
    return parseOptionalText(payload.message) ?? null;
  } catch {
    return null;
  }
}

function resolveBackendBaseUrl(config: Pick<AppConfig, 'reminderApiBaseUrl' | 'reminderApiFallbackBaseUrl'>): string {
  const configured = resolveReminderBackendBaseUrl(config);
  const absolute = normalizeBaseUrl(resolveAbsoluteBaseUrl(configured));
  if (!absolute) {
    throw new Error('请先在页面设置填写可用的后端地址（reminderApiBaseUrl）。');
  }

  assertSafePort(absolute);
  return absolute;
}

function normalizeRepoPath(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '');
}

function buildGithubRawImageUrl(
  imagePath: string,
  config: Pick<AppConfig, 'githubOwner' | 'githubRepo' | 'githubBranch'>,
): string | undefined {
  const owner = config.githubOwner.trim();
  const repo = config.githubRepo.trim();
  const branch = config.githubBranch.trim();
  const normalizedPath = imagePath.trim().replace(/^\/+/, '');

  if (!owner || !repo || !branch || !normalizedPath) {
    return undefined;
  }

  const encodedPath = normalizedPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${encodedPath}`;
}

export function resolveTripDashboardImageUrl(
  pathOrUrl: string | undefined,
  config: Pick<
    AppConfig,
    'reminderApiBaseUrl' | 'reminderApiFallbackBaseUrl' | 'githubOwner' | 'githubRepo' | 'githubBranch' | 'githubRecordsDir'
  >,
): string | undefined {
  const value = pathOrUrl?.trim();
  if (!value) {
    return undefined;
  }

  if (/^(https?:|data:|blob:)/i.test(value)) {
    return value;
  }

  const normalizedPath = value.replace(/^\/+/, '');
  const normalizedRecordsDir = normalizeRepoPath(config.githubRecordsDir);
  if (normalizedRecordsDir && normalizedPath.startsWith(`${normalizedRecordsDir}/`)) {
    const githubUrl = buildGithubRawImageUrl(normalizedPath, config);
    if (githubUrl) {
      return githubUrl;
    }
  }

  try {
    const baseUrl = resolveBackendBaseUrl(config);
    return `${baseUrl}/${normalizedPath}`;
  } catch {
    return undefined;
  }
}

export async function extractTripMetricsFromImage(
  imageDataUrl: string,
  imageFileName: string | undefined,
  config: Pick<
    AppConfig,
    'reminderApiBaseUrl' | 'reminderApiFallbackBaseUrl' | 'githubOwner' | 'githubRepo' | 'githubBranch' | 'githubRecordsDir'
  >,
  githubToken: string | undefined,
  timeoutMs = 120_000,
): Promise<TripAiExtractResult> {
  const backendBaseUrl = resolveBackendBaseUrl(config);
  const normalizedImageDataUrl = normalizeImageDataUrl(imageDataUrl);
  const fileName = imageFileName?.trim();
  const owner = config.githubOwner.trim();
  const repo = config.githubRepo.trim();
  const branch = config.githubBranch.trim();
  const recordsDir = normalizeRepoPath(config.githubRecordsDir);
  const sealedToken = githubToken?.trim() || '';
  const requestBody: TripAiExtractRequestBody = {
    imageDataUrl: normalizedImageDataUrl,
    imageFileName: fileName || undefined,
  };

  if (sealedToken && owner && repo && recordsDir) {
    requestBody.sealedToken = sealedToken;
    requestBody.owner = owner;
    requestBody.repo = repo;
    requestBody.branch = branch || undefined;
    requestBody.recordsDir = recordsDir;
  }

  const controller = new AbortController();
  const timeoutHandle = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${backendBaseUrl}/api/trip/ai-extract`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const message = (await tryReadResponseMessage(response)) ?? `后端响应异常：HTTP ${response.status}`;
      throw new Error(message);
    }

    const payload = (await response.json()) as unknown;
    return parseTripAiExtractPayload(payload);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('AI 识别超时，请检查后端服务或更换更清晰图片后重试。');
    }

    if (error instanceof TypeError) {
      const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '当前前端域名';
      throw new Error(`连接失败。可能是跨域限制（CORS）或地址不可达。请在后端配置 CORS_ORIGINS 包含 ${currentOrigin}。`);
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('调用 AI 识别服务失败。');
  } finally {
    clearTimeout(timeoutHandle);
  }
}
