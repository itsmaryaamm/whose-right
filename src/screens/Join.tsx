import { useEffect, useState } from 'react';
import { api, savedName, tokens } from '../api.ts';
import { navigate } from '../router.ts';
import { Pair } from '../components/Blob.tsx';
import { BackButton } from './NewCase.tsx';

type Info = Awaited<ReturnType<typeof api.lookup>>;

export function Join({ initialCode }: { initialCode: string }) {
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [info, setInfo] = useState<Info | null>(null);
  const [name, setName] = useState(savedName.get());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setInfo(null);
    setError('');
    if (code.length !== 6) return;
    let alive = true;
    api
      .lookup(code)
      .then((i) => alive && setInfo(i))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [code]);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.join(code, name);
      savedName.set(name.trim());
      tokens.set(r.caseId, r.token);
      navigate(`/c/${r.caseId}`, true);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="screen form-screen">
      <BackButton />
      <h1 className="page-title">Join a case</h1>
      {info ? (
        <>
          <Pair moment="listen" size={110} />
          <div className="invite-card">
            <p className="muted small">{info.invitedBy} invited you to</p>
            <p className="invite-title">{info.title}</p>
            <p className="small">
              You’ll talk to the mediator privately. {info.invitedBy} won’t see what you write, only what you choose to pass on, reframed respectfully.
            </p>
          </div>
          <form onSubmit={join} className="form">
            <label>
              Your first name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoFocus autoComplete="given-name" />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn btn-big" disabled={busy || !name.trim()}>
              {busy ? 'Joining…' : 'Join privately'}
            </button>
          </form>
        </>
      ) : (
        <div className="form">
          <label>
            Case code
            <input
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="ABC123"
              autoFocus
              inputMode="text"
              autoCapitalize="characters"
            />
          </label>
          {error && <p className="error">{error}</p>}
          <p className="muted small">Ask the person who invited you for the 6-character code, or open the link they sent.</p>
        </div>
      )}
    </div>
  );
}
