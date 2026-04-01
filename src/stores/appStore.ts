import { reactive } from 'vue';
import type { AppConfig } from '../types/config';
import { DEFAULT_APP_CONFIG } from '../types/config';
import { DEFAULT_DEVICE_NAME, type DeviceMeta } from '../types/device';
import { DEFAULT_USER_PROFILE, type AvatarStyle, type UserProfile } from '../types/profile';
import type { AppRecord, FuelRecord, RecordTombstone, RecordType, TripRecord } from '../types/records';
import type { AppStoreState, FuelBalanceAdjustmentLog, FuelBalanceState } from '../types/store';
import { createEmptyFuelBalance, recalculateFuelBalance } from '../services/balanceService';
import { applyBranding } from '../services/brandingService';
import { loadConfigFile, resolveAppConfig } from '../services/configService';
import {
  appendFuelBalanceAdjustmentToGithub,
  fetchRecordsFromGithub,
  fetchUserAvatarDataUrlFromGithub,
  fetchUserProfileFromGithub,
  submitRecordToGithub,
  submitRecordTombstoneToGithub,
  submitUserProfileToGithub,
  uploadUserAvatarToGithub,
} from '../services/githubService';
import { sealGithubTokenWithBackend } from '../services/backendPatVaultService';
import { clearGithubTokenFromVault, loadGithubTokenFromVault, saveGithubTokenToVault } from '../services/githubTokenVaultService';
import { resolveReminderBackendBaseUrl } from '../services/reminderBackendUrlService';
import {
  clearAppData,
  clearLocalConfig,
  loadAppData,
  loadDeviceMeta,
  loadLegacyGithubTokenFromLocalConfig,
  loadLocalConfig,
  removeLegacyGithubTokenFromLocalConfig,
  saveDeviceMeta,
  saveAppData,
  saveLocalConfig,
} from '../services/localStorageService';
import {
  clearReminderRingtoneConfig,
  clearReminderRingtoneSourceModeStorage,
  clearReminderSynthPatternConfigStorage,
  clearReminderTasksStorage,
} from '../services/reminderService';
import { nowIsoString, nowUnixSeconds, unixSecondsToIsoString } from '../utils/date';
import { parsePositiveNumber, roundTo } from '../utils/number';

interface FuelRecordInput {
  occurredAtUnix?: number;
  province?: string;
  fuelType: number;
  pricePerLiter: number;
  fuelVolumeLiters: number;
  totalPriceCny: number;
  stationName?: string;
  note?: string;
}

interface TripRecordInput {
  occurredAtUnix?: number;
  averageFuelConsumptionPer100Km: number;
  distanceKm: number;
  pricePerLiter: number;
  startLocation?: string;
  endLocation?: string;
  note?: string;
}

interface UpdateRecordResult {
  updated: boolean;
  wasSubmittedToGithub: boolean;
  isSubmittedToGithub: boolean;
}

interface UpdateFuelBalanceInput {
  remainingFuelLiters: number;
  balanceChangedAtUnix?: number;
}

interface UpdateFuelBalanceResult {
  submittedToGithub: boolean;
  adjustment: FuelBalanceAdjustmentLog;
  message?: string;
}

interface ImportRecordsResult {
  added: number;
  skipped: number;
  invalid: number;
}

interface BatchSubmitResult {
  successCount: number;
  failedCount: number;
  successRecordIds: string[];
  failures: Array<{ recordId: string; message: string }>;
}

interface BatchFuelBalanceAdjustmentSubmitResult {
  successCount: number;
  failedCount: number;
  successAdjustmentIds: string[];
  failures: Array<{ adjustmentId: string; message: string }>;
}

interface SyncRecordsResult extends ImportRecordsResult {
  fetched: number;
}

interface SyncUserProfileToGithubResult {
  profilePath: string;
  avatarPath?: string;
}

interface SyncUserProfileFromGithubResult {
  exists: boolean;
  avatarLoaded: boolean;
}

interface RecalculateAndPersistOptions {
  appendAdjustmentLog?: boolean;
  adjustmentSource?: 'manual' | 'records';
  balanceChangedAtUnix?: number;
  submitAdjustmentToGithub?: boolean;
}

interface ClearLocalCacheOptions {
  clearPat?: boolean;
}

let toastTimer: number | null = null;
const inFlightFuelBalanceAdjustmentSubmissions = new Map<string, Promise<{ path: string; sha?: string }>>();
const inFlightRecordTombstoneSubmissions = new Map<string, Promise<{ path: string; sha?: string }>>();

function isSealedGithubToken(token: string): boolean {
  return /^pat\.sealed\.[^.]+\./.test(token.trim());
}

function createFallbackDeviceId(): string {
  const random = Math.random().toString(16).slice(2);
  return `device-${Date.now().toString(36)}-${random}`;
}

function createNewDeviceMeta(): DeviceMeta {
  const now = nowIsoString();
  const generatedId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? `device-${crypto.randomUUID()}` : createFallbackDeviceId();

  return {
    deviceId: generatedId,
    deviceName: DEFAULT_DEVICE_NAME,
    createdAt: now,
    updatedAt: now,
  };
}

const state = reactive<AppStoreState>({
  initialized: false,
  config: { ...DEFAULT_APP_CONFIG },
  githubToken: '',
  deviceMeta: createNewDeviceMeta(),
  userProfile: { ...DEFAULT_USER_PROFILE },
  records: [],
  recordTombstones: [],
  fuelBalance: createEmptyFuelBalance(),
  fuelBalanceAdjustments: [],
  submittingRecordIds: [],
  toast: {
    visible: false,
    message: '',
    type: 'info',
  },
});

function compareRecordsByTimeAsc(a: AppRecord, b: AppRecord): number {
  if (a.occurredAtUnix === b.occurredAtUnix) {
    if (a.createdAtUnix === b.createdAtUnix) {
      return a.createdAt.localeCompare(b.createdAt);
    }

    return a.createdAtUnix - b.createdAtUnix;
  }

  return a.occurredAtUnix - b.occurredAtUnix;
}

function compareFuelBalanceAdjustmentsByTimeAsc(a: FuelBalanceAdjustmentLog, b: FuelBalanceAdjustmentLog): number {
  if (a.recordedAtUnix === b.recordedAtUnix) {
    return a.recordedAt.localeCompare(b.recordedAt);
  }

  return a.recordedAtUnix - b.recordedAtUnix;
}

function persistState(): void {
  saveAppData({
    userProfile: state.userProfile,
    records: state.records,
    recordTombstones: state.recordTombstones,
    fuelBalance: state.fuelBalance,
    fuelBalanceAdjustments: state.fuelBalanceAdjustments,
  });
}

function sanitizeFuelBalance(raw: unknown): FuelBalanceState {
  if (!raw || typeof raw !== 'object') {
    return createEmptyFuelBalance();
  }

  const value = raw as Partial<FuelBalanceState>;
  const manualOffsetLiters = Number.isFinite(value.manualOffsetLiters) ? Number(value.manualOffsetLiters) : 0;

  return {
    baselineEstablished: Boolean(value.baselineEstablished),
    baselineAnchorUnix: Number.isFinite(value.baselineAnchorUnix) ? Number(value.baselineAnchorUnix) : null,
    autoCalculatedFuelLiters: Number.isFinite(value.autoCalculatedFuelLiters) ? Number(value.autoCalculatedFuelLiters) : null,
    manualOffsetLiters: roundTo(manualOffsetLiters, 3),
    remainingFuelLiters: Number.isFinite(value.remainingFuelLiters) ? Number(value.remainingFuelLiters) : null,
    anomaly: Boolean(value.anomaly),
  };
}

function sanitizeFuelBalanceAdjustment(raw: unknown): FuelBalanceAdjustmentLog | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw as Partial<FuelBalanceAdjustmentLog>;
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
    remainingFuelLiters: remainingFuelLiters === null ? null : roundTo(remainingFuelLiters, 3),
    autoCalculatedFuelLiters: autoCalculatedFuelLiters === null ? null : roundTo(autoCalculatedFuelLiters, 3),
    manualOffsetLiters: roundTo(Number(value.manualOffsetLiters), 3),
    submittedToGithub: Boolean(value.submittedToGithub),
    githubPath: typeof value.githubPath === 'string' ? value.githubPath : undefined,
  };
}

