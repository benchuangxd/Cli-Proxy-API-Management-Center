/** Display helpers shared by the ledger rows and the summary strip. */

import type { TFunction } from 'i18next';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';
import type { LedgerWindow } from '../ledgerModel';
import { QUOTA_PROGRESS_HIGH_THRESHOLD, QUOTA_PROGRESS_MEDIUM_THRESHOLD } from './QuotaMeter';

export const ledgerWindowLabel = (t: TFunction, window: LedgerWindow): string =>
  window.labelKey ? t(window.labelKey, window.labelParams) : window.label;

export const meterLevelClass = (
  percent: number | null,
  classes: { high: string; medium: string; low: string }
): string =>
  percent === null
    ? ''
    : percent >= QUOTA_PROGRESS_HIGH_THRESHOLD
      ? classes.high
      : percent >= QUOTA_PROGRESS_MEDIUM_THRESHOLD
        ? classes.medium
        : classes.low;

/** Two-unit countdown such as `2d 2h`, `3h 5m` or `12m`; sub-minute gaps read `1m`. */
export const formatCompactDuration = (ms: number): string => {
  const total = Math.max(MINUTE_MS, ms);
  const days = Math.floor(total / DAY_MS);
  const hours = Math.floor((total % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((total % HOUR_MS) / MINUTE_MS);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
};
