import type { AppRecord, FuelRecord } from '../types/records';
import type { FuelBalanceState } from '../types/store';
import { roundTo } from '../utils/number';

export function createEmptyFuelBalance(): FuelBalanceState {
  return {
    baselineEstablished: false,
    baselineAnchorUnix: null,
    remainingFuelLiters: null,
    anomaly: false,
  };
}

export function recalculateFuelBalance(records: AppRecord[], current: FuelBalanceState): FuelBalanceState {
  if (!current.baselineEstablished || current.baselineAnchorUnix === null) {
    return createEmptyFuelBalance();
  }

  const ordered = [...records].sort((a, b) => {
    if (a.createdAtUnix === b.createdAtUnix) {
      return a.createdAt.localeCompare(b.createdAt);
    }
    return a.createdAtUnix - b.createdAtUnix;
  });

  const scoped = ordered.filter((record) => record.createdAtUnix >= current.baselineAnchorUnix!);
  const firstFuelIndex = scoped.findIndex((record) => record.type === 'fuel');

  if (firstFuelIndex < 0) {
    return createEmptyFuelBalance();
  }

  const firstFuel = scoped[firstFuelIndex] as FuelRecord;
  let remaining = firstFuel.fuelVolumeLiters;

  for (let index = firstFuelIndex + 1; index < scoped.length; index += 1) {
    const record = scoped[index];
    if (record.type === 'fuel') {
      remaining += record.fuelVolumeLiters;
    } else {
      remaining -= record.consumedFuelLiters;
    }
  }

  return {
    baselineEstablished: true,
    baselineAnchorUnix: firstFuel.createdAtUnix,
    remainingFuelLiters: roundTo(remaining, 3),
    anomaly: remaining < 0,
  };
}
