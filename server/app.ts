// The HTTP API. Used by the local server (server/index.ts) and by the
// serverless function on Vercel (api/index.ts).
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  auth,
  chatMessage,
  createCase,
  findByCode,
  getCase,
  getCases,
  id,
  mutate,
  newParticipant,
  readAttachment,
  Refusal,
  saveAttachment,
  type Case,
  type Participant,
} from './store.js';
import { describeError, generateReport, mediatorTurn, MOCK_AI } from './mediator.js';
import type { Attachment, CaseSummary, CaseView, Relationship } from '../shared/types.js';

export const app = express();
app.use(express.json({ limit: '4.5mb' }));

const RELATIONSHIPS: Relationship[] = ['couple', 'friends', 'family', 'co-founders', 'colleagues', 'business', 'other'];

// A reply that has been "thinking" longer than this was interrupted; let the person try again.
const THINK_TTL = 3 * 60_000;
const busySince = (t: number | null | undefined) => Boolean(t && Date.now() - t < THINK_TTL);

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

function yourTurn(p: Participant) {
  if (p.pendingRelay) return true;
  return p.chat.some((m) => m.at > p.lastReadAt && (m.kind === 'ai' || m.kind === 'relay-in' || m.kind === 'system'));
}

function view(c: Case, meId: string): CaseView {
  const me = c.participants.find((p) => p.id === meId)!;
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
    thinking: busySince(me.thinkingSince) || busySince(c.reportSince),
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

/** Finds `meId` in a freshly loaded case inside `mutate`. */
function find(c: Case, meId: string): Participant {
  const me = c.participants.find((p) => p.id === meId);
  if (!me) throw new Refusal('Case not found', 404);
  return me;
}

type Authed = Request & { c: Case; meId: string };

async function requireParticipant(req: Request, res: Response, next: NextFunction) {
  const c = await getCase(String(req.params.caseId));
  const me = c && auth(c, req.header('x-token'));
  if (!c || !me) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  (req as Authed).c = c;
  (req as Authed).meId = me.id;
  next();
}

// ---- Routes ---------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mockAi: MOCK_AI });
});

app.post('/api/cases', async (req, res) => {
  const title = clean(req.body.title, 80);
  const name = clean(req.body.name, 40);
  const relationship = RELATIONSHIPS.includes(req.body.relationship) ? (req.body.relationship as Relationship) : 'other';
  if (!title || !name) throw new Refusal('Please add a name and a case title.');
  const me = newParticipant(name, true);
  const c = await createCase(({ id, inviteCode }) => {
    const now = Date.now();
    const created: Case = {
      id,
      inviteCode,
      title,
      relationship,
      createdAt: now,
      updatedAt: now,
      status: 'open',
      participants: [me],
      bridge: [],
      report: null,
      reportSince: null,
    };
    me.chat = [chatMessage('ai', welcome(created, me))];
    return created;
  });
  res.json({ caseId: c.id, token: me.token });
});

app.get('/api/join/:code', async (req, res) => {
  const c = await findByCode(req.params.code);
  if (!c) throw new Refusal('No case with that code.', 404);
  res.json({
    title: c.title,
    relationship: c.relationship,
    invitedBy: c.participants.find((p) => p.isCreator)?.name ?? 'Someone',
    participants: c.participants.length,
    status: c.status,
  });
});

app.post('/api/join/:code', async (req, res) => {
  const found = await findByCode(req.params.code);
  const name = clean(req.body.name, 40);
  if (!found) throw new Refusal('No case with that code.', 404);
  if (!name) throw new Refusal('Please add your name.');
  const me = newParticipant(name, false);
  await mutate(found.id, (c) => {
    if (c.participants.length >= 8) throw new Refusal('This case is full.');
    me.chat = [];
    c.participants.push(me);
    me.chat.push(chatMessage('ai', welcome(c, me)));
    // Anything already passed on is waiting for the newcomer.
    for (const b of c.bridge) me.chat.push(chatMessage('relay-in', b.text, { fromName: b.fromName }));
    for (const p of c.participants) {
      if (p.id !== me.id) p.chat.push(chatMessage('system', `${me.name} joined the case.`));
    }
  });
  res.json({ caseId: found.id, token: me.token });
});

