export interface AppConfig {
  defaultProvince: string;
  defaultFuelType: number;
  defaultFuelPrice: number;
  defaultAverageFuelConsumptionPer100Km: number;
  defaultDistanceKm: number;
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
  defaultProvince: '',
  defaultFuelType: 92,
  defaultFuelPrice: 7.5,
  defaultAverageFuelConsumptionPer100Km: 7.8,
  defaultDistanceKm: 100,
  defaultTripNote: '',
  defaultFuelNote: '',
  githubOwner: '',
  githubRepo: '',
  githubBranch: 'main',
  githubToken: '',
  githubRecordsDir: 'data/records',
  preferConfigOverLocalStorage: false,
};
