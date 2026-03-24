<template>
  <main class="page page--home">
    <section class="welcome card">
      <div>
        <p class="eyebrow">出行手账</p>
        <h1>用车记录本</h1>
        <p class="subtitle">记录加油、油耗与车辆剩余油量估算</p>
      </div>
      <div class="quick-actions">
        <button class="btn btn--primary btn--large" @click="router.push('/fuel')">加油记录</button>
        <button class="btn btn--secondary btn--large" @click="router.push('/trip')">油耗记录</button>
        <button class="btn btn--ghost btn--large" @click="router.push('/guide')">应用说明</button>
      </div>
    </section>

    <section class="dashboard-grid">
      <article class="card overview-card">
        <h2>剩余油量概览</h2>
        <p class="value">{{ remainingFuelText }}</p>
        <p class="muted">统计基准：{{ baselineText }}</p>
        <p v-if="store.state.fuelBalance.baselineEstablished" class="hint">
          由于未记录初始剩余油量，当前剩余油量从首次加油记录开始估算。
        </p>
        <p v-if="store.state.fuelBalance.anomaly" class="alert alert--error">
          剩余油量已小于 0，说明统计基准可能不准确。
        </p>
        <button class="btn btn--ghost" @click="handleResetBaseline">重置统计基准</button>
      </article>

      <article class="card summary-card">
        <h2>最近一次加油</h2>
        <template v-if="latestFuelRecord">
          <p>{{ toLocalDateTime(latestFuelRecord.createdAt) }}</p>
          <p>{{ latestFuelRecord.fuelVolumeLiters.toFixed(3) }} L · {{ latestFuelRecord.totalPriceCny.toFixed(2) }} 元</p>
          <p class="muted">{{ latestFuelRecord.stationName || latestFuelRecord.province || '未填写地点' }}</p>
        </template>
        <p v-else class="muted">暂无加油记录</p>
      </article>

      <article class="card summary-card">
        <h2>最近一次油耗</h2>
        <template v-if="latestTripRecord">
          <p>{{ toLocalDateTime(latestTripRecord.createdAt) }}</p>
          <p>{{ latestTripRecord.distanceKm.toFixed(2) }} km · {{ latestTripRecord.consumedFuelLiters.toFixed(3) }} L</p>
          <p class="muted">{{ latestTripRecord.startLocation || '未填起点' }} → {{ latestTripRecord.endLocation || '未填终点' }}</p>
        </template>
        <p v-else class="muted">暂无油耗记录</p>
      </article>

      <article class="card totals-card">
        <h2>累计统计</h2>
        <div class="metric-grid">
          <div class="metric-item">
            <span>累计加油量</span>
            <strong>{{ formatNumber(totalFuelVolume, 3) }} L</strong>
          </div>
          <div class="metric-item">
            <span>累计行驶距离</span>
            <strong>{{ formatNumber(totalDistanceKm, 2) }} km</strong>
          </div>
          <div class="metric-item">
            <span>累计耗油量</span>
            <strong>{{ formatNumber(totalConsumedFuelLiters, 3) }} L</strong>
          </div>
          <div class="metric-item">
            <span>累计加油金额</span>
            <strong>{{ formatCurrency(totalFuelCost) }}</strong>
          </div>
        </div>
      </article>

      <article class="card recent-card">
        <h2>最近 3 条记录</h2>
        <ul v-if="recentThreeRecords.length" class="record-list">
          <li v-for="record in recentThreeRecords" :key="record.id">
            <button class="link-like" @click="jumpToRecord(record)">
              <span>{{ record.type === 'fuel' ? '加油' : '油耗' }}</span>
              <span>{{ toLocalDateTime(record.createdAt) }}</span>
              <span v-if="record.type === 'fuel'">{{ record.fuelVolumeLiters.toFixed(3) }} L</span>
              <span v-else>{{ record.distanceKm.toFixed(2) }} km</span>
            </button>
          </li>
        </ul>
        <p v-else class="muted">暂无记录</p>
      </article>

      <article class="card settings-card">
        <h2>页面设置</h2>
        <p class="muted">可修改默认值和 GitHub 配置，保存后写入 localStorage。配置文件路径：public/config/app-config.json。</p>
        <form class="settings-form" @submit.prevent="saveSettings">
          <label>
            默认省份
            <input v-model="settings.defaultProvince" type="text" placeholder="如：浙江" />
          </label>
          <label>
            默认油号
            <input v-model.number="settings.defaultFuelType" type="number" min="1" step="1" />
          </label>
          <label>
            默认油价(元/L，可留空)
            <input v-model.number="settings.defaultFuelPrice" type="number" min="0.01" step="0.01" placeholder="留空则不预填" />
          </label>
          <label>
            默认平均油耗(L/100km，可留空)
            <input
              v-model.number="settings.defaultAverageFuelConsumptionPer100Km"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="留空则不预填"
            />
          </label>
          <label>
            默认行驶距离(km，可留空)
            <input v-model.number="settings.defaultDistanceKm" type="number" min="0.01" step="0.01" placeholder="留空则不预填" />
          </label>
          <label>
            默认加油备注
            <input v-model="settings.defaultFuelNote" type="text" />
          </label>
          <label>
            默认油耗备注
            <input v-model="settings.defaultTripNote" type="text" />
          </label>
          <label>
            GitHub Owner
            <input v-model="settings.githubOwner" type="text" placeholder="your-name" />
          </label>
          <label>
            GitHub Repo
            <input v-model="settings.githubRepo" type="text" placeholder="repo-name" />
          </label>
          <label>
            GitHub Branch
            <input v-model="settings.githubBranch" type="text" placeholder="留空使用仓库默认分支" />
          </label>
          <label>
            GitHub Token
            <input v-model="settings.githubToken" type="password" placeholder="ghp_xxx" />
          </label>
          <label>
            Records 目录
            <input v-model="settings.githubRecordsDir" type="text" placeholder="data/records" />
          </label>
          <label class="checkbox-row">
            <input v-model="settings.preferConfigOverLocalStorage" type="checkbox" />
            <span>{{ configPriorityModeText }}</span>
          </label>
          <p class="hint full-width">{{ configPriorityEffectText }}</p>
          <button class="btn btn--primary" type="submit">保存设置</button>
        </form>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useStatistics } from '../composables/useStatistics';
