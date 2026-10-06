import { useState } from 'react';
import { api, savedName, tokens } from '../api.ts';
import { navigate } from '../router.ts';
import type { Relationship } from '../../shared/types.ts';

export const RELATIONSHIPS: { id: Relationship; label: string }[] = [
  { id: 'couple', label: 'Partner' },
  { id: 'friends', label: 'Friend' },
  { id: 'family', label: 'Family' },
  { id: 'co-founders', label: 'Co-founder' },
  { id: 'colleagues', label: 'Colleague' },
  { id: 'business', label: 'Business partner' },
  { id: 'other', label: 'Other' },
];

export function NewCase() {
  const [name, setName] = useState(savedName.get());
  const [title, setTitle] = useState('');
  const [rel, setRel] = useState<Relationship>('couple');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.createCase(title, rel, name);
      savedName.set(name.trim());
      tokens.set(r.caseId, r.token);
      navigate(`/c/${r.caseId}?invite=1`, true);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="screen form-screen">
      <BackButton />
      <h1 className="page-title">New case</h1>
      <p className="muted">Give it a neutral name. The other person will see it when they join.</p>
      <form onSubmit={submit} className="form">
        <label>
          Your first name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Maryam" required autoComplete="given-name" />
        </label>
        <label>
          What’s it about?
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="e.g. The weekend plans" required />
        </label>
        <fieldset>
          <legend>Who is it with?</legend>
          <div className="pills">
            {RELATIONSHIPS.map((r) => (
              <button type="button" key={r.id} className={`pill ${rel === r.id ? 'on' : ''}`} onClick={() => setRel(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
        </fieldset>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-big" disabled={busy || !name.trim() || !title.trim()}>
          {busy ? 'Opening…' : 'Open case & invite'}
        </button>
      </form>
    </div>
  );
}

export function BackButton({ to = '/' }: { to?: string }) {
  return (
    <button className="back" onClick={() => (history.length > 1 ? history.back() : navigate(to))} aria-label="Back">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 5 L8 12 L15 19" />
      </svg>
    </button>
  );
}
