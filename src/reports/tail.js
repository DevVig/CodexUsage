import { loadRecentEvents } from '../data/loader.js';

export async function printTail({ minutes = 15, max = 20, json = false } = {}) {
  const evs = await loadRecentEvents({ withinMinutes: minutes, max });
  if (json) {
    console.log(JSON.stringify(evs, null, 2));
    return;
  }
  if (evs.length === 0) {
    console.log('No recent token-bearing events found.');
    return;
  }
  console.log('Time, Tokens, Type, File');
  for (const e of evs) {
    console.log(`${e.time}, ${e.tokens}, ${e.type}, ${e.file}`);
  }
}

