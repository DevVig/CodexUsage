import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { watchSnapshots, loadCurrentBlockStats } from '../data/loader.js';

export async function runDashboard() {
  const screen = blessed.screen({ smartCSR: true, title: 'Codex Usage — Live' });
  const grid = new contrib.grid({ rows: 12, cols: 12, screen });

  const header = grid.set(0, 0, 2, 12, contrib.markdown, { label: 'Codex Usage — Live', markdown: '**Waiting for data…**' });
  const line = grid.set(2, 0, 6, 9, contrib.line, { label: 'Estimated Tokens / minute', showLegend: false, style: { line: 'cyan', text: 'white' } });
  const burnMini = grid.set(2, 9, 6, 3, contrib.sparkline, { label: 'Block Burn (last 60m)', tags: true });
  const gauge = grid.set(8, 0, 4, 3, contrib.gauge, { label: 'Cap Usage', stroke: 'green', fill: 'white' });
  const stats = grid.set(8, 3, 4, 5, contrib.table, { label: 'Summary', keys: true, interactive: false, columnWidth: [20, 20, 20] });
  const block = grid.set(8, 8, 4, 4, contrib.table, { label: 'Current Window', keys: true, interactive: false, columnWidth: [18, 22] });

  let flashTimer = null;
  let flashOn = false;
  function clearFlash() { if (flashTimer) { clearInterval(flashTimer); flashTimer = null; flashOn = false; } }

  const stop = await watchSnapshots(async (snap) => {
    const md = `Total est. tokens: ${snap.totalTokens.toLocaleString()}  |  Messages: ${snap.totalMessages.toLocaleString()}  |  Now: ${new Date().toLocaleTimeString()}`;
    header.setMarkdown(`### Codex Live Usage\n${md}`);

    const xs = snap.timeline.slice(-120).map(k => new Date(k).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' }));
    const ys = snap.points.slice(-120).map(p => p.tokens);
    line.setData([{ title: 'tokens', x: xs, y: ys }]);

    stats.setData({ headers: ['Metric', 'Value', 'Notes'], data: [
      ['Total tokens (est)', snap.totalTokens.toLocaleString(), 'Approx 4 chars/token'],
      ['Messages', snap.totalMessages.toLocaleString(), 'Parsed from JSONL'],
      ['Window', `${Math.max(0, ys.length)} min`, 'Last 2 hours max']
    ]});

    // Block window stats
    const s = await loadCurrentBlockStats();
    const remMins = Math.floor(s.remainingMs / 60000);
    const remStr = `${Math.floor(remMins/60)}h ${String(remMins%60).padStart(2,'0')}m`;
    const startStr = new Date(s.window.start).toLocaleTimeString();
    const endStr = new Date(s.window.end).toLocaleTimeString();
    const capStr = s.tokenLimit ? `${Math.round(s.percentOfLimit ?? 0)}% of ${s.tokenLimit.toLocaleString()}` : '—';
    const etaStr = s.etaMinutesToLimit != null ? `${Math.max(0, Math.floor(s.etaMinutesToLimit))}m` : '—';

    block.setData({ headers: ['Field', 'Value'], data: [
      ['Window size', `${s.window.windowHours}h (${startStr} → ${endStr})`],
      ['Time remaining', remStr],
      ['Tokens (est)', s.tokensInBlock.toLocaleString()],
      ['Burn rate', `${Math.round(s.burn.tokensPerMinute)}/min (last ${s.burn.windowMinutes}m)`],
      ['Cap usage', capStr],
      ['ETA to cap', etaStr],
    ]});

    // Mini burn chart
    const burnX = s.burnSeries.timeline.map(ts => new Date(ts).getMinutes());
    const burnY = s.burnSeries.values.map(v => Math.max(0, v));
    burnMini.setData(['tpm'], [burnY]);

    // Gauge color thresholds (env-configurable)
    const CAP_Y = Number(process.env.CODEX_CAP_YELLOW_PERCENT ?? '50');
    const CAP_R = Number(process.env.CODEX_CAP_RED_PERCENT ?? '80');
    const MIN_Y = Number(process.env.CODEX_CAP_YELLOW_MINUTES ?? '60');
    const MIN_R = Number(process.env.CODEX_CAP_RED_MINUTES ?? '30');
    let pct = Math.round(s.percentOfLimit ?? 0);
    if (!Number.isFinite(pct)) pct = 0;
    const mins = remMins;
    let color = 'green';
    if (pct >= CAP_R || mins <= MIN_R) color = 'red';
    else if (pct >= CAP_Y || mins <= MIN_Y) color = 'yellow';
    gauge.setStack([{ percent: pct, label: `${pct}%`, stroke: color }]);

    // Alert when critical
    const ALERT_MIN = Number(process.env.CODEX_ALERT_MINUTES ?? '15');
    const critical = color === 'red' || remMins <= ALERT_MIN;
    if (critical) {
      if (!flashTimer) {
        // optional extra bell on entry to critical
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
  });

  screen.key(['escape', 'q', 'C-c'], () => {
    stop();
    clearFlash();
    return process.exit(0);
  });

  screen.render();
}
