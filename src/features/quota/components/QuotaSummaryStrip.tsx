/**
 * Pooled per-provider summary: one tile per provider with the binding window's
 * remaining capacity summed across credentials ("409% of 500%"), a segment per
 * credential, and the soonest reset. Remaining pools sit behind a toggle.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import { buildResetDisplay } from '@/utils/quota';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { ledgerWindowLabel, meterLevelClass } from './ledgerFormat';
import type { LedgerPool, LedgerSummary } from '../ledgerModel';
import styles from './QuotaSummaryStrip.module.scss';

const levelClasses = { high: styles.high, medium: styles.medium, low: styles.low };

const formatPercent = (value: number | null) => (value === null ? '--' : `${Math.round(value)}%`);

export type QuotaSummaryStripProps = {
  summaries: LedgerSummary[];
  resolvedTheme: ResolvedTheme;
  now: number;
};

export function QuotaSummaryStrip({ summaries, resolvedTheme, now }: QuotaSummaryStripProps) {
  if (summaries.length === 0) return null;
  return (
    <section className={styles.strip}>
      {summaries.map((summary) => (
        <SummaryTile
          key={summary.provider}
          summary={summary}
          resolvedTheme={resolvedTheme}
          now={now}
        />
      ))}
    </section>
  );
}

function SummaryTile({
  summary,
  resolvedTheme,
  now,
}: {
  summary: LedgerSummary;
  resolvedTheme: ResolvedTheme;
  now: number;
}) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const typeLabel = getTypeLabel(t, summary.provider);
  const iconSrc = getAuthFileIcon(summary.provider, resolvedTheme);
  const [primary, ...rest] = summary.pools;
  const extras = expanded ? rest : rest.slice(0, 1);
  const capacity = summary.credentials * 100;
  const reset = primary
    ? buildResetDisplay(primary.nextResetLabel, primary.nextResetMs, now, i18n.resolvedLanguage)
    : null;

  return (
    <article className={styles.tile} aria-label={typeLabel}>
      <header className={styles.head}>
        <span
          className={styles.iconWrap}
          style={
            isThemeSurfaceIconProvider(summary.provider)
              ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
              : undefined
          }
        >
          {iconSrc ? (
            <img src={iconSrc} alt="" className={styles.icon} />
          ) : (
            <span className={styles.iconFallback}>{typeLabel.slice(0, 1).toUpperCase()}</span>
          )}
        </span>
        <span className={styles.name}>{typeLabel}</span>
        <span className={styles.count}>
          {t('quota_management.ledger_credentials', { count: summary.credentials })}
        </span>
      </header>

      <div className={styles.primaryLabel}>
        {primary ? ledgerWindowLabel(t, primary.window) : t('quota_management.ledger_not_loaded')}
      </div>
      <div className={styles.figure}>
        <span className={styles.value}>{formatPercent(primary?.pooledRemaining ?? null)}</span>
        <span className={styles.capacity}>
          {t('quota_management.ledger_of_capacity', { capacity: `${capacity}%` })}
        </span>
      </div>
      <Segments pool={primary} credentials={summary.credentials} />
      <div className={styles.reset}>
        {reset ? (
          <>
            {reset.relative && <span className={styles.resetRelative}>{reset.relative}</span>}
            <span className={styles.resetAbsolute}>{reset.absolute}</span>
          </>
        ) : (
          <span className={styles.resetAbsolute}>{t('quota_management.ledger_no_reset')}</span>
        )}
      </div>

      {rest.length > 0 && (
        <footer className={styles.extras}>
          {extras.map((pool, index) => (
            <div key={pool.id} className={styles.extraRow}>
              <span className={styles.extraLabel}>{ledgerWindowLabel(t, pool.window)}</span>
              <span className={styles.extraValue}>{formatPercent(pool.pooledRemaining)}</span>
              {index === 0 && rest.length > 1 && (
                <button
                  type="button"
                  className={styles.toggle}
                  aria-expanded={expanded}
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? t('quota_management.ledger_hide') : t('quota_management.ledger_show')}
                </button>
              )}
            </div>
          ))}
        </footer>
      )}
    </article>
  );
}

function Segments({ pool, credentials }: { pool?: LedgerPool; credentials: number }) {
  const segments = pool?.segments ?? Array.from({ length: credentials }, () => null);
  return (
    <div className={styles.segments} aria-hidden="true">
      {segments.map((value, index) => (
        <span key={index} className={styles.segment}>
          {value !== null && (
            <span
              className={`${styles.segmentFill} ${meterLevelClass(value, levelClasses)}`}
              style={{ width: `${value}%` }}
            />
          )}
        </span>
      ))}
    </div>
  );
}
