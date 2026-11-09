import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { ServerConfig } from './config.js';
import { apiRouter, validationErrorHandler } from './api/router.js';
import { initRegistry } from './core/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createApp(cfg: ServerConfig): Promise<express.Express> {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  await initRegistry(cfg);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', apiRouter(cfg));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown API route.' } });
  });

  // Validation errors from our own routes first…
  app.use(validationErrorHandler as express.ErrorRequestHandler);
  // …then everything else without leaking internals.
  app.use(
    '/api',
    ((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error('[api] unhandled error:', err);
      res.status(500).json({ error: { code: 'INTERNAL', message: 'Unexpected server error.' } });
    }) as express.ErrorRequestHandler,
  );

  // In production the server also serves the built frontend.
  const distDir = path.resolve(__dirname, '../web/dist');
  app.use(express.static(distDir));
  app.get('*', (_req, res, next) => {
    res.sendFile(path.join(distDir, 'index.html'), (err) => {
      if (err) next();
    });
  });

  return app;
}
