import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import {
  auth,
  chatMessage,
  createCase,
  findByCode,
  getCase,
  id,
  newParticipant,
  readAttachment,
  saveAttachment,
  touch,
  type Case,
  type Participant,
} from './store.ts';
import { generateReport, mediatorTurn, MediatorError, MOCK_AI } from './mediator.ts';
import type { Attachment, CaseSummary, CaseView, Relationship } from '../shared/types.ts';

const app = express();
app.use(express.json({ limit: '25mb' }));

const RELATIONSHIPS: Relationship[] = ['couple', 'friends', 'family', 'co-founders', 'colleagues', 'business', 'other'];

// Participants whose mediator turn is currently running.
const busy = new Set<string>();
const reportBusy = new Set<string>();

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

function yourTurn(p: Participant) {
  if (p.pendingRelay) return true;
  return p.chat.some((m) => m.at > p.lastReadAt && (m.kind === 'ai' || m.kind === 'relay-in' || m.kind === 'system'));
}

function view(c: Case, me: Participant): CaseView {
  return {
    id: c.id,
    title: c.title,
    relationship: c.relationship,
    createdAt: c.createdAt,
    status: c.status,
    inviteCode: c.inviteCode,
    you: { id: me.id, name: me.name },
    participants: c.participants.map((p) => ({
      id: p.id,
      name: p.name,
      joinedAt: p.joinedAt,
      isYou: p.id === me.id,
      isCreator: p.isCreator,
      agreed: p.agreed,
    })),
    chat: me.chat,
    pendingRelay: me.pendingRelay,
    bridge: c.bridge,
    report: c.report,
    thinking: busy.has(me.id) || reportBusy.has(c.id),
    yourTurn: yourTurn(me),
    mockAi: MOCK_AI,
  };
}

function welcome(c: Case, me: Participant): string {
  const others = c.participants.filter((p) => p.id !== me.id);
  if (others.length === 0) {
    return `Hi ${me.name}. This space is just for you: nobody else will ever see what you write here. Tell me what happened, exactly as you see it. Angry, messy, unfair: all fine. I'll help work out what's really going on, and only pass on what you approve.`;
  }
  const names = others.map((p) => p.name).join(' and ');
  return `Hi ${me.name}, thanks for joining. ${names} opened this case because they'd like to work something out with you. This space is private: ${names} will never see what you write here, and I only pass on the concerns you approve, reframed respectfully. In your own words, how do you see what's been going on?`;
}

type Authed = Request & { c: Case; me: Participant };

function requireParticipant(req: Request, res: Response, next: NextFunction) {
  const c = getCase(String(req.params.caseId));
  const me = c && auth(c, req.header('x-token'));
  if (!c || !me) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  (req as Authed).c = c;
  (req as Authed).me = me;
  next();
}

function errorMessage(err: unknown): string {
  if (err instanceof MediatorError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return 'The server’s Anthropic API key is invalid.';
  if (err instanceof Anthropic.RateLimitError) return 'The mediator is busy right now. Please try again in a moment.';
  if (err instanceof Anthropic.APIError) return `The mediator had a problem (${err.status}). Please try again.`;
  return 'Something went wrong. Please try again.';
}

/** Runs one mediator turn for a participant and applies the result. */
async function runTurn(c: Case, me: Participant) {
  busy.add(me.id);
  try {
    const r = await mediatorTurn(c, me);
    me.notes = r.notes.trim() || me.notes;
    me.chat.push(chatMessage('ai', r.reply.trim()));
    if (r.relay.trim()) me.pendingRelay = r.relay.trim();
  } catch (err) {
    console.error(err);
    me.chat.push(chatMessage('system', errorMessage(err)));
  } finally {
    busy.delete(me.id);
    touch(c);
  }
}

// ---- Routes ---------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mockAi: MOCK_AI });
});

app.post('/api/cases', (req, res) => {
  const title = clean(req.body.title, 80);
  const name = clean(req.body.name, 40);
  const relationship = RELATIONSHIPS.includes(req.body.relationship) ? (req.body.relationship as Relationship) : 'other';
  if (!title || !name) {
    res.status(400).json({ error: 'Please add a name and a case title.' });
    return;
  }
  const me = newParticipant(name, true);
  const c = createCase(title, relationship, me);
  me.chat.push(chatMessage('ai', welcome(c, me)));
  touch(c);
  res.json({ caseId: c.id, token: me.token });
});

app.get('/api/join/:code', (req, res) => {
  const c = findByCode(req.params.code);
  if (!c) {
    res.status(404).json({ error: 'No case with that code.' });
    return;
  }
  res.json({
    title: c.title,
    relationship: c.relationship,
    invitedBy: c.participants.find((p) => p.isCreator)?.name ?? 'Someone',
    participants: c.participants.length,
    status: c.status,
  });
});

app.post('/api/join/:code', (req, res) => {
  const c = findByCode(req.params.code);
  const name = clean(req.body.name, 40);
  if (!c) {
    res.status(404).json({ error: 'No case with that code.' });
    return;
  }
  if (!name) {
    res.status(400).json({ error: 'Please add your name.' });
    return;
  }
  if (c.participants.length >= 8) {
    res.status(400).json({ error: 'This case is full.' });
    return;
  }
  const me = newParticipant(name, false);
  c.participants.push(me);
  me.chat.push(chatMessage('ai', welcome(c, me)));
  // Anything already passed on is waiting for the newcomer.
  for (const b of c.bridge) me.chat.push(chatMessage('relay-in', b.text, { fromName: b.fromName }));
  for (const p of c.participants) {
    if (p.id !== me.id) p.chat.push(chatMessage('system', `${me.name} joined the case.`));
  }
  touch(c);
  res.json({ caseId: c.id, token: me.token });
});