function sanitizeFuelBalanceAdjustments(raw: unknown): FuelBalanceAdjustmentLog[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => sanitizeFuelBalanceAdjustment(item))
    .filter((item): item is FuelBalanceAdjustmentLog => item !== null)
    .sort(compareFuelBalanceAdjustmentsByTimeAsc);
}

function parseAvatarMimeTypeFromDataUrl(dataUrl: string): string {
  const match = /^data:([^;]+);base64,/i.exec(dataUrl.trim());
  return match ? match[1].toLowerCase() : '';
}

function normalizeProfileText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

function normalizeOptionalProfileText(value: unknown, maxLength: number): string | undefined {
  const normalized = normalizeProfileText(value, maxLength);
  return normalized ? normalized : undefined;
}

function sanitizeDeviceMeta(raw: unknown): DeviceMeta {
  if (!raw || typeof raw !== 'object') {
    return createNewDeviceMeta();
  }

  const value = raw as Partial<DeviceMeta>;
  const now = nowIsoString();
  const deviceId = normalizeProfileText(value.deviceId, 120) || createNewDeviceMeta().deviceId;
  const deviceName = normalizeProfileText(value.deviceName, 80) || DEFAULT_DEVICE_NAME;
  const createdAt = normalizeProfileText(value.createdAt, 80) || now;
  const updatedAt = normalizeProfileText(value.updatedAt, 80) || now;

  return {
    deviceId,
    deviceName,
    createdAt,
    updatedAt,
  };
}

function sanitizeUserProfile(raw: unknown): UserProfile {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_USER_PROFILE };
  }

  const value = raw as Partial<UserProfile>;
  const avatarDataUrl = normalizeProfileText(value.avatarDataUrl, 3_000_000);
  const detectedAvatarMimeType = parseAvatarMimeTypeFromDataUrl(avatarDataUrl);
  const avatarMimeType = detectedAvatarMimeType || normalizeProfileText(value.avatarMimeType, 64).toLowerCase();
  const avatarStyle: AvatarStyle = value.avatarStyle === 'square' ? 'square' : 'round';
  const avatarNeedsUpload = Boolean(value.avatarNeedsUpload) && Boolean(avatarDataUrl);

  return {
    displayName: normalizeProfileText(value.displayName, 80),
    email: normalizeProfileText(value.email, 120),
    phone: normalizeProfileText(value.phone, 40),
    location: normalizeProfileText(value.location, 120),
    bio: normalizeProfileText(value.bio, 1_000),
    avatarStyle,
    avatarDataUrl,
    avatarMimeType,
    avatarNeedsUpload,
    avatarGithubPath: normalizeOptionalProfileText(value.avatarGithubPath, 320),
    avatarUpdatedAt: normalizeOptionalProfileText(value.avatarUpdatedAt, 60),
    profileGithubPath: normalizeOptionalProfileText(value.profileGithubPath, 320),
    profileUpdatedAt: normalizeOptionalProfileText(value.profileUpdatedAt, 60),
  };
}

function normalizeGithubSubmittedTargets(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const unique = new Set<string>();
  const normalized: string[] = [];

  for (const item of raw) {
    if (typeof item !== 'string') {
      continue;
    }

    const value = item.trim();
    if (!value || unique.has(value)) {
      continue;
    }

    unique.add(value);
    normalized.push(value);
  }

  return normalized;
}

function makeGithubSubmissionTargetKey(config: AppConfig): string | null {
  const owner = config.githubOwner.trim();
  const repo = config.githubRepo.trim();
  const recordsDir = config.githubRecordsDir.trim().replace(/^\/+|\/+$/g, '');

  if (!owner || !repo || !recordsDir) {
    return null;
  }

  const branch = config.githubBranch.trim() || 'default';
  return `${owner}/${repo}#${branch}:${recordsDir}`;
}

function getCurrentGithubSubmissionTargetKey(): string | null {
  return makeGithubSubmissionTargetKey(state.config);
}

function isRecordSubmittedForTarget(
  record: Pick<AppRecord, 'submittedToGithub' | 'githubSubmittedTargets'>,
  targetKey: string | null,
): boolean {
  if (!targetKey) {
    return Boolean(record.submittedToGithub);
  }

  return normalizeGithubSubmittedTargets(record.githubSubmittedTargets).includes(targetKey);
}

function resolveRecordSubmissionState(raw: {
  submittedToGithub: unknown;
  githubSubmittedTargets: unknown;
  targetKey: string | null;
}): { submittedToGithub: boolean; githubSubmittedTargets: string[] } {
  const targets = normalizeGithubSubmittedTargets(raw.githubSubmittedTargets);

  if (targets.length === 0 && Boolean(raw.submittedToGithub) && raw.targetKey) {
    targets.push(raw.targetKey);
  }

  return {
    submittedToGithub: raw.targetKey ? targets.includes(raw.targetKey) : Boolean(raw.submittedToGithub),
    githubSubmittedTargets: targets,
  };
}

function refreshRecordSubmissionStatusForTarget(targetKey: string | null): void {
  state.records = state.records
    .map((record) => {
      const targets = normalizeGithubSubmittedTargets(record.githubSubmittedTargets);
      return {
        ...record,
        githubSubmittedTargets: targets,
        submittedToGithub: targetKey ? targets.includes(targetKey) : Boolean(record.submittedToGithub),
      };
    })
    .sort(compareRecordsByTimeAsc);

  state.recordTombstones = state.recordTombstones
    .map((tombstone) => {
      const targets = normalizeGithubSubmittedTargets(tombstone.githubSubmittedTargets);
      return {
        ...tombstone,
        githubSubmittedTargets: targets,
        submittedToGithub: targetKey ? targets.includes(targetKey) : Boolean(tombstone.submittedToGithub),
      };
    })
    .sort((a, b) => a.deletedAtUnix - b.deletedAtUnix);
}

function normalizeOccurredTime(input: {
  occurredAt: unknown;
  occurredAtUnix: unknown;
  fallbackUnix: number;
}): { occurredAt: string; occurredAtUnix: number } {
  const fallbackUnix = Math.floor(input.fallbackUnix);
  let occurredAtUnix = Number.isFinite(input.occurredAtUnix) ? Math.floor(Number(input.occurredAtUnix)) : fallbackUnix;
  let occurredAt = typeof input.occurredAt === 'string' && input.occurredAt.trim() ? input.occurredAt : '';

  if (occurredAt) {
    const parsed = new Date(occurredAt);
    if (!Number.isNaN(parsed.getTime())) {
      const parsedUnix = Math.floor(parsed.getTime() / 1000);
      if (!Number.isFinite(input.occurredAtUnix)) {
        occurredAtUnix = parsedUnix;
      }
      occurredAt = parsed.toISOString();
    } else {
      occurredAt = '';
    }
  }

  if (!occurredAt) {
    occurredAt = unixSecondsToIsoString(occurredAtUnix);
  }

  return {
    occurredAt,
    occurredAtUnix,
  };
}

