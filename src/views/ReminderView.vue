<template>
  <main class="page page--reminder">
    <PageHeader title="提醒中心" description="支持自定义倒计时、自定义时间与停车提醒；番茄钟请前往独立页面。页面保持打开时可在线提醒。" />

    <section class="reminder-grid">
            <article class="card reminder-form-card">
        <h2>创建提醒</h2>
        <form class="form-grid reminder-form" @submit.prevent="handleCreateReminder">
          <div class="inline-actions full-width reminder-kind-switch">
            <button
              class="btn btn--ghost reminder-kind-switch__btn"
              :class="{ 'reminder-kind-switch__btn--active': formKind === 'custom' }"
              type="button"
              @click="formKind = 'custom'"
            >
              自定义倒计时
            </button>
            <button
              class="btn btn--ghost reminder-kind-switch__btn"
              :class="{ 'reminder-kind-switch__btn--active': formKind === 'custom-time' }"
              type="button"
              @click="formKind = 'custom-time'"
            >
              自定义时间
            </button>
            <button
              class="btn btn--ghost reminder-kind-switch__btn"
              :class="{ 'reminder-kind-switch__btn--active': formKind === 'parking' }"
              type="button"
              @click="formKind = 'parking'"
            >
              停车提醒
            </button>
          </div>
          <label v-if="formKind === 'custom' || formKind === 'parking'">
            {{ formKind === 'parking' ? '停车倒计时分钟数' : '倒计时分钟数' }}
            <input v-model.number="formDurationMinutes" type="number" min="0" max="20160" step="1" />
          </label>
          <label v-if="formKind === 'custom' || formKind === 'parking'">
            秒（默认 00）
            <input v-model.number="formDurationSeconds" type="number" min="0" max="59" step="1" />
          </label>
          <p v-if="formKind === 'custom' || formKind === 'parking'" class="hint full-width">
            {{ formKind === 'parking' ? `默认 135 分钟 00 秒，可修改。当前总时长：${formattedFormDuration}` : `当前总时长：${formattedFormDuration}` }}
          </p>
          <div v-if="formKind === 'custom-time'" class="form-grid full-width">
            <label>
              日期时间输入方式
              <select v-model="customTimeDateInputMode">
                <option value="picker">闹钟选择</option>
                <option value="manual">手动输入</option>
              </select>
            </label>
            <label v-if="customTimeDateInputMode === 'picker'">
              日期时间
              <input v-model="customTimeDateTimeInput" type="datetime-local" />
            </label>
            <label v-else>
              手动日期时间
              <input v-model.trim="customTimeDateTimeManualInput" type="text" placeholder="YYYY-MM-DD HH:mm(:ss)" />
            </label>
            <label>
              重复日期输入方式
              <select v-model="customTimeRepeatInputMode">
                <option value="picker">选择星期</option>
                <option value="manual">手动输入</option>
              </select>
            </label>
            <div v-if="customTimeRepeatInputMode === 'picker'" class="full-width reminder-weekday-grid">
              <button
                v-for="option in weekdayOptions"
                :key="option.value"
                class="btn btn--ghost reminder-weekday-btn"
                :class="{ 'reminder-weekday-btn--active': customTimeRepeatWeekdays.includes(option.value) }"
                type="button"
                @click="toggleCustomTimeWeekday(option.value)"
              >
                {{ option.label }}
              </button>
            </div>
            <label v-else class="full-width">
              手动重复星期
              <input v-model.trim="customTimeRepeatManualInput" type="text" placeholder="例如：1,3,5（1=周一，7=周日）" />
            </label>
            <p class="hint full-width">手动输入会进行正则校验，空值表示不重复。</p>
            <p class="hint full-width">重复设置：{{ customTimeRepeatInputMode === 'picker' ? formatRepeatWeekdaysText(customTimeRepeatWeekdays) : (customTimeRepeatManualInput.trim() || '不重复') }}</p>
          </div>
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
            <RouterLink class="cross-page-link cross-page-link--pomodoro" to="/pomodoro">
              <span class="cross-page-link__eyebrow">专注模式</span>
              <strong>番茄钟页面</strong>
            </RouterLink>
          </div>
        </form>
      </article>

      <article class="card reminder-channel-card">
        <div class="reminder-channel-card__header">
          <h2>提醒通道状态</h2>
          <button
            v-if="isMobileLayout"
            class="btn btn--ghost reminder-channel-card__collapse-btn"
            type="button"
            :aria-expanded="!isChannelCardCollapsed"
            @click="toggleChannelCardCollapsed"
          >
            {{ isChannelCardCollapsed ? '展开' : '收起' }}
          </button>
        </div>
        <p v-if="isMobileLayout && isChannelCardCollapsed" class="hint">{{ channelStatusSummaryText }}</p>
        <template v-if="!isMobileLayout || !isChannelCardCollapsed">
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
        <section class="reminder-subsection">
          <h3>锁屏 Push 提醒（测试中）</h3>
          <p class="hint">状态：{{ pushStatusText }}</p>
          <p v-if="pushStatusMessage" class="hint">{{ pushStatusMessage }}</p>
          <div class="inline-actions">
            <button
              class="btn btn--ghost"
              type="button"
              :disabled="!canManagePushNotifications || pushStatus === 'syncing'"
              @click="enableLockscreenPushNotifications"
            >
              启用锁屏 Push 提醒
            </button>
            <button
              class="btn btn--ghost"
              type="button"
              :disabled="!pushRuntimeSupported || pushStatus === 'syncing'"
              @click="disableLockscreenPushNotifications"
            >
              关闭锁屏 Push 提醒
            </button>
            <button
              class="btn btn--secondary"
              type="button"
              :disabled="!pushRuntimeSupported || sendingPushTest || pushStatus === 'syncing'"
              @click="sendLockscreenPushNotificationTest"
            >
              {{ sendingPushTest ? '发送中...' : '发送 Push 测试' }}
            </button>
          </div>
          <p class="hint">提示：锁屏提醒由系统和浏览器策略决定，不保证每次都响铃。</p>
        </section>
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
        </template>
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
              <p class="hint">{{ formatTaskScheduleText(task) }}</p>
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
              <p class="hint">{{ formatTaskScheduleText(task) }}</p>
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
              <p class="hint">{{ formatTaskScheduleText(task) }}</p>
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
  fetchReminderPushVapidPublicKey,
  removeReminderPushSubscription,
  sendReminderPushTest,
  serializePushSubscription,
  upsertReminderPushSubscription,
  urlBase64ToUint8Array,
} from '../services/reminderPushService';
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
import type { ReminderRingtoneConfig, ReminderRingtoneSourceMode, ReminderSynthPatternConfig, ReminderTask } from '../types/reminder';
import { nowUnixSeconds, parseDateTimeLocalToUnix, toLocalDateTime, unixSecondsToIsoString } from '../utils/date';

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

