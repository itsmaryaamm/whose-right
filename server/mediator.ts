// The AI mediator: talks privately to each person, keeps private notes, and
// proposes reframed messages ("the concern, not the attack") to pass on.
import Anthropic from '@anthropic-ai/sdk';
import type { Case, Participant } from './store.ts';
import { readAttachment } from './store.ts';
import type { Report } from '../shared/types.ts';

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-opus-5-5';
export const MOCK_AI = process.env.MOCK_AI === '1' || !process.env.ANTHROPIC_API_KEY;

const client = MOCK_AI ? null : new Anthropic();

const RELATIONSHIP_LABEL: Record<string, string> = {
  couple: 'a couple',
  friends: 'friends',
  family: 'family members',
  'co-founders': 'co-founders',
  colleagues: 'colleagues',
  business: 'business partners',
  other: 'people with a disagreement',
};

const MEDIATOR_PROMPT = `You are the mediator inside "Who's Right", an app that helps people resolve conflicts without the emotional damage of arguing directly.

How the app works:
- One person opens a private case and invites the other party (sometimes more than one).
- Each person talks ONLY to you, privately. Nobody ever sees anyone else's private conversation with you.
- You act as an emotional firewall: raw emotion → you listen and probe → you find the underlying concern → you phrase it respectfully → only that reframed concern reaches the other person, and only after its author approves it.

Your job in a private conversation with one person:
1. Let them vent. Anger, sarcasm, exaggeration and swearing are fine here; this is the safe place for it. Don't lecture, don't moralise, don't rush them toward calm.
2. Listen like a skilled human mediator. Reflect back briefly what you heard so they feel understood, then ask ONE good probing question at a time. Probe for: what concretely happened (when, what was said or done), what they assumed, what they felt, what they needed or expected, what would feel like a fair outcome, and whether there's evidence (messages, screenshots, documents) they could share.
3. Quietly separate facts, interpretations, assumptions, feelings, expectations and points of disagreement. Notice absolutes ("always", "never") and gently test them.
4. Stay neutral. You are not this person's advocate and you never declare a winner. You can validate feelings without endorsing their version of events. If something they said conflicts with what the other side has shared, ask about it neutrally ("The other side remembers that evening a bit differently, as …; what's your memory of it?") without revealing private wording.
5. Be concise and human. Usually 1–4 short sentences plus one question. No bullet lists, no headings, no therapy jargon, no "I hear you" clichés. Match their language and register (if they write casually, so do you).

Passing a concern on (the "relay"):
- When you understand a real underlying concern well enough, draft a relay message to the other party/parties and put it in the "relay" field. The person will see your draft and choose whether to send it, so also tell them in your reply that you've drafted something they can send, edit, or hold back.
- A relay conveys the CONCERN, never the ATTACK. Translate "She never listens to me, she just does whatever she wants" into something like "He feels important decisions are being made without involving him, and that leaves him feeling his opinion isn't valued."
- Write relays in the third person about the sender, using their first name ("Sam feels …", "Sam would like …"), addressed neutrally to the other party. Include what happened from their perspective (as their perspective, not as fact), what they felt, what they need, and, where useful, a question for the other person. 2–5 sentences. No insults, no blame words, no diagnosis of the other person's motives, no quotes of private wording.
- Don't relay after every message. Relay when there is something genuinely worth passing on: the core concern, a clarifying question for the other side, an acknowledgement or apology, a proposal, or an agreement. Leave "relay" as an empty string otherwise.
- If the person explicitly asks you to pass something on, draft it (still reframed).
- When a relay from the other side arrives in this person's conversation, help them take it in: check how it lands, invite their honest reaction, and probe what's underneath that reaction.

Working towards resolution:
- Over time, look for misunderstandings, points where both sides actually agree, and possible compromises. Name them to the person when it helps.
- When both sides have been heard and things are converging, suggest they open the Resolution tab to get a neutral analysis and proposed agreement.

Safety: if anyone describes violence, threats, abuse, coercive control or a risk of self-harm, take it seriously: prioritise their safety, say that mediation isn't the right tool for abuse, and encourage them to contact local emergency services or a relevant helpline. Never relay anything that could put someone at risk (for example a location).

Private notes:
- Every turn, return your full updated private notes about THIS person in "notes" (replace the old notes, keep everything still relevant). Organise them under: Facts they claim; Interpretations & assumptions; Feelings; Underlying needs & concerns; What they want / would accept; Evidence offered; Own part they acknowledge; Open questions. Be specific and keep them under ~400 words. These notes are confidential: other people never see them, but you will see them when talking to the other side, so record substance rather than verbatim insults.

Output: JSON with "reply" (your private message to this person), "notes" and "relay" (empty string if nothing to pass on).`;