function sanitizeRecord(raw: unknown, targetKey: string | null): AppRecord | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const record = raw as Partial<AppRecord> & Record<string, unknown>;

  if (record.type !== 'fuel' && record.type !== 'trip') {
    return null;
  }

  if (typeof record.id !== 'string' || typeof record.createdAt !== 'string' || !Number.isFinite(record.createdAtUnix)) {
    return null;
  }

  const submissionState = resolveRecordSubmissionState({
    submittedToGithub: record.submittedToGithub,
    githubSubmittedTargets: record.githubSubmittedTargets,
    targetKey,
  });
  const updatedAt = typeof record.updatedAt === 'string' && record.updatedAt.trim() ? record.updatedAt : record.createdAt;
  const updatedAtUnix = Number.isFinite(record.updatedAtUnix) ? Math.floor(Number(record.updatedAtUnix)) : Number(record.createdAtUnix);
  const sourceDeviceId = typeof record.sourceDeviceId === 'string' ? normalizeOptionalProfileText(record.sourceDeviceId, 120) : undefined;
  const sourceDeviceName = typeof record.sourceDeviceName === 'string' ? normalizeOptionalProfileText(record.sourceDeviceName, 80) : undefined;

  if (record.type === 'fuel') {
    const fuelType = parsePositiveNumber(record.fuelType as number);
    const pricePerLiter = parsePositiveNumber(record.pricePerLiter as number);
    const fuelVolumeLiters = parsePositiveNumber(record.fuelVolumeLiters as number);
    const totalPriceCny = parsePositiveNumber(record.totalPriceCny as number);

    if (fuelType === null || pricePerLiter === null || fuelVolumeLiters === null || totalPriceCny === null) {
      return null;
    }

    const normalizedOccurred = normalizeOccurredTime({
      occurredAt: record.occurredAt,
      occurredAtUnix: record.occurredAtUnix,
      fallbackUnix: Number(record.createdAtUnix),
    });

    const normalized: FuelRecord = {
      id: record.id,
      type: 'fuel',
      occurredAt: normalizedOccurred.occurredAt,
      occurredAtUnix: normalizedOccurred.occurredAtUnix,
      createdAt: record.createdAt,
      createdAtUnix: Number(record.createdAtUnix),
      updatedAt,
      updatedAtUnix,
      sourceDeviceId,
      sourceDeviceName,
      province: typeof record.province === 'string' ? record.province : undefined,
      fuelType: Math.round(fuelType),
      pricePerLiter: roundTo(pricePerLiter, 2),
      fuelVolumeLiters: roundTo(fuelVolumeLiters, 3),
      totalPriceCny: roundTo(totalPriceCny, 2),
      stationName: typeof record.stationName === 'string' ? record.stationName : undefined,
      note: typeof record.note === 'string' ? record.note : undefined,
      submittedToGithub: submissionState.submittedToGithub,
      githubSubmittedTargets: submissionState.githubSubmittedTargets,
    };

    return normalized;
  }

  const average = parsePositiveNumber(record.averageFuelConsumptionPer100Km as number);
  const distance = parsePositiveNumber(record.distanceKm as number);
  const consumed = parsePositiveNumber(record.consumedFuelLiters as number);
  const pricePerLiter = parsePositiveNumber(record.pricePerLiter as number);
  const totalFuelCostCny = parsePositiveNumber(record.totalFuelCostCny as number);

  if (average === null || distance === null || consumed === null) {
    return null;
  }

  const normalizedPricePerLiter = pricePerLiter === null ? undefined : roundTo(pricePerLiter, 2);
  const normalizedTotalFuelCostCny =
    totalFuelCostCny === null
      ? normalizedPricePerLiter === undefined
        ? undefined
        : roundTo(roundTo(consumed, 3) * normalizedPricePerLiter, 2)
      : roundTo(totalFuelCostCny, 2);

  const normalizedOccurred = normalizeOccurredTime({
    occurredAt: record.occurredAt,
    occurredAtUnix: record.occurredAtUnix,
    fallbackUnix: Number(record.createdAtUnix),
  });

  const normalized: TripRecord = {
    id: record.id,
    type: 'trip',
    occurredAt: normalizedOccurred.occurredAt,
    occurredAtUnix: normalizedOccurred.occurredAtUnix,
    createdAt: record.createdAt,
    createdAtUnix: Number(record.createdAtUnix),
    updatedAt,
    updatedAtUnix,
    sourceDeviceId,
    sourceDeviceName,
    averageFuelConsumptionPer100Km: roundTo(average, 2),
    distanceKm: roundTo(distance, 2),
    consumedFuelLiters: roundTo(consumed, 3),
    pricePerLiter: normalizedPricePerLiter,
    totalFuelCostCny: normalizedTotalFuelCostCny,
    startLocation: typeof record.startLocation === 'string' ? record.startLocation : undefined,
    endLocation: typeof record.endLocation === 'string' ? record.endLocation : undefined,
    note: typeof record.note === 'string' ? record.note : undefined,
    submittedToGithub: submissionState.submittedToGithub,
    githubSubmittedTargets: submissionState.githubSubmittedTargets,
  };

  return normalized;
}

function sanitizeRecords(records: unknown, targetKey: string | null): AppRecord[] {
  if (!Array.isArray(records)) {
    return [];
  }

  return records
    .map((item) => sanitizeRecord(item, targetKey))
    .filter((item): item is AppRecord => item !== null)
    .sort(compareRecordsByTimeAsc);
}

function sanitizeRecordTombstone(raw: unknown, targetKey: string | null): RecordTombstone | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw as Partial<RecordTombstone>;
  if (
    typeof value.recordId !== 'string' ||
    (value.recordType !== undefined && value.recordType !== 'fuel' && value.recordType !== 'trip') ||
    typeof value.deletedAt !== 'string' ||
    !Number.isFinite(value.deletedAtUnix)
  ) {
    return null;
  }

  const submissionState = resolveRecordSubmissionState({
    submittedToGithub: value.submittedToGithub,
    githubSubmittedTargets: value.githubSubmittedTargets,
    targetKey,
  });

  return {
    recordId: value.recordId,
    recordType: value.recordType === 'trip' ? 'trip' : 'fuel',
    deletedAt: value.deletedAt,
    deletedAtUnix: Number(value.deletedAtUnix),
    sourceDeviceId: normalizeOptionalProfileText(value.sourceDeviceId, 120),
    sourceDeviceName: normalizeOptionalProfileText(value.sourceDeviceName, 80),
    submittedToGithub: submissionState.submittedToGithub,
    githubSubmittedTargets: submissionState.githubSubmittedTargets,
    githubPath: normalizeOptionalProfileText(value.githubPath, 320),
  };
}

function sanitizeRecordTombstones(raw: unknown, targetKey: string | null): RecordTombstone[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => sanitizeRecordTombstone(item, targetKey))
    .filter((item): item is RecordTombstone => item !== null)
    .sort((a, b) => a.deletedAtUnix - b.deletedAtUnix);
}

function normalizeImportPayload(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }

  if (raw && typeof raw === 'object') {
    const value = raw as { records?: unknown };

    if (Array.isArray(value.records)) {
      return value.records;
    }

    return [raw];
  }

  return [];
}

function mergeRecords(records: AppRecord[]): { added: number; skipped: number } {
  if (records.length === 0) {
    return { added: 0, skipped: 0 };
  }

  const existingIds = new Set(state.records.map((record) => record.id));
  let added = 0;
  let skipped = 0;

  for (const record of records.sort(compareRecordsByTimeAsc)) {
    if (existingIds.has(record.id)) {
      skipped += 1;
      continue;
    }

    state.records.push(record);
    existingIds.add(record.id);
    added += 1;
  }

  if (added > 0) {
    state.records = [...state.records].sort(compareRecordsByTimeAsc);
    recalculateAndPersist({
      appendAdjustmentLog: true,
      adjustmentSource: 'records',
      balanceChangedAtUnix: nowUnixSeconds(),
    });
  }

  return { added, skipped };
}

