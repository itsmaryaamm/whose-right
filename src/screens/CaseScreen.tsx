import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fileToUpload, tokens, type UploadFile } from '../api.ts';
import { navigate } from '../router.ts';
import { Blob, Pair } from '../components/Blob.tsx';
import { Avatar } from '../components/CaseList.tsx';
import { BackButton } from './NewCase.tsx';
import type { CaseView, ChatMessage, Report } from '../../shared/types.ts';

type Tab = 'talk' | 'shared' | 'resolution';

export function CaseScreen({ caseId }: { caseId: string }) {
  const [view, setView] = useState<CaseView | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('talk');
  const [showInvite, setShowInvite] = useState(() => new URLSearchParams(location.search).has('invite'));
  const [sending, setSending] = useState<ChatMessage | null>(null);

  // Show the invite panel once after creating a case, then drop ?invite=1 from the URL.
  useEffect(() => {
    if (location.search) history.replaceState(null, '', location.pathname);
  }, []);

  const load = useCallback(async () => {
    try {
      setView(await api.get(caseId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [caseId]);

  useEffect(() => {
    if (!tokens.get(caseId)) {
      setError('Case not found');
      return;
    }
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 3000);
    return () => clearInterval(t);
  }, [caseId, load]);

  // Mark things as read while looking at the private conversation.
  const yourTurn = view?.yourTurn && !view.pendingRelay;
  useEffect(() => {
    if (tab === 'talk' && yourTurn) api.read(caseId).catch(() => {});
  }, [tab, yourTurn, caseId]);

  if (error) {
    return (
      <div className="screen">
        <BackButton />
        <div className="empty">
          <Blob mood="worried" size={120} />
          <h2>We couldn’t open this case</h2>
          <p className="muted">It may have been opened on a different device. Ask for a new invite, or use your private link.</p>
          <button className="btn" onClick={() => navigate('/')}>
            Go home
          </button>
        </div>
      </div>
    );
  }
  if (!view) return <div className="screen muted pad">Loading…</div>;

  const others = view.participants.filter((p) => !p.isYou);
  const alone = others.length === 0;

  return (
    <div className="case-screen">
      <header className="case-header">
        <BackButton />
        <div className="case-head-main">
          <div className="case-head-title">{view.title}</div>
          <div className="case-head-sub">
            {view.participants.map((p) => (
              <Avatar key={p.id} name={p.name} you={p.isYou} />
            ))}
            <span className="muted small">{alone ? 'Waiting for them to join' : view.status === 'resolved' ? 'Resolved' : 'In progress'}</span>
          </div>
        </div>
        <button className="icon-btn" onClick={() => setShowInvite((s) => !s)} aria-label="Invite and share">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="8" r="3.5" />
            <path d="M3 20 c0-3.5 2.7-6 6-6 s6 2.5 6 6 M18 8 v6 M15 11 h6" />
          </svg>
        </button>
      </header>

      {(showInvite || (alone && view.chat.length <= 1)) && <InvitePanel view={view} onClose={() => setShowInvite(false)} />}

      <div className="tabs" role="tablist">
        {(
          [
            ['talk', 'Private chat'],
            ['shared', `Shared${view.bridge.length ? ` · ${view.bridge.length}` : ''}`],
            ['resolution', 'Resolution'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
            {id === 'resolution' && view.report && view.status !== 'resolved' && <span className="tab-dot" />}
          </button>
        ))}
      </div>

      {tab === 'talk' && <Talk view={view} setView={setView} sending={sending} setSending={setSending} />}
      {tab === 'shared' && <Shared view={view} />}
      {tab === 'resolution' && <Resolution view={view} setView={setView} />}
    </div>
  );
}

// ---- Invite ---------------------------------------------------------------

function InvitePanel({ view, onClose }: { view: CaseView; onClose: () => void }) {
  const link = `${location.origin}/join/${view.inviteCode}`;
  const [copied, setCopied] = useState('');
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(''), 1800);
    } catch {
      prompt('Copy this:', text);
    }
  };
  const share = async () => {
    const text = `I’d like us to work something out on Who’s Right. It’s private: we each talk to a neutral mediator first. Join “${view.title}”: ${link} (code ${view.inviteCode})`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Who’s Right', text });
        return;
      } catch {
        /* cancelled */
      }
    }
    copy(text, 'invite');
  };
  return (
    <section className="invite-panel">
      <button className="close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <h3>Invite the other person</h3>
      <div className="code-display" onClick={() => copy(view.inviteCode, 'code')}>
        {view.inviteCode.split('').map((ch, i) => (
          <span key={i}>{ch}</span>
        ))}
      </div>
      <div className="row">
        <button className="btn" onClick={share}>
          {copied === 'invite' ? 'Invite copied ✓' : 'Share invite'}
        </button>
        <button className="btn btn-ghost" onClick={() => copy(link, 'link')}>
          {copied === 'link' ? 'Copied ✓' : 'Copy link'}
        </button>
      </div>
      <details className="small">
        <summary>Open this case on another device</summary>
        <p className="muted">This link is your private key to the case. Don’t share it with anyone else.</p>
        <button className="btn btn-ghost" onClick={() => copy(api.privateLink(view.id), 'private')}>
          {copied === 'private' ? 'Copied ✓' : 'Copy my private link'}
        </button>
      </details>
    </section>
  );
}

