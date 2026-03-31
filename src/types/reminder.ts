export type ReminderKind = 'parking' | 'pomodoro' | 'custom';

export type ReminderStatus = 'pending' | 'fired' | 'cancelled';

export type ReminderRingtoneSourceMode = 'auto' | 'uploaded' | 'default-file' | 'synth';

export interface ReminderTask {
  id: string;
  kind: ReminderKind;
  title: string;
  note?: string;
  durationSeconds: number;
  triggerAtUnix: number;
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
  soundEnabled: boolean;
  notificationEnabled: boolean;
  nowUnix?: number;
}

export interface ReminderRingtoneConfig {
  name: string;
  mimeType: string;
  dataUrl: string;
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
