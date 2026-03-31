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

