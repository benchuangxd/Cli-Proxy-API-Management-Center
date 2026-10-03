/** Display helpers shared by the ledger rows and the summary strip. */

import type { TFunction } from 'i18next';
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
