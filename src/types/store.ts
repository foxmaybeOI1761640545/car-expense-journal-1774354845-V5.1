import type { AppConfig } from './config';
import type { AppRecord } from './records';

export interface FuelBalanceState {
  baselineEstablished: boolean;
  baselineAnchorUnix: number | null;
  autoCalculatedFuelLiters: number | null;
  manualOffsetLiters: number;
  remainingFuelLiters: number | null;
  anomaly: boolean;
}

export interface FuelBalanceAdjustmentLog {
  id: string;
  source: 'manual' | 'records';
  recordedAt: string;
  recordedAtUnix: number;
  balanceChangedAt: string;
  balanceChangedAtUnix: number;
  remainingFuelLiters: number | null;
  autoCalculatedFuelLiters: number | null;
  manualOffsetLiters: number;
  submittedToGithub: boolean;
  githubPath?: string;
}

export interface ToastState {
  visible: boolean;
  message: string;
  type: 'success' | 'error' | 'info';
}

export interface AppStoreState {
  initialized: boolean;
  config: AppConfig;
  githubToken: string;
  records: AppRecord[];
  fuelBalance: FuelBalanceState;
  fuelBalanceAdjustments: FuelBalanceAdjustmentLog[];
  submittingRecordIds: string[];
  toast: ToastState;
}
