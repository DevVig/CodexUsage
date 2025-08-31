import { loadCurrentBlockStats } from '../data/loader.js';

export async function printBlocks({ json = false } = {}) {
  const s = await loadCurrentBlockStats();
  const remMins = Math.floor(s.remainingMs / 60000);
  if (json) {
    console.log(JSON.stringify({
      window: s.window,
      explicitResetMs: s.explicitResetMs ?? null,
      tokensInBlock: s.tokensInBlock,
      tokenLimit: s.tokenLimit ?? null,
      percentOfLimit: s.percentOfLimit ?? null,
      remainingMinutes: remMins,
      burn: { tokensPerMinute: Math.round(s.burn.tokensPerMinute), windowMinutes: s.burn.windowMinutes },
      etaMinutesToLimit: s.etaMinutesToLimit ?? null,
    }, null, 2));
    return;
  }

  const remStr = `${Math.floor(remMins/60)}h ${String(remMins%60).padStart(2,'0')}m`;
  const startStr = new Date(s.window.start).toISOString();
  const endStr = new Date(s.window.end).toISOString();
  console.log('Current Block');
  console.log(' windowHours:', s.window.windowHours);
  console.log(' start:', startStr);
  console.log(' end  :', endStr);
  console.log(' remaining:', remStr);
  console.log(' tokens (est):', s.tokensInBlock);
  console.log(' burn rate (tpm):', Math.round(s.burn.tokensPerMinute));
  if (s.tokenLimit) {
    console.log(' cap:', s.tokenLimit);
    console.log(' cap usage %:', Math.round(s.percentOfLimit ?? 0));
    console.log(' ETA to cap (min):', Math.floor(s.etaMinutesToLimit ?? 0));
  }
}
