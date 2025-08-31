import { loadDailyReport } from '../data/loader.js';

export async function printDaily() {
  const rows = await loadDailyReport();
  if (rows.length === 0) {
    console.log('No Codex usage found.');
    return;
  }
  console.log('Date, Tokens (est), Messages');
  for (const r of rows) {
    console.log(`${r.date}, ${r.tokens}, ${r.messages}`);
  }
}
