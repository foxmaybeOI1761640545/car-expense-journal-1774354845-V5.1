<template>
  <main class="page page--record">
    <PageHeader title="油耗记录" description="录入平均油耗、里程与油价，自动计算本次耗油量和费用。" />

    <section class="record-layout">
      <article class="card form-card">
        <h2>油耗记录表单</h2>
        <form class="form-grid" @submit.prevent="saveTripRecord">
          <label>
            平均油耗（L/100km）
            <input v-model="form.averageFuelConsumptionPer100Km" type="number" min="0.01" step="0.01" inputmode="decimal" />
          </label>

          <label>
            行驶距离（km）
            <input v-model="form.distanceKm" type="number" min="0.01" step="0.01" inputmode="decimal" />
          </label>

          <label class="full-width">
            油价（元/升）
            <input
              v-model="form.pricePerLiter"
              type="number"
              min="0.01"
              step="0.01"
              inputmode="decimal"
              :placeholder="latestFuelPricePerLiter === null ? '暂无加油记录，请手动输入油价' : ''"
              required
            />
          </label>

          <label class="full-width">
            耗油时间（可选）
            <input v-model="form.occurredAtText" type="datetime-local" />
          </label>

          <label>
            起点（可选）
            <input v-model="form.startLocation" type="text" list="trip-location-options" placeholder="如：杭州" />
          </label>

          <label>
            终点（可选）
            <input v-model="form.endLocation" type="text" list="trip-location-options" placeholder="如：宁波" />
          </label>

          <label v-if="historyNotes.length" class="full-width">
            历史备注快捷选择
            <select v-model="selectedHistoryNote" @change="applyHistoryNote">
              <option value="">请选择历史备注（可继续修改）</option>
              <option v-for="historyNote in historyNotes" :key="historyNote" :value="historyNote">
                {{ historyNote }}
              </option>
            </select>
          </label>

          <label class="full-width">
            备注（可选）
            <textarea v-model="form.note" rows="3" placeholder="例如：高速巡航为主"></textarea>
          </label>

          <datalist id="trip-location-options">
            <option v-for="location in historyLocations" :key="location" :value="location" />
          </datalist>

          <p class="hint full-width">本次耗油量自动计算：{{ consumedFuelPreview }}</p>
          <p class="hint full-width">本次油耗费用自动计算：{{ tripFuelCostPreview }}</p>

          <button class="btn btn--primary full-width" type="submit">保存到本地</button>
        </form>
      </article>

      <article class="card list-card">
        <div class="list-header">
          <h2>油耗历史</h2>
          <div class="inline-actions">
            <button class="btn btn--ghost" @click="exportTripJson">导出 JSON</button>
            <button class="btn btn--ghost" @click="exportTripCsv">导出 CSV</button>
            <button class="btn btn--ghost" @click="openImportDialog">导入 JSON</button>
            <button class="btn btn--ghost" :disabled="isSyncingFromGithub" @click="syncFromGithub">
              {{ isSyncingFromGithub ? '拉取中...' : '从 GitHub 拉取油耗历史' }}
            </button>
          </div>
          <input
            ref="importInputRef"
            type="file"
            accept="application/json,.json"
            class="visually-hidden"
            @change="handleImportFile"
          />
        </div>

        <div class="filter-grid">
          <label>
            备注/地点搜索
            <input v-model="keyword" type="text" placeholder="输入关键词" />
          </label>
          <label>
            提交状态
            <select v-model="submitFilter">
              <option value="all">全部</option>
              <option value="submitted">仅已提交</option>
              <option value="pending">仅未提交</option>
            </select>
          </label>
        </div>

        <div v-if="filteredRecords.length" class="batch-bar">
          <div class="inline-actions">
            <button class="btn btn--ghost" @click="toggleSelectAllFiltered">
              {{ isAllFilteredSelected ? '取消全选当前筛选' : '全选当前筛选' }}
            </button>
            <button class="btn btn--secondary" :disabled="isBatchSubmitting || !selectedRecordIds.length" @click="submitSelectedRecords">
              {{ isBatchSubmitting ? '提交中...' : `提交选中（${selectedRecordIds.length}）` }}
            </button>
            <button class="btn btn--secondary" :disabled="isBatchSubmitting || !pendingRecordIds.length" @click="submitAllPendingRecords">
              {{ isBatchSubmitting ? '提交中...' : `一键提交未提交（${pendingRecordIds.length}）` }}
            </button>
            <button class="btn btn--ghost" :disabled="!selectedRecordIds.length" @click="clearSelection">清空选择</button>
          </div>
          <p class="hint">已选 {{ selectedRecordIds.length }} 条记录</p>
        </div>

        <ul v-if="filteredRecords.length" class="history-list">
          <li v-for="record in filteredRecords" :key="record.id" class="history-item">
            <div class="history-item__top">
              <label class="checkbox-inline">
                <input v-model="selectedRecordIds" type="checkbox" :value="record.id" />
                <div class="history-item__title">
                  <strong>{{ toLocalDateTime(record.occurredAt) }}</strong>
                  <span class="muted">记录时间：{{ toLocalDateTime(record.createdAt) }}</span>
                </div>
              </label>
              <span :class="record.submittedToGithub ? 'tag tag--success' : 'tag'">
                {{ record.submittedToGithub ? '已提交 GitHub' : '未提交' }}
              </span>
            </div>

            <template v-if="editingRecordId === record.id">
              <form class="form-grid history-edit-panel" @submit.prevent="saveEditRecord(record.id)">
                <label>
                  平均油耗（L/100km）
                  <input v-model="editForm.averageFuelConsumptionPer100Km" type="number" min="0.01" step="0.01" inputmode="decimal" />
                </label>
                <label>
                  行驶距离（km）
                  <input v-model="editForm.distanceKm" type="number" min="0.01" step="0.01" inputmode="decimal" />
                </label>
                <label>
                  油价（元/升）
                  <input v-model="editForm.pricePerLiter" type="number" min="0.01" step="0.01" inputmode="decimal" />
                </label>
                <label class="full-width">
                  耗油时间（可选）
                  <input v-model="editForm.occurredAtText" type="datetime-local" />
                </label>
                <label>
                  起点（可选）
                  <input v-model="editForm.startLocation" type="text" list="trip-location-options" />
                </label>
                <label>
                  终点（可选）
                  <input v-model="editForm.endLocation" type="text" list="trip-location-options" />
                </label>
                <label class="full-width">
                  备注（可选）
                  <textarea v-model="editForm.note" rows="3"></textarea>
                </label>

                <p class="hint full-width">耗油量预估：{{ editConsumedFuelPreview }}</p>

                <div class="inline-actions full-width">
                  <button class="btn btn--primary" type="submit">保存修改</button>
                  <button class="btn btn--ghost" type="button" @click="cancelEdit">取消</button>
                </div>
              </form>
            </template>

            <template v-else>
              <p>
                平均油耗 {{ record.averageFuelConsumptionPer100Km.toFixed(2) }} L/100km · 行驶 {{ record.distanceKm.toFixed(2) }} km ·
                耗油 {{ record.consumedFuelLiters.toFixed(3) }} L · 油价 {{ formatTripPrice(record) }} · 费用 {{ formatTripCost(record) }}
              </p>
              <p class="muted route-text">
                <span class="route-point">{{ record.startLocation || '未填起点' }}</span>
                <span class="route-arrow" aria-hidden="true"></span>
                <span class="route-point">{{ record.endLocation || '未填终点' }}</span>
              </p>
              <p class="muted">{{ record.note || '无备注' }}</p>

              <div class="inline-actions">
                <button class="btn btn--ghost" :disabled="isBatchSubmitting" @click="startEdit(record)">编辑</button>
                <button class="btn btn--secondary" :disabled="isBatchSubmitting || isSubmitting(record.id)" @click="submitRecord(record.id)">
                  {{ isSubmitting(record.id) ? '提交中...' : '提交到 GitHub' }}
                </button>
                <button class="btn btn--danger" :disabled="isBatchSubmitting" @click="removeRecord(record.id)">删除</button>
              </div>
            </template>
          </li>
        </ul>

        <p v-else class="muted">暂无符合筛选条件的油耗记录。</p>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import { useAppStore } from '../stores/appStore';
