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
        <button class="btn btn--secondary btn--large" :disabled="isSubmittingAll || !pendingRecordCount" @click="submitAllPendingRecords">
          {{ isSubmittingAll ? '提交中...' : `一键提交未提交（${pendingRecordCount}）` }}
        </button>
        <button class="btn btn--ghost btn--large" :disabled="isSyncingFromGithub" @click="syncAllFromGithub">
          {{ isSyncingFromGithub ? '拉取中...' : '一键拉取' }}
        </button>
        <button class="btn btn--ghost btn--large" @click="router.push('/profile')">用户管理</button>
        <button class="btn btn--ghost btn--large" @click="router.push('/guide')">应用说明</button>
      </div>
    </section>

    <section class="dashboard-grid">
      <article class="card overview-card">
        <h2>剩余油量概览</h2>
        <p class="value">{{ remainingFuelText }}</p>
        <p class="muted">统计基准：{{ baselineText }}</p>
        <p v-if="store.state.fuelBalance.autoCalculatedFuelLiters !== null" class="hint">
          自动估算：{{ store.state.fuelBalance.autoCalculatedFuelLiters.toFixed(3) }} L · 手动修正：
          {{ store.state.fuelBalance.manualOffsetLiters.toFixed(3) }} L
        </p>
        <p v-if="store.state.fuelBalance.baselineEstablished" class="hint">
          当前剩余油量从首条加油记录起算，可手动修正；后续会继续按记录自动累计。
        </p>
        <p v-if="store.state.fuelBalance.anomaly" class="alert alert--error">
          当前剩余油量已小于 0，首次建账时可能出现，必要时请手动修正。
        </p>

        <form class="fuel-balance-form" @submit.prevent="saveManualRemainingFuel">
          <label>
            手动设置当前剩余油量（L，可负数）
            <input v-model.trim="manualRemainingFuelText" type="number" step="0.001" inputmode="decimal" placeholder="如：12.5 或 -8.3" />
          </label>
          <label>
            油量变更时间（可选）
            <input v-model="manualBalanceChangedAtText" type="datetime-local" />
          </label>
          <div class="inline-actions">
            <button class="btn btn--primary" type="submit">保存剩余油量</button>
            <button
              class="btn btn--secondary"
              type="button"
              :disabled="isSyncingFuelBalanceAdjustments || pendingFuelBalanceAdjustmentCount === 0"
              @click="syncPendingFuelBalanceAdjustments"
            >
              {{
                isSyncingFuelBalanceAdjustments
                  ? '同步中...'
                  : `同步未提交油量日志（${pendingFuelBalanceAdjustmentCount}）`
              }}
            </button>
            <button class="btn btn--ghost" type="button" @click="handleResetBaseline">清除手动修正</button>
          </div>
        </form>
      </article>

      <article class="card summary-card">
        <h2>最近一次加油</h2>
        <template v-if="latestFuelRecord">
          <p>{{ toLocalDateTime(latestFuelRecord.occurredAt) }}</p>
          <p>{{ latestFuelRecord.fuelVolumeLiters.toFixed(3) }} L · {{ latestFuelRecord.totalPriceCny.toFixed(2) }} 元</p>
          <p class="muted">记录时间：{{ toLocalDateTime(latestFuelRecord.createdAt) }}</p>
          <p class="muted">{{ latestFuelRecord.stationName || latestFuelRecord.province || '未填写地点' }}</p>
        </template>
        <p v-else class="muted">暂无加油记录</p>
      </article>

      <article class="card summary-card">
        <h2>最近一次油耗</h2>
        <template v-if="latestTripRecord">
          <p>{{ toLocalDateTime(latestTripRecord.occurredAt) }}</p>
          <p>{{ latestTripRecord.distanceKm.toFixed(2) }} km · {{ latestTripRecord.consumedFuelLiters.toFixed(3) }} L</p>
          <p class="muted">记录时间：{{ toLocalDateTime(latestTripRecord.createdAt) }}</p>
          <p class="muted route-text">
            <span class="route-point">{{ latestTripRecord.startLocation || '未填起点' }}</span>
            <span class="route-arrow" aria-hidden="true"></span>
            <span class="route-point">{{ latestTripRecord.endLocation || '未填终点' }}</span>
          </p>
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
              <span>{{ toLocalDateTime(record.occurredAt) }}</span>
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
            Records 目录
            <input v-model="settings.githubRecordsDir" type="text" placeholder="data/records" />
          </label>
          <label>
            GitHub Token（仅本浏览器保存）
            <input
              v-model="githubTokenInput"
              type="password"
              placeholder="留空不变；输入则更新本地 Token Vault"
              autocomplete="new-password"
            />
          </label>
          <label class="checkbox-row">
            <input v-model="clearGithubTokenOnSave" type="checkbox" />
            <span>保存时清空已存 Token</span>
          </label>
          <label class="checkbox-row">
            <input v-model="settings.preferConfigOverLocalStorage" type="checkbox" />
            <span>{{ configPriorityModeText }}</span>
          </label>
          <p class="hint full-width">{{ configPriorityEffectText }}</p>
          <p class="hint full-width">{{ githubTokenStatusText }}</p>
          <button class="btn btn--primary" type="submit">保存设置</button>
        </form>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useStatistics } from '../composables/useStatistics';