type FormReminderKind = 'custom' | 'custom-time' | 'parking';

const MOBILE_BREAKPOINT = 767;
const PARKING_DEFAULT_DURATION_SECONDS = 135 * 60;
const MANUAL_DATE_TIME_REGEX = /^\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*$/;
const MANUAL_REPEAT_WEEKDAYS_REGEX = /^\s*(?:[1-7](?:\s*[,，]\s*[1-7])*)?\s*$/;

const store = useAppStore();
const tasks = ref<ReminderTask[]>([]);
const nowUnix = ref(nowUnixSeconds());
const formKind = ref<FormReminderKind>('custom');
const formTitle = ref('');
const formNote = ref('');
const formDurationMinutes = ref(0);
const formDurationSeconds = ref(0);
const formSoundEnabled = ref(true);
const formNotificationEnabled = ref(true);
const customTimeDateInputMode = ref<'picker' | 'manual'>('picker');
const customTimeDateTimeInput = ref('');
const customTimeDateTimeManualInput = ref('');
const customTimeRepeatInputMode = ref<'picker' | 'manual'>('picker');
const customTimeRepeatWeekdays = ref<number[]>([]);
const customTimeRepeatManualInput = ref('');
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
const isMobileLayout = ref(false);
const isChannelCardCollapsed = ref(false);
const pushStatus = ref<'unsupported' | 'idle' | 'syncing' | 'enabled' | 'error'>('idle');
const pushStatusMessage = ref('');
const pushSubscriptionId = ref('');
const sendingPushTest = ref(false);

