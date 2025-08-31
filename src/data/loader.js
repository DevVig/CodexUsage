import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'tinyglobby';
import chokidar from 'chokidar';
import { getSessionRoots } from '../util/paths.js';

// Very lightweight JSONL reader and aggregator for Codex sessions.
// Codex JSONL does not include token usage yet, so we estimate tokens by character length.

function estimateTokensFromText(text) {
  if (!text) return 0;
  // crude heuristic ~ 4 chars per token average
  return Math.max(0, Math.round(text.length / 4));
}

export async function listSessionFiles(limit = 5000) {
  const roots = getSessionRoots();
  const patterns = roots.map(r => path.join(r, '**', '*.jsonl').replaceAll('\\', '/'));
  const files = await glob(patterns, { absolute: true });
  // sort newest last-modified first
  const stats = await Promise.all(files.map(async f => ({ f, mtime: (await fsp.stat(f)).mtimeMs })));
  stats.sort((a, b) => a.mtime - b.mtime);
  return stats.slice(-limit).map(s => s.f);
}

export async function parseJsonlFile(file) {
  try {
    const content = await fsp.readFile(file, 'utf8');
    return content.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

export async function loadAllEvents() {
  const files = await listSessionFiles();
  const all = [];
  for (const f of files) {
    const rows = await parseJsonlFile(f);
    for (const r of rows) {
      all.push({ file: f, ...r });
    }
  }
  return all;
}

export function accumulateMetrics(events) {
  // Build per-minute buckets for live graphs, crude token estimate from message text
  const byMinute = new Map();
  let totalTokens = 0;
  let totalMessages = 0;

  for (const ev of events) {
    const ts = ev.timestamp ?? ev.ts ? new Date((ev.timestamp ?? (ev.ts * 1000))) : null;
    const minuteKey = ts ? new Date(ts.getFullYear(), ts.getMonth(), ts.getDate(), ts.getHours(), ts.getMinutes(), 0, 0).toISOString() : null;

    let tokens = 0;
    if (ev.type === 'message' && Array.isArray(ev.content)) {
      for (const c of ev.content) {
        if (typeof c.text === 'string') tokens += estimateTokensFromText(c.text);
      }
      totalMessages += 1;
    } else if (typeof ev.text === 'string') {
      tokens += estimateTokensFromText(ev.text);
    }

    totalTokens += tokens;
    if (minuteKey) {
      const prev = byMinute.get(minuteKey) ?? { tokens: 0, messages: 0 };
      byMinute.set(minuteKey, { tokens: prev.tokens + tokens, messages: prev.messages + (tokens > 0 ? 1 : 0) });
    }
  }

  // Convert map to sorted arrays
  const keys = Array.from(byMinute.keys()).sort();
  const series = keys.map(k => byMinute.get(k) ?? { tokens: 0, messages: 0 });
  return { totalTokens, totalMessages, timeline: keys, points: series };
}

export async function loadSnapshot() {
  const events = await loadAllEvents();
  return accumulateMetrics(events);
}

// Low-latency snapshot updates: chokidar filesystem watch + debounced refresh.
export async function watchSnapshots(onUpdate, { debounceMs = 300 } = {}) {
  // initial emit
  try { onUpdate(await loadSnapshot()); } catch {}

  const roots = getSessionRoots();
  const watcher = chokidar.watch(roots.map(r => path.join(r, '**/*.jsonl')), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });

  let pending = false;
  let timer;
  async function schedule() {
    if (pending) return;
    pending = true;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      pending = false;
      try { onUpdate(await loadSnapshot()); } catch {}
    }, debounceMs);
  }

  watcher.on('add', schedule).on('change', schedule).on('unlink', schedule);
  return async () => { clearTimeout(timer); await watcher.close(); };
}

export async function loadDailyReport() {
  const events = await loadAllEvents();
  const byDate = new Map();
  for (const ev of events) {
    let key;
    const ts = ev.timestamp ?? (ev.ts ? new Date(ev.ts * 1000).toISOString() : null);
    if (ts) {
      const d = new Date(ts);
      key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    } else if (typeof ev.file === 'string') {
      const parts = ev.file.split(path.sep);
      const si = parts.findIndex(p => p === 'sessions');
      if (si >= 0 && parts.length > si + 3) {
        const [yyyy, mm, dd] = [parts[si+1], parts[si+2], parts[si+3]];
        if (yyyy && mm && dd) key = `${yyyy}-${mm}-${dd}`;
      }
    }
    if (!key) continue;

    let tokens = 0;
    if (ev.type === 'message' && Array.isArray(ev.content)) {
      for (const c of ev.content) if (typeof c.text === 'string') tokens += estimateTokensFromText(c.text);
    } else if (typeof ev.text === 'string') {
      tokens += estimateTokensFromText(ev.text);
    }

    const prev = byDate.get(key) ?? { tokens: 0, messages: 0 };
    byDate.set(key, { tokens: prev.tokens + tokens, messages: prev.messages + (tokens > 0 ? 1 : 0) });
  }
  const rows = Array.from(byDate.entries()).map(([date, v]) => ({ date, ...v }));
  rows.sort((a,b) => a.date.localeCompare(b.date));
  return rows;
}
