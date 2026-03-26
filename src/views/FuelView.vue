<template>
  <main class="page page--record">
    <PageHeader title="加油记录" description="录入油价、油量与价格，支持自动补算与一致性检查。" />

    <section class="record-layout">
      <article class="card form-card">
        <h2>加油记录表单</h2>
        <form class="form-grid" @submit.prevent="saveFuelRecord">
          <label>
            地区/省份（可选）
            <input v-model="form.province" type="text" placeholder="如：浙江" />
          </label>

          <label>
            油号
            <input v-model="form.fuelType" type="number" min="1" step="1" />
          </label>

          <label>
            油价（元/升）
            <input
              v-model="form.pricePerLiter"
              type="number"
              min="0.01"
              step="0.01"
              inputmode="decimal"
              @input="autoFillMissing"
              @blur="autoFillMissing"
            />
          </label>

          <label>
            油量（升）
            <input
              v-model="form.fuelVolumeLiters"
              type="number"
              min="0.01"
              step="0.001"
              inputmode="decimal"
              @input="autoFillMissing"
              @blur="autoFillMissing"
            />
          </label>

          <label>
            价格（元）
            <input
              v-model="form.totalPriceCny"
              type="number"
              min="0.01"
              step="0.01"
              inputmode="decimal"
              @input="autoFillMissing"
              @blur="autoFillMissing"
            />
          </label>

          <label>
            加油站名称（可选）
            <input v-model="form.stationName" type="text" placeholder="如：中石化 XXX 站" />
          </label>

          <label class="full-width">
            加油时间（可选）
            <input v-model="form.occurredAtText" type="datetime-local" />
          </label>

          <label class="full-width">
            备注（可选）
            <textarea v-model="form.note" rows="3" placeholder="例如：周末返程前补油"></textarea>
          </label>

          <p v-if="consistencyWarning" class="alert alert--error full-width">
            加油记录数据可能有误，请检查（price × volume 与 total 误差 {{ consistencyDiff.toFixed(2) }}）。
          </p>

          <button class="btn btn--primary full-width" type="submit">保存到本地</button>
        </form>
      </article>

      <article class="card list-card">
        <div class="list-header">
          <h2>加油历史</h2>
          <div class="inline-actions">
            <button class="btn btn--ghost" @click="exportFuelJson">导出 JSON</button>
            <button class="btn btn--ghost" @click="exportFuelCsv">导出 CSV</button>
            <button class="btn btn--secondary" :disabled="isBatchSubmitting || pendingFuelChangeCount === 0" @click="submitAllPendingFuelRecords">
              {{ isBatchSubmitting ? '提交中...' : `一键提交未提交（${pendingFuelChangeCount}）` }}
            </button>
            <button class="btn btn--ghost" :disabled="isSyncingFromGithub" @click="syncFuelFromGithub">
              {{ isSyncingFromGithub ? '拉取中...' : '从 GitHub 拉取加油历史' }}
            </button>
          </div>
        </div>

        <div class="filter-grid">
          <label>
            备注/加油站搜索
            <input v-model="keyword" type="text" placeholder="输入关键词" />
          </label>
          <label>
            地区筛选
            <input v-model="provinceFilter" type="text" placeholder="如：浙江" />
          </label>
          <label>
            油号筛选
            <input v-model="fuelTypeFilter" type="text" placeholder="如：92" />
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

        <ul v-if="filteredRecords.length" class="history-list">
          <li v-for="record in filteredRecords" :key="record.id" class="history-item">
            <div class="history-item__top">
              <div class="history-item__title">
                <strong>{{ toLocalDateTime(record.occurredAt) }}</strong>
                <span class="muted">记录时间：{{ toLocalDateTime(record.createdAt) }}</span>
              </div>
              <span :class="record.submittedToGithub ? 'tag tag--success' : 'tag'">
                {{ record.submittedToGithub ? '已提交 GitHub' : '未提交' }}
              </span>
            </div>

            <template v-if="editingRecordId === record.id">
              <form class="form-grid history-edit-panel" @submit.prevent="saveEditRecord(record.id)">
                <label>
                  地区/省份（可选）
                  <input v-model="editForm.province" type="text" />
                </label>
                <label>
                  油号
                  <input v-model="editForm.fuelType" type="number" min="1" step="1" />
                </label>
                <label>
                  油价（元/升）
                  <input v-model="editForm.pricePerLiter" type="number" min="0.01" step="0.01" inputmode="decimal" />
                </label>
                <label>
                  油量（升）
                  <input v-model="editForm.fuelVolumeLiters" type="number" min="0.01" step="0.001" inputmode="decimal" />
                </label>
                <label>
                  价格（元）
                  <input v-model="editForm.totalPriceCny" type="number" min="0.01" step="0.01" inputmode="decimal" />
                </label>
                <label>
                  加油站名称（可选）
                  <input v-model="editForm.stationName" type="text" />
                </label>
                <label class="full-width">
                  加油时间（可选）
                  <input v-model="editForm.occurredAtText" type="datetime-local" />
                </label>
                <label class="full-width">
                  备注（可选）
                  <textarea v-model="editForm.note" rows="3"></textarea>
                </label>

                <div class="inline-actions full-width">
                  <button class="btn btn--primary" type="submit">保存修改</button>
                  <button class="btn btn--ghost" type="button" @click="cancelEdit">取消</button>
                </div>
              </form>
            </template>

            <template v-else>
              <p>
                油号 {{ record.fuelType }} · {{ record.pricePerLiter.toFixed(2) }} 元/L · {{ record.fuelVolumeLiters.toFixed(3) }} L ·
                {{ record.totalPriceCny.toFixed(2) }} 元
              </p>
              <p class="muted">{{ record.province || '未填地区' }} · {{ record.stationName || '未填加油站' }}</p>
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

        <p v-else class="muted">暂无符合筛选条件的加油记录。</p>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import { useAppStore } from '../stores/appStore';