// Summaries for the home screen. The client sends the tokens it holds.
app.post('/api/cases/summary', async (req, res) => {
  const entries: { id: string; token: string }[] = Array.isArray(req.body.entries) ? req.body.entries.slice(0, 100) : [];
  const cases = await getCases(entries.map((e) => String(e.id)));
  const out: CaseSummary[] = [];
  for (const c of cases) {
    const me = auth(c, String(entries.find((e) => e.id === c.id)?.token ?? ''));
    if (!me) continue;
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
  const { c, meId } = req as Authed;
  res.json(view(c, meId));
});

app.post('/api/cases/:caseId/read', requireParticipant, async (req, res) => {
  const { c, meId } = req as Authed;
  await mutate(c.id, (fresh) => {
    find(fresh, meId).lastReadAt = Date.now();
  });
  res.json({ ok: true });
});

app.post('/api/cases/:caseId/messages', requireParticipant, async (req, res) => {
  const { c, meId } = req as Authed;
  const text = clean(req.body.text, 8000);
  const files: { name: string; mime: string; data: string }[] = Array.isArray(req.body.attachments) ? req.body.attachments.slice(0, 5) : [];
  if (!text && files.length === 0) throw new Refusal('Write something first.');
  if (busySince(find(c, meId).thinkingSince)) throw new Refusal('The mediator is still replying.', 409);

  const attachments: Attachment[] = [];
  for (const f of files) attachments.push(await saveAttachment(c.id, String(f.name), String(f.mime), String(f.data)));

  // 1. Record the message and mark the mediator as busy for this person.
  const { c: withMessage } = await mutate(c.id, (fresh) => {
    const me = find(fresh, meId);
    if (busySince(me.thinkingSince)) throw new Refusal('The mediator is still replying.', 409);
    me.chat.push(chatMessage('user', text, attachments.length ? { attachments } : {}));
    me.thinkingSince = Date.now();
    me.lastReadAt = Date.now();
  });

  // 2. Ask the mediator (this can take a while; others may update the case meanwhile).
  let outcome: Awaited<ReturnType<typeof mediatorTurn>> | { error: string };
  try {
    outcome = await mediatorTurn(withMessage, find(withMessage, meId));
  } catch (err) {
    console.error(err);
    outcome = { error: describeError(err) };
  }

  // 3. Apply the reply to the latest copy of the case.
  const { c: done } = await mutate(c.id, (fresh) => {
    const me = find(fresh, meId);
    me.thinkingSince = null;
    if ('error' in outcome) {
      me.chat.push(chatMessage('system', outcome.error));
    } else {
      me.notes = outcome.notes.trim() || me.notes;
      me.chat.push(chatMessage('ai', outcome.reply.trim()));
      if (outcome.relay.trim()) me.pendingRelay = outcome.relay.trim();
    }
    me.lastReadAt = Date.now();
  });
  res.json(view(done, meId));
});

// Approve (optionally edited), or discard, the mediator's drafted relay.
app.post('/api/cases/:caseId/relay', requireParticipant, async (req, res) => {
  const { c, meId } = req as Authed;
  const { c: done } = await mutate(c.id, (fresh) => {
    const me = find(fresh, meId);
    if (!me.pendingRelay) throw new Refusal('Nothing waiting to be sent.');
    if (req.body.action === 'discard') {
      me.pendingRelay = null;
      me.chat.push(chatMessage('system', 'You held that one back. Nothing was sent.'));
    } else {
      const text = clean(req.body.text, 2000) || me.pendingRelay;
      me.pendingRelay = null;
      fresh.bridge.push({ id: id(), fromId: me.id, fromName: me.name, text, at: Date.now() });
      me.chat.push(chatMessage('relay-out', text));
      for (const p of fresh.participants) {
        if (p.id !== me.id) p.chat.push(chatMessage('relay-in', text, { fromName: me.name }));
      }
    }
    me.lastReadAt = Date.now();
  });
  res.json(view(done, meId));
});

app.post('/api/cases/:caseId/report', requireParticipant, async (req, res) => {
  const { c, meId } = req as Authed;
  const { c: started } = await mutate(c.id, (fresh) => {
    if (busySince(fresh.reportSince)) throw new Refusal('The analysis is already being written.', 409);
    if (fresh.participants.length < 2) throw new Refusal('The other person needs to join first.');
    fresh.reportSince = Date.now();
  });
  try {
    const report = await generateReport(started);
    const { c: done } = await mutate(c.id, (fresh) => {
      const me = find(fresh, meId);
      fresh.report = report;
      fresh.reportSince = null;
      fresh.status = 'open';
      for (const p of fresh.participants) {
        p.agreed = null;
        p.chat.push(chatMessage('system', `${me.name} asked for a neutral analysis. It's ready in the Resolution tab.`));
      }
    });
    res.json(view(done, meId));
  } catch (err) {
    console.error(err);
    await mutate(c.id, (fresh) => {
      fresh.reportSince = null;
    });
    res.status(502).json({ error: describeError(err) });
  }
});

app.post('/api/cases/:caseId/agree', requireParticipant, async (req, res) => {
  const { c, meId } = req as Authed;
  const { c: done } = await mutate(c.id, (fresh) => {
    const me = find(fresh, meId);
    if (!fresh.report) throw new Refusal('There is no proposed resolution yet.');
    me.agreed = Boolean(req.body.agree);
    for (const p of fresh.participants) {
      if (p.id !== me.id) {
        p.chat.push(
          chatMessage('system', me.agreed ? `${me.name} agreed to the proposed resolution.` : `${me.name} isn't ready to agree to the proposed resolution yet.`),
        );
      }
    }
    if (fresh.participants.length >= 2 && fresh.participants.every((p) => p.agreed)) {
      fresh.status = 'resolved';
      for (const p of fresh.participants) p.chat.push(chatMessage('system', 'Everyone agreed. This case is resolved. 🎉'));
    } else {
      fresh.status = 'open';
    }
    me.lastReadAt = Date.now();
  });
  res.json(view(done, meId));
});

app.get('/api/cases/:caseId/attachments/:attId', async (req, res) => {
  const c = await getCase(req.params.caseId);
  const me = c && auth(c, String(req.query.t ?? ''));
  const att = me?.chat.flatMap((m) => m.attachments ?? []).find((a) => a.id === req.params.attId);
  const data = c && att && (await readAttachment(c.id, att.id));
  if (!att || !data) {
    res.status(404).end();
    return;
  }
  res.set('cache-control', 'private, max-age=86400').type(att.mime).send(data);
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof Refusal) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});
