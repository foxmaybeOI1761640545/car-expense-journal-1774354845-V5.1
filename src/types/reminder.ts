export type ReminderKind = 'parking' | 'pomodoro' | 'custom';

export type ReminderStatus = 'pending' | 'fired' | 'cancelled';

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
}
