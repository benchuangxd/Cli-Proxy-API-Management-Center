/**
 * Ledger view: credentials grouped by provider, one dense row each — name and
 * plan on the left, every quota window as a column, then the credential's
 * reset allowance (Claude grants, Codex manual resets, xAI credits) and the
 * actions on the right. Columns lead with the provider's binding window so
 * they line up across rows.
 */

import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import type { CodexQuotaState, XaiQuotaState } from '@/types';
import {
  buildResetDisplay,
  formatInstantShort,
  parseIsoToMs,
  resolveQuotaErrorMessage,
  resolveResetMs,
} from '@/utils/quota';
import { getQuotaCacheKey, getQuotaDisplayName } from '@/utils/quota/identity';
import { getTypeLabel } from '@/features/authFiles/constants';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { getCodexPlanLabel } from '../providers/codex/planLabel';
import type { QuotaProviderType } from '../providers/types';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import { formatXaiOnDemandAmount, formatXaiRemainingAmount } from '../providers/xai/format';
import {
  exhaustedUntilMs,
  maskEmails,
  orderLedgerWindows,
  type LedgerWindow,
} from '../ledgerModel';
import { formatCompactDuration, ledgerWindowLabel, meterLevelClass } from './ledgerFormat';
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
  /** Cache key of the credential whose quota reset is in flight. */
  resettingKey: string | null;
  now: number;
  onRefresh: (entry: QuotaFileEntry) => void;
  onReset: (entry: QuotaFileEntry) => void;
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
  const { groups, quotaFor, windowsFor, canRefresh, resettingKey, onRefresh, onReset } = props;
  const { t } = useTranslation();

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
              const key = getQuotaCacheKey(entry.file);
              return (
                <LedgerRow
                  key={key}
                  entry={entry}
                  quota={quotaFor(entry)}
                  windows={orderLedgerWindows(windowsFor(entry), group.primaryWindowId)}
                  showEmails={props.showEmails}
                  canRefresh={canRefresh(entry)}
                  resetting={resettingKey === key}
                  now={props.now}
                  onRefresh={() => onRefresh(entry)}
                  onReset={() => onReset(entry)}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

type LedgerRowProps = {
  entry: QuotaFileEntry;
  quota: QuotaCardState | undefined;
  windows: LedgerWindow[];
  showEmails: boolean;
  canRefresh: boolean;
  resetting: boolean;
  now: number;
  onRefresh: () => void;
  onReset: () => void;
};

function LedgerRow(props: LedgerRowProps) {
  const { entry, quota, windows, showEmails, canRefresh, resetting, now, onRefresh, onReset } =
    props;
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const success = status === 'success' && quota !== undefined;
  const rawName = getQuotaDisplayName(entry.file);
  const name = showEmails ? rawName : maskEmails(rawName, `${entry.type}-`);
  const plan = planLabelFor(t, entry.type, quota);
  const adapter = QUOTA_ADAPTERS[entry.type];

  // Hooks cannot be conditional: non-Claude rows pass enabled=false and never read.
  const claudeReset = useClaudeResetGrants(
    entry.file,
    entry.type === 'claude' && status !== 'idle',
    !canRefresh || loading || resetting,
    quota,
    onRefresh
  );
  const showClaudeReset = entry.type === 'claude' && status !== 'idle';
  const showQuotaReset =
    success && Boolean(adapter.resetQuota) && Boolean(adapter.canResetQuota?.(quota));

  const backUntil = success ? exhaustedUntilMs(windows, now) : null;
  const renewal = entry.type === 'codex' && success ? codexRenewal(quota as CodexQuotaState) : null;
  const renewalDisplay =
    renewal === null ? null : buildResetDisplay(formatInstantShort(renewal), renewal, now, locale);

  return (
    <li className={styles.row}>
      <div className={styles.identity}>
        <span className={styles.name} title={name}>
          {name}
        </span>
        {(plan || renewalDisplay || backUntil !== null) && (
          <span className={styles.plan}>
            {plan && <span className={styles.planName}>{plan}</span>}
            {renewalDisplay && (
              <span>
                {t('quota_management.ledger_renews', { date: renewalDisplay.absolute })}
                {renewalDisplay.relative && ` · ${renewalDisplay.relative}`}
              </span>
            )}
            {backUntil !== null && (
              <span className={styles.backIn}>
                {t('quota_management.ledger_back_in', {
                  time: formatCompactDuration(backUntil - now),
                })}
              </span>
            )}
          </span>
        )}
      </div>

      <div className={styles.windows}>
        {status === 'idle' ? (
          <button type="button" className={styles.idle} onClick={onRefresh} disabled={!canRefresh}>
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
          <span className={styles.message}>{t('quota_management.ledger_no_windows')}</span>
        ) : (
          windows.map((window) => <LedgerWindowCell key={window.id} window={window} now={now} />)
        )}
      </div>

      <div className={styles.extras}>
        {showClaudeReset && (
          <>
            <div className={styles.extraLine}>
              {t('claude_reset.remaining')}:{' '}
              <strong className={styles.extraValue}>{claudeReset.count ?? '--'}</strong>
            </div>
            {claudeReset.expiresAtMs !== null && (
              <div className={styles.extraLine}>
                {t('claude_reset.ends', { date: formatInstantShort(claudeReset.expiresAtMs) })}
              </div>
            )}
            {claudeReset.message && (
              <div role="status" className={styles.extraError}>
                {t(`claude_reset.${claudeReset.message}`)}
              </div>
            )}
          </>
        )}
        {entry.type === 'codex' && success && (
          <CodexResetCredits quota={quota as CodexQuotaState} now={now} />
        )}
        {entry.type === 'xai' && success && <XaiCredits quota={quota as XaiQuotaState} now={now} />}
      </div>

      <div className={styles.actions}>
        {showClaudeReset && (
          <button
            type="button"
            className={styles.refresh}
            disabled={claudeReset.blocked}
            onClick={claudeReset.confirm}
            title={t(`claude_reset.${claudeReset.buttonLabel}`)}
          >
            <IconRefreshCw
              size={13}
              className={claudeReset.busy ? styles.spinning : undefined}
              aria-hidden="true"
            />
            {t(`claude_reset.${claudeReset.buttonLabel}`)}
          </button>
        )}
        {showQuotaReset && (
          <button
            type="button"
            className={styles.refresh}
            onClick={onReset}
            disabled={!canRefresh || loading || resetting}
            title={t('codex_quota.reset_button')}
          >
            <IconRefreshCw
              size={13}
              className={resetting ? styles.spinning : undefined}
              aria-hidden="true"
            />
            {t('codex_quota.reset_button')}
          </button>
        )}
        <button
          type="button"
          className={styles.refresh}
          onClick={onRefresh}
          disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting || claudeReset.busy)}
          title={t('auth_files.quota_refresh_hint')}
        >
          <IconRefreshCw
            size={13}
            className={loading ? styles.spinning : undefined}
            aria-hidden="true"
          />
          {t('auth_files.quota_refresh_single')}
        </button>
      </div>
    </li>
  );
}

