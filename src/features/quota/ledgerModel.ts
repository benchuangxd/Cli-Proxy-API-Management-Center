/**
 * Ledger view model: one flat list of quota windows per credential, and a
 * pooled per-provider summary built from those lists.
 *
 * Pure and React-free (`nowMs` is passed in) so every rule here is testable.
 * The provider states are read structurally, same as `quotaTimelineModel.ts`,
 * but this keeps *every* window with its own reset instant: the ledger renders
 * each window as a column, and the summary pools matching windows across
 * credentials.
 */

import type { QuotaProviderType } from './providers/types';

export interface LedgerWindow {
  /** Stable within a provider, so the same window lines up across credentials. */
  id: string;
  label: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  /** Remaining percent, 0..100; null when the payload carried no usage. */
  remaining: number | null;
  resetAtMs: number | null;
  /** Fetch-time absolute reset label, when the provider bakes one. */
  resetLabel?: string;
  periodHours: number | null;
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const remainingFromUsed = (used: unknown): number | null => {
  const value = finiteOrNull(used);
  return value === null ? null : clampPercent(100 - value);
};

interface PercentWindowLike {
  id?: string;
  label?: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  usedPercent?: number | null;
  resetLabel?: string;
  resetAtMs?: number | null;
  periodHours?: number | null;
}

/** Every quota window on one credential, in the provider's own order. */
export function buildLedgerWindows(provider: QuotaProviderType, quota: unknown): LedgerWindow[] {
  const state = quota as { status?: string } | undefined;
  if (!state || state.status !== 'success') return [];

  if (provider === 'claude' || provider === 'codex') {
    return ((quota as { windows?: PercentWindowLike[] }).windows ?? []).map((window, index) => ({
      id: window.id || `window-${index}`,
      label: window.label ?? '',
      labelKey: window.labelKey,
      labelParams: window.labelParams,
      remaining: remainingFromUsed(window.usedPercent),
      resetAtMs: finiteOrNull(window.resetAtMs),
      resetLabel: window.resetLabel,
      periodHours: finiteOrNull(window.periodHours),
    }));
  }

  if (provider === 'devin') {
    const windows =
      (
        quota as {
          windows?: {
            id: string;
            remainingPercent: number | null;
            resetAtMs: number | null;
            periodHours: number;
          }[];
        }
      ).windows ?? [];
    return windows.map((window) => ({
      id: window.id,
      label: window.id,
      labelKey: `devin_quota.${window.id}`,
      remaining: finiteOrNull(window.remainingPercent),
      resetAtMs: finiteOrNull(window.resetAtMs),
      periodHours: finiteOrNull(window.periodHours),
    }));
  }

  if (provider === 'xai') {
    const billing = (
      quota as {
        billing?: {
          periodType?: string;
          usagePercent?: number | null;
          resetAtMs?: number | null;
          periodHours?: number | null;
        } | null;
      }
    ).billing;
    // Only the weekly limit is a quota window; the monthly figure is a billing cycle.
    if (!billing || billing.periodType !== 'weekly') return [];
    return [
      {
        id: 'weekly',
        label: 'weekly',
        labelKey: 'xai_quota.weekly_limit',
        remaining: remainingFromUsed(billing.usagePercent),
        resetAtMs: finiteOrNull(billing.resetAtMs),
        periodHours: finiteOrNull(billing.periodHours) ?? 24 * 7,
      },
    ];
  }

  if (provider === 'antigravity') {
    const groups =
      (
        quota as {
          groups?: {
            buckets?: {
              id?: string;
              label?: string;
              remainingFraction?: number | null;
              resetAtMs?: number | null;
              periodHours?: number | null;
            }[];
          }[];
        }
      ).groups ?? [];
    return groups
      .flatMap((group) => group.buckets ?? [])
      .map((bucket, index) => {
        const fraction = finiteOrNull(bucket.remainingFraction);
        return {
          id: bucket.id || `bucket-${index}`,
          label: bucket.label ?? '',
          remaining: fraction === null ? null : clampPercent(Math.round(fraction * 100)),
          resetAtMs: finiteOrNull(bucket.resetAtMs),
          periodHours: finiteOrNull(bucket.periodHours),
        };
      });
  }

  if (provider === 'kimi') {
    const rows =
      (
        quota as {
          rows?: {
            id?: string;
            label?: string;
            labelKey?: string;
            labelParams?: Record<string, string | number>;
            used: number;
            limit: number;
            resetAtMs?: number | null;
            periodHours?: number | null;
          }[];
        }
      ).rows ?? [];
    return rows.map((row, index) => ({
      id: row.id || `row-${index}`,
      label: row.label ?? '',
      labelKey: row.labelKey,
      labelParams: row.labelParams,
      remaining:
        row.limit > 0 ? clampPercent(Math.round(((row.limit - row.used) / row.limit) * 100)) : null,
      resetAtMs: finiteOrNull(row.resetAtMs),
      periodHours: finiteOrNull(row.periodHours),
    }));
  }

  if (provider === 'meta') {
    const windows =
      (
        quota as {
          data?: {
            windows?: {
              id: 'window' | 'weekly';
              usedPercent: number | null;
              resetAt?: number;
              durationMinutes?: number;
            }[];
          };
        }
      ).data?.windows ?? [];
    return windows.map((window) => {
      const resetAt = finiteOrNull(window.resetAt);
      const minutes = window.id === 'weekly' ? 7 * 24 * 60 : finiteOrNull(window.durationMinutes);
      return {
        id: window.id,
        label: window.id,
        labelKey: `meta_quota.${window.id}`,
        remaining: remainingFromUsed(window.usedPercent),
        // Meta reports reset instants in Unix seconds.
        resetAtMs: resetAt === null ? null : resetAt * 1000,
        periodHours: minutes === null ? null : minutes / 60,
      };
    });
  }

  return [];
}

/* ------------------------------------------------------------------ summary */

/** One window pooled across every credential of a provider. */
export interface LedgerPool {
  id: string;
  /** Label source: the first credential that reported this window. */
  window: LedgerWindow;
  /** Sum of remaining percent across credentials that reported it. */
  pooledRemaining: number | null;
  /** 100 per credential of the provider, reported or not. */
  capacity: number;
  /** One entry per credential, in input order; null where unknown. */
  segments: (number | null)[];
  /** Soonest upcoming reset across credentials. */
  nextResetMs: number | null;
  /** Fetch-time label belonging to `nextResetMs`. */
  nextResetLabel?: string;
}

export interface LedgerSummary {
  provider: QuotaProviderType;
  credentials: number;
  /** Ordered most constraining first; empty when nothing is loaded yet. */
  pools: LedgerPool[];
}

/**
 * Pool every window id across the provider's credentials.
 *
 * Ordering answers "what runs out first": the longest-period windows lead
 * (weekly capacity is what's expensive to waste), and among those the lowest
 * pooled remaining wins. Shorter windows trail in the same order.
 */
export function buildLedgerSummary(
  provider: QuotaProviderType,
  credentialWindows: readonly LedgerWindow[][],
  nowMs: number
): LedgerSummary {
  const credentials = credentialWindows.length;
  const capacity = credentials * 100;
  const order: string[] = [];
  const byId = new Map<string, LedgerPool>();

  credentialWindows.forEach((windows, credentialIndex) => {
    windows.forEach((window) => {
      let pool = byId.get(window.id);
      if (!pool) {
        pool = {
          id: window.id,
          window,
          pooledRemaining: null,
          capacity,
          segments: Array.from({ length: credentials }, () => null),
          nextResetMs: null,
        };
        byId.set(window.id, pool);
        order.push(window.id);
      }
      if (window.remaining !== null) {
        pool.segments[credentialIndex] = window.remaining;
        pool.pooledRemaining = (pool.pooledRemaining ?? 0) + window.remaining;
      }
      const reset = window.resetAtMs;
      if (
        reset !== null &&
        reset > nowMs &&
        (pool.nextResetMs === null || reset < pool.nextResetMs)
      ) {
        pool.nextResetMs = reset;
        pool.nextResetLabel = window.resetLabel;
      }
    });
  });

  const periodOf = (pool: LedgerPool) => pool.window.periodHours ?? 0;
  const pools = order
    .map((id) => byId.get(id) as LedgerPool)
    .sort((a, b) => {
      const byPeriod = periodOf(b) - periodOf(a);
      if (byPeriod !== 0) return byPeriod;
      return (a.pooledRemaining ?? Infinity) - (b.pooledRemaining ?? Infinity);
    });

  return { provider, credentials, pools };
}

/**
 * Lead a credential's columns with the provider's primary pool so the same
 * window sits in the same column on every row; the rest keep provider order.
 */
export function orderLedgerWindows(
  windows: readonly LedgerWindow[],
  primaryId: string | null
): LedgerWindow[] {
  if (!primaryId) return [...windows];
  const primary = windows.filter((window) => window.id === primaryId);
  return [...primary, ...windows.filter((window) => window.id !== primaryId)];
}

/* ------------------------------------------------------------------ privacy */

const EMAIL_PATTERN = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+)((?:\.[A-Za-z0-9-]+)+)/g;
const MASK = '•••';

/**
 * Mask emails embedded in a credential name: `claude-tim@acme.dev.json` →
 * `claude-t•••@a•••.dev.json`.
 *
 * Auth files are named `<provider>-<email>…`, and the email pattern happily
 * swallows that hyphenated prefix as part of the local part. `keepPrefix`
 * names the prefix that should stay readable. A trailing `.json` is set aside
 * first so it is not mistaken for part of the domain.
 */
export function maskEmails(text: string, keepPrefix = ''): string {
  const extension = /\.json$/i.exec(text)?.[0] ?? '';
  const stem = extension ? text.slice(0, -extension.length) : text;
  const masked = stem.replace(
    EMAIL_PATTERN,
    (_match, local: string, host: string, rest: string) => {
      let prefix = '';
      let user = local;
      if (keepPrefix && user.toLowerCase().startsWith(keepPrefix.toLowerCase())) {
        prefix = user.slice(0, keepPrefix.length);
        user = user.slice(keepPrefix.length);
      }
      return `${prefix}${user.slice(0, 1)}${MASK}@${host.slice(0, 1)}${MASK}${rest}`;
    }
  );
  return masked + extension;
}
