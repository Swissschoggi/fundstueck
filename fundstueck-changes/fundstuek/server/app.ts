import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { ServerConfig } from './config.js';
import { apiRouter, validationErrorHandler } from './api/router.js';
import { initRegistry } from './core/registry.js';
import { rateLimitMiddleware } from './core/rate-limit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createApp(cfg: ServerConfig): Promise<express.Express> {
  const app = express();
  app.disable('x-powered-by');
  // Behind a reverse proxy (Docker, Caddy, nginx, …) so req.ip and
  // req.secure reflect the real client — required for correct rate limiting.
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '64kb' }));

  // Baseline security headers for the API and the static frontend.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (cfg.nodeEnv === 'production') {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    }
    next();
  });

  // Request-rate guardrails. /api/search fans out to external marketplaces,
  // so an unauthenticated caller could otherwise turn this server into a
  // scraping amplifier and get its IP banned upstream.
  app.use('/api/search', rateLimitMiddleware({ scope: 'search', limit: 30, windowMs: 60_000 }));
  app.use('/api', rateLimitMiddleware({ scope: 'api', limit: 300, windowMs: 60_000 }));

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
  app.use(
    express.static(distDir, {
      setHeaders(res, filePath) {
        const base = path.basename(filePath);
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          // Content-hashed build output: cache for a year.
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (base === 'sw.js' || base === 'index.html') {
          // Must always be revalidated so app updates reach installed PWAs.
          res.setHeader('Cache-Control', 'no-cache');
        } else if (base === 'manifest.webmanifest') {
          res.setHeader('Content-Type', 'application/manifest+json');
          res.setHeader('Cache-Control', 'public, max-age=3600');
        }
      },
    }),
  );
  app.get('*', (_req, res, next) => {
    res.sendFile(path.join(distDir, 'index.html'), (err) => {
      if (err) next();
    });
  });

  return app;
}
