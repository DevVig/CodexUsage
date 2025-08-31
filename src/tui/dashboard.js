import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { watchSnapshots, periodicSnapshot, loadCurrentBlockStats, loadRecentEvents, loadDailyReport } from '../data/loader.js';
import { getTheme } from './theme.js';
import { loadConfig, saveConfig, applyProfileEnv } from '../util/config.js';

function getTerminalName() {
  const envTerm = process.env.CODEX_TERM || process.env.TERM || '';
  if (/ghostty/i.test(envTerm)) return 'xterm-256color';
  return envTerm || 'xterm-256color';
}

export async function runDashboard(options = {}) {
  const poll = options.poll === true;
  let debug = options.debug === true;
  const intervalMs = Number(options.intervalMs ?? process.env.CODEX_POLL_INTERVAL_MS ?? '1000');
  let userConfig = await loadConfig();
  let themeName = userConfig.theme || process.env.CODEX_THEME || 'default';
  let theme = getTheme(themeName);

  // Dynamic controls
  let windowHours = Number(userConfig.windowHours ?? process.env.CODEX_BLOCK_WINDOW_HOURS ?? '5');
  let burnWindowMinutes = Number(userConfig.burnWindowMinutes ?? process.env.CODEX_BURN_WINDOW_MINUTES ?? '10');
  let anchor = (userConfig.anchor ?? process.env.CODEX_WINDOW_ANCHOR ?? 'rolling'); // 'rolling' | 'epoch'
  let compact = false;
  let latestSnap = null;
  let smoothing = Boolean(userConfig.smoothing ?? false);
  const windowPresets = [1, 3, 5, 12, 24];

  // Profiles
  let profiles = Array.isArray(userConfig.profiles) ? userConfig.profiles : [];
  let profileIndex = Number.isInteger(userConfig.profileIndex) ? userConfig.profileIndex : 0;
  applyProfileEnv(profiles, profileIndex);

  const screen = blessed.screen({ smartCSR: true, title: 'Codex Usage — Live', terminal: getTerminalName() });
  let grid;
  let header, line, burnMini, gauge, statsOrEvents, block, helpBox, hintBar;

  function buildLayout() {
    screen.children.forEach(c => c.destroy());
    grid = new contrib.grid({ rows: 12, cols: 12, screen });
    const w = screen.width || 120;
    const compactBySize = w < 100;
    compact = compact || compactBySize;

    header = grid.set(0, 0, 2, 12, contrib.markdown, { label: 'Codex Usage — Live', markdown: '**Waiting for data…**' });

    if (compact) {
      line = grid.set(2, 0, 6, 12, contrib.line, { label: 'Tokens/min', showLegend: false, style: { line: theme.lineColor, text: theme.textColor } });
      statsOrEvents = grid.set(8, 0, 4, 12, contrib.table, { label: debug ? 'Recent Events' : 'Summary', keys: false, interactive: false, columnWidth: debug ? [12, 10, 10, 20] : [20, 20, 20] });
      burnMini = null; gauge = null; block = null;
    } else if (w < 140) {
      line = grid.set(2, 0, 6, 12, contrib.line, { label: 'Estimated Tokens / minute', showLegend: false, style: { line: theme.lineColor, text: theme.textColor } });
      statsOrEvents = grid.set(8, 0, 4, 7, contrib.table, { label: debug ? 'Recent Events' : 'Summary', keys: false, interactive: false, columnWidth: debug ? [12, 10, 10, 20] : [20, 20, 20] });
      block = grid.set(8, 7, 4, 5, contrib.table, { label: 'Current Window', keys: false, interactive: false, columnWidth: [18, 22] });
      burnMini = null; gauge = null;
    } else {
      line = grid.set(2, 0, 6, 9, contrib.line, { label: 'Estimated Tokens / minute', showLegend: false, style: { line: theme.lineColor, text: theme.textColor } });
      burnMini = grid.set(2, 9, 6, 3, contrib.sparkline, { label: 'Block Burn (last 60m)', tags: true });
      gauge = grid.set(8, 0, 4, 3, contrib.gauge, { label: 'Cap Usage', stroke: theme.gauge.stroke, fill: theme.gauge.fill });
      statsOrEvents = grid.set(8, 3, 4, 5, contrib.table, { label: debug ? 'Recent Events' : 'Summary', keys: false, interactive: false, columnWidth: debug ? [12, 10, 10, 20] : [20, 20, 20] });
      block = grid.set(8, 8, 4, 4, contrib.table, { label: 'Current Window', keys: false, interactive: false, columnWidth: [18, 22] });
    }

    hintBar = blessed.box({ bottom: 0, height: 1, width: '100%', tags: true, style: { fg: theme.accent }, content: 'Keys: q Quit | h Help | d Debug | c Compact | w Anchor | +/- Window | [/] Burn | r Refresh' });
    screen.append(hintBar);
  }

  let flashTimer = null;
  let flashOn = false;
  function clearFlash() { if (flashTimer) { clearInterval(flashTimer); flashTimer = null; flashOn = false; } }

  buildLayout();

  const onUpdate = async (snap) => {
    latestSnap = snap;
    const status = `(${anchor}) ${poll ? 'poll' : 'fs'} | ${themeName} | W:${windowHours}h B:${burnWindowMinutes}m`;
    const md = `Total est. tokens: ${snap.totalTokens.toLocaleString()}  |  Msgs: ${snap.totalMessages.toLocaleString()}  |  ${status}  |  ${new Date().toLocaleTimeString()}`;
    header.setMarkdown(`### Codex Live Usage\n${md}`);

    const xs = snap.timeline.slice(-120).map(k => new Date(k).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' }));
    const base = snap.points.slice(-120).map(p => p.tokens);
    let ys = base;
    if (smoothing && base.length > 2) {
      const alpha = 0.2;
      let prev = base[0];
      const ema = base.map((v, i) => {
        if (i === 0) return v;
        prev = alpha * v + (1 - alpha) * prev;
        return prev;
      });
      // Plot both series for better context
      const showLegend = (screen.width || 120) >= 120;
      line.setData([
        { title: 'tokens', x: xs, y: base },
        { title: 'EMA', x: xs, y: ema },
      ]);
      if (line.options) line.options.showLegend = showLegend;
    } else {
      const showLegend = false;
      line.setData([{ title: 'tokens', x: xs, y: ys }]);
      if (line.options) line.options.showLegend = showLegend;
    }
    if (line.options) {
      line.options.style = { line: theme.lineColor, text: theme.textColor, baseline: 'black' };
      line.options.xLabelPadding = 2;
      line.options.xPadding = 4;
      line.options.wholeNumbersOnly = false;
    }

    if (statsOrEvents) {
      if (!debug) {
        statsOrEvents.setData({ headers: ['Metric', 'Value', 'Notes'], data: [
          ['Total tokens (est)', snap.totalTokens.toLocaleString(), 'Approx 4 chars/token'],
          ['Messages', snap.totalMessages.toLocaleString(), 'Parsed from JSONL'],
          ['Window', `${Math.max(0, ys.length)} min`, 'Last 2 hours max']
        ]});
      } else {
        const evs = await loadRecentEvents({ withinMinutes: 15, max: 10 });
        const rows = evs.map(e => [e.time, String(e.tokens), e.type, e.file]);
        statsOrEvents.setData({ headers: ['Time', 'Tokens', 'Type', 'File'], data: rows });
      }
    }

    const s = await loadCurrentBlockStats({ windowHours, burnWindowMinutes, anchor });
    const remMins = Math.floor(s.remainingMs / 60000);
    const remStr = `${Math.floor(remMins/60)}h ${String(remMins%60).padStart(2,'0')}m`;
    const startStr = new Date(s.window.start).toLocaleTimeString();
    const endStr = new Date(s.window.end).toLocaleTimeString();
    const capStr = s.tokenLimit ? `${Math.round(s.percentOfLimit ?? 0)}% of ${s.tokenLimit.toLocaleString()}` : '—';
    const etaStr = s.etaMinutesToLimit != null ? `${Math.max(0, Math.floor(s.etaMinutesToLimit))}m` : '—';

    if (block) {
      block.setData({ headers: ['Field', 'Value'], data: [
        ['Window size', `${s.window.windowHours}h (${startStr} → ${endStr})`],
        ['Time remaining', remStr],
        ['Tokens (est)', s.tokensInBlock.toLocaleString()],
        ['Burn rate', `${Math.round(s.burn.tokensPerMinute)}/min (last ${s.burn.windowMinutes}m)`],
        ['Cap usage', capStr],
        ['ETA to cap', etaStr],
      ]});
    }

    if (burnMini) {
      const burnY = s.burnSeries.values.map(v => Math.max(0, v));
      burnMini.setData(['tpm'], [burnY]);
    }

    // Gauge color thresholds
    const CAP_Y = Number(process.env.CODEX_CAP_YELLOW_PERCENT ?? '50');
    const CAP_R = Number(process.env.CODEX_CAP_RED_PERCENT ?? '80');
    const MIN_Y = Number(process.env.CODEX_CAP_YELLOW_MINUTES ?? '60');
    const MIN_R = Number(process.env.CODEX_CAP_RED_MINUTES ?? '30');
    let pct = Math.round(s.percentOfLimit ?? 0);
    if (!Number.isFinite(pct)) pct = 0;
    const mins = remMins;
    let color = theme.gauge.stroke || 'green';
    if (pct >= CAP_R || mins <= MIN_R) color = 'red';
    else if (pct >= CAP_Y || mins <= MIN_Y) color = 'yellow';
    if (gauge) gauge.setStack([{ percent: pct, label: `${pct}%`, stroke: color }]);

    const ALERT_MIN = Number(process.env.CODEX_ALERT_MINUTES ?? (userConfig.alertMinutes ?? 15));
    const critical = color === 'red' || remMins <= ALERT_MIN;
    if (critical) {
      if (!flashTimer) {
        if (process.env.CODEX_ALERT_BELL === '1') screen.program.bell();
        flashTimer = setInterval(() => {
          flashOn = !flashOn;
          const title = flashOn ? '### Codex Live Usage — ALERT' : '### Codex Live Usage';
          header.setMarkdown(`${title}\n${md}`);
          screen.render();
        }, 1000);
      }
    } else {
      clearFlash();
      header.setMarkdown(`### Codex Live Usage\n${md}`);
    }

    screen.render();
  };

  let stop = poll ? await periodicSnapshot(intervalMs, onUpdate) : await watchSnapshots(onUpdate);

  screen.key(['escape', 'q', 'C-c'], () => { stop(); clearFlash(); return process.exit(0); });

  function rebuildAndRender() { buildLayout(); if (latestSnap) void onUpdate(latestSnap); else screen.render(); }

  async function restartWatcher() {
    if (stop) { try { await stop(); } catch {} }
    stop = poll ? await periodicSnapshot(intervalMs, onUpdate) : await watchSnapshots(onUpdate);
  }

  // Key bindings
  screen.key(['h'], () => {
    if (helpBox && !helpBox.hidden) { helpBox.hide(); screen.render(); return; }
    helpBox = blessed.box({ top: 'center', left: 'center', width: '70%', height: '70%', border: 'line', tags: true,
      label: 'Help', style: { border: { fg: theme.accent } }, content:
`Keys:\n q Quit  |  h Help  |  d Toggle debug  |  c Toggle compact\n w Toggle window anchor (rolling/epoch)  |  +/- Change window hours\n [ ] Change burn window minutes  |  r Force refresh\n\nUse --poll for polling mode, --debug for recent events panel.\nEnvironment variables documented in README.` });
    screen.append(helpBox); screen.render();
  });
  screen.key(['d'], () => { debug = !debug; rebuildAndRender(); });
  screen.key(['c'], () => { compact = !compact; rebuildAndRender(); });
  screen.key(['w'], () => { anchor = anchor === 'rolling' ? 'epoch' : 'rolling'; if (latestSnap) void onUpdate(latestSnap); });
  screen.key(['+'], () => { windowHours = Math.min(24, Math.max(1, windowHours + 1)); if (latestSnap) void onUpdate(latestSnap); });
  screen.key(['-'], () => { windowHours = Math.min(24, Math.max(1, windowHours - 1)); if (latestSnap) void onUpdate(latestSnap); });
  screen.key([']'], () => { burnWindowMinutes = Math.min(120, Math.max(1, burnWindowMinutes + 1)); if (latestSnap) void onUpdate(latestSnap); });
  screen.key(['['], () => { burnWindowMinutes = Math.min(120, Math.max(1, burnWindowMinutes - 1)); if (latestSnap) void onUpdate(latestSnap); });
  screen.key(['r'], () => { if (latestSnap) void onUpdate(latestSnap); });

  // Theme cycle (T)
  screen.key(['T'], async () => {
    const order = ['default', 'solarized', 'mono'];
    const idx = order.indexOf(themeName);
    themeName = order[(idx + 1) % order.length];
    theme = getTheme(themeName);
    userConfig.theme = themeName;
    await saveConfig(userConfig);
    rebuildAndRender();
  });

  // Window presets cycle (W)
  screen.key(['W'], async () => {
    const i = windowPresets.indexOf(windowHours);
    windowHours = windowPresets[(i + 1) % windowPresets.length];
    userConfig.windowHours = windowHours;
    await saveConfig(userConfig);
    if (latestSnap) void onUpdate(latestSnap);
  });

  // Smoothing toggle (S)
  screen.key(['S'], async () => {
    smoothing = !smoothing;
    userConfig.smoothing = smoothing;
    await saveConfig(userConfig);
    if (latestSnap) void onUpdate(latestSnap);
  });

  // Profiles cycle (P)
  screen.key(['P'], async () => {
    if (!profiles || profiles.length === 0) return;
    profileIndex = (profileIndex + 1) % profiles.length;
    userConfig.profileIndex = profileIndex;
    await saveConfig(userConfig);
    applyProfileEnv(profiles, profileIndex);
    await restartWatcher();
  });

  // Export (E): blocks JSON + daily CSV
  screen.key(['E'], async () => {
    try {
      const s = await loadCurrentBlockStats({ windowHours, burnWindowMinutes, anchor });
      const daily = await loadDailyReport();
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
      const fs = await import('node:fs/promises');
      await fs.writeFile(`blocks-${stamp}.json`, JSON.stringify(s, null, 2));
      const header = 'date,tokens_est,messages\n';
      const rows = daily.map(r => `${r.date},${r.tokens},${r.messages}`).join('\n');
      await fs.writeFile(`daily-${stamp}.csv`, header + rows + '\n');
      screen.program.bell();
    } catch {}
  });

  screen.on('resize', () => { rebuildAndRender(); });

  screen.render();
}