// ---- Private conversation --------------------------------------------------

function Talk({
  view,
  setView,
  sending,
  setSending,
}: {
  view: CaseView;
  setView: (v: CaseView) => void;
  sending: ChatMessage | null;
  setSending: (m: ChatMessage | null) => void;
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const thinking = view.thinking || sending !== null;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [view.chat.length, sending, view.pendingRelay, thinking]);

  async function send() {
    if ((!text.trim() && files.length === 0) || thinking) return;
    setError('');
    let uploads: UploadFile[] = [];
    try {
      uploads = await Promise.all(files.map(fileToUpload));
    } catch {
      setError('Couldn’t read that file.');
      return;
    }
    const optimistic: ChatMessage = {
      id: 'pending',
      kind: 'user',
      text: text.trim(),
      at: Date.now(),
      attachments: files.map((f, i) => ({ id: `local-${i}`, name: f.name, mime: f.type, size: f.size })),
    };
    setSending(optimistic);
    const prevText = text;
    const prevFiles = files;
    setText('');
    setFiles([]);
    try {
      setView(await api.send(view.id, optimistic.text, uploads));
    } catch (e) {
      setError((e as Error).message);
      setText(prevText);
      setFiles(prevFiles);
    } finally {
      setSending(null);
    }
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const ok = Array.from(list).filter((f) => f.size <= 8 * 1024 * 1024);
    if (ok.length < list.length) setError('Files must be under 8 MB.');
    setFiles((prev) => [...prev, ...ok].slice(0, 5));
  }

  // Once the server has the message (it's "thinking"), the optimistic copy is redundant.
  const messages = sending && !view.thinking ? [...view.chat, sending] : view.chat;

  return (
    <>
      <div className="chat">
        <div className="privacy-note">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
            <path d="M7 10 V8 a5 5 0 0 1 10 0 V10 h1 a1 1 0 0 1 1 1 V20 a1 1 0 0 1 -1 1 H6 a1 1 0 0 1 -1 -1 V11 a1 1 0 0 1 1 -1 Z M9 10 h6 V8 a3 3 0 0 0 -6 0 Z" />
          </svg>
          Only you and the mediator can see this conversation.
        </div>
        {view.mockAi && <div className="mock-note">Demo mode: the server has no AI key set, so the mediator gives canned replies.</div>}
        {messages.map((m) => (
          <Message key={m.id} m={m} caseId={view.id} />
        ))}
        {thinking && (
          <div className="thinking">
            <Pair moment="listen" size={64} />
            <span className="muted small">Listening…</span>
          </div>
        )}
        {view.pendingRelay && !thinking && <RelayDraft view={view} setView={setView} />}
        <div ref={endRef} />
      </div>

      <div className="composer-wrap">
        {error && <p className="error small">{error}</p>}
        {files.length > 0 && (
          <div className="file-chips">
            {files.map((f, i) => (
              <span key={i} className="file-chip">
                {f.name}
                <button onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer">
          <button className="icon-btn" onClick={() => fileRef.current?.click()} aria-label="Add evidence (screenshots, PDFs, text)" title="Add evidence">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 11.5 L12 19.5 a5 5 0 0 1 -7 -7 L13 4.5 a3.3 3.3 0 0 1 4.7 4.7 L9.8 17.1 a1.7 1.7 0 0 1 -2.4 -2.4 L14.5 7.6" />
            </svg>
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={view.status === 'resolved' ? 'Anything else on your mind?' : 'Say it how it feels…'}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="send-btn" onClick={send} disabled={thinking || (!text.trim() && files.length === 0)} aria-label="Send">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19 V5 M6 11 L12 5 L18 11" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}

function Message({ m, caseId }: { m: ChatMessage; caseId: string }) {
  if (m.kind === 'system') return <div className="sys-msg">{m.text}</div>;
  if (m.kind === 'relay-in' || m.kind === 'relay-out') {
    return (
      <div className={`relay-card ${m.kind === 'relay-out' ? 'out' : 'in'}`}>
        <div className="relay-label">{m.kind === 'relay-in' ? `From ${m.fromName}, via the mediator` : 'You sent this, via the mediator'}</div>
        <p>{m.text}</p>
      </div>
    );
  }
  return (
    <div className={`msg ${m.kind === 'user' ? 'me' : 'ai'}`}>
      {m.kind === 'ai' && (
        <div className="msg-avatar">
          <Blob mood="calm" tone="dark" size={34} />
        </div>
      )}
      <div className="bubble">
        {m.attachments?.map((a) =>
          a.mime.startsWith('image/') && !a.id.startsWith('local-') ? (
            <img key={a.id} className="att-img" src={api.attachmentUrl(caseId, a.id)} alt={a.name} />
          ) : (
            <a
              key={a.id}
              className="att-file"
              href={a.id.startsWith('local-') ? undefined : api.attachmentUrl(caseId, a.id)}
              target="_blank"
              rel="noreferrer"
            >
              📎 {a.name}
            </a>
          ),
        )}
        {m.text && <p>{m.text}</p>}
      </div>
    </div>
  );
}

function RelayDraft({ view, setView }: { view: CaseView; setView: (v: CaseView) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(view.pendingRelay ?? '');
  const [busy, setBusy] = useState(false);
  const others = view.participants.filter((p) => !p.isYou).map((p) => p.name);
  const to = others.length ? others.join(' & ') : 'them when they join';

  useEffect(() => setText(view.pendingRelay ?? ''), [view.pendingRelay]);

  async function act(action: 'send' | 'discard') {
    setBusy(true);
    try {
      setView(await api.relay(view.id, action, editing ? text : undefined));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relay-draft">
      <div className="relay-label">Ready to pass on to {to}</div>
      {editing ? (
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} />
      ) : (
        <p>{view.pendingRelay}</p>
      )}
      <p className="muted small">Nothing is sent until you tap Send. Only this message is shared, never your private chat.</p>
      <div className="row">
        <button className="btn" disabled={busy || (editing && !text.trim())} onClick={() => act('send')}>
          Send it
        </button>
        {!editing && (
          <button className="btn btn-ghost" disabled={busy} onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
        <button className="btn btn-ghost" disabled={busy} onClick={() => act('discard')}>
          Hold back
        </button>
      </div>
    </div>
  );
}

// ---- Shared bridge ----------------------------------------------------------

function Shared({ view }: { view: CaseView }) {
  return (
    <div className="pane">
      <p className="muted small pad-b">
        Everything that has actually been passed between you, after each person approved it. Private conversations never appear here.
      </p>
      {view.bridge.length === 0 ? (
        <div className="empty">
          <Pair moment="listen" size={100} />
          <p className="muted">Nothing shared yet. Keep talking with the mediator. When it understands what you need, it will draft something for you to send.</p>
        </div>
      ) : (
        view.bridge.map((b) => (
          <div key={b.id} className={`relay-card ${b.fromId === view.you.id ? 'out' : 'in'}`}>
            <div className="relay-label">
              {b.fromId === view.you.id ? 'You' : b.fromName} · {new Date(b.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
            </div>
            <p>{b.text}</p>
          </div>
        ))
      )}
    </div>
  );
}

// ---- Resolution ----------------------------------------------------------

function Resolution({ view, setView }: { view: CaseView; setView: (v: CaseView) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alone = view.participants.length < 2;
  const me = view.participants.find((p) => p.isYou)!;

  async function generate() {
    setBusy(true);
    setError('');
    try {
      setView(await api.report(view.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function agree(yes: boolean) {
    setBusy(true);
    try {
      setView(await api.agree(view.id, yes));
    } finally {
      setBusy(false);
    }
  }

  if (busy && !view.report) {
    return (
      <div className="pane empty">
        <Pair moment="listen" size={110} />
        <p className="muted">Weighing up both sides fairly. This can take a minute…</p>
      </div>
    );
  }

  if (!view.report) {
    return (
      <div className="pane empty">
        <Pair moment="connect" size={110} />
        <h2>Neutral analysis</h2>
        <p className="muted">
          When you’ve both had your say, the mediator can write a fair analysis for everyone: what you agree on, what’s disputed, what each of you
          actually needs, where things got misunderstood, and a proposed agreement.
        </p>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-big" disabled={alone || busy} onClick={generate}>
          {alone ? 'Waiting for the other person to join' : 'Get a neutral analysis'}
        </button>
      </div>
    );
  }

  const r = view.report;
  return (
    <div className="pane report">
      {view.status === 'resolved' && (
        <div className="resolved-banner">
          <Pair moment="connect" size={90} />
          <p>
            <b>Resolved.</b> You both agreed. Nicely done.
          </p>
        </div>
      )}
      <p className="report-summary">{r.summary}</p>
      <ReportSection title="What you both agree happened" items={r.agreedFacts} />
      <ReportSection title="Still disputed" items={r.disputedFacts} />
      {r.concerns.length > 0 && (
        <section className="report-section">
          <h3>What each person is really concerned about</h3>
          {r.concerns.map((c, i) => (
            <p key={i}>
              <b>{c.name}:</b> {c.concern}
            </p>
          ))}
        </section>
      )}
      <ReportSection title="Where misunderstandings happened" items={r.misunderstandings} />
      {r.contributions.length > 0 && (
        <section className="report-section">
          <h3>How each person contributed</h3>
          {r.contributions.map((c, i) => (
            <div key={i}>
              <p className="who">{c.name}</p>
              <ul>
                {c.items.map((it, j) => (
                  <li key={j}>{it}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
      <ReportSection title="What seems reasonable" items={r.reasonablePositions} />
      <ReportSection title="Common ground" items={r.commonGround} />
      <ReportSection title="Possible compromises" items={r.compromises} />
      <section className="report-section proposal">
        <h3>Proposed resolution</h3>
        <p>{r.proposedResolution}</p>
        {r.nextSteps.length > 0 && (
          <ul>
            {r.nextSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="agree-box">
        <div className="agree-people">
          {view.participants.map((p) => (
            <div key={p.id} className="agree-person">
              <Avatar name={p.name} you={p.isYou} />
              <span>{p.isYou ? 'You' : p.name}</span>
              <span className={`agree-state ${p.agreed ? 'yes' : p.agreed === false ? 'no' : ''}`}>
                {p.agreed ? 'Agreed' : p.agreed === false ? 'Not yet' : 'Hasn’t answered'}
              </span>
            </div>
          ))}
        </div>
        {view.status !== 'resolved' && (
          <div className="row">
            <button className="btn" disabled={busy || me.agreed === true} onClick={() => agree(true)}>
              I agree to this
            </button>
            <button className="btn btn-ghost" disabled={busy || me.agreed === false} onClick={() => agree(false)}>
              Not yet
            </button>
          </div>
        )}
        <p className="muted small">
          Not quite right? Keep talking in your private chat, then ask for a fresh analysis.
        </p>
        {error && <p className="error">{error}</p>}
        <button className="link-btn" disabled={busy} onClick={generate}>
          {busy ? 'Rewriting…' : '↻ Refresh analysis'}
        </button>
      </section>
      <p className="muted small">
        Written {new Date(r.generatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}. AI-generated from what each person shared. It may
        be wrong. Use it as a starting point for agreement, not a verdict.
      </p>
    </div>
  );
}

function ReportSection({ title, items }: { title: string; items: Report['agreedFacts'] }) {
  if (items.length === 0) return null;
  return (
    <section className="report-section">
      <h3>{title}</h3>
      <ul>
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </section>
  );
}
