export type RecordType = 'fuel' | 'trip';

export interface BaseRecord {
  id: string;
  type: RecordType;
  createdAt: string;
  createdAtUnix: number;
  note?: string;
  submittedToGithub: boolean;
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
