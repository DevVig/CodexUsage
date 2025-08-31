import { loadSnapshot } from '../data/loader.js';

export async function printMonthly() {
  // Placeholder: monthly aggregation will be added after we persist daily bins
  const snap = await loadSnapshot();
  console.log('Codex Monthly (approx)');
  console.log('- Total tokens (est):', snap.totalTokens.toLocaleString());
  console.log('- Messages:', snap.totalMessages.toLocaleString());
  console.log('(Note) Add precise monthly bins once token logging is available.');
}

