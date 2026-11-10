import { createRequire } from 'node:module';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

export const hasSupabase = Boolean(url && key);

let client: SupabaseClient | null = null;
if (hasSupabase) {
  const require = createRequire(import.meta.url);
  const WebSocket = require('ws');
  client = createClient(url!, key!, { realtime: { transport: WebSocket } });
}

export const supabase = client;
