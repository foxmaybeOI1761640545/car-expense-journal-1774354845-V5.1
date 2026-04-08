<template>
  <main class="page page--settings">
    <PageHeader title="页面设置" description="可修改默认值和 GitHub 配置，保存后写入 localStorage。" />

    <article class="card settings-card settings-card--standalone">
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
          默认耗油备注
          <input v-model="settings.defaultTripNote" type="text" />
        </label>
        <label>
          设备名称
          <input v-model="deviceNameInput" type="text" maxlength="80" placeholder="如：我的手机 / 家里电脑" />
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
          提醒后端地址（可选）
          <input v-model="settings.reminderApiBaseUrl" type="text" placeholder="https://your-service.onrender.com" />
        </label>
        <label>
          默认提醒邮箱（可选）
          <input v-model="settings.reminderDefaultEmail" type="email" placeholder="you@example.com" />
        </label>
        <label>
          黑屏快捷键（可自定义）
          <input v-model="settings.blackoutToggleShortcut" type="text" placeholder="Ctrl+Q" @blur="normalizeBlackoutShortcutInput" />
        </label>
        <label>
          GitHub Token（仅本浏览器保存）
          <input
            v-model="githubTokenInput"
            type="password"
            placeholder="留空不变；输入则调用后端密封后保存到本地"
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
        <label class="checkbox-row full-width">
          <input v-model="clearPatWhenClearingCache" type="checkbox" />
          <span>清空缓存时同时清除本地 PAT</span>
        </label>
        <p class="hint full-width">{{ configPriorityEffectText }}</p>
        <p class="hint full-width">当前设备 ID：{{ currentDeviceIdText }}</p>
        <p class="hint full-width">黑屏快捷键：{{ normalizedBlackoutShortcutText }}（示例：Ctrl+Q / Ctrl+Shift+B）</p>
        <p class="hint full-width">{{ githubTokenStatusText }}</p>
        <button class="btn btn--primary full-width" type="submit">保存设置</button>
        <button class="btn btn--danger full-width" type="button" :disabled="isClearingLocalCache" @click="clearLocalCache">
          {{ isClearingLocalCache ? '清空中...' : clearPatWhenClearingCache ? '清空本地缓存（含 PAT）' : '清空本地缓存（保留 PAT）' }}
        </button>
        <p class="hint full-width">会清空本地记录、油量日志、用户资料和页面设置。</p>
      </form>
    </article>
  </main>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import { useAppStore } from '../stores/appStore';
import type { AppConfig } from '../types/config';
import { DEFAULT_BLACKOUT_TOGGLE_SHORTCUT, normalizeShortcutText } from '../utils/shortcut';
import { parsePositiveNumber, roundTo } from '../utils/number';

const store = useAppStore();
const githubTokenInput = ref('');
const deviceNameInput = ref('');
const clearGithubTokenOnSave = ref(false);
const clearPatWhenClearingCache = ref(false);
const isClearingLocalCache = ref(false);

function isSealedGithubToken(value: string): boolean {
  return /^pat\.sealed\.[^.]+\./.test(value.trim());
}

const settings = reactive<AppConfig>({ ...store.state.config });

watch(
  () => store.state.config,
  (value) => {
    Object.assign(settings, value);
  },
  { immediate: true, deep: true },
);

watch(
  () => store.state.deviceMeta.deviceName,
  (value) => {
    deviceNameInput.value = value;
  },
  { immediate: true },
);

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
    return 'Token 状态：本次保存后将调用后端密封并更新本地 Token。';
  }

  if (!store.state.githubToken) {
    return 'Token 状态：当前未保存。';
  }

  return isSealedGithubToken(store.state.githubToken)
    ? 'Token 状态：本地已保存（后端密封 Token）。'
    : 'Token 状态：本地已保存（旧版本地转换，建议重新保存为后端密封 Token）。';
});
const currentDeviceIdText = computed(() => {
  const value = store.state.deviceMeta.deviceId.trim();
  if (!value) {
    return '未生成';
  }
  return value.length <= 18 ? value : `${value.slice(0, 10)}...${value.slice(-6)}`;
});
const normalizedBlackoutShortcutText = computed(() =>
  normalizeShortcutText(settings.blackoutToggleShortcut, DEFAULT_BLACKOUT_TOGGLE_SHORTCUT),
);

function normalizeBlackoutShortcutInput(): void {
  settings.blackoutToggleShortcut = normalizeShortcutText(settings.blackoutToggleShortcut, DEFAULT_BLACKOUT_TOGGLE_SHORTCUT);
}

async function saveSettings(): Promise<void> {
  const defaultFuelPrice = parsePositiveNumber(settings.defaultFuelPrice);
  const defaultAverageFuelConsumptionPer100Km = parsePositiveNumber(settings.defaultAverageFuelConsumptionPer100Km);
  const defaultDistanceKm = parsePositiveNumber(settings.defaultDistanceKm);
  normalizeBlackoutShortcutInput();

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
    reminderApiBaseUrl: settings.reminderApiBaseUrl.trim(),
    reminderDefaultEmail: settings.reminderDefaultEmail.trim(),
    blackoutToggleShortcut: settings.blackoutToggleShortcut,
    preferConfigOverLocalStorage: settings.preferConfigOverLocalStorage,
  });
  store.updateDeviceName(deviceNameInput.value);

  let tokenMessage = 'Token 未变更。';

  try {
    if (clearGithubTokenOnSave.value) {
      await store.saveGithubToken('');
      githubTokenInput.value = '';
      clearGithubTokenOnSave.value = false;
      tokenMessage = 'Token 已清空。';
    } else if (githubTokenInput.value.trim()) {
      await store.saveGithubToken(githubTokenInput.value);
      githubTokenInput.value = '';
      tokenMessage = 'Token 已通过后端密封并更新到本地存储。';
    }
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '更新 GitHub Token 失败。', 'error');
    return;
  }

  store.showToast(`设置已保存。${tokenMessage}`, 'success');
}

async function clearLocalCache(): Promise<void> {
  if (isClearingLocalCache.value) {
    return;
  }

  const message = clearPatWhenClearingCache.value
    ? '确认清空本地缓存并清除本地 PAT 吗？此操作不可恢复。'
    : '确认清空本地缓存吗？将保留本地 PAT。此操作不可恢复。';

  if (!window.confirm(message)) {
    return;
  }

  isClearingLocalCache.value = true;

  try {
    await store.clearLocalCache({
      clearPat: clearPatWhenClearingCache.value,
    });
    githubTokenInput.value = '';
    clearGithubTokenOnSave.value = false;

    if (clearPatWhenClearingCache.value) {
      clearPatWhenClearingCache.value = false;
      store.showToast('本地缓存与 PAT 已清空。', 'success');
      return;
    }

    store.showToast('本地缓存已清空，PAT 已保留。', 'success');
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '清空本地缓存失败。', 'error');
  } finally {
    isClearingLocalCache.value = false;
  }
}
</script>
