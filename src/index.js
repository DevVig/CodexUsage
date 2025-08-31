#!/usr/bin/env node
import { argv } from 'node:process';
import { runDashboard } from './tui/dashboard.js';
import { printDaily } from './reports/daily.js';
import { printMonthly } from './reports/monthly.js';
import { printSessions } from './reports/session.js';
import { printBlocks } from './reports/blocks.js';
import { printStatusline } from './reports/statusline.js';

async function main() {
  const cmd = argv[2] ?? 'dashboard';
  try {
    if (cmd === 'dashboard') {
      const poll = argv.includes('--poll');
      // Parse --interval=NNN or --interval NNN
      let intervalMs;
      for (let i = 3; i < argv.length; i++) {
        const a = argv[i];
        if (!a) continue;
        if (a.startsWith('--interval=')) intervalMs = Number(a.split('=')[1]);
        else if (a === '--interval' && argv[i+1]) intervalMs = Number(argv[i+1]);
      }
      await runDashboard({ poll, intervalMs });
    } else if (cmd === 'daily') {
      await printDaily();
    } else if (cmd === 'monthly') {
      await printMonthly();
    } else if (cmd === 'session' || cmd === 'sessions') {
      await printSessions();
    } else if (cmd === 'blocks') {
      const json = argv.includes('--json');
      await printBlocks({ json });
    } else if (cmd === 'statusline') {
      const json = argv.includes('--json');
      await printStatusline({ json });
    } else {
      console.log('codexusage <dashboard|daily|monthly|session|blocks|statusline> [--json]');
      process.exitCode = 2;
    }
  } catch (err) {
    console.error('codexusage error:', err?.message ?? String(err));
    process.exitCode = 1;
  }
}

main();