const reminderApiBaseUrl = computed(() => store.state.config.reminderApiBaseUrl.trim());
const effectiveReminderApiBaseUrl = computed(() => resolveReminderBackendBaseUrl(store.state.config));
const pushRuntimeSupported = computed(
  () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window,
);
const canManagePushNotifications = computed(
  () => pushRuntimeSupported.value && notificationPermission.value !== 'unsupported',
);
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
const weekdayOptions = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' },
];
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
const pushStatusText = computed(() => {
  if (pushStatus.value === 'unsupported') {
    return 'Current browser does not support Web Push';
  }
  if (pushStatus.value === 'syncing') {
    return 'Syncing...';
  }
  if (pushStatus.value === 'enabled') {
    return pushSubscriptionId.value ? `Enabled: ${pushSubscriptionId.value}` : 'Enabled';
  }
  if (pushStatus.value === 'error') {
    return 'Error';
  }
  return 'Not enabled';
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
const channelStatusSummaryText = computed(() => {
  const notificationSummary =
    notificationPermission.value === 'granted'
      ? '通知已授权'
      : notificationPermission.value === 'denied'
        ? '通知被拒绝'
        : notificationPermission.value === 'unsupported'
          ? '通知不支持'
          : '通知未授权';
  const soundSummary = soundPrimed.value ? '声音已启用' : '声音未启用';
  return `${notificationSummary} · ${soundSummary} · ${backendStatusText.value}`;
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
    formDurationMinutes.value = PARKING_DEFAULT_DURATION_SECONDS / 60;
    formDurationSeconds.value = 0;
    if (!formTitle.value.trim()) {
      formTitle.value = '停车提醒';
    }
    return;
  }

  if (value === 'custom-time') {
    formDurationMinutes.value = 0;
    formDurationSeconds.value = 0;
    resetCustomTimeFormFields();
    if (!formTitle.value.trim()) {
      formTitle.value = '自定义时间提醒';
    }
    return;
  }

  formDurationMinutes.value = 0;
  formDurationSeconds.value = 0;
  if (!formTitle.value.trim()) {
    formTitle.value = '自定义倒计时提醒';
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
  syncMobileLayoutState();
  syncSynthInputsFromConfig(synthPatternConfig.value);
  tasks.value = loadReminderTasks();
  triggerDueReminders();
  void syncLoopingSoundLoop();
  void reloadDefaultRingtoneAsset();
  void refreshPushSubscriptionStatus();

  ticker = window.setInterval(() => {
    nowUnix.value = nowUnixSeconds();
    triggerDueReminders();
  }, 1000);

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('resize', handleViewportResize);
});

onBeforeUnmount(() => {
  if (ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }

  stopLoopingSound();
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('resize', handleViewportResize);
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

function syncMobileLayoutState(): void {
  const nextIsMobile = window.innerWidth <= MOBILE_BREAKPOINT;
  if (nextIsMobile === isMobileLayout.value) {
    return;
  }

  isMobileLayout.value = nextIsMobile;
  isChannelCardCollapsed.value = nextIsMobile;
}

function handleViewportResize(): void {
  syncMobileLayoutState();
}

function toggleChannelCardCollapsed(): void {
  if (!isMobileLayout.value) {
    return;
  }

  isChannelCardCollapsed.value = !isChannelCardCollapsed.value;
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

function normalizeWeekdayValue(value: number): number | null {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 7) {
    return null;
  }
  return parsed;
}

function normalizeRepeatWeekdays(values: number[]): number[] {
  const normalized = values
    .map((item) => normalizeWeekdayValue(item))
    .filter((item): item is number => item !== null);

  return Array.from(new Set<number>(normalized)).sort((a, b) => a - b);
}

function weekdayFromDate(date: Date): number {
  const weekday = date.getDay();
  return weekday === 0 ? 7 : weekday;
}

function formatRepeatWeekdaysText(weekdays?: number[]): string {
  const normalized = normalizeRepeatWeekdays(weekdays ?? []);
  if (!normalized.length) {
    return '不重复';
  }

  return normalized
    .map((weekday) => weekdayOptions.find((item) => item.value === weekday)?.label ?? `周${weekday}`)
    .join('、');
}

function formatTaskScheduleText(task: ReminderTask): string {
  if (task.scheduleMode === 'date-time') {
    return `计划类型：自定义时间（${formatRepeatWeekdaysText(task.repeatWeekdays)}）`;
  }
  return '计划类型：倒计时';
}

function parseManualDateTimeToUnix(raw: string): number | undefined {
  const matched = MANUAL_DATE_TIME_REGEX.exec(raw.trim());
  if (!matched) {
    return undefined;
  }

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const hour = Number(matched[4]);
  const minute = Number(matched[5]);
  const second = Number(matched[6] ?? '0');

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second)
  ) {
    return undefined;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return undefined;
  }

  const parsed = new Date(year, month - 1, day, hour, minute, second, 0);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute ||
    parsed.getSeconds() !== second
  ) {
    return undefined;
  }

  return Math.floor(parsed.getTime() / 1000);
}

function parseRepeatWeekdaysFromManualInput(raw: string): number[] {
  if (!MANUAL_REPEAT_WEEKDAYS_REGEX.test(raw)) {
    throw new Error('重复日期格式无效，请输入 1-7（逗号分隔），例如 1,3,5。');
  }

  const text = raw.trim();
  if (!text) {
    return [];
  }

  const numbers = text
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => Number(item));

  return normalizeRepeatWeekdays(numbers);
}

