#!/usr/bin/env node
import { argv } from 'node:process';
import { runDashboard } from './tui/dashboard.js';
import { printDaily } from './reports/daily.js';
import { printMonthly } from './reports/monthly.js';
import { printSessions } from './reports/session.js';

async function main() {
  const cmd = argv[2] ?? 'dashboard';
  try {
    if (cmd === 'dashboard') {
      await runDashboard();
    } else if (cmd === 'daily') {
      await printDaily();
    } else if (cmd === 'monthly') {
      await printMonthly();
    } else if (cmd === 'session' || cmd === 'sessions') {
      await printSessions();
    } else {
      console.log('codexusage <dashboard|daily|monthly|session>');
      process.exitCode = 2;
    }
  } catch (err) {
    console.error('codexusage error:', err?.message ?? String(err));
    process.exitCode = 1;
  }
}

main();

