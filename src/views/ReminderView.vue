<template>
  <main class="page page--reminder">
    <PageHeader title="提醒中心" description="支持停车提醒、番茄钟与自定义倒计时；页面保持打开时可在线提醒。" />

    <section class="reminder-grid">
      <article class="card reminder-form-card">
        <h2>创建提醒</h2>
        <form class="form-grid reminder-form" @submit.prevent="handleCreateReminder">
          <label>
            提醒类型
            <select v-model="formKind">
              <option value="parking">停车提醒</option>
              <option value="pomodoro">番茄钟</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          <label>
            倒计时分钟数
            <input v-model.number="formDurationMinutes" type="number" min="0" max="20160" step="1" />
          </label>
          <label>
            秒（默认 00）
            <input v-model.number="formDurationSeconds" type="number" min="0" max="59" step="1" />
          </label>
          <p class="hint full-width">当前总时长：{{ formattedFormDuration }}</p>
          <label class="full-width">
            标题（可选）
            <input v-model.trim="formTitle" type="text" maxlength="80" placeholder="留空自动按类型命名" />
          </label>
          <label class="full-width">
            备注（可选）
            <textarea v-model.trim="formNote" rows="2" maxlength="500" placeholder="例如：地库 B2，车位 A-106"></textarea>
          </label>
          <label class="checkbox-inline">
            <input v-model="formSoundEnabled" type="checkbox" />
            <span>到点播放提示音</span>
          </label>
          <label class="checkbox-inline">
            <input v-model="formNotificationEnabled" type="checkbox" :disabled="notificationPermission === 'unsupported'" />
            <span>到点系统通知</span>
          </label>
          <div class="inline-actions full-width">
            <button class="btn btn--primary" type="submit">创建提醒</button>
            <button class="btn btn--ghost" type="button" @click="applyTemplateDuration('parking')">停车 120:00</button>
            <button class="btn btn--ghost" type="button" @click="applyTemplateDuration('pomodoro')">番茄钟 25:00</button>
          </div>
        </form>
      </article>

      <article class="card reminder-channel-card">
        <h2>提醒通道状态</h2>
        <p class="muted">支持四种铃声策略：自动、仅上传音频、仅默认文件、仅 Web Audio 合成。</p>
        <div class="form-grid reminder-synth-grid">
          <label class="full-width">
            铃声来源策略
            <select v-model="ringtoneSourceMode" @change="handleRingtoneSourceModeChange">
              <option value="auto">自动（上传优先，默认文件次之，最后合成）</option>
              <option value="uploaded">仅上传音频</option>
              <option value="default-file">仅默认音频文件</option>
              <option value="synth">仅 Web Audio 合成</option>
            </select>
          </label>
        </div>
        <p class="hint">{{ ringtoneSourceModeDescription }}</p>
        <div class="inline-actions">
          <button class="btn btn--secondary" type="button" @click="requestBrowserNotificationPermission">请求通知权限</button>
          <button class="btn btn--secondary" type="button" @click="enableSoundReminder">启用声音提醒（测试）</button>
          <button class="btn btn--ghost" type="button" @click="reloadDefaultRingtoneAsset">重载默认铃声配置</button>
        </div>
        <div class="inline-actions">
          <button class="btn btn--ghost" type="button" @click="openRingtonePicker">上传自定义铃声</button>
          <button class="btn btn--ghost" type="button" :disabled="!customRingtoneConfig" @click="clearCustomRingtone">清除上传铃声</button>
          <input ref="ringtoneInputRef" class="visually-hidden" type="file" :accept="ringtoneFileAccept" @change="handleRingtoneFileChange" />
        </div>
        <p class="hint">上传限制：仅允许常见音频格式（mp3/wav/ogg/m4a/aac/flac/opus/webm/mp4），最大 1.5MB。</p>
        <section class="reminder-subsection">
          <h3>DIY 合成铃声（数字编辑）</h3>
          <div class="form-grid reminder-synth-grid">
            <label>
              波形
              <select v-model="synthWaveformInput">
                <option value="sine">sine</option>
                <option value="square">square</option>
                <option value="triangle">triangle</option>
                <option value="sawtooth">sawtooth</option>
              </select>
            </label>
            <label>
              单音时长（毫秒）
              <input v-model.number="synthToneDurationInput" type="number" min="40" max="2000" step="1" />
            </label>
            <label>
              间隔时长（毫秒）
              <input v-model.number="synthGapDurationInput" type="number" min="0" max="1200" step="1" />
            </label>
            <label>
              音量（0.01-1.00）
              <input v-model.number="synthGainInput" type="number" min="0.01" max="1" step="0.01" />
            </label>
            <label class="full-width">
              频率序列（Hz，逗号分隔，1-16 个，范围 80-4000）
              <input v-model.trim="synthFrequenciesInput" type="text" placeholder="例如：880,659,880" />
            </label>
          </div>
          <div class="inline-actions">
            <button class="btn btn--ghost" type="button" @click="saveSynthConfigFromInputs">保存 DIY 参数</button>
            <button class="btn btn--ghost" type="button" @click="previewSynthConfigFromInputs">试听 DIY 铃声</button>
            <button class="btn btn--ghost" type="button" @click="resetSynthConfig">恢复默认参数</button>
          </div>
          <p class="hint">当前合成参数：{{ synthConfigSummary }}</p>
        </section>
        <section class="reminder-subsection">
          <h3>GitHub 铃声同步（可选）</h3>
          <div class="inline-actions">
            <button class="btn btn--ghost" type="button" :disabled="pushingToGithub" @click="syncCustomRingtoneToGithub">
              {{ pushingToGithub ? '同步中...' : '同步当前铃声配置到 GitHub' }}
            </button>
            <button class="btn btn--ghost" type="button" :disabled="pullingFromGithub" @click="syncCustomRingtoneFromGithub">
              {{ pullingFromGithub ? '拉取中...' : '从 GitHub 拉取铃声配置' }}
            </button>
          </div>
          <p class="hint">GitHub 配置：{{ githubConfigStatusText }}</p>
          <p class="hint">同步状态：{{ githubSyncStatusText }}</p>
          <p v-if="githubSyncMessage" class="hint">{{ githubSyncMessage }}</p>
        </section>
        <p class="hint">通知权限：{{ notificationPermissionText }}</p>
        <p class="hint">声音状态：{{ soundStatusText }}</p>
        <p class="hint">当前铃声：{{ ringtoneLabelText }}</p>
        <p class="hint">循环状态：{{ soundLoopStatusText }}</p>
        <p class="hint">默认文件状态：{{ defaultAudioStatusText }}</p>
        <p v-if="defaultAudioStatusMessage" class="hint">{{ defaultAudioStatusMessage }}</p>
        <p class="hint">后端地址：{{ reminderApiBaseUrl || '未配置' }}</p>
        <div class="inline-actions">
          <button class="btn btn--ghost" type="button" :disabled="backendStatus === 'checking'" @click="checkBackendConnectivity">
            {{ backendStatus === 'checking' ? '检测中...' : '检测后端连通性' }}
          </button>
          <span class="tag" :class="backendStatusTagClass">{{ backendStatusText }}</span>
        </div>
        <p v-if="backendStatusMessage" class="hint">{{ backendStatusMessage }}</p>
        <p v-if="backendPingResult" class="hint">
          服务：{{ backendPingResult.service }} · 版本：{{ backendPingResult.version }} · 运行 {{ backendPingResult.uptimeSeconds }} 秒
        </p>
      </article>

      <article class="card reminder-list-card">
        <div class="list-header">
          <h2>待确认提醒（{{ acknowledgmentPendingTasks.length }}）</h2>
          <button class="btn btn--ghost" type="button" :disabled="acknowledgmentPendingTasks.length === 0" @click="acknowledgeAllFiredTasks">
            全部已收到
          </button>
        </div>
        <ul v-if="acknowledgmentPendingTasks.length" class="reminder-list">
          <li v-for="task in acknowledgmentPendingTasks" :key="task.id" class="reminder-item reminder-item--fired">
            <div class="reminder-item__main">
              <div class="reminder-item__title-row">
                <strong>{{ task.title }}</strong>
                <span class="tag tag--pending">待确认</span>
              </div>
              <p class="hint">到点时间：{{ toLocalDateTimeText(task.triggerAtUnix) }}</p>
              <p class="hint">触发时间：{{ toLocalDateTimeText(task.firedAtUnix ?? task.updatedAtUnix) }}</p>
              <p v-if="task.note" class="muted">{{ task.note }}</p>
            </div>
            <div class="inline-actions">
              <button class="btn btn--primary" type="button" @click="acknowledgeTask(task.id)">我已收到</button>
            </div>
          </li>
        </ul>
        <p v-else class="muted">暂无待确认提醒。</p>

        <div class="list-header">
          <h2>待提醒任务（{{ pendingTasks.length }}）</h2>
        </div>
        <ul v-if="pendingTasks.length" class="reminder-list">
          <li v-for="task in pendingTasks" :key="task.id" class="reminder-item reminder-item--pending">
            <div class="reminder-item__main">
              <div class="reminder-item__title-row">
                <strong>{{ task.title }}</strong>
                <span class="tag tag--pending">{{ formatReminderKind(task.kind) }}</span>
              </div>
              <p class="hint">剩余时间：{{ formatRemainingText(task) }}</p>
              <p class="hint">到点时间：{{ toLocalDateTimeText(task.triggerAtUnix) }}</p>
              <p v-if="task.note" class="muted">{{ task.note }}</p>
            </div>
            <div class="inline-actions">
              <button class="btn btn--ghost" type="button" @click="cancelTask(task.id)">取消</button>
            </div>
          </li>
        </ul>
        <p v-else class="muted">暂无待提醒任务。</p>

        <div class="list-header">
          <h2>历史任务（{{ historyTasks.length }}）</h2>
          <button class="btn btn--ghost" type="button" :disabled="historyTasks.length === 0" @click="clearHistoryTasks">
            清空历史
          </button>
        </div>
        <ul v-if="historyTasks.length" class="reminder-list">
          <li v-for="task in historyTasks" :key="task.id" class="reminder-item">
            <div class="reminder-item__main">
              <div class="reminder-item__title-row">
                <strong>{{ task.title }}</strong>
                <span class="tag" :class="task.status === 'fired' ? 'tag--success' : 'tag--neutral'">
                  {{ task.status === 'fired' ? '已确认' : '已取消' }}
                </span>
              </div>
              <p class="hint">创建时间：{{ toLocalDateTimeText(task.createdAtUnix) }}</p>
              <p class="hint">到点时间：{{ toLocalDateTimeText(task.triggerAtUnix) }}</p>
              <p v-if="task.status === 'fired'" class="hint">
                确认时间：{{ toLocalDateTimeText(task.acknowledgedAtUnix ?? task.updatedAtUnix) }}
              </p>
            </div>
          </li>
        </ul>
        <p v-else class="muted">暂无历史任务。</p>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import {
  fetchReminderAudioDataUrlFromGithub,
  fetchReminderRingtonePathConfigFromGithub,
  syncReminderRingtonePathConfigToGithub,
  uploadReminderRingtoneToGithub,
} from '../services/githubService';
import { loadReminderDefaultAudioAsset, type ReminderResolvedDefaultAudioAsset } from '../services/reminderAudioAssetService';
import { resolveReminderBackendBaseUrl } from '../services/reminderBackendUrlService';
import { pingReminderBackend, type ReminderBackendPingResult } from '../services/reminderBackendService';
import {
  acknowledgeReminderTask,
  cancelReminderTask,
  clearReminderRingtoneConfig,
  createReminderTask,
  formatReminderKind,
  getDefaultReminderSynthPatternConfig,
  getReminderRemainingSeconds,
  loadReminderRingtoneConfig,
  loadReminderRingtoneSourceMode,
  loadReminderSynthPatternConfig,
  loadReminderTasks,
  markReminderFired,
  saveReminderRingtoneConfig,
  saveReminderRingtoneSourceMode,
  saveReminderSynthPatternConfig,
  saveReminderTasks,
  upsertReminderTask,
} from '../services/reminderService';
import { useAppStore } from '../stores/appStore';
import type { ReminderKind, ReminderRingtoneConfig, ReminderRingtoneSourceMode, ReminderSynthPatternConfig, ReminderTask } from '../types/reminder';
import { nowUnixSeconds, toLocalDateTime, unixSecondsToIsoString } from '../utils/date';

