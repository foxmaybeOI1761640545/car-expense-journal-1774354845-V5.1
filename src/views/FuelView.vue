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
              <strong>{{ toLocalDateTime(record.createdAt) }}</strong>
              <span :class="record.submittedToGithub ? 'tag tag--success' : 'tag'">
                {{ record.submittedToGithub ? '已提交 GitHub' : '未提交' }}
              </span>
            </div>
            <p>
              油号 {{ record.fuelType }} · {{ record.pricePerLiter.toFixed(2) }} 元/L · {{ record.fuelVolumeLiters.toFixed(3) }} L ·
              {{ record.totalPriceCny.toFixed(2) }} 元
            </p>
            <p class="muted">{{ record.province || '未填地区' }} · {{ record.stationName || '未填加油站' }}</p>
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
import { toLocalDateTime } from '../utils/date';
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
  note: store.state.config.defaultFuelNote,
});

const keyword = ref('');
const provinceFilter = ref('');
const fuelTypeFilter = ref('');
const submitFilter = ref<'all' | 'submitted' | 'pending'>('all');

const fuelRecords = computed(() =>
  store.state.records
    .filter((record): record is FuelRecord => record.type === 'fuel')
    .sort((a, b) => {
      if (a.createdAtUnix === b.createdAtUnix) {
        return b.createdAt.localeCompare(a.createdAt);
      }
      return b.createdAtUnix - a.createdAtUnix;
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
    store.addFuelRecord({
      province: form.province,
      fuelType,
      pricePerLiter: price,
      fuelVolumeLiters: volume,
      totalPriceCny: total,
      stationName: form.stationName,
      note: form.note,
    });

    if (consistencyWarning.value) {
      store.showToast('记录已保存，但三项金额数据可能有误，请检查。', 'info');
    } else {
      store.showToast('加油记录已保存到本地。', 'success');
    }
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '保存失败。', 'error');
  }
}

function removeRecord(recordId: string): void {
  if (!window.confirm('确认删除该加油记录吗？')) {
    return;
  }

  store.deleteRecord(recordId);
  store.showToast('加油记录已删除。', 'info');
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
    ['createdAt', 'province', 'fuelType', 'pricePerLiter', 'fuelVolumeLiters', 'totalPriceCny', 'stationName', 'note', 'submittedToGithub'],
    filteredRecords.value.map((record) => [
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
