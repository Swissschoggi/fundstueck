import process from 'node:process';
import { loadConfig } from './config.js';
import { createApp } from './app.js';

// Load .env when present (Node >= 20.12; silently skipped otherwise).
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch {
    /* no .env file — fine, env vars can come from the shell */
  }
}

const cfg = loadConfig();
const app = await createApp(cfg);

app.listen(cfg.port, () => {
  console.log(`[fundstueck] ${cfg.nodeEnv} server listening on http://localhost:${cfg.port}`);
});