const MAX_RINGTONE_BYTES = 1_500_000;
const RINGTONE_FILE_ACCEPT =
  'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg,audio/webm,audio/mp4,audio/aac,audio/flac,audio/x-flac,audio/opus,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus,.webm,.mp4,.aiff';

const ALLOWED_AUDIO_MIME_TYPES = new Set<string>([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/aac',
  'audio/flac',
  'audio/x-flac',
  'audio/opus',
  'audio/aiff',
]);
const ALLOWED_AUDIO_EXTENSIONS = new Set<string>(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'webm', 'mp4', 'aiff']);
const BLOCKED_FILE_EXTENSIONS = new Set<string>([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'pdf',
  'txt',
  'md',
  'json',
  'js',
  'ts',
  'vue',
  'html',
  'css',
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'exe',
  'msi',
  'bat',
  'cmd',
  'ps1',
]);

type ActiveRingtoneKind = 'uploaded' | 'default-file' | 'synth';

interface ActiveRingtoneTarget {
  kind: ActiveRingtoneKind;
  label: string;
  sourceUrl?: string;
  fallbackReason?: string;
}

const store = useAppStore();
const tasks = ref<ReminderTask[]>([]);
const nowUnix = ref(nowUnixSeconds());
const formKind = ref<ReminderKind>('parking');
const formTitle = ref('');
const formNote = ref('');
const formDurationMinutes = ref(120);
const formDurationSeconds = ref(0);
const formSoundEnabled = ref(true);
const formNotificationEnabled = ref(true);
const notificationPermission = ref<'unsupported' | NotificationPermission>(getNotificationPermission());
const soundPrimed = ref(false);
const customRingtoneConfig = ref<ReminderRingtoneConfig | null>(loadReminderRingtoneConfig());
const ringtoneSourceMode = ref<ReminderRingtoneSourceMode>(loadReminderRingtoneSourceMode());
const synthPatternConfig = ref<ReminderSynthPatternConfig>(loadReminderSynthPatternConfig());
const synthWaveformInput = ref<OscillatorType>(synthPatternConfig.value.waveform);
const synthFrequenciesInput = ref(synthPatternConfig.value.frequencies.join(','));
const synthToneDurationInput = ref(synthPatternConfig.value.toneDurationMs);
const synthGapDurationInput = ref(synthPatternConfig.value.gapDurationMs);
const synthGainInput = ref(synthPatternConfig.value.gain);
const defaultAudioAsset = ref<ReminderResolvedDefaultAudioAsset | null>(null);
const defaultAudioStatus = ref<'checking' | 'missing' | 'ready' | 'failed'>('checking');
const defaultAudioStatusMessage = ref('');
const githubSyncStatus = ref<'idle' | 'syncing' | 'success' | 'error'>('idle');
const githubSyncMessage = ref('');
const pushingToGithub = ref(false);
const pullingFromGithub = ref(false);
const ringtoneInputRef = ref<HTMLInputElement | null>(null);
const backendStatus = ref<'unconfigured' | 'checking' | 'online' | 'offline'>('unconfigured');
const backendStatusMessage = ref('');
const backendPingResult = ref<ReminderBackendPingResult | null>(null);
const alarmLoopRunning = ref(false);

