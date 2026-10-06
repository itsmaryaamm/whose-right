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
- **Works like an app.** Install it to your home screen and it opens full-screen with its own icon. Cases are remembered on your phone, and a private link lets you open a case on another device.

## Run it locally

You need Node 22+ and a free [Gemini API key](https://aistudio.google.com/apikey).

```bash
git clone https://github.com/itsmaryaamm/whose-right && cd whose-right
npm install
cp .env.example .env              # then put your key in .env
export $(grep -v '^#' .env | xargs)
npm run dev
```

Open http://localhost:5173. To try it with a second person on the same computer, open the invite link in a private/incognito window.

**No API key yet?** Run `npm run dev:mock` (or start without a key). The mediator gives canned replies so you can click through the whole flow.

## Put it online for free (about 5 minutes, works from your phone)

Everything here is free: **Vercel** hosts the app, **Neon** stores the cases, and **Gemini** is the AI. No credit card is needed.

1. **Deploy.** Open **[vercel.com/new](https://vercel.com/new)** and sign in with GitHub. Find **whose-right** in the list and tap **Import**. Open **Environment Variables**, add `GEMINI_API_KEY` with your key, and tap **Deploy**.
2. **Add the free database.** When the deploy finishes, open the project, go to **Storage → Create Database → Neon**, choose the **Free** plan, and connect it to the project. This adds `DATABASE_URL` for you.
3. **Redeploy.** Go to **Deployments**, tap **⋯** on the latest one, then **Redeploy**.

Your link is the domain Vercel shows, e.g. **`https://whose-right.vercel.app`**. Open it on your phone, tap **Share → Add to Home Screen** (iPhone) or **Install** (Android), and send the link to your family.

**Free-tier limits** are plenty for a family:
- Vercel Hobby: 100 GB bandwidth/month.
- Neon Free: 0.5 GB of storage, and it sleeps when idle (the first request after a while takes a second longer).
- Gemini free tier: about 20 requests per model per day, stretched across several models (see below).

**Other hosts:** `render.yaml` deploys the same app on Render’s free plan (set `GEMINI_API_KEY` and `DATABASE_URL`). The Dockerfile runs it anywhere.

## How it’s built

| Part | Where |
|---|---|
| Mediator prompts, Gemini/Claude calls, structured JSON output | `server/mediator.ts` |
| HTTP API, relays, analysis, agreement | `server/app.ts` |
| Storage: Postgres (Neon) when `DATABASE_URL` is set, JSON file locally | `server/store.ts` |
| Vercel serverless entry point | `api/index.ts`, `vercel.json` |
| Installable app: icons, offline shell, install prompt | `public/`, `src/components/InstallBanner.tsx` |
| Phone UI (React + Vite) | `src/` |
| Animated characters (Arrive / Listen / Connect) | `src/components/Blob.tsx` |

- AI: **Gemini** when `GEMINI_API_KEY` is set (otherwise Claude via `ANTHROPIC_API_KEY`). Each mediator turn returns `{ reply, notes, relay }` as structured JSON.
- **Free tier:** Gemini’s free tier allows roughly 20 requests per model per day. Each message you send uses one request, and so does each analysis. So the app works through a chain of Flash and Flash-Lite models, resting any model that’s out of quota or overloaded. That gives you well over 100 messages a day for free. If you ever enable billing, set `GEMINI_MODEL=gemini-pro-latest` for the strongest mediator.
- Privacy model: each participant gets a secret token stored in their browser. The API only ever returns a person’s own chat, the shared relays, and the analysis. Other people’s chats and the mediator’s notes never leave the server.
- Each case is one JSON document in Postgres with a version number. Updates re-read and retry if two people act at once, so nothing is lost.

## Notes

Who’s Right is a communication tool, not therapy or legal advice. The mediator is told to step back and point to real help when it hears about abuse, threats or risk of harm.

Colours: `#F7F9F5` background · `#9CE8BD` mint · `#45BE88` green · `#191C1A` ink.