function LedgerWindowCell({ window, now }: { window: LedgerWindow; now: number }) {
  const { t, i18n } = useTranslation();
  const reset = buildResetDisplay(
    window.resetLabel,
    window.resetAtMs !== null && window.resetAtMs > now ? window.resetAtMs : null,
    now,
    i18n.resolvedLanguage
  );
  const pending = reset !== null && window.resetAtMs !== null && window.resetAtMs > now;
  const exhausted = window.remaining !== null && window.remaining <= 0;
  return (
    <div className={exhausted ? `${styles.window} ${styles.windowExhausted}` : styles.window}>
      <div className={styles.windowHead}>
        <span className={styles.windowLabel}>{ledgerWindowLabel(t, window)}</span>
        <span className={styles.windowValue}>
          {window.remaining === null ? '--' : `${Math.round(window.remaining)}%`}
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
            {reset.relative && <span className={styles.resetRelative}>{reset.relative}</span>}
            <span className={styles.resetAbsolute}>{reset.absolute}</span>
          </>
        ) : (
          t('quota_management.ledger_no_reset')
        )}
      </div>
    </div>
  );
}

/** Codex manual resets: how many are banked and when the next one expires. */
function CodexResetCredits({ quota, now }: { quota: CodexQuotaState; now: number }) {
  const { t, i18n } = useTranslation();
  const available = quota.rateLimitResetCreditsAvailableCount ?? null;
  const credits = quota.rateLimitResetCredits ?? [];
  if (available === null && credits.length === 0 && !quota.rateLimitResetCreditsError) {
    return null;
  }

  let soonest: { index: number; ms: number } | null = null;
  for (const [index, credit] of credits.entries()) {
    const ms = parseIsoToMs(credit.expiresAt);
    if (ms !== null && ms > now && (soonest === null || ms < soonest.ms)) soonest = { index, ms };
  }
  const expiry =
    soonest === null
      ? null
      : buildResetDisplay(formatInstantShort(soonest.ms), soonest.ms, now, i18n.resolvedLanguage);

  return (
    <>
      <div className={styles.extraTitle}>{t('codex_quota.reset_credits_label')}</div>
      <div className={styles.extraLine}>
        <strong className={styles.extraCount}>{available ?? credits.length}</strong>{' '}
        {t('quota_management.ledger_resets_available')}
      </div>
      {soonest !== null && expiry ? (
        <div className={styles.extraMeta} title={expiry.absolute}>
          {t('codex_quota.reset_credit_number', { index: soonest.index + 1 })}
          {expiry.relative && (
            <>
              {' · '}
              <strong>{expiry.relative}</strong>
            </>
          )}
          {` · ${expiry.absolute}`}
        </div>
      ) : quota.rateLimitResetCreditsError ? (
        <div className={styles.extraError}>
          {t('codex_quota.reset_credits_expiry_failed', {
            message: quota.rateLimitResetCreditsError,
          })}
        </div>
      ) : null}
    </>
  );
}