const reminderApiBaseUrl = computed(() => store.state.config.reminderApiBaseUrl.trim());
const effectiveReminderApiBaseUrl = computed(() => resolveReminderBackendBaseUrl(store.state.config));
const pendingTasks = computed(() => tasks.value.filter((task) => task.status === 'pending'));
const acknowledgmentPendingTasks = computed(() =>
  tasks.value
    .filter((task) => task.status === 'fired' && task.requiresAcknowledgement && !Number.isFinite(task.acknowledgedAtUnix))
    .sort((a, b) => {
      const aKey = a.firedAtUnix ?? a.updatedAtUnix;
      const bKey = b.firedAtUnix ?? b.updatedAtUnix;
      return bKey - aKey;
    }),
);
const historyTasks = computed(() =>
  tasks.value
    .filter(
      (task) =>
        task.status === 'cancelled' ||
        (task.status === 'fired' && (!task.requiresAcknowledgement || Number.isFinite(task.acknowledgedAtUnix))),
    )
    .sort((a, b) => b.updatedAtUnix - a.updatedAtUnix)
    .slice(0, 50),
);
const hasPendingLoopingSound = computed(() =>
  acknowledgmentPendingTasks.value.some((task) => task.soundEnabled),
);
const formattedFormDuration = computed(() =>
  `${Math.max(0, Math.floor(Number(formDurationMinutes.value) || 0))
    .toString()
    .padStart(2, '0')}:${Math.max(0, Math.floor(Number(formDurationSeconds.value) || 0))
    .toString()
    .padStart(2, '0')}`,
);
const ringtoneFileAccept = RINGTONE_FILE_ACCEPT;
const notificationPermissionText = computed(() => {
  if (notificationPermission.value === 'unsupported') {
    return '当前浏览器不支持 Notification API';
  }
  if (notificationPermission.value === 'granted') {
    return '已授权';
  }
  if (notificationPermission.value === 'denied') {
    return '已拒绝';
  }
  return '未授权';
});
const ringtoneSourceModeDescription = computed(() => {
  if (ringtoneSourceMode.value === 'uploaded') {
    return '仅使用上传铃声；若未上传会自动回退到合成音。';
  }
  if (ringtoneSourceMode.value === 'default-file') {
    return '仅使用默认文件路径；文件不存在或不可播放时会回退到合成音。';
  }
  if (ringtoneSourceMode.value === 'synth') {
    return '仅使用 Web Audio 合成铃声。';
  }
  return '自动策略：优先上传铃声，其次默认文件，最后回退到 Web Audio 合成。';
});
const soundStatusText = computed(() => (soundPrimed.value ? '已解锁，可到点播放提示音' : '未解锁，请先点击“启用声音提醒（测试）”'));
const ringtoneLabelText = computed(() => resolveRingtoneTarget().label);
const synthConfigSummary = computed(() => {
  const config = synthPatternConfig.value;
  return `${config.waveform} | ${config.frequencies.join('/')}Hz | 音长 ${config.toneDurationMs}ms | 间隔 ${config.gapDurationMs}ms | 音量 ${config.gain.toFixed(2)}`;
});
const soundLoopStatusText = computed(() => (alarmLoopRunning.value ? '循环播放中，等待用户确认提醒' : '空闲'));
const defaultAudioStatusText = computed(() => {
  if (defaultAudioStatus.value === 'ready') {
    return '已就绪，可作为默认文件铃声使用';
  }
  if (defaultAudioStatus.value === 'missing') {
    return '未找到默认铃声配置，将自动回退到合成音';
  }
  if (defaultAudioStatus.value === 'failed') {
    return '默认铃声文件不可用，将自动回退到合成音';
  }
  return '检测中...';
});
const githubConfigStatusText = computed(() => {
  const hasBaseConfig = Boolean(
    store.state.config.githubOwner.trim() && store.state.config.githubRepo.trim() && store.state.config.githubRecordsDir.trim(),
  );
  const hasToken = Boolean(store.state.githubToken.trim());

  if (!hasBaseConfig) {
    return '未完成（请先在页面设置填写 owner/repo/recordsDir）';
  }
  if (!hasToken) {
    return '未完成（请先配置 GitHub Token）';
  }
  return '已完成，可同步铃声';
});
const githubSyncStatusText = computed(() => {
  if (githubSyncStatus.value === 'syncing') {
    return '进行中';
  }
  if (githubSyncStatus.value === 'success') {
    return '成功';
  }
  if (githubSyncStatus.value === 'error') {
    return '失败';
  }
  return '未开始';
});
const backendStatusText = computed(() => {
  if (backendStatus.value === 'online') {
    return '后端在线';
  }
  if (backendStatus.value === 'offline') {
    return '后端离线';
  }
  if (backendStatus.value === 'checking') {
    return '检测中';
  }
  return '未配置';
});
const backendStatusTagClass = computed(() => {
  if (backendStatus.value === 'online') {
    return 'tag--success';
  }
  if (backendStatus.value === 'offline') {
    return 'tag--pending';
  }
  return 'tag--neutral';
});

