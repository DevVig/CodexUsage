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
```
- Daily summary
```
node src/index.js daily
```
- Recent sessions
```
node src/index.js session
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