import type { FuelRecord, TripRecord } from '../types/records';
import { parseDateTimeLocalToUnix, toDateTimeLocalInputValue, toLocalDateTime } from '../utils/date';
import { exportCsv, exportJson } from '../utils/export';
import { parsePositiveNumber, roundTo } from '../utils/number';

const store = useAppStore();

const latestFuelPricePerLiter = computed<number | null>(() => {
  const latestFuelRecord = store.state.records
    .filter((record): record is FuelRecord => record.type === 'fuel')
    .sort((a, b) => {
      if (a.occurredAtUnix === b.occurredAtUnix) {
        if (a.createdAtUnix === b.createdAtUnix) {
          return b.createdAt.localeCompare(a.createdAt);
        }

        return b.createdAtUnix - a.createdAtUnix;
      }

      return b.occurredAtUnix - a.occurredAtUnix;
    })[0];

  return latestFuelRecord?.pricePerLiter ?? null;
});

const form = reactive({
  averageFuelConsumptionPer100Km:
    store.state.config.defaultAverageFuelConsumptionPer100Km === undefined
      ? ''
      : store.state.config.defaultAverageFuelConsumptionPer100Km.toFixed(2),
  distanceKm: store.state.config.defaultDistanceKm === undefined ? '' : store.state.config.defaultDistanceKm.toFixed(2),
  pricePerLiter: latestFuelPricePerLiter.value === null ? '' : latestFuelPricePerLiter.value.toFixed(2),
  occurredAtText: '',
  startLocation: '',
  endLocation: '',
  note: store.state.config.defaultTripNote,
});