function resolveNextRepeatTriggerAtUnix(baseTriggerAtUnix: number, repeatWeekdays: number[], referenceUnix: number): number {
  const normalizedRepeatWeekdays = normalizeRepeatWeekdays(repeatWeekdays);
  if (!normalizedRepeatWeekdays.length) {
    return baseTriggerAtUnix;
  }

  const baseDate = new Date(baseTriggerAtUnix * 1000);
  if (Number.isNaN(baseDate.getTime())) {
    throw new Error('自定义时间无效，请重新设置。');
  }

  const hour = baseDate.getHours();
  const minute = baseDate.getMinutes();
  const second = baseDate.getSeconds();
  const searchFrom = new Date((referenceUnix + 1) * 1000);

  for (let offset = 0; offset <= 21; offset += 1) {
    const candidate = new Date(searchFrom);
    candidate.setDate(searchFrom.getDate() + offset);
    candidate.setHours(hour, minute, second, 0);

    const weekday = weekdayFromDate(candidate);
    if (!normalizedRepeatWeekdays.includes(weekday)) {
      continue;
    }

    const candidateUnix = Math.floor(candidate.getTime() / 1000);
    if (candidateUnix > referenceUnix) {
      return candidateUnix;
    }
  }

  throw new Error('无法计算下一个重复时间，请检查重复日期配置。');
}

function toggleCustomTimeWeekday(weekday: number): void {
  const normalizedWeekday = normalizeWeekdayValue(weekday);
  if (!normalizedWeekday) {
    return;
  }

  if (customTimeRepeatWeekdays.value.includes(normalizedWeekday)) {
    customTimeRepeatWeekdays.value = customTimeRepeatWeekdays.value.filter((item) => item !== normalizedWeekday);
    return;
  }

  customTimeRepeatWeekdays.value = normalizeRepeatWeekdays([...customTimeRepeatWeekdays.value, normalizedWeekday]);
}

