/** In-memory ring buffer of real server events, surfaced on the settings page. */
export type EventLevel = 'info' | 'ok' | 'error';

export interface ServerEvent {
  id: number;
  at: string;
  source: string;
  level: EventLevel;
  message: string;
}

const MAX_EVENTS = 250;
const buffer: ServerEvent[] = [];
let seq = 0;

export function logEvent(source: string, level: EventLevel, message: string): void {
  seq += 1;
  buffer.push({ id: seq, at: new Date().toISOString(), source, level, message });
  if (buffer.length > MAX_EVENTS) buffer.splice(0, buffer.length - MAX_EVENTS);
  // Mirror to stdout so the terminal shows the same truth as the UI.
  const tag = level === 'error' ? 'ERR' : level === 'ok' ? 'OK ' : '   ';
  console.log(`[${tag}] [${source}] ${message}`);
}

export function recentEvents(limit = 60): ServerEvent[] {
  return buffer.slice(-Math.max(1, Math.min(limit, MAX_EVENTS)));
}
