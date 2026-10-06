import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { navigate } from '../router.ts';
import type { CaseSummary } from '../../shared/types.ts';

export function useCaseSummaries() {
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .summaries()
        .then((c) => alive && setCases(c))
        .catch(() => alive && setCases((prev) => prev ?? []));
    load();
    const t = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return cases;
}

export function Avatar({ name, you }: { name: string; you?: boolean }) {
  return (
    <span className={`avatar ${you ? 'you' : ''}`} title={name}>
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

export function CaseList({ cases, empty }: { cases: CaseSummary[] | null; empty: React.ReactNode }) {
  if (cases === null) return <div className="muted pad">Loading…</div>;
  if (cases.length === 0) return <>{empty}</>;
  return (
    <div className="case-list">
      {cases.map((c) => (
        <button key={c.id} className="case-card" onClick={() => navigate(`/c/${c.id}`)}>
          <div className="case-card-top">
            <span className="case-title">{c.title}</span>
            {c.status === 'resolved' ? (
              <span className="chip chip-done">Resolved</span>
            ) : (
              <span className="chip chip-private">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
                  <path d="M7 10 V8 a5 5 0 0 1 10 0 V10 h1 a1 1 0 0 1 1 1 V20 a1 1 0 0 1 -1 1 H6 a1 1 0 0 1 -1 -1 V11 a1 1 0 0 1 1 -1 Z M9 10 h6 V8 a3 3 0 0 0 -6 0 Z" />
                </svg>
                Private
              </span>
            )}
          </div>
          <div className="case-card-bottom">
            <div className="avatars">
              {c.participants.map((p, i) => (
                <Avatar key={i} name={p.name} you={p.isYou} />
              ))}
              {c.participants.length < 2 && <span className="waiting">waiting for them to join</span>}
            </div>
            {c.yourTurn && c.status !== 'resolved' && <span className="chip chip-turn">Your turn</span>}
          </div>
        </button>
      ))}
    </div>
  );
}