import { useAppStore } from '../stores/appStore';
import type { AppConfig } from '../types/config';
import type { AppRecord } from '../types/records';
import { toLocalDateTime } from '../utils/date';
import { formatCurrency, formatNumber, parsePositiveNumber, roundTo } from '../utils/number';

const router = useRouter();
const store = useAppStore();

const recordsRef = computed(() => store.state.records);
const {
  latestFuelRecord,
  latestTripRecord,
  totalFuelVolume,
  totalDistanceKm,
  totalConsumedFuelLiters,
  totalFuelCost,
  sortedRecords,
} = useStatistics(recordsRef);

const recentThreeRecords = computed(() => sortedRecords.value.slice(0, 3));

const remainingFuelText = computed(() => {
  if (!store.state.fuelBalance.baselineEstablished || store.state.fuelBalance.remainingFuelLiters === null) {
    return '当前剩余油量：未建立统计基准';
  }
  return `当前剩余油量：${store.state.fuelBalance.remainingFuelLiters.toFixed(3)} L`;
});

const baselineText = computed(() => (store.state.fuelBalance.baselineEstablished ? '已建立' : '未建立'));
const configPriorityModeText = computed(() =>
  settings.preferConfigOverLocalStorage
    ? '当前模式：配置文件优先（已勾选）'
    : '当前模式：localStorage 优先（未勾选）',
);
const configPriorityEffectText = computed(() =>
  settings.preferConfigOverLocalStorage
    ? '启动时优先使用 public/config/app-config.json；同名配置会覆盖 localStorage。'
    : '启动时优先使用 localStorage；配置文件作为初始默认值。',
);

const settings = reactive<AppConfig>({ ...store.state.config });

watch(
  () => store.state.config,
  (value) => {
    Object.assign(settings, value);
  },
  { immediate: true, deep: true },
);

function saveSettings(): void {
  const defaultFuelPrice = parsePositiveNumber(settings.defaultFuelPrice);
  const defaultAverageFuelConsumptionPer100Km = parsePositiveNumber(settings.defaultAverageFuelConsumptionPer100Km);
  const defaultDistanceKm = parsePositiveNumber(settings.defaultDistanceKm);

  store.updateConfig({
    defaultProvince: settings.defaultProvince,
    defaultFuelType: Math.max(1, Math.round(Number(settings.defaultFuelType) || 92)),
    defaultFuelPrice: defaultFuelPrice === null ? undefined : roundTo(defaultFuelPrice, 2),
    defaultAverageFuelConsumptionPer100Km:
      defaultAverageFuelConsumptionPer100Km === null ? undefined : roundTo(defaultAverageFuelConsumptionPer100Km, 2),
    defaultDistanceKm: defaultDistanceKm === null ? undefined : roundTo(defaultDistanceKm, 2),
    defaultTripNote: settings.defaultTripNote,
    defaultFuelNote: settings.defaultFuelNote,
    githubOwner: settings.githubOwner.trim(),
    githubRepo: settings.githubRepo.trim(),
    githubBranch: settings.githubBranch.trim(),
    githubToken: settings.githubToken.trim(),
    githubRecordsDir: settings.githubRecordsDir.trim() || 'data/records',
    preferConfigOverLocalStorage: settings.preferConfigOverLocalStorage,
  });
  store.showToast('设置已保存。', 'success');
}

function handleResetBaseline(): void {
  store.resetFuelBaseline();
  store.showToast('统计基准已重置，下次新增加油记录后重新开始估算。', 'info');
}

function jumpToRecord(record: AppRecord): void {
  router.push(record.type === 'fuel' ? '/fuel' : '/trip');
}
</script>
