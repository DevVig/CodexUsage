# CodexUsage

CodexUsage is a lightweight CLI + TUI that reads Codex session JSONL logs under `~/.codex/sessions/**` and provides:

- Live dashboard with charts and auto-refresh
- Daily and session reports (monthly coming as logs improve)
- Always-on terminal window for continuous visibility

This is inspired by ccusage’s approach (local JSONL ingestion, fast aggregation), adapted for Codex.

## Install

- Node 18+ (Node 20+ recommended)

```
npm install
```

## Run

- Live dashboard (auto-refreshing chart)
```
npm run dashboard
# Polling fallback (e.g., network FS)
node src/index.js dashboard --poll --interval=1000
# Ghostty/terminfo note: if you see Setulc errors, run with
#   CODEX_TERM=xterm-256color node src/index.js dashboard
# or set TERM=xterm-256color for this process.
# Interactive keys (terminal):
#  h Help   d Toggle debug   c Compact
#  w Anchor rolling/epoch    + / - Window hours
#  [ / ] Burn window minutes  r Refresh
#  T Theme cycle              W Window presets (1/3/5/12/24h)
#  S Smoothing (EMA)          P Profile cycle (CODEX_CONFIG_DIR presets)
#  E Export (blocks.json + daily.csv)   q Quit
```
- Daily summary
```
node src/index.js daily
```
- Recent sessions
```
node src/index.js session
```

- Statusline (compact, for prompts/hooks)
```
node src/index.js statusline
node src/index.js statusline --json | jq
```

- Current window (CLI) — human-readable
```
node src/index.js blocks
```

- Current window (CLI) — JSON for scripting
```
node src/index.js blocks --json | jq
```

Tip: Keep the dashboard open in a dedicated terminal for continuous monitoring.

## Data source

- Default: `~/.codex/sessions/**.jsonl` and `~/.codex/history.jsonl`
- Override base dir(s): set `CODEX_CONFIG_DIR` (comma-separated list supported)

## Notes on accuracy

Codex logs currently don’t include token counts or model names. CodexUsage estimates tokens from text length (~4 chars ≈ 1 token). Once Codex logs add `message.model` and `message.usage.*`, CodexUsage will provide exact per-model costs and richer graphs.

## Roadmap

- Chokidar-based live updates (low-latency), completed in this repo
- Burn-rate indicator, block windows, per-model charts
- Pricing integration (LiteLLM) and exact cost breakdowns once logs include tokens/models

## License

MIT

## Configuration

- `CODEX_CONFIG_DIR`: override default Codex data dirs (comma-separated).
- `CODEX_BLOCK_WINDOW_HOURS` (default: 5): rolling window size.
- `CODEX_BLOCK_TOKEN_LIMIT` (optional): show % usage and ETA to cap.
- `CODEX_BURN_WINDOW_MINUTES` (default: 10): averaging window for tpm.
- Polling fallback:
  - `CODEX_POLL_INTERVAL_MS` (default: 1000 when using --poll)
 - Terminal compatibility:
   - `CODEX_TERM` (override terminal type; set to `xterm-256color` if using Ghostty)
- UI thresholds (defaults):
  - `CODEX_CAP_YELLOW_PERCENT=50`, `CODEX_CAP_RED_PERCENT=80`
  - `CODEX_CAP_YELLOW_MINUTES=60`, `CODEX_CAP_RED_MINUTES=30`
- Alerts:
  - `CODEX_ALERT_MINUTES=15` triggers flashing header within N minutes
  - `CODEX_ALERT_BELL=1` rings terminal bell on critical entry
- Estimation fallback:
  - `CODEX_SIZE_DELTA=1` counts per-line bytes (approx/backup) when no text/usage is present in events
    (useful when your client logs mostly state/control records without text)
