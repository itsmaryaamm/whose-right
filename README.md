# Who’s Right?

**Say it how it feels. We’ll pass on what it means.**

An AI mediator for disagreements between partners, friends, family, co-founders and colleagues. Instead of arguing directly, each person talks to the mediator **privately**. The mediator listens, asks probing questions, and works out the real concern underneath the anger. Only a respectful, reframed version reaches the other person, and only after its author approves it.

```
Raw emotion → AI listens & probes → underlying concern → respectful message → other person
```

> “She never listens to me. She just does whatever she wants.”
> becomes
> “He feels important decisions are being made without involving him, which makes him feel his opinion isn’t valued.”

## What it does

- **Private cases.** Start a case, then invite the other person with a link or a 6‑character code. Two or more people can join.
- **Private chat with the mediator.** Vent freely. Nobody else ever sees it. The mediator reflects back what it heard and asks one good question at a time, separating facts, assumptions, feelings and needs.
- **Relays with consent.** When the mediator understands a concern, it drafts a message for the other side. You can **send it**, **edit** it, or **hold it back**. Incoming relays show up in the other person’s private chat, and the mediator helps them respond.
- **Evidence.** Attach screenshots, PDFs or text files so facts don’t rely on memory alone. Attachments stay private to you and the mediator.
- **Cross-checking.** The mediator keeps confidential notes on each person. It uses them to spot conflicting accounts, misunderstandings and common ground, without quoting anyone’s private words.
- **Neutral analysis.** Anyone can ask for one. It covers what you agree happened, what’s still disputed, what each person is really concerned about, where misunderstandings happened, how each person contributed, what seems reasonable, common ground, possible compromises, and a proposed resolution with next steps.
- **Agreement.** Each person taps “I agree” or “Not yet”. When everyone agrees, the case is marked resolved.
- **Phone-first.** It’s a web app you can add to your home screen. Cases are remembered on your device, and a private link lets you open a case on another device.

## Run it locally

You need Node 22+ and an [Anthropic API key](https://console.anthropic.com).

```bash
git clone https://github.com/itsmaryaamm/whose-right && cd whose-right
npm install
cp .env.example .env              # then put your key in .env
export $(cat .env | xargs)        # or set ANTHROPIC_API_KEY however you like
npm run dev
```

Open http://localhost:5173. To try it with a second person on the same computer, open the invite link in a private/incognito window.

**No API key yet?** Run `npm run dev:mock` (or start without a key). The mediator gives canned replies so you can click through the whole flow.

## Put it online (so the other person can join)

The app is a single Node server (API + web app) that stores data in `DATA_DIR` (default `./data`).

**Render (easiest):** in Render choose **New → Blueprint**, pick the repo, and paste your `ANTHROPIC_API_KEY` when asked. `render.yaml` sets up the service and a 1 GB disk for case data.

**Anywhere with Docker** (Railway, Fly.io, a VPS):

```bash
docker build -t whos-right .
docker run -p 8787:8787 -e ANTHROPIC_API_KEY=sk-ant-... -v whosright-data:/data whos-right
```

Use HTTPS in production, since invite links and private links carry access keys.

## How it’s built

| Part | Where |
|---|---|
| Mediator prompts, Claude calls, structured JSON output | `server/mediator.ts` |
| HTTP API, relays, analysis, agreement | `server/index.ts` |
| JSON-file storage and attachments | `server/store.ts` |
| Phone UI (React + Vite) | `src/` |
| Animated characters (Arrive / Listen / Connect) | `src/components/Blob.tsx` |

- Model: `claude-opus-5-5` (override with `CLAUDE_MODEL`). Each mediator turn returns `{ reply, notes, relay }` via structured outputs. Server-side refusal fallback (`fallbacks: "default"`) is enabled.
- Privacy model: each participant gets a secret token stored in their browser. The API only ever returns a person’s own chat, the shared relays, and the analysis. Other people’s chats and the mediator’s notes never leave the server.
- Storage is a single JSON file. That’s fine for personal use and small groups; move to Postgres/SQLite if it grows.

## Notes

Who’s Right is a communication tool, not therapy or legal advice. The mediator is told to step back and point to real help when it hears about abuse, threats or risk of harm.

Colours: `#F7F9F5` background · `#9CE8BD` mint · `#45BE88` green · `#191C1A` ink.