const editForm = reactive({
  averageFuelConsumptionPer100Km: '',
  distanceKm: '',
  pricePerLiter: '',
  occurredAtText: '',
  startLocation: '',
  endLocation: '',
  note: '',
});

const keyword = ref('');
const submitFilter = ref<'all' | 'submitted' | 'pending'>('all');
const selectedRecordIds = ref<string[]>([]);
const selectedHistoryNote = ref('');
const importInputRef = ref<HTMLInputElement | null>(null);
const isBatchSubmitting = ref(false);
const isSyncingFromGithub = ref(false);
const editingRecordId = ref<string | null>(null);

watch(
  latestFuelPricePerLiter,
  (value) => {
    if (form.pricePerLiter.trim()) {
      return;
    }

    form.pricePerLiter = value === null ? '' : value.toFixed(2);
  },
  { immediate: true },
);

const tripRecords = computed(() =>
  store.state.records
    .filter((record): record is TripRecord => record.type === 'trip')
    .sort((a, b) => {
      if (a.occurredAtUnix === b.occurredAtUnix) {
        if (a.createdAtUnix === b.createdAtUnix) {
          return b.createdAt.localeCompare(a.createdAt);
        }

        return b.createdAtUnix - a.createdAtUnix;
      }

      return b.occurredAtUnix - a.occurredAtUnix;
    }),
);

const filteredRecords = computed(() => {
  const keywordValue = keyword.value.trim().toLowerCase();

  return tripRecords.value.filter((record) => {
    const matchesKeyword =
      !keywordValue ||
      record.note?.toLowerCase().includes(keywordValue) ||
      record.startLocation?.toLowerCase().includes(keywordValue) ||
      record.endLocation?.toLowerCase().includes(keywordValue);

    const matchesSubmitStatus =
      submitFilter.value === 'all' ||
      (submitFilter.value === 'submitted' && record.submittedToGithub) ||
      (submitFilter.value === 'pending' && !record.submittedToGithub);

    return Boolean(matchesKeyword && matchesSubmitStatus);
  });
});