// Summaries for the home screen. The client sends the tokens it holds.
app.post('/api/cases/summary', (req, res) => {
  const entries: { id: string; token: string }[] = Array.isArray(req.body.entries) ? req.body.entries.slice(0, 100) : [];
  const out: CaseSummary[] = [];
  for (const e of entries) {
    const c = getCase(String(e.id));
    const me = c && auth(c, String(e.token));
    if (!c || !me) continue;
    out.push({
      id: c.id,
      title: c.title,
      relationship: c.relationship,
      status: c.status,
      participants: c.participants.map((p) => ({ name: p.name, isYou: p.id === me.id })),
      yourTurn: yourTurn(me),
      updatedAt: c.updatedAt,
    });
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  res.json(out);
});

app.get('/api/cases/:caseId', requireParticipant, (req, res) => {
  const { c, me } = req as Authed;
  res.json(view(c, me));
});

app.post('/api/cases/:caseId/read', requireParticipant, (req, res) => {
  const { c, me } = req as Authed;
  me.lastReadAt = Date.now();
  touch(c);
  res.json({ ok: true });
});

app.post('/api/cases/:caseId/messages', requireParticipant, async (req, res) => {
  const { c, me } = req as Authed;
  if (busy.has(me.id)) {
    res.status(409).json({ error: 'The mediator is still replying.' });
    return;
  }
  const text = clean(req.body.text, 8000);
  const files: { name: string; mime: string; data: string }[] = Array.isArray(req.body.attachments) ? req.body.attachments.slice(0, 5) : [];
  if (!text && files.length === 0) {
    res.status(400).json({ error: 'Write something first.' });
    return;
  }
  let attachments: Attachment[];
  try {
    attachments = files.map((f) => saveAttachment(c.id, String(f.name), String(f.mime), String(f.data)));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }
  me.chat.push(chatMessage('user', text, attachments.length ? { attachments } : {}));
  me.lastReadAt = Date.now();
  touch(c);
  await runTurn(c, me);
  me.lastReadAt = Date.now();
  res.json(view(c, me));
});

// Approve (optionally edited), or discard, the mediator's drafted relay.
app.post('/api/cases/:caseId/relay', requireParticipant, (req, res) => {
  const { c, me } = req as Authed;
  if (!me.pendingRelay) {
    res.status(400).json({ error: 'Nothing waiting to be sent.' });
    return;
  }
  if (req.body.action === 'discard') {
    me.pendingRelay = null;
    me.chat.push(chatMessage('system', 'You held that one back. Nothing was sent.'));
  } else {
    const text = clean(req.body.text, 2000) || me.pendingRelay;
    me.pendingRelay = null;
    c.bridge.push({ id: id(), fromId: me.id, fromName: me.name, text, at: Date.now() });
    me.chat.push(chatMessage('relay-out', text));
    for (const p of c.participants) {
      if (p.id !== me.id) p.chat.push(chatMessage('relay-in', text, { fromName: me.name }));
    }
  }
  me.lastReadAt = Date.now();
  touch(c);
  res.json(view(c, me));
});

app.post('/api/cases/:caseId/report', requireParticipant, async (req, res) => {
  const { c, me } = req as Authed;
  if (reportBusy.has(c.id)) {
    res.status(409).json({ error: 'The analysis is already being written.' });
    return;
  }
  if (c.participants.length < 2) {
    res.status(400).json({ error: 'The other person needs to join first.' });
    return;
  }
  reportBusy.add(c.id);
  try {
    c.report = await generateReport(c);
    for (const p of c.participants) {
      p.agreed = null;
      p.chat.push(chatMessage('system', `${me.name} asked for a neutral analysis. It's ready in the Resolution tab.`));
    }
    c.status = 'open';
    touch(c);
    res.json(view(c, me));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: errorMessage(err) });
  } finally {
    reportBusy.delete(c.id);
  }
});

app.post('/api/cases/:caseId/agree', requireParticipant, (req, res) => {
  const { c, me } = req as Authed;
  if (!c.report) {
    res.status(400).json({ error: 'There is no proposed resolution yet.' });
    return;
  }
  me.agreed = Boolean(req.body.agree);
  for (const p of c.participants) {
    if (p.id !== me.id) {
      p.chat.push(
        chatMessage('system', me.agreed ? `${me.name} agreed to the proposed resolution.` : `${me.name} isn't ready to agree to the proposed resolution yet.`),
      );
    }
  }
  if (c.participants.length >= 2 && c.participants.every((p) => p.agreed)) {
    c.status = 'resolved';
    for (const p of c.participants) p.chat.push(chatMessage('system', 'Everyone agreed. This case is resolved. 🎉'));
  } else {
    c.status = 'open';
  }
  me.lastReadAt = Date.now();
  touch(c);
  res.json(view(c, me));
});

app.get('/api/cases/:caseId/attachments/:attId', (req, res) => {
  const c = getCase(req.params.caseId);
  const me = c && auth(c, String(req.query.t ?? ''));
  const att = me?.chat.flatMap((m) => m.attachments ?? []).find((a) => a.id === req.params.attId);
  if (!c || !att) {
    res.status(404).end();
    return;
  }
  res.type(att.mime).send(readAttachment(c.id, att.id));
});

// ---- Static client (production) -------------------------------------------

const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`Who's Right API on http://localhost:${port}${MOCK_AI ? '  (mock mediator: set ANTHROPIC_API_KEY for the real one)' : ''}`);
});