function resolveCustomTimeTriggerAtFromForm(referenceUnix: number): { triggerAtUnix: number; repeatWeekdays: number[] } {
  const rawTriggerAtUnix =
    customTimeDateInputMode.value === 'manual'
      ? parseManualDateTimeToUnix(customTimeDateTimeManualInput.value)
      : parseDateTimeLocalToUnix(customTimeDateTimeInput.value);

  if (rawTriggerAtUnix === undefined || !Number.isFinite(rawTriggerAtUnix)) {
    throw new Error('请设置有效的日期时间。手动输入格式示例：2026-04-02 08:30 或 2026-04-02 08:30:15。');
  }

  let triggerAtUnix = Math.floor(rawTriggerAtUnix);
  const repeatWeekdays =
    customTimeRepeatInputMode.value === 'manual'
      ? parseRepeatWeekdaysFromManualInput(customTimeRepeatManualInput.value)
      : normalizeRepeatWeekdays(customTimeRepeatWeekdays.value);

  if (repeatWeekdays.length > 0) {
    const referenceForRepeat = Math.max(referenceUnix, triggerAtUnix - 1);
    triggerAtUnix = resolveNextRepeatTriggerAtUnix(triggerAtUnix, repeatWeekdays, referenceForRepeat);
  } else if (triggerAtUnix <= referenceUnix) {
    throw new Error('自定义时间需要晚于当前时间；若希望自动循环，请设置重复日期。');
  }

  return {
    triggerAtUnix,
    repeatWeekdays,
  };
}

function resolveCountdownDurationSecondsFromForm(): number {
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

function resetCustomTimeFormFields(): void {
  customTimeDateInputMode.value = 'picker';
  customTimeDateTimeInput.value = '';
  customTimeDateTimeManualInput.value = '';
  customTimeRepeatInputMode.value = 'picker';
  customTimeRepeatWeekdays.value = [];
  customTimeRepeatManualInput.value = '';
}

function handleCreateReminder(): void {
  const createAtUnix = nowUnixSeconds();
  let task: ReminderTask;

  try {
    if (formKind.value === 'parking') {
      const durationSeconds = resolveCountdownDurationSecondsFromForm();
      task = createReminderTask({
        kind: 'parking',
        title: formTitle.value,
        note: formNote.value,
        durationSeconds,
        scheduleMode: 'countdown',
        soundEnabled: formSoundEnabled.value,
        notificationEnabled: formNotificationEnabled.value,
        nowUnix: createAtUnix,
      });
    } else if (formKind.value === 'custom-time') {
      const { triggerAtUnix, repeatWeekdays } = resolveCustomTimeTriggerAtFromForm(createAtUnix);
      task = createReminderTask({
        kind: 'custom-time',
        title: formTitle.value,
        note: formNote.value,
        durationSeconds: Math.max(0, triggerAtUnix - createAtUnix),
        scheduleMode: 'date-time',
        triggerAtUnix,
        repeatWeekdays,
        soundEnabled: formSoundEnabled.value,
        notificationEnabled: formNotificationEnabled.value,
        nowUnix: createAtUnix,
      });
    } else {
      const durationSeconds = resolveCountdownDurationSecondsFromForm();
      task = createReminderTask({
        kind: 'custom',
        title: formTitle.value,
        note: formNote.value,
        durationSeconds,
        scheduleMode: 'countdown',
        soundEnabled: formSoundEnabled.value,
        notificationEnabled: formNotificationEnabled.value,
        nowUnix: createAtUnix,
      });
    }
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '提醒参数无效。', 'error');
    return;
  }

  persistTasks(upsertReminderTask(tasks.value, task));
  if (task.scheduleMode === 'date-time') {
    store.showToast(
      `提醒已创建：${task.title}，触发时间 ${toLocalDateTimeText(task.triggerAtUnix)}（${formatRepeatWeekdaysText(task.repeatWeekdays)}）。`,
      'success',
    );
  } else {
    store.showToast(`提醒已创建：${task.title}，将在 ${formatDuration(task.durationSeconds)} 后触发。`, 'success');
  }

  formTitle.value = '';
  formNote.value = '';

  if (formKind.value === 'custom-time') {
    resetCustomTimeFormFields();
  } else if (formKind.value === 'custom') {
    formDurationMinutes.value = 0;
    formDurationSeconds.value = 0;
  } else {
    formDurationMinutes.value = PARKING_DEFAULT_DURATION_SECONDS / 60;
    formDurationSeconds.value = 0;
  }

  nowUnix.value = createAtUnix;
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

function resolvePushGithubContextOrThrow(): {
  githubToken: string;
  owner: string;
  repo: string;
  branch?: string;
  recordsDir: string;
} {
  const githubToken = store.state.githubToken.trim();
  const owner = store.state.config.githubOwner.trim();
  const repo = store.state.config.githubRepo.trim();
  const branch = store.state.config.githubBranch.trim();
  const recordsDir = store.state.config.githubRecordsDir.trim();

  if (!githubToken || !owner || !repo || !recordsDir) {
    throw new Error('请先配置 GitHub Token 与 owner/repo/recordsDir。');
  }

  return {
    githubToken,
    owner,
    repo,
    branch: branch || undefined,
    recordsDir,
  };
}

function resolveServiceWorkerBaseUrl(): string {
  return (import.meta.env.BASE_URL || '/').replace(/\/+$/, '/');
}

async function ensureReminderServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (!pushRuntimeSupported.value) {
    throw new Error('当前环境不支持 Service Worker 或 PushManager。');
  }

  const baseUrl = resolveServiceWorkerBaseUrl();
  let registration = await navigator.serviceWorker.getRegistration(baseUrl);
  if (!registration) {
    registration = await navigator.serviceWorker.register(`${baseUrl}sw.js`, { scope: baseUrl });
  }

  return registration;
}