const pendingRecordIds = computed(() => tripRecords.value.filter((record) => !record.submittedToGithub).map((record) => record.id));
const filteredRecordIdSet = computed(() => new Set(filteredRecords.value.map((record) => record.id)));
const isAllFilteredSelected = computed(() => {
  if (!filteredRecords.value.length) {
    return false;
  }

  const selectedSet = new Set(selectedRecordIds.value);
  return filteredRecords.value.every((record) => selectedSet.has(record.id));
});

const historyLocations = computed(() => {
  const unique = new Set<string>();
  const values: string[] = [];

  for (const record of tripRecords.value) {
    for (const location of [record.startLocation, record.endLocation]) {
      const text = location?.trim();

      if (!text) {
        continue;
      }

      const key = text.toLowerCase();
      if (unique.has(key)) {
        continue;
      }

      unique.add(key);
      values.push(text);
    }
  }

  return values;
});

const historyNotes = computed(() => {
  const unique = new Set<string>();
  const values: string[] = [];

  for (const record of tripRecords.value) {
    const text = record.note?.trim();

    if (!text) {
      continue;
    }

    const key = text.toLowerCase();
    if (unique.has(key)) {
      continue;
    }

    unique.add(key);
    values.push(text);
  }

  return values;
});

watch(
  tripRecords,
  (records) => {
    const validIds = new Set(records.map((record) => record.id));
    selectedRecordIds.value = selectedRecordIds.value.filter((recordId) => validIds.has(recordId));
  },
  { immediate: true },
);

const consumedFuelLitersValue = computed<number | null>(() => {
  const average = parsePositiveNumber(form.averageFuelConsumptionPer100Km);
  const distance = parsePositiveNumber(form.distanceKm);

  if (average === null || distance === null) {
    return null;
  }

  return roundTo((distance / 100) * average, 3);
});

const consumedFuelPreview = computed(() => {
  if (consumedFuelLitersValue.value === null) {
    return '--';
  }

  return `${consumedFuelLitersValue.value.toFixed(3)} L`;
});

const tripFuelCostPreview = computed(() => {
  const price = parsePositiveNumber(form.pricePerLiter);

  if (consumedFuelLitersValue.value === null || price === null) {
    return '--';
  }

  return `${roundTo(consumedFuelLitersValue.value * price, 2).toFixed(2)} 元`;
});

const editConsumedFuelPreview = computed(() => {
  const average = parsePositiveNumber(editForm.averageFuelConsumptionPer100Km);
  const distance = parsePositiveNumber(editForm.distanceKm);

  if (average === null || distance === null) {
    return '--';
  }

  return `${roundTo((distance / 100) * average, 3).toFixed(3)} L`;
});

function resolveOccurredAtUnixOrReject(value: string): number | undefined {
  const parsed = parseDateTimeLocalToUnix(value);

  if (value.trim() && parsed === undefined) {
    throw new Error('耗油时间格式无效，请重新填写。');
  }

  return parsed;
}

function saveTripRecord(): void {
  const average = parsePositiveNumber(form.averageFuelConsumptionPer100Km);
  const distance = parsePositiveNumber(form.distanceKm);
  const price = parsePositiveNumber(form.pricePerLiter);

  if (average === null || distance === null || price === null) {
    store.showToast('请填写有效的正数：平均油耗、行驶距离、油价。', 'error');
    return;
  }

  try {
    store.addTripRecord({
      occurredAtUnix: resolveOccurredAtUnixOrReject(form.occurredAtText),
      averageFuelConsumptionPer100Km: average,
      distanceKm: distance,
      pricePerLiter: price,
      startLocation: form.startLocation,
      endLocation: form.endLocation,
      note: form.note,
    });
    store.showToast('油耗记录已保存到本地。', 'success');
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '保存失败。', 'error');
  }
}

