import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || 'https://xdyewakhzjnmpzhzhehl.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_NlWBlKCz5PlkCS7HBeI6mw_NoYKi2RC';

export const supabase = createClient(url, key);
export const hasSupabase = Boolean(url && key);