import { describe, expect, test } from 'bun:test';
import {
  buildLedgerSummary,
  buildLedgerWindows,
  maskEmails,
  orderLedgerWindows,
} from '@/features/quota/ledgerModel';

const NOW = Date.UTC(2026, 8, 10, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

const claude = (fable: number, fiveHour: number, sevenDay: number, resetInHours: number) => ({
  status: 'success',
  windows: [
    {
      id: 'five-hour',
      label: '5h',
      labelKey: 'claude_quota.five_hour',
      usedPercent: 100 - fiveHour,
      resetLabel: '-',
      resetAtMs: NOW + 3 * HOUR,
      periodHours: 5,
    },
    {
      id: 'seven-day',
      label: '7d',
      labelKey: 'claude_quota.seven_day',
      usedPercent: 100 - sevenDay,
      resetLabel: '-',
      resetAtMs: NOW + resetInHours * HOUR,
      periodHours: 168,
    },
    {
      id: 'seven-day-fable',
      label: 'fable',
      labelKey: 'claude_quota.seven_day_fable',
      usedPercent: 100 - fable,
      resetLabel: '-',
      resetAtMs: NOW + resetInHours * HOUR,
      periodHours: 168,
    },
  ],
});

describe('buildLedgerWindows', () => {
  test('returns nothing until the quota has loaded', () => {
    expect(buildLedgerWindows('claude', undefined)).toEqual([]);
    expect(buildLedgerWindows('claude', { status: 'loading', windows: [] })).toEqual([]);
  });

  test('converts percent used into remaining', () => {
    const windows = buildLedgerWindows('claude', claude(58, 100, 79, 24));
    expect(windows.map((window) => [window.id, window.remaining])).toEqual([
      ['five-hour', 100],
      ['seven-day', 79],
      ['seven-day-fable', 58],
    ]);
  });

  test('derives kimi remaining from raw counts', () => {
    const windows = buildLedgerWindows('kimi', {
      status: 'success',
      rows: [{ id: 'weekly', label: 'Weekly', used: 25, limit: 100, resetAtMs: null }],
    });
    expect(windows[0].remaining).toBe(75);
  });

  test('keeps only the weekly xAI billing period', () => {
    expect(
      buildLedgerWindows('xai', { status: 'success', billing: { periodType: 'monthly' } })
    ).toEqual([]);
    const [weekly] = buildLedgerWindows('xai', {
      status: 'success',
      billing: { periodType: 'weekly', usagePercent: null, resetAtMs: NOW + HOUR },
    });
    expect(weekly.remaining).toBeNull();
    expect(weekly.periodHours).toBe(168);
  });
});

describe('buildLedgerSummary', () => {
  test('pools remaining across credentials and leads with the binding weekly window', () => {
    const credentials = [claude(58, 100, 79, 25), claude(100, 100, 100, 96), []].map((quota) =>
      Array.isArray(quota) ? quota : buildLedgerWindows('claude', quota)
    );
    const summary = buildLedgerSummary('claude', credentials, NOW);

    expect(summary.credentials).toBe(3);
    expect(summary.pools.map((pool) => pool.id)).toEqual([
      'seven-day-fable',
      'seven-day',
      'five-hour',
    ]);

    const [fable] = summary.pools;
    expect(fable.pooledRemaining).toBe(158);
    expect(fable.capacity).toBe(300);
    expect(fable.segments).toEqual([58, 100, null]);
    expect(fable.nextResetMs).toBe(NOW + 25 * HOUR);
  });

  test('ignores resets already in the past', () => {
    const summary = buildLedgerSummary(
      'claude',
      [buildLedgerWindows('claude', claude(50, 50, 50, -1))],
      NOW
    );
    expect(summary.pools[0].nextResetMs).toBeNull();
  });

  test('has no pools when nothing is loaded', () => {
    expect(buildLedgerSummary('codex', [[], []], NOW).pools).toEqual([]);
  });
});

describe('orderLedgerWindows', () => {
  test('moves the primary window to the first column', () => {
    const windows = buildLedgerWindows('claude', claude(1, 2, 3, 4));
    expect(orderLedgerWindows(windows, 'seven-day-fable').map((window) => window.id)).toEqual([
      'seven-day-fable',
      'five-hour',
      'seven-day',
    ]);
    expect(orderLedgerWindows(windows, null)).toEqual(windows);
  });
});

describe('maskEmails', () => {
  test('masks local part and first domain label, keeping prefix and extension', () => {
    expect(maskEmails('claude-tim@1dev.dev.json', 'claude-')).toBe('claude-t•••@1•••.dev.json');
    expect(maskEmails('claude-sam@pixel.gg.json', 'claude-')).toBe('claude-s•••@p•••.gg.json');
  });

  test('leaves names without an email untouched', () => {
    expect(maskEmails('kimi-oauth.json', 'kimi-')).toBe('kimi-oauth.json');
  });

  test('masks hyphenated local parts without leaking them', () => {
    expect(maskEmails('codex-john-doe@gmail.com-pro.json', 'codex-')).toBe(
      'codex-j•••@g•••.com-pro.json'
    );
  });
});