const TURN_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    notes: { type: 'string' },
    relay: { type: 'string' },
  },
  required: ['reply', 'notes', 'relay'],
  additionalProperties: false,
} as const;

const strList = { type: 'array', items: { type: 'string' } } as const;
const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    agreedFacts: strList,
    disputedFacts: strList,
    concerns: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, concern: { type: 'string' } },
        required: ['name', 'concern'],
        additionalProperties: false,
      },
    },
    misunderstandings: strList,
    contributions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, items: strList },
        required: ['name', 'items'],
        additionalProperties: false,
      },
    },
    reasonablePositions: strList,
    commonGround: strList,
    compromises: strList,
    proposedResolution: { type: 'string' },
    nextSteps: strList,
  },
  required: [
    'summary',
    'agreedFacts',
    'disputedFacts',
    'concerns',
    'misunderstandings',
    'contributions',
    'reasonablePositions',
    'commonGround',
    'compromises',
    'proposedResolution',
    'nextSteps',
  ],
  additionalProperties: false,
} as const;

export class MediatorError extends Error {}

/** Calls Claude with structured JSON output, using server-side refusal fallback when available. */
async function callJson<T>(
  system: Anthropic.Beta.BetaTextBlockParam[],
  messages: Anthropic.Beta.BetaMessageParam[],
  schema: Record<string, unknown>,
  effort: 'medium' | 'high',
): Promise<T> {
  if (!client) throw new MediatorError('AI is not configured');
  const base = {
    model: MODEL,
    max_tokens: 16000,
    system,
    messages,
    output_config: { effort, format: { type: 'json_schema' as const, schema } },
  };
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await client.beta.messages.create({
      ...base,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  } catch (err) {
    // If the fallback beta isn't available on this account, retry plainly.
    if (err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message)) {
      res = await client.beta.messages.create(base);
    } else {
      throw err;
    }
  }
  if (res.stop_reason === 'refusal') {
    throw new MediatorError("The mediator couldn't respond to that. Try rephrasing, or reach out to someone you trust.");
  }
  if (res.stop_reason === 'max_tokens') throw new MediatorError('The response was cut off. Please try again.');
  const text = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text;
  if (!text) throw new MediatorError('Empty response from the mediator.');
  return JSON.parse(text) as T;
}

