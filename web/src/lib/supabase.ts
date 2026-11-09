import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || 'https://xdyewakhzjnmpzhzhehl.supabase.co';
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_NlWBlKCz5PlkCS7HBeI6mw_NoYKi2RC';

export const supabase = createClient(url, key);
export const hasSupabase = Boolean(url && key);