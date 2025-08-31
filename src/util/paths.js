import { homedir } from 'node:os';
import path from 'node:path';

export function getCodexBaseDirs() {
  const env = process.env.CODEX_CONFIG_DIR?.trim();
  if (env) return env.split(',').map(p => path.resolve(p.trim())).filter(Boolean);
  const home = homedir();
  return [path.join(home, '.config', 'codex'), path.join(home, '.codex')];
}

export function getSessionRoots() {
  return getCodexBaseDirs().map(p => path.join(p, 'sessions'));
}

