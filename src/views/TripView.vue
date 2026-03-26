<template>
  <main class="page page--record page--trip-record">
    <PageHeader title="耗油记录" description="录入平均油耗、里程与油价，自动计算本次耗油量和费用。" />

    <section class="record-layout">
      <article class="card form-card">
        <h2>耗油记录表单</h2>
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

          <label class="full-width">
            备注快捷模板
            <select v-model="selectedTemplateNote" @change="applyTemplateNote">
              <option value="">请选择快捷模板（可继续修改）</option>
              <option v-for="template in noteTemplates" :key="template" :value="template">
                {{ template }}
              </option>
            </select>
          </label>

          <label class="full-width">
            创建备注模板
            <input
              v-model="newTemplateNote"
              type="text"
              maxlength="120"
              placeholder="输入常用备注后点击“添加模板”"
              @keydown.enter.prevent="addNoteTemplate"
            />
          </label>

          <div class="inline-actions full-width">
            <button class="btn btn--ghost" type="button" @click="addNoteTemplate">添加模板</button>
            <button class="btn btn--ghost" type="button" :disabled="!selectedTemplateNote" @click="removeSelectedTemplate">删除当前模板</button>
          </div>

          <label class="full-width">
            备注（可选）
            <textarea v-model="form.note" rows="3" placeholder="例如：高速巡航为主"></textarea>
          </label>

          <datalist id="trip-location-options">
            <option v-for="location in historyLocations" :key="location" :value="location" />
          </datalist>

          <p class="hint full-width">本次耗油量自动计算：{{ consumedFuelPreview }}</p>
          <p class="hint full-width">本次耗油费用自动计算：{{ tripFuelCostPreview }}</p>

          <button class="btn btn--primary full-width" type="submit">保存到本地</button>
        </form>
      </article>

      <article class="card list-card">
        <div class="list-header">
          <h2>耗油历史</h2>
          <div class="inline-actions">
            <button class="btn btn--ghost" @click="exportTripJson">导出 JSON</button>
            <button class="btn btn--ghost" @click="exportTripCsv">导出 CSV</button>
            <button class="btn btn--ghost" @click="openImportDialog">导入 JSON</button>
            <button class="btn btn--ghost" :disabled="isSyncingFromGithub" @click="syncFromGithub">
              {{ isSyncingFromGithub ? '拉取中...' : '从 GitHub 拉取耗油历史' }}
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
            <input v-model="keyword" type="text" placeholder="输入关键字" />
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
            <button class="btn btn--secondary" :disabled="isBatchSubmitting || pendingTripChangeCount === 0" @click="submitAllPendingRecords">
              {{ isBatchSubmitting ? '提交中...' : `一键提交未提交（${pendingTripChangeCount}）` }}
            </button>
            <button class="btn btn--ghost" :disabled="!selectedRecordIds.length" @click="clearSelection">清空选择</button>
          </div>
          <p class="hint">已选 {{ selectedRecordIds.length }} 条记录</p>
        </div>

        <ul v-if="filteredRecords.length" class="history-list">
          <li
            v-for="record in filteredRecords"
            :key="record.id"
            :class="['history-item', { 'history-item--interactive': editingRecordId !== record.id }]"
            @click="openRecordDetail(record.id, $event)"
          >
            <div class="history-item__top history-item__top--desktop">
              <label class="checkbox-inline">
                <input v-model="selectedRecordIds" type="checkbox" :value="record.id" />
                <div class="history-item__title">
                  <strong>{{ toLocalDateTime(record.occurredAt) }}</strong>
                  <span class="muted">记录时间：{{ toLocalDateTime(record.createdAt) }}</span>
                </div>
              </label>
              <span :class="['tag', { 'tag--success': record.submittedToGithub, 'tag--pending': !record.submittedToGithub }]">
                {{ record.submittedToGithub ? '已提交' : '未提交' }}
              </span>
            </div>

            <div class="history-item__top history-item__top--mobile">
              <div class="history-item__title">
                <strong>{{ toLocalDateTime(record.occurredAt) }}</strong>
              </div>
              <span :class="['tag', { 'tag--success': record.submittedToGithub, 'tag--pending': !record.submittedToGithub }]">
                {{ record.submittedToGithub ? '已提交' : '未提交' }}
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
              <div class="history-item__desktop">
                <p>
                  平均油耗 {{ record.averageFuelConsumptionPer100Km.toFixed(2) }} L/100km · 行驶 {{ record.distanceKm.toFixed(2) }} km ·
                  耗油 {{ record.consumedFuelLiters.toFixed(3) }} L · 油价 {{ formatTripPrice(record) }} · 费用 {{ formatTripCost(record) }}
                </p>
                <p class="muted route-text">
                  <span class="route-point">{{ record.startLocation || '未填起点' }}</span>
                  <span class="route-arrow" aria-hidden="true"></span>
                  <span class="route-point">{{ record.endLocation || '未填终点' }}</span>
                </p>
                <p class="muted history-note-preview" :title="record.note || '无备注'">
                  {{ formatNotePreview(record.note) }}
                </p>

                <div class="inline-actions">
                  <button class="btn btn--ghost" type="button" :disabled="isBatchSubmitting" @click.stop="goToTripDetail(record.id)">详情</button>
                  <button class="btn btn--ghost" type="button" :disabled="isBatchSubmitting" @click.stop="startEdit(record)">编辑</button>
                  <button
                    class="btn btn--secondary"
                    type="button"
                    :disabled="isBatchSubmitting || isSubmitting(record.id)"
                    @click.stop="submitRecord(record.id)"
                  >
                    {{ isSubmitting(record.id) ? '提交中...' : '提交到 GitHub' }}
                  </button>
                  <button class="btn btn--danger" type="button" :disabled="isBatchSubmitting" @click.stop="removeRecord(record.id)">删除</button>
                </div>
              </div>

              <div class="history-item__mobile">
                <div class="history-item__metrics">
                  <p class="history-item__metric">
                    <span class="history-item__metric-label">平均油耗</span>
                    <span class="history-item__metric-value">{{ record.averageFuelConsumptionPer100Km.toFixed(2) }} L/100km</span>
                  </p>
                  <p class="history-item__metric">
                    <span class="history-item__metric-label">行驶</span>
                    <span class="history-item__metric-value">{{ record.distanceKm.toFixed(2) }} km</span>
                  </p>
                  <p class="history-item__metric">
                    <span class="history-item__metric-label">耗油</span>
                    <span class="history-item__metric-value">{{ record.consumedFuelLiters.toFixed(3) }} L</span>
                  </p>
                  <p class="history-item__metric">
                    <span class="history-item__metric-label">油价</span>
                    <span class="history-item__metric-value">{{ formatTripPrice(record) }}</span>
                  </p>
                  <p class="history-item__metric history-item__metric--wide">
                    <span class="history-item__metric-label">费用</span>
                    <span class="history-item__metric-value">{{ formatTripCost(record) }}</span>
                  </p>
                </div>

                <p class="muted route-text history-item__mobile-route">
                  <span class="route-point">{{ record.startLocation || '未填起点' }}</span>
                  <span class="route-arrow" aria-hidden="true"></span>
                  <span class="route-point">{{ record.endLocation || '未填终点' }}</span>
                </p>

                <p class="muted history-item__mobile-note" :title="record.note || '无备注'">
                  备注：{{ formatNotePreview(record.note) }}
                </p>

                <div class="inline-actions history-item__mobile-actions">
                  <button class="btn btn--ghost" type="button" :disabled="isBatchSubmitting" @click.stop="goToTripDetail(record.id)">详情</button>
                  <button
                    class="btn btn--secondary"
                    type="button"
                    :disabled="isBatchSubmitting || isSubmitting(record.id)"
                    @click.stop="submitRecord(record.id)"
                  >
                    {{ isSubmitting(record.id) ? '提交中...' : '提交到 GitHub' }}
                  </button>
                  <button class="btn btn--danger" type="button" :disabled="isBatchSubmitting" @click.stop="removeRecord(record.id)">删除</button>
                </div>
              </div>
            </template>
          </li>
        </ul>

        <p v-else class="muted">暂无符合筛选条件的耗油记录。</p>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '../components/PageHeader.vue';
