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

function tokensFromEvent(ev) {
  const usage = ev?.message?.usage;
  if (usage && (typeof usage.input_tokens === 'number' || typeof usage.output_tokens === 'number')) {
    const input = usage.input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    const ccreate = usage.cache_creation_input_tokens ?? 0;
    const cread = usage.cache_read_input_tokens ?? 0;
    return input + output + ccreate + cread;
  }
  let tokens = 0;
  // message with content array
  if (ev.type === 'message' && Array.isArray(ev.content)) {
    for (const c of ev.content) {
      if (typeof c.text === 'string') tokens += estimateTokensFromText(c.text);
    }
  }
  // simple text
  if (typeof ev.text === 'string') {
    tokens += estimateTokensFromText(ev.text);
  }
  // function_call_output: may carry large output text in 'output' string (sometimes JSON-stringified)
  if (ev.type === 'function_call_output' && typeof ev.output === 'string') {
    let payload = ev.output;
    try {
      const parsed = JSON.parse(ev.output);
      if (parsed && typeof parsed.output === 'string') payload = parsed.output;
    } catch { /* keep raw string */ }
    tokens += estimateTokensFromText(payload);
  }
  // reasoning with summary array containing { type: 'summary_text', text }
  if (ev.type === 'reasoning' && Array.isArray(ev.summary)) {
    for (const s of ev.summary) {
      if (typeof s?.text === 'string') tokens += estimateTokensFromText(s.text);
    }
  }
  return tokens;
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
    let lastTs = null;
    return content.split('\n').filter(Boolean).map(line => {
      try {
        const obj = JSON.parse(line);
        // Normalize timestamp: prefer ISO in obj.timestamp; else 'ts' seconds; else carry forward lastTs; else file mtime
        let ts = null;
        if (typeof obj.timestamp === 'string') {
          ts = obj.timestamp;
        } else if (typeof obj.ts === 'number') {
          ts = new Date(obj.ts * 1000).toISOString();
        } else if (lastTs != null) {
          ts = lastTs;
        }
        if (ts == null) {
          // fallback to file mtime on first unknown
          try {
            const st = fs.statSync(file);
            ts = new Date(st.mtimeMs).toISOString();
          } catch { /* ignore */ }
        }
        if (ts) obj.timestamp = ts;
        if (ts) lastTs = ts;
        return obj;
      } catch { return null; }
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

    let tokens = tokensFromEvent(ev);
    if (ev.type === 'message' && Array.isArray(ev.content)) {
      totalMessages += 1;
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

function extractCandidateTimestampsFromText(text) {
  const candidates = [];
  if (!text || typeof text !== 'string') return candidates;
  // ccusage-style: "Claude AI usage limit reached |<epochSeconds>"
  {
    const m = text.match(/\|(\d{10})(?:\b|$)/);
    if (m) candidates.push(Number(m[1]) * 1000);
  }
  // Generic: look for 10-digit epoch seconds near words reset/limit
  if (/limit|reset|window|quota/i.test(text)) {
    const ms = text.match(/\b(1\d{9})\b/g);
    if (ms) for (const s of ms) candidates.push(Number(s) * 1000);
  }
  return candidates;
}

function findLatestResetTimestamp(events) {
  let best = null;
  for (const ev of events) {
    const texts = [];
    if (typeof ev.text === 'string') texts.push(ev.text);
    if (ev.content && Array.isArray(ev.content)) {
      for (const c of ev.content) if (typeof c.text === 'string') texts.push(c.text);
    }
    for (const t of texts) {
      const times = extractCandidateTimestampsFromText(t);
      for (const ts of times) {
        if (Number.isFinite(ts) && (best == null || ts > best)) best = ts;
      }
    }
  }
  return best; // ms epoch or null
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

// Polling fallback for environments with unreliable FS events
export async function periodicSnapshot(intervalMs, onUpdate) {
  let timer;
  let stopped = false;
  async function tick() {
    if (stopped) return;
    try { onUpdate(await loadSnapshot()); } catch {}
    timer = setTimeout(tick, intervalMs);
  }
  // initial emit
  try { onUpdate(await loadSnapshot()); } catch {}
  tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
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

    const tokens = tokensFromEvent(ev);

    const prev = byDate.get(key) ?? { tokens: 0, messages: 0 };
    byDate.set(key, { tokens: prev.tokens + tokens, messages: prev.messages + (tokens > 0 ? 1 : 0) });
  }
  const rows = Array.from(byDate.entries()).map(([date, v]) => ({ date, ...v }));
  rows.sort((a,b) => a.date.localeCompare(b.date));
  return rows;
}

// Compute current block stats (e.g., 5-hour window), optional soft cap.
export async function loadCurrentBlockStats({
  windowHours = Number(process.env.CODEX_BLOCK_WINDOW_HOURS ?? '5'),
  tokenLimit = process.env.CODEX_BLOCK_TOKEN_LIMIT ? Number(process.env.CODEX_BLOCK_TOKEN_LIMIT) : undefined,
  burnWindowMinutes = Number(process.env.CODEX_BURN_WINDOW_MINUTES ?? '10'),
  anchor = (process.env.CODEX_WINDOW_ANCHOR ?? 'rolling'), // 'rolling' | 'epoch'
} = {}) {
  const events = await loadAllEvents();
  const now = Date.now();
  const windowMs = windowHours * 60 * 60 * 1000;
  // Prefer explicit reset timestamps if present
  const explicitResetMs = findLatestResetTimestamp(events);
  let start;
  let end;
  if (explicitResetMs && explicitResetMs > now - windowMs && explicitResetMs > now) {
    // If we have an upcoming reset within the plausible window, use it as end
    end = explicitResetMs;
    start = end - windowMs;
  } else {
    if (anchor === 'epoch') {
      // Align to epoch buckets
      start = Math.floor(now / windowMs) * windowMs;
      end = start + windowMs;
    } else {
      // Rolling window: last N hours up to now
      end = now;
      start = end - windowMs;
    }
  }

  let tokensInBlock = 0;
  const burnStart = now - burnWindowMinutes * 60 * 1000;
  let tokensInBurnWindow = 0;

  for (const ev of events) {
    const tsMs = ev.timestamp ? Date.parse(ev.timestamp) : (ev.ts ? ev.ts * 1000 : undefined);
    if (!tsMs) continue;
    if (tsMs >= start && tsMs < end) {
      const t = tokensFromEvent(ev);
      tokensInBlock += t;
      if (tsMs >= burnStart) tokensInBurnWindow += t;
    }
  }

  const minutes = Math.max(1, (now - burnStart) / 60000);
  const tokensPerMinute = tokensInBurnWindow / minutes;
  const remainingMs = Math.max(0, end - now);
  const percentOfLimit = tokenLimit ? Math.min(100, (tokensInBlock / tokenLimit) * 100) : undefined;
  const minutesToHitLimit = tokenLimit && tokensPerMinute > 0
    ? Math.max(0, (tokenLimit - tokensInBlock) / tokensPerMinute)
    : undefined;

  // Build a short burn series for mini-chart (last 60 min)
  const seriesStart = now - 60 * 60000;
  const perMinute = new Map();
  for (const ev of events) {
    const tsMs = ev.timestamp ? Date.parse(ev.timestamp) : (ev.ts ? ev.ts * 1000 : undefined);
    if (!tsMs || tsMs < seriesStart) continue;
    const t = tokensFromEvent(ev);
    const bucket = Math.floor(tsMs / 60000) * 60000;
    perMinute.set(bucket, (perMinute.get(bucket) ?? 0) + t);
  }
  const burnTimeline = Array.from({ length: 60 }).map((_, i) => seriesStart + i * 60000);
  const burnValues = burnTimeline.map(ts => perMinute.get(ts) ?? 0);

  return {
    window: { start, end, windowHours },
    tokensInBlock,
    tokenLimit,
    percentOfLimit,
    remainingMs,
    burn: { tokensPerMinute, windowMinutes: burnWindowMinutes },
    etaMinutesToLimit: minutesToHitLimit,
    burnSeries: { timeline: burnTimeline, values: burnValues },
    explicitResetMs,
  };
}

export async function loadRecentEvents({ withinMinutes = 10, max = 20 } = {}) {
  const events = await loadAllEvents();
  const now = Date.now();
  const since = now - withinMinutes * 60000;
  const recent = [];
  for (const ev of events) {
    const tsMs = ev.timestamp ? Date.parse(ev.timestamp) : (ev.ts ? ev.ts * 1000 : undefined);
    if (!tsMs || tsMs < since) continue;
    const tokens = tokensFromEvent(ev);
    recent.push({
      ts: tsMs,
      tokens,
      type: ev.type ?? ev.record_type ?? 'unknown',
      file: ev.file ?? '',
    });
  }
  recent.sort((a, b) => a.ts - b.ts);
  const trimmed = recent.slice(-max);
  return trimmed.map(r => ({
    time: new Date(r.ts).toLocaleTimeString(),
    tokens: r.tokens,
    type: r.type,
    file: r.file.split('/').slice(-1)[0] ?? '',
  }));
}
