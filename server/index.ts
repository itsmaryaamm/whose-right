// Local / container server: the API plus the built web app from dist/.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { app } from './app.js';
import { MOCK_AI, MODEL_LABEL } from './mediator.js';
import { STORAGE } from './store.js';

const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(
    `Who's Right on http://localhost:${port} · AI: ${MODEL_LABEL}${MOCK_AI ? ' (set GEMINI_API_KEY for the real one)' : ''} · storage: ${STORAGE}`,
  );
});