import { useAppStore } from '../stores/appStore';
import type { FuelRecord, TripRecord } from '../types/records';
import { parseDateTimeLocalToUnix, toDateTimeLocalInputValue, toLocalDateTime } from '../utils/date';
import { exportCsv, exportJson } from '../utils/export';
import { parsePositiveNumber, roundTo } from '../utils/number';

const NOTE_TEMPLATE_STORAGE_KEY = 'trip-note-templates';
const NOTE_TEMPLATE_LIMIT = 30;
const NOTE_TEMPLATE_MAX_LENGTH = 120;

const router = useRouter();
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
const selectedTemplateNote = ref('');
const newTemplateNote = ref('');
const noteTemplates = ref<string[]>(loadNoteTemplates());
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

const pendingTripChangeCount = computed(() => store.getPendingRecordChangeCount('trip'));
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

interface TripRecordDuplicateCheckInput {
  occurredAtUnix?: number;
  averageFuelConsumptionPer100Km: number;
  distanceKm: number;
  consumedFuelLiters: number;
  pricePerLiter: number;
  totalFuelCostCny: number;
  startLocation?: string;
  endLocation?: string;
  note?: string;
}

function normalizeOptionalText(value: string): string | undefined {
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function resetTripForm(): void {
  form.averageFuelConsumptionPer100Km = '';
  form.distanceKm = '';
  form.pricePerLiter = '';
  form.occurredAtText = '';
  form.startLocation = '';
  form.endLocation = '';
  form.note = '';
  selectedTemplateNote.value = '';
}

function resolveTripTotalFuelCost(record: TripRecord): number | undefined {
  if (record.totalFuelCostCny !== undefined) {
    return record.totalFuelCostCny;
  }

  if (record.pricePerLiter === undefined) {
    return undefined;
  }

  return roundTo(record.consumedFuelLiters * record.pricePerLiter, 2);
}

function hasExactTripDuplicate(input: TripRecordDuplicateCheckInput): boolean {
  return tripRecords.value.some((record) => {
    const recordTotalFuelCost = resolveTripTotalFuelCost(record);
    const sameOccurredAt = input.occurredAtUnix === undefined || record.occurredAtUnix === input.occurredAtUnix;

    return (
      sameOccurredAt &&
      record.averageFuelConsumptionPer100Km === input.averageFuelConsumptionPer100Km &&
      record.distanceKm === input.distanceKm &&
      record.consumedFuelLiters === input.consumedFuelLiters &&
      record.pricePerLiter === input.pricePerLiter &&
      recordTotalFuelCost === input.totalFuelCostCny &&
      record.startLocation === input.startLocation &&
      record.endLocation === input.endLocation &&
      record.note === input.note
    );
  });
}

function normalizeTemplateText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, NOTE_TEMPLATE_MAX_LENGTH);
}

