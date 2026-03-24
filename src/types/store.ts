import type { AppConfig } from './config';
import type { AppRecord } from './records';

export interface FuelBalanceState {
  baselineEstablished: boolean;
  baselineAnchorUnix: number | null;
  remainingFuelLiters: number | null;
  anomaly: boolean;
}

export interface ToastState {
  visible: boolean;
  message: string;
  type: 'success' | 'error' | 'info';
}

export interface AppStoreState {
  initialized: boolean;
  config: AppConfig;
  records: AppRecord[];
  fuelBalance: FuelBalanceState;
  submittingRecordIds: string[];
  toast: ToastState;
}