async function refreshPushSubscriptionStatus(): Promise<void> {
  if (!pushRuntimeSupported.value) {
    pushStatus.value = 'unsupported';
    pushStatusMessage.value = '';
    pushSubscriptionId.value = '';
    return;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration(resolveServiceWorkerBaseUrl());
    if (!registration) {
      pushStatus.value = 'idle';
      pushStatusMessage.value = 'Service Worker 尚未就绪，可刷新页面后重试。';
      pushSubscriptionId.value = '';
      return;
    }

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      pushStatus.value = 'idle';
      pushStatusMessage.value = '';
      pushSubscriptionId.value = '';
      return;
    }

    pushStatus.value = 'enabled';
    pushSubscriptionId.value = '';
    pushStatusMessage.value = '检测到本机 Push 订阅，可点击“启用锁屏 Push 提醒”完成云端同步。';
  } catch (error) {
    pushStatus.value = 'error';
    pushStatusMessage.value = error instanceof Error ? error.message : '获取 Push 状态失败。';
  }
}

async function enableLockscreenPushNotifications(): Promise<void> {
  if (!canManagePushNotifications.value) {
    store.showToast('当前环境不支持锁屏 Push 提醒。', 'error');
    return;
  }

  pushStatus.value = 'syncing';
  pushStatusMessage.value = '';

  try {
    if (notificationPermission.value !== 'granted') {
      await requestBrowserNotificationPermission();
    }
    if (notificationPermission.value !== 'granted') {
      throw new Error('请先授予通知权限，再启用锁屏 Push 提醒。');
    }

    const vapidPublicKey = await fetchReminderPushVapidPublicKey(store.state.config);
    const registration = await ensureReminderServiceWorkerRegistration();
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const rawServerKey = urlBase64ToUint8Array(vapidPublicKey);
      const applicationServerKey = new Uint8Array(rawServerKey.length);
      applicationServerKey.set(rawServerKey);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    const result = await upsertReminderPushSubscription(
      store.state.config,
      resolvePushGithubContextOrThrow(),
      store.state.deviceMeta.deviceId,
      serializePushSubscription(subscription),
    );

    pushStatus.value = 'enabled';
    pushSubscriptionId.value = result.subscriptionId;
    pushStatusMessage.value = `已启用并同步到 GitHub：${result.path}`;
    store.showToast('锁屏 Push 提醒已启用。', 'success');
  } catch (error) {
    pushStatus.value = 'error';
    pushStatusMessage.value = error instanceof Error ? error.message : '启用锁屏 Push 失败。';
    store.showToast(pushStatusMessage.value, 'error');
  }
}