function makeRecordId(type: 'fuel' | 'trip' | 'fuel-balance-adjustment'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${type}-${crypto.randomUUID()}`;
  }

  return `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeNullableLiters(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return roundTo(Number(value), 3);
}

function getRecordUpdatedAtUnix(record: Pick<AppRecord, 'updatedAtUnix' | 'createdAtUnix'>): number {
  return Number.isFinite(record.updatedAtUnix) ? Number(record.updatedAtUnix) : Number(record.createdAtUnix);
}

function makeRecordTombstone(record: AppRecord): RecordTombstone {
  return {
    recordId: record.id,
    recordType: record.type,
    deletedAt: nowIsoString(),
    deletedAtUnix: nowUnixSeconds(),
    sourceDeviceId: state.deviceMeta.deviceId,
    sourceDeviceName: state.deviceMeta.deviceName,
    submittedToGithub: false,
    githubSubmittedTargets: [],
  };
}

function isFuelBalanceChanged(previous: FuelBalanceState, next: FuelBalanceState): boolean {
  return (
    previous.baselineEstablished !== next.baselineEstablished ||
    previous.baselineAnchorUnix !== next.baselineAnchorUnix ||
    normalizeNullableLiters(previous.autoCalculatedFuelLiters) !== normalizeNullableLiters(next.autoCalculatedFuelLiters) ||
    roundTo(previous.manualOffsetLiters, 3) !== roundTo(next.manualOffsetLiters, 3) ||
    normalizeNullableLiters(previous.remainingFuelLiters) !== normalizeNullableLiters(next.remainingFuelLiters) ||
    previous.anomaly !== next.anomaly
  );
}

function appendFuelBalanceAdjustmentLog(input: {
  source: 'manual' | 'records';
  balanceChangedAtUnix: number;
  balance: FuelBalanceState;
}): FuelBalanceAdjustmentLog {
  const balanceChangedAtUnix = Math.floor(input.balanceChangedAtUnix);
  const adjustment: FuelBalanceAdjustmentLog = {
    id: makeRecordId('fuel-balance-adjustment'),
    source: input.source,
    recordedAt: nowIsoString(),
    recordedAtUnix: nowUnixSeconds(),
    balanceChangedAt: unixSecondsToIsoString(balanceChangedAtUnix),
    balanceChangedAtUnix,
    remainingFuelLiters: normalizeNullableLiters(input.balance.remainingFuelLiters),
    autoCalculatedFuelLiters: normalizeNullableLiters(input.balance.autoCalculatedFuelLiters),
    manualOffsetLiters: roundTo(input.balance.manualOffsetLiters, 3),
    submittedToGithub: false,
  };

  state.fuelBalanceAdjustments.push(adjustment);
  state.fuelBalanceAdjustments = [...state.fuelBalanceAdjustments].sort(compareFuelBalanceAdjustmentsByTimeAsc);
  persistState();
  return adjustment;
}

function trySubmitFuelBalanceAdjustmentInBackground(adjustmentId: string): void {
  void submitFuelBalanceAdjustment(adjustmentId).catch(() => {
    // Keep it pending in localStorage. User can retry from Home page.
  });
}

function recalculateAndPersist(options: RecalculateAndPersistOptions = {}): void {
  const previousBalance = state.fuelBalance;
  const nextBalance = recalculateFuelBalance(state.records, state.fuelBalance);
  state.fuelBalance = nextBalance;
  persistState();

  if (!options.appendAdjustmentLog || !isFuelBalanceChanged(previousBalance, nextBalance)) {
    return;
  }

  const balanceChangedAtUnix = Number.isFinite(options.balanceChangedAtUnix) ? Number(options.balanceChangedAtUnix) : nowUnixSeconds();
  const adjustment = appendFuelBalanceAdjustmentLog({
    source: options.adjustmentSource ?? 'records',
    balanceChangedAtUnix,
    balance: nextBalance,
  });

  if (options.submitAdjustmentToGithub !== false) {
    trySubmitFuelBalanceAdjustmentInBackground(adjustment.id);
  }
}

function showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  state.toast.visible = true;
  state.toast.message = message;
  state.toast.type = type;

  if (toastTimer !== null) {
    window.clearTimeout(toastTimer);
  }

  toastTimer = window.setTimeout(() => {
    state.toast.visible = false;
  }, 3000);
}

function hideToast(): void {
  state.toast.visible = false;
}

export async function initializeStore(): Promise<void> {
  if (state.initialized) {
    return;
  }

  const [fileConfig, localConfig, persistedData, localDeviceMeta] = await Promise.all([
    loadConfigFile(),
    Promise.resolve(loadLocalConfig()),
    Promise.resolve(loadAppData()),
    Promise.resolve(loadDeviceMeta()),
  ]);

  state.config = resolveAppConfig(fileConfig, localConfig);
  const vaultToken = loadGithubTokenFromVault();
  const legacyToken = loadLegacyGithubTokenFromLocalConfig();
  if (!vaultToken && legacyToken) {
    saveGithubTokenToVault(legacyToken);
    state.githubToken = legacyToken;
  } else {
    state.githubToken = vaultToken;
  }

  if (legacyToken) {
    removeLegacyGithubTokenFromLocalConfig();
  }

  applyBranding(state.config);
  state.deviceMeta = sanitizeDeviceMeta(localDeviceMeta);
  state.userProfile = sanitizeUserProfile(persistedData.userProfile);
  state.records = sanitizeRecords(persistedData.records, getCurrentGithubSubmissionTargetKey());
  state.recordTombstones = sanitizeRecordTombstones(persistedData.recordTombstones, getCurrentGithubSubmissionTargetKey());
  const activeTombstones = new Map<string, RecordTombstone>();
  for (const tombstone of state.recordTombstones) {
    const existing = activeTombstones.get(tombstone.recordId);
    if (!existing || tombstone.deletedAtUnix >= existing.deletedAtUnix) {
      activeTombstones.set(tombstone.recordId, tombstone);
    }
  }
  state.records = state.records.filter((record) => {
    const tombstone = activeTombstones.get(record.id);
    if (!tombstone) {
      return true;
    }
    return tombstone.deletedAtUnix < getRecordUpdatedAtUnix(record);
  });
  state.fuelBalance = sanitizeFuelBalance(persistedData.fuelBalance);
  state.fuelBalanceAdjustments = sanitizeFuelBalanceAdjustments(persistedData.fuelBalanceAdjustments);
  state.fuelBalance = recalculateFuelBalance(state.records, state.fuelBalance);
  state.initialized = true;

  saveDeviceMeta(state.deviceMeta);
  persistState();
}

function updateConfig(partial: Partial<AppConfig>): void {
  const previousTargetKey = getCurrentGithubSubmissionTargetKey();
  state.config = {
    ...state.config,
    ...partial,
  };
  applyBranding(state.config);
  saveLocalConfig(state.config);

  const nextTargetKey = getCurrentGithubSubmissionTargetKey();
  if (nextTargetKey !== previousTargetKey) {
    refreshRecordSubmissionStatusForTarget(nextTargetKey);
    persistState();
  }
}

function updateDeviceName(deviceName: string): void {
  const normalized = normalizeProfileText(deviceName, 80) || DEFAULT_DEVICE_NAME;
  const nextMeta: DeviceMeta = {
    ...state.deviceMeta,
    deviceName: normalized,
    updatedAt: nowIsoString(),
  };
  state.deviceMeta = nextMeta;
  saveDeviceMeta(nextMeta);
}

async function saveGithubToken(token: string): Promise<void> {
  const normalized = token.trim();
  if (!normalized) {
    state.githubToken = '';
    clearGithubTokenFromVault();
    return;
  }

  if (isSealedGithubToken(normalized)) {
    state.githubToken = normalized;
    saveGithubTokenToVault(normalized);
    return;
  }

  const backendBaseUrl = resolveReminderBackendBaseUrl(state.config);
  if (!backendBaseUrl) {
    throw new Error('请先配置提醒后端地址（reminderApiBaseUrl）或配置文件默认后端地址（reminderApiFallbackBaseUrl），再保存 GitHub Token。');
  }

  const sealed = await sealGithubTokenWithBackend(backendBaseUrl, normalized);
  state.githubToken = sealed.sealedToken;
  saveGithubTokenToVault(sealed.sealedToken);
}