let ticker: number | null = null;
let audioContext: AudioContext | null = null;
let soundBlockedHintShown = false;
let ringtoneFallbackHintShown = false;
let loopStartInProgress: Promise<void> | null = null;
let loopAudioElement: HTMLAudioElement | null = null;
let syntheticLoopTimer: number | null = null;
const inFlightDueIds = new Set<string>();

watch(
  effectiveReminderApiBaseUrl,
  () => {
    backendPingResult.value = null;
    backendStatusMessage.value = '';

    if (!effectiveReminderApiBaseUrl.value) {
      backendStatus.value = 'unconfigured';
      return;
    }

    void checkBackendConnectivity();
  },
  { immediate: true },
);

watch(formKind, (value) => {
  if (value === 'parking') {
    formDurationMinutes.value = 120;
    formDurationSeconds.value = 0;
    if (!formTitle.value.trim()) {
      formTitle.value = '停车提醒';
    }
    return;
  }

  if (value === 'pomodoro') {
    formDurationMinutes.value = 25;
    formDurationSeconds.value = 0;
    if (!formTitle.value.trim()) {
      formTitle.value = '番茄钟提醒';
    }
    return;
  }

  formDurationMinutes.value = 10;
  formDurationSeconds.value = 0;
  if (!formTitle.value.trim()) {
    formTitle.value = '自定义提醒';
  }
});

watch(
  hasPendingLoopingSound,
  () => {
    void syncLoopingSoundLoop();
  },
  { immediate: false },
);

onMounted(() => {
  syncSynthInputsFromConfig(synthPatternConfig.value);
  tasks.value = loadReminderTasks();
  triggerDueReminders();
  void syncLoopingSoundLoop();
  void reloadDefaultRingtoneAsset();

  ticker = window.setInterval(() => {
    nowUnix.value = nowUnixSeconds();
    triggerDueReminders();
  }, 1000);

  document.addEventListener('visibilitychange', handleVisibilityChange);
});

onBeforeUnmount(() => {
  if (ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }

  stopLoopingSound();
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});

function persistTasks(nextTasks: ReminderTask[]): void {
  tasks.value = nextTasks;
  saveReminderTasks(nextTasks);
}

function handleVisibilityChange(): void {
  if (document.visibilityState !== 'visible') {
    return;
  }

  nowUnix.value = nowUnixSeconds();
  notificationPermission.value = getNotificationPermission();
  triggerDueReminders();
}

function applyTemplateDuration(kind: ReminderKind): void {
  formKind.value = kind;
}

function handleRingtoneSourceModeChange(): void {
  saveReminderRingtoneSourceMode(ringtoneSourceMode.value);
  stopLoopingSound();
  void syncLoopingSoundLoop();
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function formatRemainingText(task: ReminderTask): string {
  return formatDuration(getReminderRemainingSeconds(task, nowUnix.value));
}

function toLocalDateTimeText(unixSeconds: number): string {
  return toLocalDateTime(unixSecondsToIsoString(unixSeconds));
}

function resolveDurationSecondsFromForm(): number {
  const parsedMinutes = Number(formDurationMinutes.value);
  const parsedSeconds = Number(formDurationSeconds.value);

  if (!Number.isFinite(parsedMinutes) || !Number.isFinite(parsedSeconds)) {
    throw new Error('倒计时时间格式无效。');
  }

  const minutes = Math.floor(parsedMinutes);
  const seconds = Math.floor(parsedSeconds);

  if (minutes < 0 || minutes > 20160) {
    throw new Error('分钟数需在 0 到 20160 之间。');
  }
  if (seconds < 0 || seconds > 59) {
    throw new Error('秒数需在 0 到 59 之间。');
  }

  const total = minutes * 60 + seconds;
  if (total < 1 || total > 86400 * 14) {
    throw new Error('倒计时总时长需在 1 秒到 14 天之间。');
  }

  return total;
}

function handleCreateReminder(): void {
  let durationSeconds = 0;
  try {
    durationSeconds = resolveDurationSecondsFromForm();
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '倒计时时间无效。', 'error');
    return;
  }

  const task = createReminderTask({
    kind: formKind.value,
    title: formTitle.value,
    note: formNote.value,
    durationSeconds,
    soundEnabled: formSoundEnabled.value,
    notificationEnabled: formNotificationEnabled.value,
  });

  persistTasks(upsertReminderTask(tasks.value, task));
  store.showToast(`提醒已创建：${task.title}，将在 ${formatDuration(durationSeconds)} 后触发。`, 'success');

  formTitle.value = '';
  formNote.value = '';
  nowUnix.value = nowUnixSeconds();
}

function cancelTask(taskId: string): void {
  const nextNow = nowUnixSeconds();
  let changed = false;

  const nextTasks = tasks.value.map((task) => {
    if (task.id !== taskId) {
      return task;
    }

    const nextTask = cancelReminderTask(task, nextNow);
    changed = nextTask !== task;
    return nextTask;
  });

  if (!changed) {
    return;
  }

  persistTasks(nextTasks);
  void syncLoopingSoundLoop();
  store.showToast('提醒已取消。', 'info');
}

function acknowledgeTask(taskId: string): void {
  const nextNow = nowUnixSeconds();
  let changed = false;

  const nextTasks = tasks.value.map((task) => {
    if (task.id !== taskId) {
      return task;
    }

    const nextTask = acknowledgeReminderTask(task, nextNow);
    changed = nextTask !== task;
    return nextTask;
  });

  if (!changed) {
    return;
  }

  persistTasks(nextTasks);
  void syncLoopingSoundLoop();
  store.showToast('已确认提醒。', 'success');
}

function acknowledgeAllFiredTasks(): void {
  if (acknowledgmentPendingTasks.value.length === 0) {
    return;
  }

  const nextNow = nowUnixSeconds();
  const nextTasks = tasks.value.map((task) => acknowledgeReminderTask(task, nextNow));
  persistTasks(nextTasks);
  void syncLoopingSoundLoop();
  store.showToast('已确认全部待确认提醒。', 'success');
}

