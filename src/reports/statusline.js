import { loadCurrentBlockStats } from '../data/loader.js';

function fmtMins(total) {
  const h = Math.floor(total / 60);
  const m = Math.max(0, Math.floor(total % 60));
  return `${h}h${String(m).padStart(2, '0')}m`;
}

export async function printStatusline({ json = false } = {}) {
  const s = await loadCurrentBlockStats();
  const remMins = Math.floor(s.remainingMs / 60000);
  const pct = s.percentOfLimit != null ? Math.round(s.percentOfLimit) : null;
  const eta = s.etaMinutesToLimit != null ? Math.max(0, Math.floor(s.etaMinutesToLimit)) : null;
  const burn = Math.round(s.burn.tokensPerMinute);

  if (json) {
    console.log(JSON.stringify({ remainingMinutes: remMins, percentOfLimit: pct, etaMinutesToLimit: eta, tokensPerMinute: burn }, null, 2));
    return;
  }

  const parts = [];
  if (pct != null) parts.push(`Cap ${pct}%`);
  if (eta != null) parts.push(`ETA ${eta}m`);
  parts.push(`Burn ${burn}/m`);
  parts.push(`Rem ${fmtMins(remMins)}`);

  console.log(parts.join(' | '));
}

