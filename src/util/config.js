import { homedir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

function getConfigPath() {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  const dir = path.join(xdg, 'codexusage');
  return { dir, file: path.join(dir, 'config.json') };
}

export async function loadConfig() {
  const { file } = getConfigPath();
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function saveConfig(cfg) {
  const { dir, file } = getConfigPath();
  try { await fsp.mkdir(dir, { recursive: true }); } catch {}
  await fsp.writeFile(file, JSON.stringify(cfg, null, 2), 'utf8');
}

export function applyProfileEnv(profiles, index) {
  if (!Array.isArray(profiles) || profiles.length === 0) return;
  const p = profiles[index % profiles.length];
  if (typeof p === 'string' && p.trim() !== '') {
    process.env.CODEX_CONFIG_DIR = p;
  }
}

