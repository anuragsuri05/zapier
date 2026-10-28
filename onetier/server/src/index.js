import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import './db.js';
import { publicAuth, core } from './routes/core.js';
import { flows } from './routes/flows.js';
import { products } from './routes/products.js';
import { misc } from './routes/misc.js';
import { ai } from './routes/ai.js';
import { hooks, publicApi, v1, mcp } from './routes/public.js';
import { startScheduler } from './engine/triggers.js';
import { migrateToFree } from './plans.js';

migrateToFree();

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

// Keep the raw body for "Catch Raw Hook", parse JSON / form / text for everything else.
const keepRaw = (req, _res, buf) => { req.rawBody = buf.toString('utf8'); };
app.use(express.json({ limit: '5mb', verify: keepRaw, type: ['application/json', 'application/*+json'] }));
app.use(express.urlencoded({ extended: true, limit: '5mb', verify: keepRaw }));
app.use(express.text({ type: ['text/*', 'application/xml'], limit: '5mb', verify: keepRaw }));

// Permissive CORS for public endpoints (webhooks, embeds, REST API, MCP).
const cors = (req, res, next) => {
  res.set({ 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization, x-api-key, x-interface-password, mcp-session-id, mcp-protocol-version', 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS' });
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
};

app.get('/health', (_req, res) => res.json({ ok: true, name: 'OneTier', time: new Date().toISOString() }));
app.use('/hooks', cors, hooks);
app.use('/mcp', cors, mcp);
app.use('/api/public', cors, publicApi);
app.use('/api/v1', cors, v1);
app.use('/api', publicAuth);
app.use('/api', core);
app.use('/api', flows);
app.use('/api', products);
app.use('/api', misc);
app.use('/api', ai);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built web app (single-page app with client-side routing).
const dist = path.join(here, '..', '..', 'web', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side.' });
});

app.listen(PORT, () => {
  console.log(`\n  OneTier is running →  http://localhost:${PORT}\n`);
  startScheduler();
});