function startEdit(record: TripRecord): void {
  editingRecordId.value = record.id;
  editForm.averageFuelConsumptionPer100Km = record.averageFuelConsumptionPer100Km.toFixed(2);
  editForm.distanceKm = record.distanceKm.toFixed(2);
  editForm.pricePerLiter = (record.pricePerLiter ?? 0).toFixed(2);
  editForm.occurredAtText = toDateTimeLocalInputValue(record.occurredAt);
  editForm.startLocation = record.startLocation ?? '';
  editForm.endLocation = record.endLocation ?? '';
  editForm.note = record.note ?? '';
}

function cancelEdit(): void {
  editingRecordId.value = null;
}

function saveEditRecord(recordId: string): void {
  const average = parsePositiveNumber(editForm.averageFuelConsumptionPer100Km);
  const distance = parsePositiveNumber(editForm.distanceKm);
  const price = parsePositiveNumber(editForm.pricePerLiter);

  if (average === null || distance === null || price === null) {
    store.showToast('请填写有效的正数：平均油耗、行驶距离、油价。', 'error');
    return;
  }

  try {
    const result = store.updateTripRecord(recordId, {
      occurredAtUnix: resolveOccurredAtUnixOrReject(editForm.occurredAtText),
      averageFuelConsumptionPer100Km: average,
      distanceKm: distance,
      pricePerLiter: price,
      startLocation: editForm.startLocation,
      endLocation: editForm.endLocation,
      note: editForm.note,
    });

    if (!result.updated) {
      store.showToast('未检测到变化。', 'info');
      return;
    }

    editingRecordId.value = null;

    if (result.wasSubmittedToGithub && !result.isSubmittedToGithub) {
      store.showToast('修改已保存，记录已标记为未提交，请重新同步到 GitHub。', 'info');
      return;
    }

    store.showToast('修改已保存到本地。', 'success');
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '保存修改失败。', 'error');
  }
}

function removeRecord(recordId: string): void {
  if (!window.confirm('确认删除该油耗记录吗？')) {
    return;
  }

  store.deleteRecord(recordId);
  selectedRecordIds.value = selectedRecordIds.value.filter((id) => id !== recordId);
  if (editingRecordId.value === recordId) {
    editingRecordId.value = null;
  }
  store.showToast('油耗记录已删除。', 'info');
}

function isSubmitting(recordId: string): boolean {
  return store.isRecordSubmitting(recordId);
}

async function submitRecord(recordId: string): Promise<void> {
  try {
    const result = await store.submitRecord(recordId);
    store.showToast(`提交成功：${result.path}`, 'success');
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '提交失败。', 'error');
  }
}

async function submitMultiple(recordIds: string[], label: string): Promise<void> {
  if (isBatchSubmitting.value) {
    return;
  }

  if (!recordIds.length) {
    store.showToast('没有可提交的记录。', 'info');
    return;
  }

  isBatchSubmitting.value = true;

  try {
    const result = await store.submitRecords(recordIds);
    const succeededSet = new Set(result.successRecordIds);
    selectedRecordIds.value = selectedRecordIds.value.filter((id) => !succeededSet.has(id));

    if (result.successCount > 0 && result.failedCount === 0) {
      store.showToast(`${label}提交成功，共 ${result.successCount} 条。`, 'success');
      return;
    }

    if (result.successCount > 0) {
      const firstFailure = result.failures[0]?.message ?? '部分记录提交失败。';
      store.showToast(`${label}完成：成功 ${result.successCount}，失败 ${result.failedCount}。${firstFailure}`, 'info');
      return;
    }

    const failure = result.failures[0]?.message ?? '提交失败。';
    store.showToast(failure, 'error');
  } finally {
    isBatchSubmitting.value = false;
  }
}

async function submitSelectedRecords(): Promise<void> {
  const selectedSet = new Set(selectedRecordIds.value);
  const targetIds = tripRecords.value
    .filter((record) => selectedSet.has(record.id) && !record.submittedToGithub)
    .map((record) => record.id);

  await submitMultiple(targetIds, '选中记录');
}

async function submitAllPendingRecords(): Promise<void> {
  await submitMultiple(pendingRecordIds.value, '未提交记录');
}

