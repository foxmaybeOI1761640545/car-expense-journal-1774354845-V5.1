export interface AppConfig {
  pageTitle: string;
  pageFavicon: string;
  defaultProvince: string;
  defaultFuelType: number;
  defaultFuelPrice?: number;
  defaultAverageFuelConsumptionPer100Km?: number;
  defaultDistanceKm?: number;
  defaultTripNote: string;
  defaultFuelNote: string;
  githubOwner: string;
  githubRepo: string;
  githubBranch: string;
  githubToken: string;
  githubRecordsDir: string;
  preferConfigOverLocalStorage: boolean;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  pageTitle: '行驶油耗记录',
  pageFavicon: 'favicon.svg',
  defaultProvince: '广东',
  defaultFuelType: 92,
  defaultTripNote: '',
  defaultFuelNote: '',
  githubOwner: 'foxmaybeOI1761640545',
  githubRepo: 'car-expense-journal-1774354845-V5.1',
  githubBranch: 'records/live-data',
  githubToken: '',
  githubRecordsDir: 'data/records',
  preferConfigOverLocalStorage: false,
};
