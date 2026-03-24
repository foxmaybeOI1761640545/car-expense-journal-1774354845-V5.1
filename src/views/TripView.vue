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

          <label>
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

          <label>
            起点（可选）
            <input v-model="form.startLocation" type="text" placeholder="如：杭州" />
          </label>

          <label>
            终点（可选）
            <input v-model="form.endLocation" type="text" placeholder="如：宁波" />
          </label>

          <label class="full-width">
            备注（可选）
            <textarea v-model="form.note" rows="3" placeholder="例如：高速巡航为主"></textarea>
          </label>

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
          </div>
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

        <ul v-if="filteredRecords.length" class="history-list">
          <li v-for="record in filteredRecords" :key="record.id" class="history-item">
            <div class="history-item__top">
              <strong>{{ toLocalDateTime(record.createdAt) }}</strong>
              <span :class="record.submittedToGithub ? 'tag tag--success' : 'tag'">
                {{ record.submittedToGithub ? '已提交 GitHub' : '未提交' }}
              </span>
            </div>
            <p>
              平均油耗 {{ record.averageFuelConsumptionPer100Km.toFixed(2) }} L/100km · 行驶 {{ record.distanceKm.toFixed(2) }} km ·
              耗油 {{ record.consumedFuelLiters.toFixed(3) }} L · 油价 {{ formatTripPrice(record) }} · 费用 {{ formatTripCost(record) }}
            </p>
            <p class="muted">{{ record.startLocation || '未填起点' }} → {{ record.endLocation || '未填终点' }}</p>
            <p class="muted">{{ record.note || '无备注' }}</p>

            <div class="inline-actions">
              <button
                class="btn btn--secondary"
                :disabled="isSubmitting(record.id)"
                @click="submitRecord(record.id)"
              >
                {{ isSubmitting(record.id) ? '提交中...' : '提交到 GitHub' }}
              </button>
              <button class="btn btn--danger" @click="removeRecord(record.id)">删除</button>
            </div>
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
import { toLocalDateTime } from '../utils/date';
import { exportCsv, exportJson } from '../utils/export';
import { parsePositiveNumber, roundTo } from '../utils/number';

const store = useAppStore();

const latestFuelPricePerLiter = computed<number | null>(() => {
  const latestFuelRecord = store.state.records
    .filter((record): record is FuelRecord => record.type === 'fuel')
    .sort((a, b) => {
      if (a.createdAtUnix === b.createdAtUnix) {
        return b.createdAt.localeCompare(a.createdAt);
      }
      return b.createdAtUnix - a.createdAtUnix;
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
  startLocation: '',
  endLocation: '',
  note: store.state.config.defaultTripNote,
});

const keyword = ref('');
const submitFilter = ref<'all' | 'submitted' | 'pending'>('all');

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
      if (a.createdAtUnix === b.createdAtUnix) {
        return b.createdAt.localeCompare(a.createdAt);
      }
      return b.createdAtUnix - a.createdAtUnix;
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

function removeRecord(recordId: string): void {
  if (!window.confirm('确认删除该油耗记录吗？')) {
    return;
  }

  store.deleteRecord(recordId);
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
