import type { AppRecord, FuelRecord } from '../types/records';
import type { FuelBalanceState } from '../types/store';
import { roundTo } from '../utils/number';

export function createEmptyFuelBalance(): FuelBalanceState {
  return {
    baselineEstablished: false,
    baselineAnchorUnix: null,
    autoCalculatedFuelLiters: null,
    manualOffsetLiters: 0,
    remainingFuelLiters: null,
    anomaly: false,
  };
}

export function recalculateFuelBalance(records: AppRecord[], current: FuelBalanceState): FuelBalanceState {
  const ordered = [...records].sort((a, b) => {
    if (a.createdAtUnix === b.createdAtUnix) {
      return a.createdAt.localeCompare(b.createdAt);
    }
    return a.createdAtUnix - b.createdAtUnix;
  });

  const firstFuelIndex = ordered.findIndex((record) => record.type === 'fuel');
  if (firstFuelIndex < 0) {
    return createEmptyFuelBalance();
  }

  const firstFuel = ordered[firstFuelIndex] as FuelRecord;
  let autoRemaining = firstFuel.fuelVolumeLiters;

  for (let index = firstFuelIndex + 1; index < ordered.length; index += 1) {
    const record = ordered[index];
    if (record.type === 'fuel') {
      autoRemaining += record.fuelVolumeLiters;
    } else {
      autoRemaining -= record.consumedFuelLiters;
    }
  }

  const manualOffset = Number.isFinite(current.manualOffsetLiters) ? Number(current.manualOffsetLiters) : 0;
  const remaining = autoRemaining + manualOffset;

  return {
    baselineEstablished: true,
    baselineAnchorUnix: firstFuel.createdAtUnix,
    autoCalculatedFuelLiters: roundTo(autoRemaining, 3),
    manualOffsetLiters: roundTo(manualOffset, 3),
    remainingFuelLiters: roundTo(remaining, 3),
    anomaly: remaining < 0,
  };
}