function loadNoteTemplates(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(NOTE_TEMPLATE_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const unique = new Set<string>();
    const values: string[] = [];

    for (const item of parsed) {
      if (typeof item !== 'string') {
        continue;
      }

      const text = normalizeTemplateText(item);
      if (!text) {
        continue;
      }

      const key = text.toLowerCase();
      if (unique.has(key)) {
        continue;
      }

      unique.add(key);
      values.push(text);

      if (values.length >= NOTE_TEMPLATE_LIMIT) {
        break;
      }
    }

    return values;
  } catch {
    return [];
  }
}

function persistNoteTemplates(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(NOTE_TEMPLATE_STORAGE_KEY, JSON.stringify(noteTemplates.value));
}

function addNoteTemplate(): void {
  const text = normalizeTemplateText(newTemplateNote.value);

  if (!text) {
    store.showToast('请输入模板内容后再添加。', 'info');
    return;
  }

  const exists = noteTemplates.value.some((item) => item.toLowerCase() === text.toLowerCase());
  if (exists) {
    selectedTemplateNote.value = noteTemplates.value.find((item) => item.toLowerCase() === text.toLowerCase()) ?? '';
    store.showToast('该模板已存在。', 'info');
    return;
  }

  noteTemplates.value = [text, ...noteTemplates.value].slice(0, NOTE_TEMPLATE_LIMIT);
  selectedTemplateNote.value = text;
  newTemplateNote.value = '';
  persistNoteTemplates();
  store.showToast('备注模板已保存。', 'success');
}

function removeSelectedTemplate(): void {
  const template = selectedTemplateNote.value;

  if (!template) {
    return;
  }

  noteTemplates.value = noteTemplates.value.filter((item) => item !== template);
  selectedTemplateNote.value = '';
  persistNoteTemplates();
  store.showToast('已删除当前备注模板。', 'info');
}