function clearHistoryTasks(): void {
  if (!historyTasks.value.length) {
    return;
  }

  if (!window.confirm('确认清空历史任务吗？此操作不可恢复。')) {
    return;
  }

  const nextTasks = tasks.value.filter(
    (task) =>
      task.status === 'pending' || (task.status === 'fired' && task.requiresAcknowledgement && !Number.isFinite(task.acknowledgedAtUnix)),
  );
  persistTasks(nextTasks);
  store.showToast('历史任务已清空。', 'success');
}

function getNotificationPermission(): 'unsupported' | NotificationPermission {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }

  return Notification.permission;
}

async function requestBrowserNotificationPermission(): Promise<void> {
  if (notificationPermission.value === 'unsupported') {
    store.showToast('当前浏览器不支持系统通知。', 'error');
    return;
  }

  const permission = await Notification.requestPermission();
  notificationPermission.value = permission;

  if (permission === 'granted') {
    store.showToast('通知权限已授权。', 'success');
    return;
  }

  if (permission === 'denied') {
    store.showToast('通知权限被拒绝，可在浏览器设置中手动开启。', 'error');
    return;
  }

  store.showToast('通知权限保持未授权。', 'info');
}

function resolveAudioContextCtor(): typeof AudioContext | null {
  if (typeof globalThis === 'undefined') {
    return null;
  }

  const maybeGlobal = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  return maybeGlobal.AudioContext ?? maybeGlobal.webkitAudioContext ?? null;
}

function ensureAudioContext(): AudioContext {
  if (audioContext) {
    return audioContext;
  }

  const AudioContextCtor = resolveAudioContextCtor();
  if (!AudioContextCtor) {
    throw new Error('当前浏览器不支持 Web Audio。');
  }

  audioContext = new AudioContextCtor();
  return audioContext;
}

function parseSynthFrequenciesFromInput(raw: string): number[] {
  const parts = raw
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (parts.length === 0) {
    throw new Error('请至少输入 1 个频率值。');
  }
  if (parts.length > 16) {
    throw new Error('频率数量不能超过 16 个。');
  }

  return parts.map((item) => {
    const parsed = Number(item);
    if (!Number.isFinite(parsed)) {
      throw new Error(`频率值无效：${item}`);
    }
    const hz = Math.floor(parsed);
    if (hz < 80 || hz > 4000) {
      throw new Error(`频率超出范围（80-4000Hz）：${hz}`);
    }
    return hz;
  });
}

function normalizeOscillatorType(value: string): OscillatorType {
  if (value === 'sine' || value === 'square' || value === 'triangle' || value === 'sawtooth') {
    return value;
  }
  return 'sine';
}

function buildSynthConfigFromInputs(): ReminderSynthPatternConfig {
  const waveform = normalizeOscillatorType(String(synthWaveformInput.value));
  const frequencies = parseSynthFrequenciesFromInput(synthFrequenciesInput.value);
  const toneDurationMs = Math.floor(Number(synthToneDurationInput.value));
  const gapDurationMs = Math.floor(Number(synthGapDurationInput.value));
  const gain = Number(synthGainInput.value);

  if (!Number.isFinite(toneDurationMs) || toneDurationMs < 40 || toneDurationMs > 2000) {
    throw new Error('单音时长需在 40-2000 毫秒之间。');
  }
  if (!Number.isFinite(gapDurationMs) || gapDurationMs < 0 || gapDurationMs > 1200) {
    throw new Error('间隔时长需在 0-1200 毫秒之间。');
  }
  if (!Number.isFinite(gain) || gain < 0.01 || gain > 1) {
    throw new Error('音量需在 0.01-1.00 之间。');
  }

  return {
    waveform,
    frequencies,
    toneDurationMs,
    gapDurationMs,
    gain: Number(gain.toFixed(3)),
    updatedAtUnix: nowUnixSeconds(),
  };
}

function syncSynthInputsFromConfig(config: ReminderSynthPatternConfig): void {
  synthWaveformInput.value = config.waveform;
  synthFrequenciesInput.value = config.frequencies.join(',');
  synthToneDurationInput.value = config.toneDurationMs;
  synthGapDurationInput.value = config.gapDurationMs;
  synthGainInput.value = config.gain;
}

function saveSynthConfigFromInputs(): void {
  try {
    const nextConfig = buildSynthConfigFromInputs();
    synthPatternConfig.value = nextConfig;
    saveReminderSynthPatternConfig(nextConfig);
    syncSynthInputsFromConfig(nextConfig);
    stopLoopingSound();
    void syncLoopingSoundLoop();
    store.showToast('DIY 合成参数已保存。', 'success');
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : 'DIY 合成参数保存失败。', 'error');
  }
}

async function previewSynthConfigFromInputs(): Promise<void> {
  try {
    const config = buildSynthConfigFromInputs();
    await playSyntheticToneOnce(config);
    soundPrimed.value = true;
    soundBlockedHintShown = false;
    store.showToast('DIY 合成铃声试听成功。', 'success');
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : 'DIY 合成铃声试听失败。', 'error');
  }
}

function resetSynthConfig(): void {
  const config = getDefaultReminderSynthPatternConfig(nowUnixSeconds());
  synthPatternConfig.value = config;
  saveReminderSynthPatternConfig(config);
  syncSynthInputsFromConfig(config);
  stopLoopingSound();
  void syncLoopingSoundLoop();
  store.showToast('已恢复默认合成参数。', 'success');
}

function getSynthLoopIntervalMs(config: ReminderSynthPatternConfig): number {
  const beepCount = config.frequencies.length;
  const totalPatternMs = beepCount * config.toneDurationMs + Math.max(0, beepCount - 1) * config.gapDurationMs;
  return Math.max(500, totalPatternMs + 220);
}

async function playSyntheticToneOnce(config: ReminderSynthPatternConfig): Promise<void> {
  const context = ensureAudioContext();

  if (context.state === 'suspended') {
    await context.resume();
  }

  const toneDurationSeconds = config.toneDurationMs / 1000;
  const gapDurationSeconds = config.gapDurationMs / 1000;
  const startTime = context.currentTime + 0.02;
  let cursor = startTime;

  config.frequencies.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    const toneStart = cursor;
    const toneEnd = toneStart + toneDurationSeconds;
    const attackEnd = toneStart + Math.min(0.03, Math.max(0.005, toneDurationSeconds * 0.2));

    oscillator.type = config.waveform;
    oscillator.frequency.setValueAtTime(frequency, toneStart);

    gainNode.gain.setValueAtTime(0.0001, toneStart);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, config.gain), attackEnd);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, toneEnd);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start(toneStart);
    oscillator.stop(toneEnd + 0.01);

    if (index < config.frequencies.length - 1) {
      cursor = toneEnd + gapDurationSeconds;
    }
  });
}