function toggleSelectAllFiltered(): void {
  if (isAllFilteredSelected.value) {
    selectedRecordIds.value = selectedRecordIds.value.filter((recordId) => !filteredRecordIdSet.value.has(recordId));
    return;
  }

  const merged = new Set(selectedRecordIds.value);
  for (const record of filteredRecords.value) {
    merged.add(record.id);
  }

  selectedRecordIds.value = [...merged];
}

function clearSelection(): void {
  selectedRecordIds.value = [];
}

function applyHistoryNote(): void {
  if (!selectedHistoryNote.value) {
    return;
  }

  form.note = selectedHistoryNote.value;
}

function openImportDialog(): void {
  importInputRef.value?.click();
}

async function handleImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text) as unknown;
    const result = store.importRecords(parsed);

    if (result.added > 0) {
      store.showToast(`导入完成：新增 ${result.added}，重复 ${result.skipped}，无效 ${result.invalid}。`, 'success');
    } else {
      store.showToast(`导入完成：新增 0，重复 ${result.skipped}，无效 ${result.invalid}。`, 'info');
    }
  } catch (error) {
    store.showToast(error instanceof Error ? `导入失败：${error.message}` : '导入失败。', 'error');
  } finally {
    input.value = '';
  }
}

async function syncFromGithub(): Promise<void> {
  if (isSyncingFromGithub.value) {
    return;
  }

  isSyncingFromGithub.value = true;

  try {
    const result = await store.syncRecordsFromGithub('trip');

    if (result.fetched === 0) {
      store.showToast('GitHub 目录暂无可导入的油耗记录。', 'info');
      return;
    }

    store.showToast(`拉取完成：读取 ${result.fetched} 条，新增 ${result.added}，重复 ${result.skipped}，无效 ${result.invalid}。`, 'success');
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '从 GitHub 拉取失败。', 'error');
  } finally {
    isSyncingFromGithub.value = false;
  }
}

function exportTripJson(): void {
  if (!filteredRecords.value.length) {
    store.showToast('暂无可导出的油耗记录。', 'info');
    return;
  }

  exportJson(`trip-records-${Date.now()}.json`, filteredRecords.value);
  store.showToast('已导出 JSON。', 'success');
}

function exportTripCsv(): void {
  if (!filteredRecords.value.length) {
    store.showToast('暂无可导出的油耗记录。', 'info');
    return;
  }

  exportCsv(
    `trip-records-${Date.now()}.csv`,
    [
      'occurredAt',
      'createdAt',
      'averageFuelConsumptionPer100Km',
      'distanceKm',
      'consumedFuelLiters',
      'pricePerLiter',
      'totalFuelCostCny',
      'startLocation',
      'endLocation',
      'note',
      'submittedToGithub',
    ],
    filteredRecords.value.map((record) => [
      toLocalDateTime(record.occurredAt),
      toLocalDateTime(record.createdAt),
      record.averageFuelConsumptionPer100Km.toFixed(2),
      record.distanceKm.toFixed(2),
      record.consumedFuelLiters.toFixed(3),
      record.pricePerLiter?.toFixed(2) ?? '',
      getTripFuelCost(record)?.toFixed(2) ?? '',
      record.startLocation ?? '',
      record.endLocation ?? '',
      record.note ?? '',
      record.submittedToGithub ? 'true' : 'false',
    ]),
  );

  store.showToast('已导出 CSV。', 'success');
}

function getTripFuelCost(record: TripRecord): number | null {
  if (record.totalFuelCostCny !== undefined) {
    return record.totalFuelCostCny;
  }

  if (record.pricePerLiter === undefined) {
    return null;
  }

  return roundTo(record.consumedFuelLiters * record.pricePerLiter, 2);
}

function formatTripPrice(record: TripRecord): string {
  if (record.pricePerLiter === undefined) {
    return '--';
  }

  return `${record.pricePerLiter.toFixed(2)} 元/L`;
}

function formatTripCost(record: TripRecord): string {
  const cost = getTripFuelCost(record);

  if (cost === null) {
    return '--';
  }

  return `${cost.toFixed(2)} 元`;
}
</script>
