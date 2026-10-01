# meeting-assistant

A local-first desktop AI meeting copilot: it listens to what is said in your
meeting or interview, transcribes it in real time **on-device**, and streams
short "what to say next" answers into a translucent always-on-top overlay that
is excluded from screen shares.

- **Answers come from MiniMax** (OpenAI-compatible `/v1/chat/completions`,
  default model `MiniMax-M2`) using **your own API key** — nothing is proxied
  through anyone else's server.
- **Speech-to-text runs on your machine** (bundled ONNX Whisper; Apple Speech /
  other streaming STT engines remain available for the escape-hatch build).
- **Meeting history and RAG embeddings are on-device** (SQLite + sqlite-vec,
  bundled local embedding model). Cloud embedding providers are never contacted
  by default.
- **Screenshot help is local OCR → text → MiniMax** (the model lane is declared
  text-only, so screen pixels never leave your machine).

## Setup

Requirements: Node ≥ 22.6, Rust toolchain (for the native audio module), and a
MiniMax API key from https://www.minimax.io.

```bash
npm install
cp .env.example .env        # put your MINIMAX_API_KEY in .env
npm start                   # dev (Vite + Electron)
```

Configuration lives in `.env`:

| Var | Default | Meaning |
| --- | --- | --- |
| `MINIMAX_API_KEY` | — | **required** — your MiniMax key |
| `MINIMAX_BASE_URL` | `https://api.minimax.io/v1` | set `https://api.minimaxi.com/v1` for the CN region |
| `MINIMAX_MODEL` | `MiniMax-M2` | any MiniMax chat model you have access to |
| `MEETING_ASSISTANT_ALLOW_LEGACY_PROVIDERS` | unset | escape hatch: restore the original multi-provider behavior (Gemini/Groq/OpenAI/Claude/… + cloud embeddings) |

If you prefer the Settings UI over `.env` (e.g. packaged builds, which do not
read `.env`): **Settings → AI Providers → Add custom provider** and save a
provider with id `minimax-m2` — a stored entry overrides the env seed.

## Behavior notes

- **MiniMax-only by design.** No other text-provider key is ever hydrated into
  the LLM router, and the Natively hosted gateway can no longer hijack the
  default model / STT / reranker. The whole policy lives in
  `electron/llm/minimaxProvider.ts` + `ProcessingHelper.ts` and is covered by
  `electron/services/__tests__/MiniMaxOnlyPolicy.test.mjs`.
- **Overlay invisibility**: `setContentProtection(true)`, always-on-top
  floating level, skip-taskbar, panel window type; Zoom users must enable
  "Advanced capture with window filtering" (Zoom → Settings → Share Screen).
- **Linux**: the app builds and unit-tests pass on Linux; the native audio
  module's *system-audio* tap is written for macOS/Windows, so on Linux use the
  microphone channel (or a virtual loopback device) until a PipeWire backend
  lands.
- **Platform**: production targets remain macOS and Windows; treat Linux as
  best-effort developer support.

## Development

```bash
npm run build:electron    # esbuild main process (premium/ submodule is optional: imports are external)
npm run typecheck:electron
npm test                  # ~12.5k assertions (the suite runs with the legacy-provider hatch on;
                          # fork-policy behavior is asserted by MiniMaxOnlyPolicy.test.mjs)
```

## License

Personal, educational, research and non-commercial use under the
**Natively Personal Use Source License v1.0** (see `LICENSE`). This codebase is
based on Natively, originally developed by Natively AI Private Limited;
commercial use requires written permission from them.