async function clearLocalCache(options: ClearLocalCacheOptions = {}): Promise<void> {
  const clearPat = options.clearPat === true;
  const fileConfig = await loadConfigFile();
  const preservedDeviceMeta = state.deviceMeta;

  clearAppData();
  clearLocalConfig();
  clearReminderTasksStorage();
  clearReminderRingtoneConfig();
  clearReminderRingtoneSourceModeStorage();
  clearReminderSynthPatternConfigStorage();

  state.config = resolveAppConfig(fileConfig, {});
  applyBranding(state.config);
  state.deviceMeta = preservedDeviceMeta;
  state.userProfile = { ...DEFAULT_USER_PROFILE };
  state.records = [];
  state.recordTombstones = [];
  state.fuelBalance = createEmptyFuelBalance();
  state.fuelBalanceAdjustments = [];
  state.submittingRecordIds = [];
  state.toast.visible = false;

  if (clearPat) {
    clearGithubTokenFromVault();
    state.githubToken = '';
  } else {
    state.githubToken = loadGithubTokenFromVault();
  }

  saveDeviceMeta(state.deviceMeta);
  persistState();
}

function normalizeOptionalText(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function updateUserProfile(partial: Partial<UserProfile>): void {
  state.userProfile = sanitizeUserProfile({
    ...state.userProfile,
    ...partial,
  });
  persistState();
}

function setUserProfileAvatar(avatarDataUrl: string): void {
  state.userProfile = sanitizeUserProfile({
    ...state.userProfile,
    avatarDataUrl,
    avatarNeedsUpload: true,
  });
  persistState();
}

function clearUserProfileAvatar(): void {
  state.userProfile = sanitizeUserProfile({
    ...state.userProfile,
    avatarDataUrl: '',
    avatarMimeType: '',
    avatarGithubPath: undefined,
    avatarUpdatedAt: undefined,
    avatarNeedsUpload: true,
  });
  persistState();
}

async function syncUserProfileToGithub(): Promise<SyncUserProfileToGithubResult> {
  const profileSnapshot = sanitizeUserProfile(state.userProfile);
  const now = nowIsoString();
  const deviceId = state.deviceMeta.deviceId;
  const deviceName = state.deviceMeta.deviceName;

  let avatarPath = profileSnapshot.avatarGithubPath;
  let avatarUpdatedAt = profileSnapshot.avatarUpdatedAt;
  let avatarMimeType = profileSnapshot.avatarMimeType;

  if (profileSnapshot.avatarDataUrl) {
    if (profileSnapshot.avatarNeedsUpload || !avatarPath) {
      const avatarResult = await uploadUserAvatarToGithub(profileSnapshot.avatarDataUrl, state.config, state.githubToken, deviceId);
      avatarPath = avatarResult.path;
      avatarUpdatedAt = now;
      avatarMimeType = parseAvatarMimeTypeFromDataUrl(profileSnapshot.avatarDataUrl) || avatarMimeType;
    }
  } else {
    avatarPath = undefined;
    avatarUpdatedAt = undefined;
    avatarMimeType = '';
  }

  const profilePayload = {
    schemaVersion: 2,
    deviceId,
    deviceName: normalizeOptionalText(deviceName),
    displayName: profileSnapshot.displayName,
    email: normalizeOptionalText(profileSnapshot.email),
    phone: normalizeOptionalText(profileSnapshot.phone),
    location: normalizeOptionalText(profileSnapshot.location),
    bio: normalizeOptionalText(profileSnapshot.bio),
    avatarStyle: profileSnapshot.avatarStyle,
    avatarPath,
    avatarMimeType: normalizeOptionalText(avatarMimeType),
    avatarUpdatedAt: normalizeOptionalText(avatarUpdatedAt),
    updatedAt: now,
  };

  const profileResult = await submitUserProfileToGithub(profilePayload, state.config, state.githubToken, deviceId);

  state.userProfile = sanitizeUserProfile({
    ...profileSnapshot,
    avatarGithubPath: avatarPath,
    avatarUpdatedAt,
    avatarMimeType,
    avatarNeedsUpload: false,
    profileGithubPath: profileResult.path,
    profileUpdatedAt: now,
  });
  persistState();

  return {
    profilePath: profileResult.path,
    avatarPath,
  };
}

async function syncUserProfileFromGithub(): Promise<SyncUserProfileFromGithubResult> {
  const deviceId = state.deviceMeta.deviceId;
  const fetched = (await fetchUserProfileFromGithub(state.config, state.githubToken, deviceId)) ?? (await fetchUserProfileFromGithub(state.config, state.githubToken));
  if (!fetched) {
    return {
      exists: false,
      avatarLoaded: false,
    };
  }

  let avatarDataUrl = '';
  let avatarLoaded = false;

  if (fetched.profile.avatarPath) {
    avatarDataUrl = await fetchUserAvatarDataUrlFromGithub(fetched.profile.avatarPath, state.config, state.githubToken);
    avatarLoaded = true;
  }

  state.userProfile = sanitizeUserProfile({
    ...state.userProfile,
    displayName: fetched.profile.displayName,
    email: fetched.profile.email ?? '',
    phone: fetched.profile.phone ?? '',
    location: fetched.profile.location ?? '',
    bio: fetched.profile.bio ?? '',
    avatarStyle: fetched.profile.avatarStyle,
    avatarDataUrl,
    avatarMimeType: fetched.profile.avatarMimeType ?? parseAvatarMimeTypeFromDataUrl(avatarDataUrl),
    avatarGithubPath: fetched.profile.avatarPath,
    avatarUpdatedAt: fetched.profile.avatarUpdatedAt,
    avatarNeedsUpload: false,
    profileGithubPath: fetched.path,
    profileUpdatedAt: fetched.profile.updatedAt,
  });
  persistState();

  return {
    exists: true,
    avatarLoaded,
  };
}

function addFuelRecord(input: FuelRecordInput): FuelRecord {
  const fuelType = parsePositiveNumber(input.fuelType);
  const price = parsePositiveNumber(input.pricePerLiter);
  const volume = parsePositiveNumber(input.fuelVolumeLiters);
  const total = parsePositiveNumber(input.totalPriceCny);

  if (fuelType === null || price === null || volume === null || total === null) {
    throw new Error('加油记录存在无效数值，请检查。');
  }

  const createdAtUnix = nowUnixSeconds();
  const createdAt = nowIsoString();
  const occurred = normalizeOccurredTime({
    occurredAt: undefined,
    occurredAtUnix: input.occurredAtUnix,
    fallbackUnix: createdAtUnix,
  });
  const record: FuelRecord = {
    id: makeRecordId('fuel'),
    type: 'fuel',
    occurredAt: occurred.occurredAt,
    occurredAtUnix: occurred.occurredAtUnix,
    createdAt,
    createdAtUnix,
    updatedAt: createdAt,
    updatedAtUnix: createdAtUnix,
    sourceDeviceId: state.deviceMeta.deviceId,
    sourceDeviceName: state.deviceMeta.deviceName,
    province: input.province?.trim() || undefined,
    fuelType: Math.round(fuelType),
    pricePerLiter: roundTo(price, 2),
    fuelVolumeLiters: roundTo(volume, 3),
    totalPriceCny: roundTo(total, 2),
    stationName: input.stationName?.trim() || undefined,
    note: input.note?.trim() || undefined,
    submittedToGithub: false,
    githubSubmittedTargets: [],
  };

  state.records = [...state.records, record].sort(compareRecordsByTimeAsc);
  recalculateAndPersist({
    appendAdjustmentLog: true,
    adjustmentSource: 'records',
    balanceChangedAtUnix: record.occurredAtUnix,
  });
  return record;
}

function addTripRecord(input: TripRecordInput): TripRecord {
  const average = parsePositiveNumber(input.averageFuelConsumptionPer100Km);
  const distance = parsePositiveNumber(input.distanceKm);
  const price = parsePositiveNumber(input.pricePerLiter);

  if (average === null || distance === null || price === null) {
    throw new Error('耗油记录存在无效数值，请检查。');
  }

  const consumedFuelLiters = roundTo((distance / 100) * average, 3);
  const totalFuelCostCny = roundTo(consumedFuelLiters * price, 2);
  const createdAtUnix = nowUnixSeconds();
  const createdAt = nowIsoString();
  const occurred = normalizeOccurredTime({
    occurredAt: undefined,
    occurredAtUnix: input.occurredAtUnix,
    fallbackUnix: createdAtUnix,
  });

  const record: TripRecord = {
    id: makeRecordId('trip'),
    type: 'trip',
    occurredAt: occurred.occurredAt,
    occurredAtUnix: occurred.occurredAtUnix,
    createdAt,
    createdAtUnix,
    updatedAt: createdAt,
    updatedAtUnix: createdAtUnix,
    sourceDeviceId: state.deviceMeta.deviceId,
    sourceDeviceName: state.deviceMeta.deviceName,
    averageFuelConsumptionPer100Km: roundTo(average, 2),
    distanceKm: roundTo(distance, 2),
    consumedFuelLiters,
    pricePerLiter: roundTo(price, 2),
    totalFuelCostCny,
    startLocation: input.startLocation?.trim() || undefined,
    endLocation: input.endLocation?.trim() || undefined,
    note: input.note?.trim() || undefined,
    submittedToGithub: false,
    githubSubmittedTargets: [],
  };

  state.records = [...state.records, record].sort(compareRecordsByTimeAsc);
  recalculateAndPersist({
    appendAdjustmentLog: true,
    adjustmentSource: 'records',
    balanceChangedAtUnix: record.occurredAtUnix,
  });
  return record;
}

function updateFuelRecord(recordId: string, input: FuelRecordInput): UpdateRecordResult {
  const index = state.records.findIndex((record) => record.id === recordId);

  if (index < 0) {
    throw new Error('未找到对应的加油记录。');
  }

  const current = state.records[index];
  if (current.type !== 'fuel') {
    throw new Error('记录类型不匹配，无法更新加油记录。');
  }

  const fuelType = parsePositiveNumber(input.fuelType);
  const price = parsePositiveNumber(input.pricePerLiter);
  const volume = parsePositiveNumber(input.fuelVolumeLiters);
  const total = parsePositiveNumber(input.totalPriceCny);

  if (fuelType === null || price === null || volume === null || total === null) {
    throw new Error('加油记录存在无效数值，请检查。');
  }

  const occurred = normalizeOccurredTime({
    occurredAt: undefined,
    occurredAtUnix: input.occurredAtUnix,
    fallbackUnix: current.createdAtUnix,
  });

  const next: FuelRecord = {
    ...current,
    occurredAt: occurred.occurredAt,
    occurredAtUnix: occurred.occurredAtUnix,
    updatedAt: nowIsoString(),
    updatedAtUnix: nowUnixSeconds(),
    sourceDeviceId: state.deviceMeta.deviceId,
    sourceDeviceName: state.deviceMeta.deviceName,
    province: normalizeOptionalText(input.province),
    fuelType: Math.round(fuelType),
    pricePerLiter: roundTo(price, 2),
    fuelVolumeLiters: roundTo(volume, 3),
    totalPriceCny: roundTo(total, 2),
    stationName: normalizeOptionalText(input.stationName),
    note: normalizeOptionalText(input.note),
  };

  const updated =
    next.occurredAtUnix !== current.occurredAtUnix ||
    next.province !== current.province ||
    next.fuelType !== current.fuelType ||
    next.pricePerLiter !== current.pricePerLiter ||
    next.fuelVolumeLiters !== current.fuelVolumeLiters ||
    next.totalPriceCny !== current.totalPriceCny ||
    next.stationName !== current.stationName ||
    next.note !== current.note;

  if (!updated) {
    return {
      updated: false,
      wasSubmittedToGithub: current.submittedToGithub,
      isSubmittedToGithub: current.submittedToGithub,
    };
  }

  const wasSubmittedToGithub = current.submittedToGithub;
  next.submittedToGithub = false;
  next.githubSubmittedTargets = [];
  state.records[index] = next;
  state.records = [...state.records].sort(compareRecordsByTimeAsc);
  recalculateAndPersist({
    appendAdjustmentLog: true,
    adjustmentSource: 'records',
    balanceChangedAtUnix: nowUnixSeconds(),
  });

  return {
    updated: true,
    wasSubmittedToGithub,
    isSubmittedToGithub: next.submittedToGithub,
  };
}

function updateTripRecord(recordId: string, input: TripRecordInput): UpdateRecordResult {
  const index = state.records.findIndex((record) => record.id === recordId);

  if (index < 0) {
    throw new Error('未找到对应的耗油记录。');
  }

  const current = state.records[index];
  if (current.type !== 'trip') {
    throw new Error('记录类型不匹配，无法更新耗油记录。');
  }

  const average = parsePositiveNumber(input.averageFuelConsumptionPer100Km);
  const distance = parsePositiveNumber(input.distanceKm);
  const price = parsePositiveNumber(input.pricePerLiter);

  if (average === null || distance === null || price === null) {
    throw new Error('耗油记录存在无效数值，请检查。');
  }

  const consumedFuelLiters = roundTo((distance / 100) * average, 3);
  const totalFuelCostCny = roundTo(consumedFuelLiters * price, 2);
  const occurred = normalizeOccurredTime({
    occurredAt: undefined,
    occurredAtUnix: input.occurredAtUnix,
    fallbackUnix: current.createdAtUnix,
  });

  const next: TripRecord = {
    ...current,
    occurredAt: occurred.occurredAt,
    occurredAtUnix: occurred.occurredAtUnix,
    updatedAt: nowIsoString(),
    updatedAtUnix: nowUnixSeconds(),
    sourceDeviceId: state.deviceMeta.deviceId,
    sourceDeviceName: state.deviceMeta.deviceName,
    averageFuelConsumptionPer100Km: roundTo(average, 2),
    distanceKm: roundTo(distance, 2),
    consumedFuelLiters,
    pricePerLiter: roundTo(price, 2),
    totalFuelCostCny,
    startLocation: normalizeOptionalText(input.startLocation),
    endLocation: normalizeOptionalText(input.endLocation),
    note: normalizeOptionalText(input.note),
  };

  const updated =
    next.occurredAtUnix !== current.occurredAtUnix ||
    next.averageFuelConsumptionPer100Km !== current.averageFuelConsumptionPer100Km ||
    next.distanceKm !== current.distanceKm ||
    next.consumedFuelLiters !== current.consumedFuelLiters ||
    next.pricePerLiter !== current.pricePerLiter ||
    next.totalFuelCostCny !== current.totalFuelCostCny ||
    next.startLocation !== current.startLocation ||
    next.endLocation !== current.endLocation ||
    next.note !== current.note;

  if (!updated) {
    return {
      updated: false,
      wasSubmittedToGithub: current.submittedToGithub,
      isSubmittedToGithub: current.submittedToGithub,
    };
  }

  const wasSubmittedToGithub = current.submittedToGithub;
  next.submittedToGithub = false;
  next.githubSubmittedTargets = [];
  state.records[index] = next;
  state.records = [...state.records].sort(compareRecordsByTimeAsc);
  recalculateAndPersist({
    appendAdjustmentLog: true,
    adjustmentSource: 'records',
    balanceChangedAtUnix: nowUnixSeconds(),
  });

  return {
    updated: true,
    wasSubmittedToGithub,
    isSubmittedToGithub: next.submittedToGithub,
  };
}
async function deleteRecord(recordId: string): Promise<void> {
  const current = state.records.find((record) => record.id === recordId);
  if (!current) {
    return;
  }

  state.records = state.records.filter((record) => record.id !== recordId);
  const nextTombstone = makeRecordTombstone(current);
  const existingIndex = state.recordTombstones.findIndex((item) => item.recordId === recordId);

  if (existingIndex >= 0) {
    state.recordTombstones[existingIndex] = nextTombstone;
  } else {
    state.recordTombstones.push(nextTombstone);
  }

  state.recordTombstones = [...state.recordTombstones].sort((a, b) => a.deletedAtUnix - b.deletedAtUnix);
  recalculateAndPersist({
    appendAdjustmentLog: true,
    adjustmentSource: 'records',
    balanceChangedAtUnix: nowUnixSeconds(),
  });

  try {
    await submitRecordTombstone(recordId);
  } catch {
    // Keep local pending tombstone and let batch sync retry later.
  }
}

function resetFuelBaseline(): void {
  state.fuelBalance = {
    ...state.fuelBalance,
    manualOffsetLiters: 0,
  };
  recalculateAndPersist({
    appendAdjustmentLog: true,
    adjustmentSource: 'manual',
    balanceChangedAtUnix: nowUnixSeconds(),
  });
}

function isRecordSubmitting(recordId: string): boolean {
  return state.submittingRecordIds.includes(recordId);
}

async function submitRecord(recordId: string): Promise<{ path: string; sha?: string }> {
  const record = state.records.find((item) => item.id === recordId);

  if (!record) {
    throw new Error('记录不存在，无法提交。');
  }

  if (isRecordSubmitting(recordId)) {
    throw new Error('记录正在提交中，请稍候。');
  }

  state.submittingRecordIds = [...state.submittingRecordIds, recordId];

  try {
    const result = await submitRecordToGithub(record, state.config, state.githubToken);
    const targetKey = getCurrentGithubSubmissionTargetKey();
    const targets = normalizeGithubSubmittedTargets(record.githubSubmittedTargets);

    if (targetKey && !targets.includes(targetKey)) {
      targets.push(targetKey);
    }

    record.githubSubmittedTargets = targets;
    record.submittedToGithub = targetKey ? targets.includes(targetKey) : true;
    state.recordTombstones = state.recordTombstones.filter((item) => item.recordId !== record.id);
    persistState();
    return result;
  } finally {
    state.submittingRecordIds = state.submittingRecordIds.filter((id) => id !== recordId);
  }
}

function getPendingRecordTombstoneIds(recordType?: RecordType): string[] {
  const targetKey = getCurrentGithubSubmissionTargetKey();
  return state.recordTombstones
    .filter(
      (item) =>
        !(targetKey ? item.githubSubmittedTargets.includes(targetKey) : item.submittedToGithub) &&
        (!recordType || item.recordType === recordType),
    )
    .map((item) => item.recordId);
}

async function submitRecordTombstone(recordId: string): Promise<{ path: string; sha?: string }> {
  const existingTask = inFlightRecordTombstoneSubmissions.get(recordId);
  if (existingTask) {
    return existingTask;
  }

  const task = (async () => {
    const tombstone = state.recordTombstones.find((item) => item.recordId === recordId);
    if (!tombstone) {
      throw new Error('删除记录不存在，无法提交。');
    }

    const result = await submitRecordTombstoneToGithub(tombstone, state.config, state.githubToken);
    const targetKey = getCurrentGithubSubmissionTargetKey();
    const targets = normalizeGithubSubmittedTargets(tombstone.githubSubmittedTargets);
    if (targetKey && !targets.includes(targetKey)) {
      targets.push(targetKey);
    }

    tombstone.githubSubmittedTargets = targets;
    tombstone.submittedToGithub = targetKey ? targets.includes(targetKey) : true;
    tombstone.githubPath = result.path;
    persistState();
    return result;
  })();

  inFlightRecordTombstoneSubmissions.set(recordId, task);

  try {
    return await task;
  } finally {
    inFlightRecordTombstoneSubmissions.delete(recordId);
  }
}

async function submitFuelBalanceAdjustment(adjustmentId: string): Promise<{ path: string; sha?: string }> {
  const existingTask = inFlightFuelBalanceAdjustmentSubmissions.get(adjustmentId);
  if (existingTask) {
    return existingTask;
  }

  const task = (async () => {
    const adjustment = state.fuelBalanceAdjustments.find((item) => item.id === adjustmentId);

    if (!adjustment) {
      throw new Error('油量变更日志不存在，无法提交。');
    }

    const result = await appendFuelBalanceAdjustmentToGithub(adjustment, state.config, state.githubToken);
    adjustment.submittedToGithub = true;
    adjustment.githubPath = result.path;
    persistState();
    return result;
  })();

  inFlightFuelBalanceAdjustmentSubmissions.set(adjustmentId, task);

  try {
    return await task;
  } finally {
    inFlightFuelBalanceAdjustmentSubmissions.delete(adjustmentId);
  }
}

async function updateRemainingFuelLiters(input: UpdateFuelBalanceInput): Promise<UpdateFuelBalanceResult> {
  const nextRemaining = Number(input.remainingFuelLiters);

  if (!Number.isFinite(nextRemaining)) {
    throw new Error('当前剩余油量必须是有效数字。');
  }

  const snapshotBalance = recalculateFuelBalance(state.records, state.fuelBalance);
  if (!snapshotBalance.baselineEstablished || snapshotBalance.autoCalculatedFuelLiters === null) {
    throw new Error('暂无加油记录，无法手动修改当前剩余油量。');
  }

  const normalizedRemaining = roundTo(nextRemaining, 3);
  const autoCalculatedFuelLiters = snapshotBalance.autoCalculatedFuelLiters;
  const manualOffsetLiters = roundTo(normalizedRemaining - autoCalculatedFuelLiters, 3);

  const balanceChangedAtUnixRaw = Number.isFinite(input.balanceChangedAtUnix) ? Number(input.balanceChangedAtUnix) : nowUnixSeconds();
  const balanceChangedAtUnix = Math.floor(balanceChangedAtUnixRaw);

  state.fuelBalance = {
    ...snapshotBalance,
    manualOffsetLiters,
  };
  state.fuelBalance = recalculateFuelBalance(state.records, state.fuelBalance);

  const adjustment = appendFuelBalanceAdjustmentLog({
    source: 'manual',
    balanceChangedAtUnix,
    balance: state.fuelBalance,
  });

  try {
    const result = await submitFuelBalanceAdjustment(adjustment.id);
    return {
      submittedToGithub: true,
      adjustment,
      message: result.path,
    };
  } catch (error) {
    return {
      submittedToGithub: false,
      adjustment,
      message: error instanceof Error ? error.message : '油量变更日志提交失败。',
    };
  }
}

function getPendingFuelBalanceAdjustmentIds(): string[] {
  return state.fuelBalanceAdjustments.filter((item) => !item.submittedToGithub).map((item) => item.id);
}

async function syncPendingFuelBalanceAdjustments(): Promise<BatchFuelBalanceAdjustmentSubmitResult> {
  const pendingIds = getPendingFuelBalanceAdjustmentIds();
  const successAdjustmentIds: string[] = [];
  const failures: Array<{ adjustmentId: string; message: string }> = [];

  for (const adjustmentId of pendingIds) {
    try {
      await submitFuelBalanceAdjustment(adjustmentId);
      successAdjustmentIds.push(adjustmentId);
    } catch (error) {
      failures.push({
        adjustmentId,
        message: error instanceof Error ? error.message : '提交失败。',
      });
    }
  }

  return {
    successCount: successAdjustmentIds.length,
    failedCount: failures.length,
    successAdjustmentIds,
    failures,
  };
}

function importRecords(raw: unknown): ImportRecordsResult {
  const candidates = normalizeImportPayload(raw);

  if (candidates.length === 0) {
    return { added: 0, skipped: 0, invalid: 0 };
  }

  const sanitized: AppRecord[] = [];
  let invalid = 0;
  const targetKey = getCurrentGithubSubmissionTargetKey();

  for (const item of candidates) {
    const normalized = sanitizeRecord(item, targetKey);

    if (normalized === null) {
      invalid += 1;
      continue;
    }

    sanitized.push(normalized);
  }

  const merged = mergeRecords(sanitized);

  return {
    added: merged.added,
    skipped: merged.skipped,
    invalid,
  };
}

async function submitRecords(recordIds: string[]): Promise<BatchSubmitResult> {
  const uniqueIds = Array.from(new Set(recordIds));
  const successRecordIds: string[] = [];
  const failures: Array<{ recordId: string; message: string }> = [];

  for (const recordId of uniqueIds) {
    const exists = state.records.some((record) => record.id === recordId);

    if (!exists) {
      failures.push({
        recordId,
        message: '记录不存在，已跳过。',
      });
      continue;
    }

    try {
      await submitRecord(recordId);
      successRecordIds.push(recordId);
    } catch (error) {
      failures.push({
        recordId,
        message: error instanceof Error ? error.message : '提交失败。',
      });
    }
  }

  return {
    successCount: successRecordIds.length,
    failedCount: failures.length,
    successRecordIds,
    failures,
  };
}

async function submitRecordTombstones(recordIds: string[]): Promise<BatchSubmitResult> {
  const uniqueIds = Array.from(new Set(recordIds));
  const successRecordIds: string[] = [];
  const failures: Array<{ recordId: string; message: string }> = [];

  for (const recordId of uniqueIds) {
    const exists = state.recordTombstones.some((item) => item.recordId === recordId);

    if (!exists) {
      failures.push({
        recordId,
        message: '删除记录不存在，已跳过。',
      });
      continue;
    }

    try {
      await submitRecordTombstone(recordId);
      successRecordIds.push(recordId);
    } catch (error) {
      failures.push({
        recordId,
        message: error instanceof Error ? error.message : '提交失败。',
      });
    }
  }

  return {
    successCount: successRecordIds.length,
    failedCount: failures.length,
    successRecordIds,
    failures,
  };
}

function filterRecordsByType(records: unknown[], recordType?: RecordType): unknown[] {
  if (!recordType) {
    return records;
  }

  return records.filter((item) => {
    if (!item || typeof item !== 'object') {
      return false;
    }

    return (item as { type?: unknown }).type === recordType;
  });
}

function getPendingRecordIds(recordType?: RecordType): string[] {
  const targetKey = getCurrentGithubSubmissionTargetKey();
  return state.records
    .filter((record) => !isRecordSubmittedForTarget(record, targetKey) && (!recordType || record.type === recordType))
    .map((record) => record.id);
}

function getPendingRecordChangeCount(recordType?: RecordType): number {
  return getPendingRecordIds(recordType).length + getPendingRecordTombstoneIds(recordType).length;
}

async function submitPendingRecords(recordType?: RecordType): Promise<BatchSubmitResult> {
  const recordResult = await submitRecords(getPendingRecordIds(recordType));
  const tombstoneResult = await submitRecordTombstones(getPendingRecordTombstoneIds(recordType));

  return {
    successCount: recordResult.successCount + tombstoneResult.successCount,
    failedCount: recordResult.failedCount + tombstoneResult.failedCount,
    successRecordIds: [...recordResult.successRecordIds, ...tombstoneResult.successRecordIds],
    failures: [...recordResult.failures, ...tombstoneResult.failures],
  };
}

async function syncRecordsFromGithub(recordType?: RecordType): Promise<SyncRecordsResult> {
  const remoteBundle = await fetchRecordsFromGithub(state.config, state.githubToken);
  const targetKey = getCurrentGithubSubmissionTargetKey();
  const localRecordsMap = new Map(state.records.map((record) => [record.id, record]));
  const previousSignature = state.records.map((record) => `${record.id}:${getRecordUpdatedAtUnix(record)}`).join('|');

  const filteredFromGithub = filterRecordsByType(remoteBundle.records, recordType);
  const normalizedRemoteRecords: AppRecord[] = [];
  let invalid = 0;

  for (const item of filteredFromGithub) {
    if (!item || typeof item !== 'object') {
      invalid += 1;
      continue;
    }

    const value = item as Record<string, unknown>;
    const targets = normalizeGithubSubmittedTargets(value.githubSubmittedTargets);
    if (targetKey && !targets.includes(targetKey)) {
      targets.push(targetKey);
    }

    const normalized = sanitizeRecord(
      {
        ...value,
        submittedToGithub: targetKey ? true : Boolean(value.submittedToGithub),
        githubSubmittedTargets: targets,
      },
      targetKey,
    );

    if (!normalized) {
      invalid += 1;
      continue;
    }

    normalizedRemoteRecords.push(normalized);
  }

  const latestRemoteRecordMap = new Map<string, AppRecord>();
  for (const record of normalizedRemoteRecords) {
    const existing = latestRemoteRecordMap.get(record.id);
    if (!existing || getRecordUpdatedAtUnix(record) >= getRecordUpdatedAtUnix(existing)) {
      latestRemoteRecordMap.set(record.id, record);
    }
  }

  let added = 0;
  let skipped = 0;

  for (const [recordId, remoteRecord] of latestRemoteRecordMap.entries()) {
    const localRecord = localRecordsMap.get(recordId);
    if (!localRecord) {
      localRecordsMap.set(recordId, remoteRecord);
      added += 1;
      continue;
    }

    if (getRecordUpdatedAtUnix(remoteRecord) > getRecordUpdatedAtUnix(localRecord)) {
      localRecordsMap.set(recordId, remoteRecord);
      continue;
    }

    skipped += 1;
  }

  const normalizedRemoteTombstones = remoteBundle.tombstones
    .filter((item) => !recordType || !item.recordType || item.recordType === recordType)
    .sort((a, b) => a.deletedAtUnix - b.deletedAtUnix);

  for (const tombstone of normalizedRemoteTombstones) {
    const localRecord = localRecordsMap.get(tombstone.recordId);
    if (localRecord && tombstone.deletedAtUnix >= getRecordUpdatedAtUnix(localRecord)) {
      localRecordsMap.delete(tombstone.recordId);
    }

    const localTombstone = state.recordTombstones.find((item) => item.recordId === tombstone.recordId);
    if (!localTombstone) {
      continue;
    }

    if (tombstone.deletedAtUnix >= localTombstone.deletedAtUnix) {
      const targets = normalizeGithubSubmittedTargets(localTombstone.githubSubmittedTargets);
      if (targetKey && !targets.includes(targetKey)) {
        targets.push(targetKey);
      }
      localTombstone.githubSubmittedTargets = targets;
      localTombstone.submittedToGithub = targetKey ? targets.includes(targetKey) : true;
      localTombstone.deletedAt = tombstone.deletedAt;
      localTombstone.deletedAtUnix = tombstone.deletedAtUnix;
    }
  }

  for (const tombstone of state.recordTombstones) {
    if (recordType && tombstone.recordType !== recordType) {
      continue;
    }

    const localRecord = localRecordsMap.get(tombstone.recordId);
    if (localRecord && tombstone.deletedAtUnix >= getRecordUpdatedAtUnix(localRecord)) {
      localRecordsMap.delete(tombstone.recordId);
    }
  }

  state.records = [...localRecordsMap.values()].sort(compareRecordsByTimeAsc);
  state.recordTombstones = [...state.recordTombstones].sort((a, b) => a.deletedAtUnix - b.deletedAtUnix);

  const nextSignature = state.records.map((record) => `${record.id}:${getRecordUpdatedAtUnix(record)}`).join('|');
  if (nextSignature !== previousSignature) {
    recalculateAndPersist({
      appendAdjustmentLog: true,
      adjustmentSource: 'records',
      balanceChangedAtUnix: nowUnixSeconds(),
    });
  } else {
    persistState();
  }

  return {
    fetched: filteredFromGithub.length,
    added,
    skipped,
    invalid,
  };
}

export function useAppStore() {
  return {
    state,
    initializeStore,
    updateConfig,
    updateDeviceName,
    saveGithubToken,
    clearLocalCache,
    updateUserProfile,
    setUserProfileAvatar,
    clearUserProfileAvatar,
    syncUserProfileToGithub,
    syncUserProfileFromGithub,
    addFuelRecord,
    addTripRecord,
    updateFuelRecord,
    updateTripRecord,
    deleteRecord,
    resetFuelBaseline,
    updateRemainingFuelLiters,
    getPendingFuelBalanceAdjustmentIds,
    syncPendingFuelBalanceAdjustments,
    importRecords,
    submitRecord,
    submitRecords,
    submitPendingRecords,
    getPendingRecordChangeCount,
    syncRecordsFromGithub,
    isRecordSubmitting,
    showToast,
    hideToast,
  };
}