import { useAppStore } from '../stores/appStore';
import type { AppConfig } from '../types/config';
import type { AppRecord } from '../types/records';
import { parseDateTimeLocalToUnix, toLocalDateTime } from '../utils/date';
import { formatCurrency, formatNumber, parsePositiveNumber, roundTo } from '../utils/number';

const router = useRouter();
const store = useAppStore();
const isSubmittingAll = ref(false);
const isSyncingFromGithub = ref(false);
const isSyncingFuelBalanceAdjustments = ref(false);
const manualRemainingFuelText = ref('');
const manualBalanceChangedAtText = ref('');
const githubTokenInput = ref('');
const clearGithubTokenOnSave = ref(false);

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
const pendingRecordCount = computed(() => store.state.records.filter((record) => !record.submittedToGithub).length);
const pendingFuelBalanceAdjustmentCount = computed(
  () => store.state.fuelBalanceAdjustments.filter((item) => !item.submittedToGithub).length,
);

const remainingFuelText = computed(() => {
  if (!store.state.fuelBalance.baselineEstablished || store.state.fuelBalance.remainingFuelLiters === null) {
    return '当前剩余油量：暂无加油记录';
  }

  return `当前剩余油量：${store.state.fuelBalance.remainingFuelLiters.toFixed(3)} L`;
});

const baselineText = computed(() => (store.state.fuelBalance.baselineEstablished ? '已建立（首条加油记录）' : '未建立（暂无加油记录）'));
const configPriorityModeText = computed(() =>
  settings.preferConfigOverLocalStorage ? '当前模式：配置文件优先（已勾选）' : '当前模式：localStorage 优先（未勾选）',
);
const configPriorityEffectText = computed(() =>
  settings.preferConfigOverLocalStorage
    ? '启动时优先使用 public/config/app-config.json；同名配置会覆盖 localStorage。'
    : '启动时优先使用 localStorage；配置文件作为初始默认值。',
);
const githubTokenStatusText = computed(() => {
  if (clearGithubTokenOnSave.value) {
    return 'Token 状态：本次保存后将清空本地 Token。';
  }

  if (githubTokenInput.value.trim()) {
    return 'Token 状态：本次保存后将更新本地 Token（仅浏览器本地保存，转换后存储）。';
  }

  return store.state.githubToken ? 'Token 状态：本地已保存（已转换存储）。' : 'Token 状态：当前未保存。';
});

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
    githubRecordsDir: settings.githubRecordsDir.trim() || 'data/records',
    preferConfigOverLocalStorage: settings.preferConfigOverLocalStorage,
  });

  let tokenMessage = 'Token 未变更。';

  if (clearGithubTokenOnSave.value) {
    store.saveGithubToken('');
    githubTokenInput.value = '';
    clearGithubTokenOnSave.value = false;
    tokenMessage = 'Token 已清空。';
  } else if (githubTokenInput.value.trim()) {
    store.saveGithubToken(githubTokenInput.value);
    githubTokenInput.value = '';
    tokenMessage = 'Token 已更新到本地安全存储。';
  }

  store.showToast(`设置已保存。${tokenMessage}`, 'success');
}