import type { FuelRecord } from '../types/records';
import { parseDateTimeLocalToUnix, toDateTimeLocalInputValue, toLocalDateTime } from '../utils/date';
import { exportCsv, exportJson } from '../utils/export';
import { parsePositiveNumber, roundTo } from '../utils/number';

const CONSISTENCY_TOLERANCE = 0.1;

const store = useAppStore();

const form = reactive({
  province: store.state.config.defaultProvince,
  fuelType: String(store.state.config.defaultFuelType),
  pricePerLiter: store.state.config.defaultFuelPrice === undefined ? '' : store.state.config.defaultFuelPrice.toFixed(2),
  fuelVolumeLiters: '',
  totalPriceCny: '',
  stationName: '',
  occurredAtText: '',
  note: store.state.config.defaultFuelNote,
});

const editForm = reactive({
  province: '',
  fuelType: '',
  pricePerLiter: '',
  fuelVolumeLiters: '',
  totalPriceCny: '',
  stationName: '',
  occurredAtText: '',
  note: '',
});

const keyword = ref('');
const provinceFilter = ref('');
const fuelTypeFilter = ref('');
const submitFilter = ref<'all' | 'submitted' | 'pending'>('all');
const isBatchSubmitting = ref(false);
const isSyncingFromGithub = ref(false);
const editingRecordId = ref<string | null>(null);

const fuelRecords = computed(() =>
  store.state.records
    .filter((record): record is FuelRecord => record.type === 'fuel')
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
  return fuelRecords.value.filter((record) => {
    const keywordValue = keyword.value.trim().toLowerCase();
    const provinceValue = provinceFilter.value.trim().toLowerCase();
    const fuelTypeValue = fuelTypeFilter.value.trim();

    const matchesKeyword =
      !keywordValue ||
      record.note?.toLowerCase().includes(keywordValue) ||
      record.stationName?.toLowerCase().includes(keywordValue);

    const matchesProvince = !provinceValue || record.province?.toLowerCase().includes(provinceValue);
    const matchesFuelType = !fuelTypeValue || String(record.fuelType) === fuelTypeValue;

    const matchesSubmitStatus =
      submitFilter.value === 'all' ||
      (submitFilter.value === 'submitted' && record.submittedToGithub) ||
      (submitFilter.value === 'pending' && !record.submittedToGithub);

    return Boolean(matchesKeyword && matchesProvince && matchesFuelType && matchesSubmitStatus);
  });
});

const pendingFuelChangeCount = computed(() => store.getPendingRecordChangeCount('fuel'));

const consistencyDiff = computed(() => {
  const price = parsePositiveNumber(form.pricePerLiter);
  const volume = parsePositiveNumber(form.fuelVolumeLiters);
  const total = parsePositiveNumber(form.totalPriceCny);

  if (price === null || volume === null || total === null) {
    return 0;
  }

  return Math.abs(roundTo(price * volume, 2) - total);
});

const consistencyWarning = computed(() => consistencyDiff.value > CONSISTENCY_TOLERANCE);

