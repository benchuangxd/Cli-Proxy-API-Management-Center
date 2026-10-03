/**
 * Ledger view: credentials grouped by provider, one dense row each — name and
 * plan on the left, every quota window as a column, refresh on the right.
 * Columns lead with the provider's binding window so they line up across rows.
 */

import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { buildResetDisplay, resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaCacheKey, getQuotaDisplayName } from '@/utils/quota/identity';
import { getTypeLabel } from '@/features/authFiles/constants';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { getCodexPlanLabel } from '../providers/codex/planLabel';
import type { QuotaProviderType } from '../providers/types';
import { maskEmails, orderLedgerWindows, type LedgerWindow } from '../ledgerModel';
import { ledgerWindowLabel, meterLevelClass } from './ledgerFormat';
import styles from './QuotaLedger.module.scss';

const levelClasses = { high: styles.high, medium: styles.medium, low: styles.low };

export interface QuotaLedgerGroup {
  provider: QuotaProviderType;
  entries: QuotaFileEntry[];
  /** Binding window id from the provider summary; leads every row's columns. */
  primaryWindowId: string | null;
}

export type QuotaLedgerProps = {
  groups: QuotaLedgerGroup[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  windowsFor: (entry: QuotaFileEntry) => LedgerWindow[];
  showEmails: boolean;
  canRefresh: (entry: QuotaFileEntry) => boolean;
  now: number;
  onRefresh: (entry: QuotaFileEntry) => void;
};

const planLabelFor = (
  t: TFunction,
  provider: QuotaProviderType,
  quota: QuotaCardState | undefined
): string | null => {
  const planType = (quota as { planType?: string | null } | undefined)?.planType ?? null;
  if (!planType) return null;
  if (provider === 'claude') return t(`claude_quota.${planType}`, { defaultValue: planType });
  if (provider === 'codex') return getCodexPlanLabel(t, planType);
  return null;
};

export function QuotaLedger(props: QuotaLedgerProps) {
  const { groups, quotaFor, windowsFor, showEmails, canRefresh, now, onRefresh } = props;
  const { t, i18n } = useTranslation();

  return (
    <div className={styles.ledger}>
      {groups.map((group) => (
        <section key={group.provider} className={styles.group}>
          <h2 className={styles.groupTitle}>
            {getTypeLabel(t, group.provider)}
            <span className={styles.groupCount}>{group.entries.length}</span>
          </h2>
          <ul className={styles.rows}>
            {group.entries.map((entry) => {
              const quota = quotaFor(entry);
              const status = quota?.status ?? 'idle';
              const loading = status === 'loading';
              const rawName = getQuotaDisplayName(entry.file);
              const name = showEmails ? rawName : maskEmails(rawName, `${entry.type}-`);
              const plan = planLabelFor(t, entry.type, quota);
              const windows = orderLedgerWindows(windowsFor(entry), group.primaryWindowId);
              const adapter = QUOTA_ADAPTERS[entry.type];
              const refreshable = canRefresh(entry);

              return (
                <li key={getQuotaCacheKey(entry.file)} className={styles.row}>
                  <div className={styles.identity}>
                    <span className={styles.name} title={name}>
                      {name}
                    </span>
                    {plan && <span className={styles.plan}>{plan}</span>}
                  </div>

                  <div className={styles.windows}>
                    {status === 'idle' ? (
                      <button
                        type="button"
                        className={styles.idle}
                        onClick={() => onRefresh(entry)}
                        disabled={!refreshable}
                      >
                        {t(`${adapter.i18nPrefix}.idle`)}
                      </button>
                    ) : loading ? (
                      <span className={styles.message} aria-busy="true">
                        {t(`${adapter.i18nPrefix}.loading`)}
                      </span>
                    ) : status === 'error' ? (
                      <span className={styles.error} role="alert">
                        {t(`${adapter.i18nPrefix}.load_failed`, {
                          message: resolveQuotaErrorMessage(
                            t,
                            quota?.errorStatus,
                            quota?.error || t('common.unknown_error')
                          ),
                        })}
                      </span>
                    ) : windows.length === 0 ? (
                      <span className={styles.message}>
                        {t('quota_management.ledger_no_windows')}
                      </span>
                    ) : (
                      windows.map((window) => {
                        const reset = buildResetDisplay(
                          window.resetLabel,
                          window.resetAtMs !== null && window.resetAtMs > now
                            ? window.resetAtMs
                            : null,
                          now,
                          i18n.resolvedLanguage
                        );
                        const pending =
                          reset !== null && window.resetAtMs !== null && window.resetAtMs > now;
                        return (
                          <div key={window.id} className={styles.window}>
                            <div className={styles.windowHead}>
                              <span className={styles.windowLabel}>
                                {ledgerWindowLabel(t, window)}
                              </span>
                              <span className={styles.windowValue}>
                                {window.remaining === null
                                  ? '--'
                                  : `${Math.round(window.remaining)}%`}
                              </span>
                            </div>
                            <div className={styles.bar}>
                              {window.remaining !== null && (
                                <span
                                  className={`${styles.barFill} ${meterLevelClass(window.remaining, levelClasses)}`}
                                  style={{ width: `${window.remaining}%` }}
                                />
                              )}
                            </div>
                            <div className={styles.windowReset}>
                              {pending && reset ? (
                                <>
                                  {reset.relative && (
                                    <span className={styles.resetRelative}>{reset.relative}</span>
                                  )}
                                  <span className={styles.resetAbsolute}>{reset.absolute}</span>
                                </>
                              ) : (
                                t('quota_management.ledger_no_reset')
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <button
                    type="button"
                    className={styles.refresh}
                    onClick={() => onRefresh(entry)}
                    disabled={isQuotaRefreshDisabled(refreshable, loading, false)}
                    title={t('auth_files.quota_refresh_hint')}
                  >
                    <IconRefreshCw
                      size={13}
                      className={loading ? styles.spinning : undefined}
                      aria-hidden="true"
                    />
                    {t('auth_files.quota_refresh_single')}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
