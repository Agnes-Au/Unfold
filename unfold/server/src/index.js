import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { config as defaultConfig } from './config.js';
import { createDb } from './db.js';
import { workersRouter } from './routes/workers.js';
import { devicesRouter } from './routes/devices.js';
import { workerRouter } from './routes-worker.js';
import { studentRouter } from './routes-student.js';
import { demoRouter } from './routes/demo.js';
import { transcribeRouter } from './routes/transcribe.js';
import { ensureFictionalDemo } from './fictional-demo.js';
import { startSweeper } from './sweeper.js';

/**
 * Express app factory. Exported separately from the listener so tests can
 * build an app against an in-memory database.
 *
 * All GenAI calls happen server-side (see src/genai.js) using the Gemini
 * key from the server environment only; nothing here ever ships a key to a
 * client.
 */
export function createApp({ db, config = defaultConfig } = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      demoMode: !!config.demoMode,
      transcription: { configured: !!config.elevenLabsApiKey },
      genai: {
        configured: !!config.geminiApiKey,
        model: config.genaiModel,
        baseUrl: config.geminiBaseUrl,
      },
      timeouts: {
        unclaimedHours: config.unclaimedTimeoutHours,
        responseHours: config.responseTimeoutHours,
      },
    });
  });

  app.use('/api/workers', workersRouter(db, config));
  app.use('/api/worker', workerRouter(db, config));
  app.use('/api/devices', devicesRouter(db));
  app.use('/api/transcribe', transcribeRouter(config));
  if (config.demoMode) {
    app.use('/api/demo', demoRouter(db));
  } else {
    app.use('/api/demo', (_req, res) => res.status(404).json({ error: 'not_found' }));
  }
  app.use('/api', studentRouter(db, config));

  // 404 for unknown API routes
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

  serveWebApp(app, '/worker', config.workerWebDir);
  serveWebApp(app, '/', config.studentWebDir);

  // Central error handler. Client errors raised by body parsers (e.g. 413
  // payload too large) keep their status; everything else is a 500.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.status >= 400 && err.status < 500) {
      return res.status(err.status).json({ error: err.type || 'bad_request' });
    }
    console.error('[server] error:', err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

/**
 * Serve a built single-page app from `dir` under `mountPath`, falling back to
 * its index.html so client-side routes survive a refresh. Skipped when the
 * build is absent (local development runs the dev servers instead).
 */
function serveWebApp(app, mountPath, dir) {
  if (!dir || !existsSync(path.join(dir, 'index.html'))) return;
  const index = path.join(dir, 'index.html');
  app.use(mountPath, express.static(dir));
  app.get(mountPath === '/' ? '*' : `${mountPath}/*`, (_req, res) => res.sendFile(index));
}

// Boot only when run directly (node src/index.js), not when imported by tests.
import { fileURLToPath } from 'node:url';
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const db = createDb(defaultConfig.dbPath);
  // Seed the demo worker and Maya's case up front so the worker console works
  // on a fresh database before anyone opens the student demo.
  if (defaultConfig.demoMode) ensureFictionalDemo(db);
  const app = createApp({ db, config: defaultConfig });
  startSweeper(db, defaultConfig);
  app.listen(defaultConfig.port, () => {
    console.log(`[server] Unfold backend listening on http://localhost:${defaultConfig.port}`);
    console.log(`[server] Demo mode: ${defaultConfig.demoMode ? 'on' : 'off'}`);
    console.log(`[server] Transcription: ${defaultConfig.elevenLabsApiKey ? 'configured' : 'NOT configured (ELEVENLABS_API_KEY unset)'}`);
    console.log(
      `[server] GenAI: ${defaultConfig.geminiApiKey ? `configured (model ${defaultConfig.genaiModel})` : 'NOT configured — deterministic local fallbacks will be used (genai=0)'}`
    );
  });
}
