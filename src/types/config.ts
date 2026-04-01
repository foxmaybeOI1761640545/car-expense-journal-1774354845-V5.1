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
  githubRecordsDir: string;
  reminderApiBaseUrl: string;
  reminderApiFallbackBaseUrl: string;
  reminderDefaultEmail: string;
  preferConfigOverLocalStorage: boolean;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  pageTitle: '用车记录',
  pageFavicon: 'favicon.svg',
  defaultProvince: '广东',
  defaultFuelType: 92,
  defaultTripNote: '',
  defaultFuelNote: '',
  githubOwner: 'foxmaybeOI1761640545',
  githubRepo: 'car-expense-journal-1774354845-V5.1',
  githubBranch: 'records/live-data',
  githubRecordsDir: 'data/records',
  reminderApiBaseUrl: '',
  reminderApiFallbackBaseUrl: '',
  reminderDefaultEmail: '',
  preferConfigOverLocalStorage: false,
};
