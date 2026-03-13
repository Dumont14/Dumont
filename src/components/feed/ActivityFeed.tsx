// src/components/feed/ActivityFeed.tsx
'use client';

import { useActivityFeed } from '@/hooks/useActivityFeed';
import { ROLES } from '@/lib/constants';
import type { UserRole } from '@/types';
import styles from './ActivityFeed.module.css';

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)   return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
}

export function ActivityFeed() {
  const { events, loading, error } = useActivityFeed(50);

  return (
    <aside className={styles.feed}>
      <div className={styles.head}>
        <span className={styles.title}>ACTIVITY</span>
        <span className={[styles.dot, events.length ? styles.live : ''].join(' ')} />
      </div>

      {loading && <div className={styles.msg}><span className="spin" /></div>}
      {error   && <div className={styles.msg} style={{ color: 'var(--red)' }}>⚠ {error}</div>}
      {!loading && events.length === 0 && (
        <div className={styles.msg}>No recent activity</div>
      )}

      <ul className={styles.list}>
        {events.map(e => {
          const u      = e.ab_users;
          const role   = u?.role as UserRole | undefined;
          const label  = role ? ROLES[role]?.label : '—';
          const isRoute = !!e.icao_arr;
          return (
            <li key={e.id} className={styles.item}>
              <div className={styles.itemTop}>
                <span className={styles.name}>{u?.visible ? u.name : 'Anonymous'}</span>
                <span className={styles.time}>{timeAgo(e.created_at)}</span>
              </div>
              <div className={styles.itemBot}>
                <span className={styles.role}>{label}</span>
                <span className={styles.icao}>
                  {e.icao_dep}{isRoute ? ` → ${e.icao_arr}` : ''}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
