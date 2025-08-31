import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { watchSnapshots } from '../data/loader.js';

export async function runDashboard() {
  const screen = blessed.screen({ smartCSR: true, title: 'Codex Usage — Live' });
  const grid = new contrib.grid({ rows: 12, cols: 12, screen });

  const header = grid.set(0, 0, 2, 12, contrib.markdown, { label: 'Codex Usage — Live', markdown: '**Waiting for data…**' });
  const line = grid.set(2, 0, 6, 12, contrib.line, { label: 'Estimated Tokens / minute', showLegend: false, style: { line: 'cyan', text: 'white' } });
  const stats = grid.set(8, 0, 4, 12, contrib.table, { label: 'Summary', keys: true, interactive: false, columnWidth: [20, 20, 20] });

  const stop = await watchSnapshots((snap) => {
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

    screen.render();
  });

  screen.key(['escape', 'q', 'C-c'], () => {
    stop();
    return process.exit(0);
  });

  screen.render();
}
