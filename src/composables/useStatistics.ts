import { computed, type Ref } from 'vue';
import type { AppRecord, FuelRecord, TripRecord } from '../types/records';

export function useStatistics(records: Ref<AppRecord[]>) {
  const sortedRecords = computed(() =>
    [...records.value].sort((a, b) => {
      if (a.createdAtUnix === b.createdAtUnix) {
        return b.createdAt.localeCompare(a.createdAt);
      }
      return b.createdAtUnix - a.createdAtUnix;
    }),
  );

  const latestFuelRecord = computed(() => sortedRecords.value.find((record) => record.type === 'fuel') as FuelRecord | undefined);
  const latestTripRecord = computed(() => sortedRecords.value.find((record) => record.type === 'trip') as TripRecord | undefined);

  const totalFuelVolume = computed(() =>
    records.value.filter((record): record is FuelRecord => record.type === 'fuel').reduce((sum, record) => sum + record.fuelVolumeLiters, 0),
  );

  const totalDistanceKm = computed(() =>
    records.value.filter((record): record is TripRecord => record.type === 'trip').reduce((sum, record) => sum + record.distanceKm, 0),
  );

  const totalConsumedFuelLiters = computed(() =>
    records.value.filter((record): record is TripRecord => record.type === 'trip').reduce((sum, record) => sum + record.consumedFuelLiters, 0),
  );

  const totalFuelCost = computed(() =>
    records.value.filter((record): record is FuelRecord => record.type === 'fuel').reduce((sum, record) => sum + record.totalPriceCny, 0),
  );

  const recentRecords = computed(() => sortedRecords.value.slice(0, 5));

  return {
    sortedRecords,
    latestFuelRecord,
    latestTripRecord,
    totalFuelVolume,
    totalDistanceKm,
    totalConsumedFuelLiters,
    totalFuelCost,
    recentRecords,
  };
}