interface FuelRecordDuplicateCheckInput {
  occurredAtUnix?: number;
  province?: string;
  fuelType: number;
  pricePerLiter: number;
  fuelVolumeLiters: number;
  totalPriceCny: number;
  stationName?: string;
  note?: string;
}

function normalizeOptionalText(value: string): string | undefined {
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function resetFuelForm(): void {
  form.province = '';
  form.fuelType = '';
  form.pricePerLiter = '';
  form.fuelVolumeLiters = '';
  form.totalPriceCny = '';
  form.stationName = '';
  form.occurredAtText = '';
  form.note = '';
}

function hasExactFuelDuplicate(input: FuelRecordDuplicateCheckInput): boolean {
  return fuelRecords.value.some((record) => {
    const sameOccurredAt = input.occurredAtUnix === undefined || record.occurredAtUnix === input.occurredAtUnix;

    return (
      sameOccurredAt &&
      record.province === input.province &&
      record.fuelType === input.fuelType &&
      record.pricePerLiter === input.pricePerLiter &&
      record.fuelVolumeLiters === input.fuelVolumeLiters &&
      record.totalPriceCny === input.totalPriceCny &&
      record.stationName === input.stationName &&
      record.note === input.note
    );
  });
}

function autoFillMissing(): void {
  const price = parsePositiveNumber(form.pricePerLiter);
  const volume = parsePositiveNumber(form.fuelVolumeLiters);
  const total = parsePositiveNumber(form.totalPriceCny);

  const missingCount = [price, volume, total].filter((value) => value === null).length;

  if (missingCount !== 1) {
    return;
  }

  if (price === null && volume !== null && total !== null) {
    form.pricePerLiter = roundTo(total / volume, 2).toFixed(2);
    return;
  }

  if (volume === null && price !== null && total !== null) {
    form.fuelVolumeLiters = roundTo(total / price, 3).toFixed(3);
    return;
  }

  if (total === null && price !== null && volume !== null) {
    form.totalPriceCny = roundTo(price * volume, 2).toFixed(2);
  }
}

function resolveOccurredAtUnixOrReject(value: string): number | undefined {
  const parsed = parseDateTimeLocalToUnix(value);

  if (value.trim() && parsed === undefined) {
    throw new Error('加油时间格式无效，请重新填写。');
  }

  return parsed;
}

function saveFuelRecord(): void {
  const fuelType = parsePositiveNumber(form.fuelType);
  const price = parsePositiveNumber(form.pricePerLiter);
  const volume = parsePositiveNumber(form.fuelVolumeLiters);
  const total = parsePositiveNumber(form.totalPriceCny);

  if (fuelType === null || price === null || volume === null || total === null) {
    store.showToast('请填写有效的正数：油号、油价、油量、价格。', 'error');
    return;
  }

  try {
    const occurredAtUnix = resolveOccurredAtUnixOrReject(form.occurredAtText);
    const duplicateCandidate: FuelRecordDuplicateCheckInput = {
      occurredAtUnix,
      province: normalizeOptionalText(form.province),
      fuelType: Math.round(fuelType),
      pricePerLiter: roundTo(price, 2),
      fuelVolumeLiters: roundTo(volume, 3),
      totalPriceCny: roundTo(total, 2),
      stationName: normalizeOptionalText(form.stationName),
      note: normalizeOptionalText(form.note),
    };

    if (hasExactFuelDuplicate(duplicateCandidate)) {
      const shouldContinue = window.confirm('检测到一条完全一致的加油记录，请检查是否重复录入。点击“确定”继续保存，点击“取消”返回检查。');
      if (!shouldContinue) {
        return;
      }
    }

    const hasConsistencyWarning = consistencyWarning.value;
    store.addFuelRecord({
      occurredAtUnix,
      province: form.province,
      fuelType,
      pricePerLiter: price,
      fuelVolumeLiters: volume,
      totalPriceCny: total,
      stationName: form.stationName,
      note: form.note,
    });

    resetFuelForm();

    if (hasConsistencyWarning) {
      store.showToast('记录已保存，但三项金额数据可能有误，请检查。', 'info');
    } else {
      store.showToast('加油记录已保存到本地。', 'success');
    }
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '保存失败。', 'error');
  }
}

function startEdit(record: FuelRecord): void {
  editingRecordId.value = record.id;
  editForm.province = record.province ?? '';
  editForm.fuelType = String(record.fuelType);
  editForm.pricePerLiter = record.pricePerLiter.toFixed(2);
  editForm.fuelVolumeLiters = record.fuelVolumeLiters.toFixed(3);
  editForm.totalPriceCny = record.totalPriceCny.toFixed(2);
  editForm.stationName = record.stationName ?? '';
  editForm.occurredAtText = toDateTimeLocalInputValue(record.occurredAt);
  editForm.note = record.note ?? '';
}