function cleanupAudioElement(audio: HTMLAudioElement): void {
  audio.pause();
  audio.currentTime = 0;
  audio.removeAttribute('src');
  audio.load();
}

function waitAudioSamplePlayback(audio: HTMLAudioElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    const timer = window.setTimeout(finish, timeoutMs);
    audio.addEventListener('ended', finish, { once: true });
    audio.addEventListener('error', finish, { once: true });
  });
}

async function playAudioSourceOnce(sourceUrl: string): Promise<void> {
  const audio = new Audio(sourceUrl);
  audio.preload = 'auto';

  try {
    await audio.play();
    await waitAudioSamplePlayback(audio, 1500);
  } finally {
    cleanupAudioElement(audio);
  }
}

function getFileExtension(fileName: string): string | undefined {
  const matched = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return matched ? matched[1].toLowerCase() : undefined;
}

function resolveMimeTypeByExtension(extension?: string): string {
  if (!extension) {
    return 'audio/mpeg';
  }
  if (extension === 'wav') {
    return 'audio/wav';
  }
  if (extension === 'ogg') {
    return 'audio/ogg';
  }
  if (extension === 'webm') {
    return 'audio/webm';
  }
  if (extension === 'm4a' || extension === 'mp4') {
    return 'audio/mp4';
  }
  if (extension === 'aac') {
    return 'audio/aac';
  }
  if (extension === 'flac') {
    return 'audio/flac';
  }
  if (extension === 'opus') {
    return 'audio/opus';
  }
  if (extension === 'aiff') {
    return 'audio/aiff';
  }
  return 'audio/mpeg';
}

function parseMimeTypeFromDataUrl(dataUrl: string): string | null {
  const match = /^data:([^;]+);base64,/i.exec(dataUrl.trim());
  return match ? match[1].toLowerCase() : null;
}

function validateRingtoneUploadFile(file: File): string {
  const extension = getFileExtension(file.name);
  const mimeType = file.type.trim().toLowerCase();

  if (extension && BLOCKED_FILE_EXTENSIONS.has(extension)) {
    throw new Error(`不支持的文件类型：.${extension}`);
  }
  if (file.size > MAX_RINGTONE_BYTES) {
    throw new Error('铃声文件过大，请控制在 1.5MB 以内。');
  }
  if (mimeType && !mimeType.startsWith('audio/')) {
    throw new Error('仅支持音频文件，请重新选择。');
  }

  const extensionAllowed = Boolean(extension && ALLOWED_AUDIO_EXTENSIONS.has(extension));
  const mimeAllowed = Boolean(mimeType && ALLOWED_AUDIO_MIME_TYPES.has(mimeType));
  if (!extensionAllowed && !mimeAllowed) {
    throw new Error('不支持该音频格式，请使用 mp3/wav/ogg/m4a/aac/flac/opus/webm/mp4。');
  }

  if (mimeType && mimeAllowed) {
    return mimeType;
  }
  return resolveMimeTypeByExtension(extension);
}

function openRingtonePicker(): void {
  ringtoneInputRef.value?.click();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('读取铃声文件失败。'));
    };
    reader.onerror = () => {
      reject(new Error('读取铃声文件失败。'));
    };
    reader.readAsDataURL(file);
  });
}

async function handleRingtoneFileChange(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = '';

  if (!file) {
    return;
  }

  try {
    const fallbackMimeType = validateRingtoneUploadFile(file);
    const dataUrl = await readFileAsDataUrl(file);
    const detectedMimeType = parseMimeTypeFromDataUrl(dataUrl);
    const mimeType = detectedMimeType && detectedMimeType.startsWith('audio/') ? detectedMimeType : fallbackMimeType;

    const config: ReminderRingtoneConfig = {
      name: file.name.trim().slice(0, 120) || 'custom-ringtone',
      mimeType,
      dataUrl,
      updatedAtUnix: nowUnixSeconds(),
      githubPath: undefined,
      githubSyncedAtUnix: undefined,
    };
    saveReminderRingtoneConfig(config);
    customRingtoneConfig.value = config;
    githubSyncStatus.value = 'idle';
    githubSyncMessage.value = '';
    soundBlockedHintShown = false;
    store.showToast(`自定义铃声已更新：${config.name}`, 'success');
    stopLoopingSound();
    void syncLoopingSoundLoop();
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '保存自定义铃声失败。', 'error');
  }
}

function clearCustomRingtone(): void {
  if (!customRingtoneConfig.value) {
    return;
  }

  clearReminderRingtoneConfig();
  customRingtoneConfig.value = null;
  githubSyncStatus.value = 'idle';
  githubSyncMessage.value = '';
  stopLoopingSound();
  void syncLoopingSoundLoop();
  store.showToast('已清除上传铃声，将按当前策略回退。', 'success');
}

function resolveRingtoneTarget(): ActiveRingtoneTarget {
  const uploaded = customRingtoneConfig.value;
  const defaultReady = defaultAudioStatus.value === 'ready' ? defaultAudioAsset.value : null;

  if (ringtoneSourceMode.value === 'uploaded') {
    if (uploaded) {
      return {
        kind: 'uploaded',
        sourceUrl: uploaded.dataUrl,
        label: `上传铃声：${uploaded.name}`,
      };
    }
    return {
      kind: 'synth',
      label: '合成铃声（上传铃声未配置）',
      fallbackReason: '上传铃声未配置，已自动回退到合成铃声。',
    };
  }

  if (ringtoneSourceMode.value === 'default-file') {
    if (defaultReady) {
      return {
        kind: 'default-file',
        sourceUrl: defaultReady.url,
        label: `默认文件铃声：${defaultReady.name}`,
      };
    }
    return {
      kind: 'synth',
      label: '合成铃声（默认文件不可用）',
      fallbackReason: '默认铃声文件不可用，已自动回退到合成铃声。',
    };
  }

  if (ringtoneSourceMode.value === 'synth') {
    return {
      kind: 'synth',
      label: '合成铃声（DIY 参数）',
    };
  }

  if (uploaded) {
    return {
      kind: 'uploaded',
      sourceUrl: uploaded.dataUrl,
      label: `上传铃声：${uploaded.name}`,
    };
  }
  if (defaultReady) {
    return {
      kind: 'default-file',
      sourceUrl: defaultReady.url,
      label: `默认文件铃声：${defaultReady.name}`,
    };
  }
  return {
    kind: 'synth',
    label: '合成铃声（默认回退）',
  };
}

function notifyRingtoneFallbackIfNeeded(target: ActiveRingtoneTarget): void {
  if (!target.fallbackReason) {
    ringtoneFallbackHintShown = false;
    return;
  }
  if (ringtoneFallbackHintShown) {
    return;
  }

  ringtoneFallbackHintShown = true;
  store.showToast(target.fallbackReason, 'info');
}