async function disableLockscreenPushNotifications(): Promise<void> {
  if (!pushRuntimeSupported.value) {
    store.showToast('当前环境不支持 Push 功能。', 'error');
    return;
  }

  pushStatus.value = 'syncing';

  try {
    const registration = await ensureReminderServiceWorkerRegistration();
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      pushStatus.value = 'idle';
      pushStatusMessage.value = '当前浏览器没有可关闭的 Push 订阅。';
      pushSubscriptionId.value = '';
      return;
    }

    const serialized = serializePushSubscription(subscription);
    let remoteMessage = '';
    try {
      const result = await removeReminderPushSubscription(
        store.state.config,
        resolvePushGithubContextOrThrow(),
        store.state.deviceMeta.deviceId,
        {
          subscriptionId: pushSubscriptionId.value || undefined,
          endpoint: serialized.endpoint,
        },
      );
      remoteMessage = result.removed ? '云端订阅已删除。' : '云端未找到订阅，已仅移除本地订阅。';
    } catch (error) {
      remoteMessage = error instanceof Error ? `远端移除失败：${error.message}` : '远端移除失败。';
    }

    await subscription.unsubscribe();
    pushStatus.value = 'idle';
    pushSubscriptionId.value = '';
    pushStatusMessage.value = remoteMessage || '锁屏 Push 提醒已关闭。';
    store.showToast('锁屏 Push 提醒已关闭。', 'success');
  } catch (error) {
    pushStatus.value = 'error';
    pushStatusMessage.value = error instanceof Error ? error.message : '关闭锁屏 Push 失败。';
    store.showToast(pushStatusMessage.value, 'error');
  }
}

async function sendLockscreenPushNotificationTest(): Promise<void> {
  if (!pushRuntimeSupported.value) {
    store.showToast('当前环境不支持 Push 功能。', 'error');
    return;
  }

  sendingPushTest.value = true;
  try {
    const registration = await ensureReminderServiceWorkerRegistration();
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      throw new Error('请先启用锁屏 Push 提醒。');
    }

    await sendReminderPushTest(store.state.config, serializePushSubscription(subscription));
    store.showToast('测试 Push 已发送，请检查通知栏与锁屏效果。', 'success');
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '发送测试 Push 失败。', 'error');
  } finally {
    sendingPushTest.value = false;
  }
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

function buildNextRepeatTaskIfNeeded(task: ReminderTask, referenceUnix: number): ReminderTask | null {
  if (task.scheduleMode !== 'date-time' || task.kind !== 'custom-time') {
    return null;
  }

  const repeatWeekdays = normalizeRepeatWeekdays(task.repeatWeekdays ?? []);
  if (repeatWeekdays.length === 0) {
    return null;
  }

  let nextTriggerAtUnix = 0;
  try {
    nextTriggerAtUnix = resolveNextRepeatTriggerAtUnix(task.triggerAtUnix, repeatWeekdays, referenceUnix);
  } catch {
    return null;
  }
  if (nextTriggerAtUnix <= referenceUnix) {
    return null;
  }

  return createReminderTask({
    kind: 'custom-time',
    title: task.title,
    note: task.note,
    durationSeconds: Math.max(0, nextTriggerAtUnix - referenceUnix),
    scheduleMode: 'date-time',
    triggerAtUnix: nextTriggerAtUnix,
    repeatWeekdays,
    soundEnabled: task.soundEnabled,
    notificationEnabled: task.notificationEnabled,
    nowUnix: referenceUnix,
  });
}

function triggerDueReminders(): void {
  const dueTasks: ReminderTask[] = [];
  const nextRepeatTasks: ReminderTask[] = [];
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
    const nextRepeatTask = buildNextRepeatTaskIfNeeded(task, nowUnix.value);
    if (nextRepeatTask) {
      nextRepeatTasks.push(nextRepeatTask);
    }

    const firedTask = markReminderFired(task, nowUnix.value);
    dueTasks.push(firedTask);
    return firedTask;
  });

  if (dueTasks.length === 0) {
    return;
  }

  const withRepeatTasks = nextRepeatTasks.reduce((currentTasks, repeatTask) => upsertReminderTask(currentTasks, repeatTask), nextTasks);
  persistTasks(withRepeatTasks);
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