function caseContext(c: Case, me: Participant): string {
  const others = c.participants.filter((p) => p.id !== me.id);
  const lines: string[] = [];
  lines.push(`CASE: "${c.title}" — the parties are ${RELATIONSHIP_LABEL[c.relationship] ?? 'people'}.`);
  lines.push(`You are currently talking privately with: ${me.name}${me.isCreator ? ' (who opened the case)' : ''}.`);
  if (others.length === 0) {
    lines.push('The other party has not joined yet. Help this person get clear on what happened and what they need, and draft a first relay when ready; it will be waiting for the other party when they join.');
  } else {
    lines.push(`Other parties: ${others.map((p) => p.name).join(', ')}.`);
  }
  lines.push('');
  lines.push('YOUR CONFIDENTIAL NOTES ON THE OTHER PARTIES (from your private conversations with them; use them to spot conflicting accounts, misunderstandings and common ground, but never reveal or quote their private words, and only reference content that has already been relayed or that you are asking about neutrally):');
  for (const p of others) {
    lines.push(`--- ${p.name} ---\n${p.notes || '(nothing yet)'}`);
  }
  lines.push('');
  lines.push('SHARED BRIDGE (reframed messages that have actually been passed between the parties, oldest first):');
  if (c.bridge.length === 0) lines.push('(nothing shared yet)');
  for (const b of c.bridge) lines.push(`[${b.fromName} → others] ${b.text}`);
  lines.push('');
  lines.push(`YOUR CURRENT NOTES ON ${me.name.toUpperCase()}:\n${me.notes || '(none yet)'}`);
  if (me.pendingRelay) lines.push(`\nA relay draft is waiting for ${me.name}'s approval: "${me.pendingRelay}". Replace it if you draft a new one.`);
  if (c.report) lines.push(`\nA neutral analysis has been generated. Proposed resolution: ${c.report.proposedResolution}`);
  return lines.join('\n');
}

function attachmentBlocks(c: Case, msg: Participant['chat'][number]): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const a of msg.attachments ?? []) {
    let data: Buffer;
    try {
      data = readAttachment(c.id, a.id);
    } catch {
      continue;
    }
    if (a.mime === 'application/pdf') {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: data.toString('base64') }, title: a.name });
    } else if (a.mime === 'text/plain') {
      blocks.push({ type: 'text', text: `[Attached text file "${a.name}"]\n${data.toString('utf8').slice(0, 50000)}` });
    } else {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: a.mime as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data: data.toString('base64') },
      });
    }
  }
  return blocks;
}

/** Turns this person's private chat into an alternating user/assistant transcript. */
function transcript(c: Case, me: Participant): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  const push = (role: 'user' | 'assistant', blocks: Anthropic.Beta.BetaContentBlockParam[]) => {
    const last = out[out.length - 1];
    if (last && last.role === role && Array.isArray(last.content)) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of me.chat) {
    switch (m.kind) {
      case 'user':
        push('user', [...attachmentBlocks(c, m), { type: 'text', text: m.text || '(sent an attachment)' }]);
        break;
      case 'ai':
        push('assistant', [{ type: 'text', text: m.text }]);
        break;
      case 'relay-in':
        push('user', [{ type: 'text', text: `[App notice: a relayed message from ${m.fromName} was delivered to ${me.name}: "${m.text}"]` }]);
        break;
      case 'relay-out':
        push('user', [{ type: 'text', text: `[App notice: ${me.name} approved and sent this relay: "${m.text}"]` }]);
        break;
      case 'system':
        push('user', [{ type: 'text', text: `[App notice: ${m.text}]` }]);
        break;
    }
  }
  if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: [{ type: 'text', text: '[App notice: session started]' }] });
  if (out[out.length - 1]?.role === 'assistant') {
    push('user', [{ type: 'text', text: '[App notice: no new message; respond to the latest developments if useful]' }]);
  }
  return out;
}

export interface TurnResult {
  reply: string;
  notes: string;
  relay: string;
}

export async function mediatorTurn(c: Case, me: Participant): Promise<TurnResult> {
  if (MOCK_AI) return mockTurn(c, me);
  return callJson<TurnResult>(
    [
      { type: 'text', text: MEDIATOR_PROMPT, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: caseContext(c, me) },
    ],
    transcript(c, me),
    TURN_SCHEMA,
    'medium',
  );
}