function applyTemplateNote(): void {
  if (!selectedTemplateNote.value) {
    return;
  }

  form.note = selectedTemplateNote.value;
  store.showToast('已应用备注模板，可继续编辑。', 'info');
}

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
    const occurredAtUnix = resolveOccurredAtUnixOrReject(form.occurredAtText);
    const consumedFuelLiters = roundTo((distance / 100) * average, 3);
    const duplicateCandidate: TripRecordDuplicateCheckInput = {
      occurredAtUnix,
      averageFuelConsumptionPer100Km: roundTo(average, 2),
      distanceKm: roundTo(distance, 2),
      consumedFuelLiters,
      pricePerLiter: roundTo(price, 2),
      totalFuelCostCny: roundTo(consumedFuelLiters * price, 2),
      startLocation: normalizeOptionalText(form.startLocation),
      endLocation: normalizeOptionalText(form.endLocation),
      note: normalizeOptionalText(form.note),
    };

    if (hasExactTripDuplicate(duplicateCandidate)) {
      const shouldContinue = window.confirm('检测到一条完全一致的耗油记录，请检查是否重复录入。点击“确定”继续保存，点击“取消”返回检查。');
      if (!shouldContinue) {
        return;
      }
    }

    store.addTripRecord({
      occurredAtUnix,
      averageFuelConsumptionPer100Km: average,
      distanceKm: distance,
      pricePerLiter: price,
      startLocation: form.startLocation,
      endLocation: form.endLocation,
      note: form.note,
    });
    resetTripForm();
    store.showToast('耗油记录已保存到本地。', 'success');
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

async function removeRecord(recordId: string): Promise<void> {
  if (!window.confirm('确认删除该耗油记录吗？')) {
    return;
  }

  try {
    await store.deleteRecord(recordId);
    selectedRecordIds.value = selectedRecordIds.value.filter((id) => id !== recordId);
    if (editingRecordId.value === recordId) {
      editingRecordId.value = null;
    }
    store.showToast('耗油记录已删除。', 'info');
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
  if (isBatchSubmitting.value) {
    return;
  }

  if (pendingTripChangeCount.value === 0) {
    store.showToast('没有可提交的耗油记录变更。', 'info');
    return;
  }

  isBatchSubmitting.value = true;

  try {
    const result = await store.submitPendingRecords('trip');

    if (result.successCount > 0 && result.failedCount === 0) {
      store.showToast(`耗油记录变更提交成功，共 ${result.successCount} 条。`, 'success');
      return;
    }

    if (result.successCount > 0) {
      const firstFailure = result.failures[0]?.message ?? '部分记录提交失败。';
      store.showToast(`耗油记录变更提交完成：成功 ${result.successCount}，失败 ${result.failedCount}。${firstFailure}`, 'info');
      return;
    }

    const failure = result.failures[0]?.message ?? '提交失败。';
    store.showToast(failure, 'error');
  } finally {
    isBatchSubmitting.value = false;
  }
}

function toggleSelectAllFiltered(): void {
  if (isAllFilteredSelected.value) {
    selectedRecordIds.value = selectedRecordIds.value.filter((recordId) => !filteredRecordIdSet.value.has(recordId));
    store.showToast('已取消当前筛选项的全选。', 'info');
    return;
  }

  const merged = new Set(selectedRecordIds.value);
  for (const record of filteredRecords.value) {
    merged.add(record.id);
  }

  selectedRecordIds.value = [...merged];
  store.showToast(`已选中当前筛选项（${filteredRecords.value.length} 条）。`, 'success');
}

function clearSelection(): void {
  if (!selectedRecordIds.value.length) {
    store.showToast('当前没有已选记录。', 'info');
    return;
  }

  selectedRecordIds.value = [];
  store.showToast('已清空选择。', 'info');
}

function openImportDialog(): void {
  importInputRef.value?.click();
  store.showToast('请选择要导入的 JSON 文件。', 'info');
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
      store.showToast('GitHub 目录暂无可导入的耗油记录。', 'info');
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
    store.showToast('暂无可导出的耗油记录。', 'info');
    return;
  }

  exportJson(`trip-records-${Date.now()}.json`, filteredRecords.value);
  store.showToast('已导出 JSON。', 'success');
}

function exportTripCsv(): void {
  if (!filteredRecords.value.length) {
    store.showToast('暂无可导出的耗油记录。', 'info');
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

function shouldIgnoreRecordClick(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(target.closest('button, input, textarea, select, a, label'));
}

function openRecordDetail(recordId: string, event: MouseEvent): void {
  if (editingRecordId.value === recordId || shouldIgnoreRecordClick(event.target)) {
    return;
  }

  goToTripDetail(recordId);
}

function goToTripDetail(recordId: string): void {
  router.push({
    name: 'trip-detail',
    params: {
      recordId,
    },
  });
}

function formatNotePreview(note?: string): string {
  const value = note?.trim();
  if (!value) {
    return '无备注';
  }

  return value.replace(/\s+/g, ' ');
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
