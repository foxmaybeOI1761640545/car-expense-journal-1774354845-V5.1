export type ReminderKind = 'parking' | 'pomodoro' | 'custom' | 'custom-time';

export type ReminderStatus = 'pending' | 'fired' | 'cancelled';
export type ReminderScheduleMode = 'countdown' | 'date-time';

export type ReminderRingtoneSourceMode = 'auto' | 'uploaded' | 'default-file' | 'synth';
export type ReminderRingtoneStorageMode = 'data-url' | 'idb-blob';

export interface ReminderTask {
  id: string;
  kind: ReminderKind;
  title: string;
  note?: string;
  durationSeconds: number;
  triggerAtUnix: number;
  scheduleMode?: ReminderScheduleMode;
  repeatWeekdays?: number[];
  createdAtUnix: number;
  updatedAtUnix: number;
  status: ReminderStatus;
  soundEnabled: boolean;
  notificationEnabled: boolean;
  firedAtUnix?: number;
  requiresAcknowledgement?: boolean;
  acknowledgedAtUnix?: number;
  cancelledAtUnix?: number;
}

export interface CreateReminderTaskInput {
  kind: ReminderKind;
  title?: string;
  note?: string;
  durationSeconds: number;
  scheduleMode?: ReminderScheduleMode;
  triggerAtUnix?: number;
  repeatWeekdays?: number[];
  soundEnabled: boolean;
  notificationEnabled: boolean;
  nowUnix?: number;
}

export interface ReminderRingtoneConfig {
  name: string;
  mimeType: string;
  storageMode?: ReminderRingtoneStorageMode;
  dataUrl?: string;
  blobStorageId?: string;
  sizeBytes?: number;
  updatedAtUnix: number;
  githubPath?: string;
  githubSyncedAtUnix?: number;
}

export interface ReminderDefaultAudioFileConfig {
  name: string;
  path: string;
  mimeType?: string;
}

export interface ReminderSynthPatternConfig {
  waveform: OscillatorType;
  frequencies: number[];
  toneDurationMs: number;
  gapDurationMs: number;
  gain: number;
  updatedAtUnix: number;
}