async function playCurrentRingtoneOnce(): Promise<void> {
  const target = resolveRingtoneTarget();
  notifyRingtoneFallbackIfNeeded(target);

  if (target.kind === 'synth') {
    await playSyntheticToneOnce(synthPatternConfig.value);
    return;
  }
  if (!target.sourceUrl) {
    throw new Error('当前铃声源不可用。');
  }
  await playAudioSourceOnce(target.sourceUrl);
}

async function enableSoundReminder(): Promise<void> {
  try {
    await playCurrentRingtoneOnce();
    soundPrimed.value = true;
    soundBlockedHintShown = false;
    store.showToast('声音提醒已启用。', 'success');
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '启用声音提醒失败。', 'error');
  }
}

async function probeAudioUrl(url: string, timeoutMs = 3500): Promise<boolean> {
  return new Promise((resolve) => {
    const audio = new Audio();
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      cleanupAudioElement(audio);
      resolve(result);
    };

    const timer = window.setTimeout(() => finish(false), timeoutMs);
    audio.addEventListener('canplaythrough', () => finish(true), { once: true });
    audio.addEventListener('error', () => finish(false), { once: true });
    audio.preload = 'metadata';
    audio.src = url;
    audio.load();
  });
}

async function reloadDefaultRingtoneAsset(): Promise<void> {
  defaultAudioStatus.value = 'checking';
  defaultAudioStatusMessage.value = '';
  defaultAudioAsset.value = null;

  const loaded = await loadReminderDefaultAudioAsset();
  if (!loaded) {
    defaultAudioStatus.value = 'missing';
    defaultAudioStatusMessage.value = '未发现配置文件 public/config/reminder-audio-config.json 或其中未配置默认音频。';
    return;
  }

  defaultAudioAsset.value = loaded;
  const playable = await probeAudioUrl(loaded.url);
  if (playable) {
    defaultAudioStatus.value = 'ready';
    defaultAudioStatusMessage.value = `路径：${loaded.path}`;
    return;
  }

  defaultAudioStatus.value = 'failed';
  defaultAudioStatusMessage.value = `文件不可播放：${loaded.path}`;
}

function stopLoopingSound(): void {
  if (loopAudioElement) {
    cleanupAudioElement(loopAudioElement);
    loopAudioElement = null;
  }

  if (syntheticLoopTimer !== null) {
    clearInterval(syntheticLoopTimer);
    syntheticLoopTimer = null;
  }

  alarmLoopRunning.value = false;
}

async function startLoopingForTarget(target: ActiveRingtoneTarget): Promise<void> {
  if (target.kind === 'synth') {
    await playSyntheticToneOnce(synthPatternConfig.value);
    const intervalMs = getSynthLoopIntervalMs(synthPatternConfig.value);
    syntheticLoopTimer = window.setInterval(() => {
      void playSyntheticToneOnce(synthPatternConfig.value).catch(() => {
        // Ignore one-shot oscillator errors during background throttling.
      });
    }, intervalMs);
    return;
  }

  if (!target.sourceUrl) {
    throw new Error('铃声路径无效。');
  }

  const audio = new Audio(target.sourceUrl);
  audio.preload = 'auto';
  audio.loop = true;
  await audio.play();
  loopAudioElement = audio;
}

async function startLoopingSound(): Promise<void> {
  if (alarmLoopRunning.value) {
    return;
  }
  if (loopStartInProgress) {
    await loopStartInProgress;
    return;
  }

  loopStartInProgress = (async () => {
    let target: ActiveRingtoneTarget | null = null;

    try {
      stopLoopingSound();
      target = resolveRingtoneTarget();
      notifyRingtoneFallbackIfNeeded(target);
      await startLoopingForTarget(target);
      alarmLoopRunning.value = true;
      soundPrimed.value = true;
      return;
    } catch {
      if (target && target.kind !== 'synth') {
        try {
          await startLoopingForTarget({
            kind: 'synth',
            label: '合成铃声（文件播放失败回退）',
          });
          alarmLoopRunning.value = true;
          soundPrimed.value = true;
          store.showToast('文件铃声播放失败，已回退到合成铃声循环。', 'info');
          return;
        } catch {
          // continue to browser blocked fallback
        }
      }

      stopLoopingSound();
      if (!soundBlockedHintShown) {
        soundBlockedHintShown = true;
        store.showToast('循环铃声可能被浏览器拦截，请点击“启用声音提醒（测试）”。', 'info');
      }
    } finally {
      loopStartInProgress = null;
    }
  })();

  await loopStartInProgress;
}

async function syncLoopingSoundLoop(): Promise<void> {
  if (!hasPendingLoopingSound.value) {
    stopLoopingSound();
    return;
  }

  await startLoopingSound();
}

function resolveGithubTokenOrThrow(): string {
  const owner = store.state.config.githubOwner.trim();
  const repo = store.state.config.githubRepo.trim();
  const recordsDir = store.state.config.githubRecordsDir.trim();
  const token = store.state.githubToken.trim();

  if (!owner || !repo || !recordsDir) {
    throw new Error('请先在页面设置中完成 GitHub owner/repo/recordsDir 配置。');
  }
  if (!token) {
    throw new Error('请先配置 GitHub Token（PAT）。');
  }
  return token;
}

function buildDefaultFileSyncPayload():
  | {
      name?: string;
      path: string;
      mimeType?: string;
    }
  | undefined {
  if (!defaultAudioAsset.value) {
    return undefined;
  }

  return {
    name: defaultAudioAsset.value.name,
    path: defaultAudioAsset.value.path,
    mimeType: defaultAudioAsset.value.mimeType,
  };
}