function handleResetBaseline(): void {
  store.resetFuelBaseline();
  store.showToast('已清除手动修正，当前剩余油量恢复为自动估算值。', 'info');
}

async function saveManualRemainingFuel(): Promise<void> {
  const remaining = Number(manualRemainingFuelText.value);
  if (!Number.isFinite(remaining)) {
    store.showToast('请填写有效数字作为当前剩余油量。', 'error');
    return;
  }

  if (manualBalanceChangedAtText.value.trim() && parseDateTimeLocalToUnix(manualBalanceChangedAtText.value) === undefined) {
    store.showToast('油量变更时间格式无效，请重新填写。', 'error');
    return;
  }

  try {
    const result = await store.updateRemainingFuelLiters({
      remainingFuelLiters: remaining,
      balanceChangedAtUnix: parseDateTimeLocalToUnix(manualBalanceChangedAtText.value),
    });

    if (result.submittedToGithub) {
      manualRemainingFuelText.value = '';
      store.showToast(`剩余油量已更新，日志已写入 GitHub：${result.message ?? ''}`.trim(), 'success');
      return;
    }

    store.showToast(`剩余油量已更新，但日志未提交到 GitHub：${result.message ?? '请稍后重试。'}`, 'info');
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '保存剩余油量失败。', 'error');
  }
}

async function syncPendingFuelBalanceAdjustments(): Promise<void> {
  if (isSyncingFuelBalanceAdjustments.value) {
    return;
  }

  if (pendingFuelBalanceAdjustmentCount.value === 0) {
    store.showToast('没有待同步的油量变更日志。', 'info');
    return;
  }

  isSyncingFuelBalanceAdjustments.value = true;

  try {
    const result = await store.syncPendingFuelBalanceAdjustments();

    if (result.successCount > 0 && result.failedCount === 0) {
      store.showToast(`油量变更日志同步成功，共 ${result.successCount} 条。`, 'success');
      return;
    }

    if (result.successCount > 0) {
      const firstFailure = result.failures[0]?.message ?? '部分日志同步失败。';
      store.showToast(`油量变更日志同步完成：成功 ${result.successCount}，失败 ${result.failedCount}。${firstFailure}`, 'info');
      return;
    }

    store.showToast(result.failures[0]?.message ?? '油量变更日志同步失败。', 'error');
  } finally {
    isSyncingFuelBalanceAdjustments.value = false;
  }
}

function jumpToRecord(record: AppRecord): void {
  router.push(record.type === 'fuel' ? '/fuel' : '/trip');
}

async function submitAllPendingRecords(): Promise<void> {
  if (isSubmittingAll.value) {
    return;
  }

  if (!pendingRecordCount.value) {
    store.showToast('没有可提交的记录。', 'info');
    return;
  }

  isSubmittingAll.value = true;

  try {
    const result = await store.submitPendingRecords();

    if (result.successCount > 0 && result.failedCount === 0) {
      store.showToast(`全部未提交记录已提交，共 ${result.successCount} 条。`, 'success');
      return;
    }

    if (result.successCount > 0) {
      const firstFailure = result.failures[0]?.message ?? '部分记录提交失败。';
      store.showToast(`提交完成：成功 ${result.successCount}，失败 ${result.failedCount}。${firstFailure}`, 'info');
      return;
    }

    store.showToast(result.failures[0]?.message ?? '提交失败。', 'error');
  } finally {
    isSubmittingAll.value = false;
  }
}

async function syncAllFromGithub(): Promise<void> {
  if (isSyncingFromGithub.value) {
    return;
  }

  isSyncingFromGithub.value = true;

  try {
    const result = await store.syncRecordsFromGithub();

    if (result.fetched === 0) {
      store.showToast('GitHub 目录暂无可导入的历史记录。', 'info');
      return;
    }

    store.showToast(`拉取完成：读取 ${result.fetched} 条，新增 ${result.added}，重复 ${result.skipped}，无效 ${result.invalid}。`, 'success');
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '从 GitHub 拉取失败。', 'error');
  } finally {
    isSyncingFromGithub.value = false;
  }
}
</script>
