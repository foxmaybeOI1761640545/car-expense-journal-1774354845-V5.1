export type RecordType = 'fuel' | 'trip';

export interface BaseRecord {
  id: string;
  type: RecordType;
  occurredAt: string;
  occurredAtUnix: number;
  createdAt: string;
  createdAtUnix: number;
  updatedAt: string;
  updatedAtUnix: number;
  sourceDeviceId?: string;
  sourceDeviceName?: string;
  note?: string;
  submittedToGithub: boolean;
  githubSubmittedTargets: string[];
}

export interface FuelRecord extends BaseRecord {
  type: 'fuel';
  province?: string;
  fuelType: number;
  pricePerLiter: number;
  fuelVolumeLiters: number;
  totalPriceCny: number;
  stationName?: string;
}

export interface TripRecord extends BaseRecord {
  type: 'trip';
  averageFuelConsumptionPer100Km: number;
  distanceKm: number;
  consumedFuelLiters: number;
  pricePerLiter?: number;
  totalFuelCostCny?: number;
  startLocation?: string;
  endLocation?: string;
}

export type AppRecord = FuelRecord | TripRecord;

export interface RecordTombstone {
  recordId: string;
  recordType: RecordType;
  deletedAt: string;
  deletedAtUnix: number;
  sourceDeviceId?: string;
  sourceDeviceName?: string;
  submittedToGithub: boolean;
  githubSubmittedTargets: string[];
  githubPath?: string;
}