const REPORT_PROMPT = `You are the neutral mediator inside "Who's Right". You have spoken privately with each party in a conflict and are now writing a fair, neutral analysis that ALL parties will read together.

Rules:
- Be even-handed. Don't declare a winner or loser. Where one position seems more reasonable on the available information, say so plainly but kindly, with reasons, and note what information would change that view.
- Never quote or reveal anyone's private wording, insults or venting. Describe positions and concerns respectfully, in neutral language.
- Distinguish clearly between facts both sides accept, facts still disputed, and interpretations.
- "contributions": for each person, how their behaviour (not their character) contributed to the conflict. Be fair and specific; include everyone.
- The proposed resolution should be concrete and practical: who does what, by when, and how they'll handle it next time. Write it as a short agreement both could sign up to.
- Use people's first names. Keep each list item to one or two sentences. Empty lists are fine where nothing applies.
- "summary" is two or three sentences on what this conflict is really about.`;

export async function generateReport(c: Case): Promise<Report> {
  if (MOCK_AI) return mockReport(c);
  const ctx: string[] = [`CASE: "${c.title}" — parties are ${RELATIONSHIP_LABEL[c.relationship] ?? 'people'}.`];
  for (const p of c.participants) ctx.push(`\n=== Your private notes on ${p.name} ===\n${p.notes || '(nothing recorded)'}`);
  ctx.push('\n=== Shared bridge (messages actually relayed between the parties) ===');
  for (const b of c.bridge) ctx.push(`[${b.fromName}] ${b.text}`);
  const r = await callJson<Omit<Report, 'generatedAt'>>(
    [{ type: 'text', text: REPORT_PROMPT }],
    [{ role: 'user', content: ctx.join('\n') + '\n\nWrite the neutral analysis now.' }],
    REPORT_SCHEMA,
    'high',
  );
  return { ...r, generatedAt: Date.now() };
}

// ---- Mock mediator (MOCK_AI=1 or no API key) -------------------------------
// Lets you click through the whole flow without spending tokens.

function mockTurn(c: Case, me: Participant): TurnResult {
  const said = me.chat.filter((m) => m.kind === 'user');
  const last = said[said.length - 1]?.text ?? '';
  const others = c.participants.filter((p) => p.id !== me.id).map((p) => p.name).join(' and ') || 'the other person';
  const notes = `Facts they claim: ${said.map((m) => m.text).join(' / ').slice(0, 300)}`;
  if (said.length < 2) {
    return {
      reply: `That sounds really frustrating. When you say "${last.slice(0, 60)}", what actually happened most recently, and what did you need from ${others} in that moment?`,
      notes,
      relay: '',
    };
  }
  return {
    reply: `Thanks, that helps. Underneath it, it sounds like you want to feel included and taken seriously. I've drafted something you can send to ${others}. Send it, edit it, or hold it back.`,
    notes,
    relay: `${me.name} feels that some recent decisions were made without them, and it left them feeling their view didn't count. They'd like to find a way to talk things through before decisions are made. How do you see it?`,
  };
}

function mockReport(c: Case): Report {
  const names = c.participants.map((p) => p.name);
  return {
    generatedAt: Date.now(),
    summary: `This is less about the specific event and more about how decisions get made between ${names.join(' and ')}. Both want to feel respected.`,
    agreedFacts: ['A decision was made without everyone being consulted.'],
    disputedFacts: ['Whether there was time to check in beforehand.'],
    concerns: names.map((n) => ({ name: n, concern: `${n} wants to feel their perspective matters.` })),
    misunderstandings: ['Silence was read as agreement.'],
    contributions: names.map((n) => ({ name: n, items: [`${n} assumed the other knew how they felt.`] })),
    reasonablePositions: ['Wanting to be consulted on shared decisions is reasonable.'],
    commonGround: ['Both value the relationship and want fewer arguments.'],
    compromises: ['Check in by message for any decision that affects both.'],
    proposedResolution: 'For the next month, any plan that affects both of you gets a quick check-in message first. Either person can say "let\'s run it through the app" if things get heated.',
    nextSteps: ['Agree on what counts as a "shared decision".', 'Review how it went in a month.'],
  };
}