function cancelEdit(): void {
  editingRecordId.value = null;
}

function saveEditRecord(recordId: string): void {
  const fuelType = parsePositiveNumber(editForm.fuelType);
  const price = parsePositiveNumber(editForm.pricePerLiter);
  const volume = parsePositiveNumber(editForm.fuelVolumeLiters);
  const total = parsePositiveNumber(editForm.totalPriceCny);

  if (fuelType === null || price === null || volume === null || total === null) {
    store.showToast('请填写有效的正数：油号、油价、油量、价格。', 'error');
    return;
  }

  try {
    const result = store.updateFuelRecord(recordId, {
      occurredAtUnix: resolveOccurredAtUnixOrReject(editForm.occurredAtText),
      province: editForm.province,
      fuelType,
      pricePerLiter: price,
      fuelVolumeLiters: volume,
      totalPriceCny: total,
      stationName: editForm.stationName,
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

async function removeRecord(recordId: string): Promise<void> {
  if (!window.confirm('确认删除该加油记录吗？')) {
    return;
  }

  try {
    await store.deleteRecord(recordId);
    if (editingRecordId.value === recordId) {
      editingRecordId.value = null;
    }
    store.showToast('加油记录已删除。', 'info');
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '删除失败。', 'error');
  }
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

async function submitAllPendingFuelRecords(): Promise<void> {
  if (isBatchSubmitting.value) {
    return;
  }

  if (pendingFuelChangeCount.value === 0) {
    store.showToast('没有可提交的加油记录变更。', 'info');
    return;
  }

  isBatchSubmitting.value = true;

  try {
    const result = await store.submitPendingRecords('fuel');

    if (result.successCount > 0 && result.failedCount === 0) {
      store.showToast(`加油记录变更提交成功，共 ${result.successCount} 条。`, 'success');
      return;
    }

    if (result.successCount > 0) {
      const firstFailure = result.failures[0]?.message ?? '部分记录提交失败。';
      store.showToast(`加油记录变更提交完成：成功 ${result.successCount}，失败 ${result.failedCount}。${firstFailure}`, 'info');
      return;
    }

    store.showToast(result.failures[0]?.message ?? '提交失败。', 'error');
  } finally {
    isBatchSubmitting.value = false;
  }
}

async function syncFuelFromGithub(): Promise<void> {
  if (isSyncingFromGithub.value) {
    return;
  }

  isSyncingFromGithub.value = true;

  try {
    const result = await store.syncRecordsFromGithub('fuel');

    if (result.fetched === 0) {
      store.showToast('GitHub 目录暂无可导入的加油记录。', 'info');
      return;
    }

    store.showToast(`拉取完成：读取 ${result.fetched} 条，新增 ${result.added}，重复 ${result.skipped}，无效 ${result.invalid}。`, 'success');
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '从 GitHub 拉取失败。', 'error');
  } finally {
    isSyncingFromGithub.value = false;
  }
}

function exportFuelJson(): void {
  if (!filteredRecords.value.length) {
    store.showToast('暂无可导出的加油记录。', 'info');
    return;
  }

  exportJson(`fuel-records-${Date.now()}.json`, filteredRecords.value);
  store.showToast('已导出 JSON。', 'success');
}

function exportFuelCsv(): void {
  if (!filteredRecords.value.length) {
    store.showToast('暂无可导出的加油记录。', 'info');
    return;
  }

  exportCsv(
    `fuel-records-${Date.now()}.csv`,
    [
      'occurredAt',
      'createdAt',
      'province',
      'fuelType',
      'pricePerLiter',
      'fuelVolumeLiters',
      'totalPriceCny',
      'stationName',
      'note',
      'submittedToGithub',
    ],
    filteredRecords.value.map((record) => [
      toLocalDateTime(record.occurredAt),
      toLocalDateTime(record.createdAt),
      record.province ?? '',
      record.fuelType,
      record.pricePerLiter.toFixed(2),
      record.fuelVolumeLiters.toFixed(3),
      record.totalPriceCny.toFixed(2),
      record.stationName ?? '',
      record.note ?? '',
      record.submittedToGithub ? 'true' : 'false',
    ]),
  );

  store.showToast('已导出 CSV。', 'success');
}
</script>