/** xAI monthly credits and pay-as-you-go state. */
function XaiCredits({ quota, now }: { quota: XaiQuotaState; now: number }) {
  const { t, i18n } = useTranslation();
  const billing = quota.billing;
  if (!billing || billing.mode !== 'billing' || billing.monthlyLimitCents === null) return null;
  const [remaining, limit] = formatXaiRemainingAmount(billing).split(' / ');
  const cycleMs = parseIsoToMs(billing.billingPeriodEnd);
  const cycle =
    cycleMs === null
      ? null
      : buildResetDisplay(formatInstantShort(cycleMs), cycleMs, now, i18n.resolvedLanguage);
  const onDemand =
    (billing.onDemandCapCents ?? 0) > 0
      ? formatXaiOnDemandAmount(billing)
      : t('xai_quota.pay_as_you_go_disabled');
  return (
    <>
      <div className={styles.extraTitle}>{t('xai_quota.monthly_credits')}</div>
      <div className={styles.extraLine}>
        <strong className={styles.extraCount}>{remaining}</strong>
        {limit && <span className={styles.extraLimit}> / {limit}</span>}
      </div>
      <div className={styles.extraMeta} title={cycle?.absolute}>
        {t('xai_quota.pay_as_you_go_label')}: {onDemand}
        {cycle?.relative && ` · ${cycle.relative}`}
      </div>
    </>
  );
}

const codexRenewal = (quota: CodexQuotaState): number | null =>
  quota.subscriptionActiveUntil ? resolveResetMs([quota.subscriptionActiveUntil]) : null;
