import { reactive } from 'vue';
import type { AppConfig } from '../types/config';
import { DEFAULT_APP_CONFIG } from '../types/config';
import type { AppRecord, FuelRecord, RecordType, TripRecord } from '../types/records';
import type { AppStoreState, FuelBalanceAdjustmentLog, FuelBalanceState } from '../types/store';
import { createEmptyFuelBalance, recalculateFuelBalance } from '../services/balanceService';
import { applyBranding } from '../services/brandingService';
import { loadConfigFile, resolveAppConfig } from '../services/configService';
import { appendFuelBalanceAdjustmentToGithub, fetchRecordsFromGithub, submitRecordToGithub } from '../services/githubService';
import { loadAppData, loadLocalConfig, saveAppData, saveLocalConfig } from '../services/localStorageService';
import { nowIsoString, nowUnixSeconds } from '../utils/date';
import { parsePositiveNumber, roundTo } from '../utils/number';

interface FuelRecordInput {
  province?: string;
  fuelType: number;
  pricePerLiter: number;
  fuelVolumeLiters: number;
  totalPriceCny: number;
  stationName?: string;
  note?: string;
}

interface TripRecordInput {
  averageFuelConsumptionPer100Km: number;
  distanceKm: number;
  pricePerLiter: number;
  startLocation?: string;
  endLocation?: string;
  note?: string;
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

interface RecalculateAndPersistOptions {
  appendAdjustmentLog?: boolean;
  adjustmentSource?: 'manual' | 'records';
  balanceChangedAtUnix?: number;
  submitAdjustmentToGithub?: boolean;
}

let toastTimer: number | null = null;

const state = reactive<AppStoreState>({
  initialized: false,
  config: { ...DEFAULT_APP_CONFIG },
  records: [],
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
  if (a.createdAtUnix === b.createdAtUnix) {
    return a.createdAt.localeCompare(b.createdAt);
  }

  return a.createdAtUnix - b.createdAtUnix;
}

function compareFuelBalanceAdjustmentsByTimeAsc(a: FuelBalanceAdjustmentLog, b: FuelBalanceAdjustmentLog): number {
  if (a.recordedAtUnix === b.recordedAtUnix) {
    return a.recordedAt.localeCompare(b.recordedAt);
  }

  return a.recordedAtUnix - b.recordedAtUnix;
}

function persistState(): void {
  saveAppData({
    records: state.records,
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

function sanitizeRecord(raw: unknown): AppRecord | null {
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

  if (record.type === 'fuel') {
    const fuelType = parsePositiveNumber(record.fuelType as number);
    const pricePerLiter = parsePositiveNumber(record.pricePerLiter as number);
    const fuelVolumeLiters = parsePositiveNumber(record.fuelVolumeLiters as number);
    const totalPriceCny = parsePositiveNumber(record.totalPriceCny as number);

    if (fuelType === null || pricePerLiter === null || fuelVolumeLiters === null || totalPriceCny === null) {
      return null;
    }

    const normalized: FuelRecord = {
      id: record.id,
      type: 'fuel',
      createdAt: record.createdAt,
      createdAtUnix: Number(record.createdAtUnix),
      province: typeof record.province === 'string' ? record.province : undefined,
      fuelType: Math.round(fuelType),
      pricePerLiter: roundTo(pricePerLiter, 2),
      fuelVolumeLiters: roundTo(fuelVolumeLiters, 3),
      totalPriceCny: roundTo(totalPriceCny, 2),
      stationName: typeof record.stationName === 'string' ? record.stationName : undefined,
      note: typeof record.note === 'string' ? record.note : undefined,
      submittedToGithub: Boolean(record.submittedToGithub),
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

  const normalized: TripRecord = {
    id: record.id,
    type: 'trip',
    createdAt: record.createdAt,
    createdAtUnix: Number(record.createdAtUnix),
    averageFuelConsumptionPer100Km: roundTo(average, 2),
    distanceKm: roundTo(distance, 2),
    consumedFuelLiters: roundTo(consumed, 3),
    pricePerLiter: normalizedPricePerLiter,
    totalFuelCostCny: normalizedTotalFuelCostCny,
    startLocation: typeof record.startLocation === 'string' ? record.startLocation : undefined,
    endLocation: typeof record.endLocation === 'string' ? record.endLocation : undefined,
    note: typeof record.note === 'string' ? record.note : undefined,
    submittedToGithub: Boolean(record.submittedToGithub),
  };

  return normalized;
}

function sanitizeRecords(records: unknown): AppRecord[] {
  if (!Array.isArray(records)) {
    return [];
  }

  return records
    .map((item) => sanitizeRecord(item))
    .filter((item): item is AppRecord => item !== null)
    .sort(compareRecordsByTimeAsc);
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

function unixSecondsToIsoString(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);

  if (Number.isNaN(date.getTime())) {
    return nowIsoString();
  }

  return date.toISOString();
}

function normalizeNullableLiters(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return roundTo(Number(value), 3);
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
  }, 2600);
}

function hideToast(): void {
  state.toast.visible = false;
}

export async function initializeStore(): Promise<void> {
  if (state.initialized) {
    return;
  }

  const [fileConfig, localConfig, persistedData] = await Promise.all([loadConfigFile(), Promise.resolve(loadLocalConfig()), Promise.resolve(loadAppData())]);

  state.config = resolveAppConfig(fileConfig, localConfig);
  applyBranding(state.config);
  state.records = sanitizeRecords(persistedData.records);
  state.fuelBalance = sanitizeFuelBalance(persistedData.fuelBalance);
  state.fuelBalanceAdjustments = sanitizeFuelBalanceAdjustments(persistedData.fuelBalanceAdjustments);
  state.fuelBalance = recalculateFuelBalance(state.records, state.fuelBalance);
  state.initialized = true;

  persistState();
}

function updateConfig(partial: Partial<AppConfig>): void {
  state.config = {
    ...state.config,
    ...partial,
  };
  applyBranding(state.config);
  saveLocalConfig(state.config);
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
  const record: FuelRecord = {
    id: makeRecordId('fuel'),
    type: 'fuel',
    createdAt: nowIsoString(),
    createdAtUnix,
    province: input.province?.trim() || undefined,
    fuelType: Math.round(fuelType),
    pricePerLiter: roundTo(price, 2),
    fuelVolumeLiters: roundTo(volume, 3),
    totalPriceCny: roundTo(total, 2),
    stationName: input.stationName?.trim() || undefined,
    note: input.note?.trim() || undefined,
    submittedToGithub: false,
  };

  state.records.push(record);
  recalculateAndPersist({
    appendAdjustmentLog: true,
    adjustmentSource: 'records',
    balanceChangedAtUnix: createdAtUnix,
  });
  return record;
}

function addTripRecord(input: TripRecordInput): TripRecord {
  const average = parsePositiveNumber(input.averageFuelConsumptionPer100Km);
  const distance = parsePositiveNumber(input.distanceKm);
  const price = parsePositiveNumber(input.pricePerLiter);

  if (average === null || distance === null || price === null) {
    throw new Error('油耗记录存在无效数值，请检查。');
  }

  const consumedFuelLiters = roundTo((distance / 100) * average, 3);
  const totalFuelCostCny = roundTo(consumedFuelLiters * price, 2);
  const createdAtUnix = nowUnixSeconds();

  const record: TripRecord = {
    id: makeRecordId('trip'),
    type: 'trip',
    createdAt: nowIsoString(),
    createdAtUnix,
    averageFuelConsumptionPer100Km: roundTo(average, 2),
    distanceKm: roundTo(distance, 2),
    consumedFuelLiters,
    pricePerLiter: roundTo(price, 2),
    totalFuelCostCny,
    startLocation: input.startLocation?.trim() || undefined,
    endLocation: input.endLocation?.trim() || undefined,
    note: input.note?.trim() || undefined,
    submittedToGithub: false,
  };

  state.records.push(record);
  recalculateAndPersist({
    appendAdjustmentLog: true,
    adjustmentSource: 'records',
    balanceChangedAtUnix: createdAtUnix,
  });
  return record;
}

function deleteRecord(recordId: string): void {
  const next = state.records.filter((record) => record.id !== recordId);

  if (next.length === state.records.length) {
    return;
  }

  state.records = next;
  recalculateAndPersist({
    appendAdjustmentLog: true,
    adjustmentSource: 'records',
    balanceChangedAtUnix: nowUnixSeconds(),
  });
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
    const result = await submitRecordToGithub(record, state.config);
    record.submittedToGithub = true;
    persistState();
    return result;
  } finally {
    state.submittingRecordIds = state.submittingRecordIds.filter((id) => id !== recordId);
  }
}

async function submitFuelBalanceAdjustment(adjustmentId: string): Promise<{ path: string; sha?: string }> {
  const adjustment = state.fuelBalanceAdjustments.find((item) => item.id === adjustmentId);

  if (!adjustment) {
    throw new Error('油量变更日志不存在，无法提交。');
  }

  const result = await appendFuelBalanceAdjustmentToGithub(adjustment, state.config);
  adjustment.submittedToGithub = true;
  adjustment.githubPath = result.path;
  persistState();
  return result;
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

  for (const item of candidates) {
    const normalized = sanitizeRecord(item);

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
  return state.records
    .filter((record) => !record.submittedToGithub && (!recordType || record.type === recordType))
    .map((record) => record.id);
}

async function submitPendingRecords(recordType?: RecordType): Promise<BatchSubmitResult> {
  return submitRecords(getPendingRecordIds(recordType));
}

async function syncRecordsFromGithub(recordType?: RecordType): Promise<SyncRecordsResult> {
  const githubRecords = await fetchRecordsFromGithub(state.config);
  const filteredFromGithub = filterRecordsByType(githubRecords, recordType);
  const normalizedFromGithub = filteredFromGithub.map((item) => {
    if (!item || typeof item !== 'object') {
      return item;
    }

    return {
      ...(item as Record<string, unknown>),
      submittedToGithub: true,
    };
  });
  const importResult = importRecords(normalizedFromGithub);

  return {
    fetched: filteredFromGithub.length,
    ...importResult,
  };
}

export function useAppStore() {
  return {
    state,
    initializeStore,
    updateConfig,
    addFuelRecord,
    addTripRecord,
    deleteRecord,
    resetFuelBaseline,
    updateRemainingFuelLiters,
    getPendingFuelBalanceAdjustmentIds,
    syncPendingFuelBalanceAdjustments,
    importRecords,
    submitRecord,
    submitRecords,
    submitPendingRecords,
    syncRecordsFromGithub,
    isRecordSubmitting,
    showToast,
    hideToast,
  };
}
