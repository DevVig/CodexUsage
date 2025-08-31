import { listSessionFiles, parseJsonlFile } from '../data/loader.js';

export async function printSessions() {
  const files = await listSessionFiles(200);
  const rows = [];
  for (const f of files.slice(-20)) { // show last 20
    const parts = f.split('/').slice(-4).join('/');
    const lines = await parseJsonlFile(f);
    const first = lines.find(l => l.timestamp) ?? null;
    const when = first?.timestamp ? new Date(first.timestamp).toLocaleString() : '-';
    rows.push({ file: parts, entries: lines.length, started: when });
  }
  console.log('Recent Sessions');
  for (const r of rows) {
    console.log(`- ${r.file} | entries: ${r.entries} | started: ${r.started}`);
  }
}