async function syncCustomRingtoneToGithub(): Promise<void> {
  if (pushingToGithub.value) {
    return;
  }

  let token = '';
  try {
    token = resolveGithubTokenOrThrow();
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : 'GitHub 配置不完整。', 'error');
    return;
  }

  pushingToGithub.value = true;
  githubSyncStatus.value = 'syncing';
  githubSyncMessage.value = customRingtoneConfig.value ? '正在上传自定义铃声并同步配置...' : '正在同步 DIY 参数与铃声配置...';

  try {
    const current = customRingtoneConfig.value;
    const defaultFile = buildDefaultFileSyncPayload();
    const synth = synthPatternConfig.value;

    if (current) {
      const result = await uploadReminderRingtoneToGithub(
        {
          fileName: current.name,
          mimeType: current.mimeType,
          dataUrl: current.dataUrl,
          sourceMode: ringtoneSourceMode.value,
          defaultFile,
          synth,
        },
        store.state.config,
        token,
      );

      const nextConfig: ReminderRingtoneConfig = {
        ...current,
        githubPath: result.audioPath,
        githubSyncedAtUnix: nowUnixSeconds(),
      };
      saveReminderRingtoneConfig(nextConfig);
      customRingtoneConfig.value = nextConfig;

      githubSyncStatus.value = 'success';
      githubSyncMessage.value = `已同步铃声：${result.audioPath}；配置：${result.configPath}`;
      store.showToast('上传铃声与 DIY 参数已同步到 GitHub。', 'success');
      return;
    }

    const remoteConfig = await fetchReminderRingtonePathConfigFromGithub(store.state.config, token);
    const synced = await syncReminderRingtonePathConfigToGithub(
      {
        sourceMode: ringtoneSourceMode.value,
        uploaded: remoteConfig?.uploaded,
        defaultFile,
        synth,
      },
      store.state.config,
      token,
    );

    githubSyncStatus.value = 'success';
    githubSyncMessage.value = `已同步铃声配置：${synced.configPath}`;
    store.showToast('DIY 参数已同步到 GitHub。', 'success');
  } catch (error) {
    githubSyncStatus.value = 'error';
    githubSyncMessage.value = error instanceof Error ? error.message : '同步失败。';
    store.showToast(githubSyncMessage.value, 'error');
  } finally {
    pushingToGithub.value = false;
  }
}

async function syncCustomRingtoneFromGithub(): Promise<void> {
  if (pullingFromGithub.value) {
    return;
  }

  let token = '';
  try {
    token = resolveGithubTokenOrThrow();
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : 'GitHub 配置不完整。', 'error');
    return;
  }

  pullingFromGithub.value = true;
  githubSyncStatus.value = 'syncing';
  githubSyncMessage.value = '正在拉取远端铃声配置...';

  try {
    const remoteConfig = await fetchReminderRingtonePathConfigFromGithub(store.state.config, token);
    if (!remoteConfig) {
      throw new Error('GitHub 中未找到已同步的铃声配置。');
    }

    const pulledParts: string[] = [];

    if (remoteConfig.uploaded) {
      const dataUrl = await fetchReminderAudioDataUrlFromGithub(
        remoteConfig.uploaded.path,
        store.state.config,
        token,
        remoteConfig.uploaded.mimeType,
      );
      const pulledConfig: ReminderRingtoneConfig = {
        name: remoteConfig.uploaded.name,
        mimeType: remoteConfig.uploaded.mimeType,
        dataUrl,
        updatedAtUnix: nowUnixSeconds(),
        githubPath: remoteConfig.uploaded.path,
        githubSyncedAtUnix: nowUnixSeconds(),
      };
      saveReminderRingtoneConfig(pulledConfig);
      customRingtoneConfig.value = pulledConfig;
      pulledParts.push('上传铃声');
    }

    if (remoteConfig.synth) {
      const pulledSynth: ReminderSynthPatternConfig = {
        waveform: remoteConfig.synth.waveform,
        frequencies: [...remoteConfig.synth.frequencies],
        toneDurationMs: remoteConfig.synth.toneDurationMs,
        gapDurationMs: remoteConfig.synth.gapDurationMs,
        gain: remoteConfig.synth.gain,
        updatedAtUnix: remoteConfig.synth.updatedAtUnix,
      };
      saveReminderSynthPatternConfig(pulledSynth);
      synthPatternConfig.value = pulledSynth;
      syncSynthInputsFromConfig(pulledSynth);
      pulledParts.push('DIY 参数');
    }

    if (remoteConfig.sourceMode) {
      ringtoneSourceMode.value = remoteConfig.sourceMode;
      saveReminderRingtoneSourceMode(remoteConfig.sourceMode);
      pulledParts.push(`铃声策略（${remoteConfig.sourceMode}）`);
    }

    if (pulledParts.length === 0) {
      pulledParts.push('配置元数据');
    }

    githubSyncStatus.value = 'success';
    githubSyncMessage.value = `已拉取：${pulledParts.join('、')}`;
    stopLoopingSound();
    void syncLoopingSoundLoop();
    store.showToast('已从 GitHub 拉取铃声配置。', 'success');
  } catch (error) {
    githubSyncStatus.value = 'error';
    githubSyncMessage.value = error instanceof Error ? error.message : '拉取失败。';
    store.showToast(githubSyncMessage.value, 'error');
  } finally {
    pullingFromGithub.value = false;
  }
}

function sendBrowserNotification(task: ReminderTask): void {
  if (notificationPermission.value !== 'granted') {
    return;
  }

  try {
    const body = `到点时间：${toLocalDateTimeText(task.triggerAtUnix)}`;
    new Notification(task.title, {
      body,
      tag: task.id,
    });
  } catch {
    // Ignore notification runtime failures and keep toast fallback.
  }
}

function emitReminderAlert(task: ReminderTask): void {
  const summary = `${task.title} 已到点，请点击“我已收到”停止循环提醒。`;
  store.showToast(summary, 'info');

  if (task.notificationEnabled) {
    sendBrowserNotification(task);
  }
}

function triggerDueReminders(): void {
  const dueTasks: ReminderTask[] = [];
  const nextTasks = tasks.value.map((task) => {
    if (task.status !== 'pending') {
      return task;
    }

    if (task.triggerAtUnix > nowUnix.value) {
      return task;
    }

    if (inFlightDueIds.has(task.id)) {
      return task;
    }

    inFlightDueIds.add(task.id);
    const firedTask = markReminderFired(task, nowUnix.value);
    dueTasks.push(firedTask);
    return firedTask;
  });

  if (dueTasks.length === 0) {
    return;
  }

  persistTasks(nextTasks);
  void syncLoopingSoundLoop();

  dueTasks.forEach((task) => {
    try {
      emitReminderAlert(task);
    } finally {
      inFlightDueIds.delete(task.id);
    }
  });
}

async function checkBackendConnectivity(): Promise<void> {
  const backendBaseUrl = effectiveReminderApiBaseUrl.value;
  if (!backendBaseUrl) {
    backendStatus.value = 'unconfigured';
    backendStatusMessage.value = '未配置提醒后端地址。';
    backendPingResult.value = null;
    return;
  }

  backendStatus.value = 'checking';
  backendStatusMessage.value = '';
  backendPingResult.value = null;

  try {
    const result = await pingReminderBackend(backendBaseUrl);
    backendStatus.value = 'online';
    backendPingResult.value = result;
    backendStatusMessage.value = `后端时间：${toLocalDateTimeText(result.serverTimeUnix)}`;
  } catch (error) {
    backendStatus.value = 'offline';
    backendStatusMessage.value = error instanceof Error ? error.message : '后端连接失败。';
  }
}
</script>
