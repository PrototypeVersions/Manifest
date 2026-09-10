# Manifest Desktop

This folder is the native Manifest prototype. It is intentionally separate from the GitHub Pages site at the repository root.

## Product flow

1. **Analyze This Computer** — Manifest reads the local CPU, memory, operating system and architecture.
2. **Install My AI** — Manifest downloads a known-good GGUF model directly into the app data directory. The user does not install Ollama, LM Studio or another model manager.
3. **Start Manifest** — the bundled `llama-server` sidecar starts locally and loads the model.
4. **Chat** — requests stay on the machine and stream through the native Rust backend.

The first prototype intentionally uses one conservative baseline model, Qwen2.5 1.5B Instruct Q4_K_M (Apache-2.0). The device profile already exposes a capability tier so later releases can map different hardware to different model packages automatically.

## Development

Requirements: Node.js, Rust, Tauri system prerequisites, CMake and a staged `llama-server` sidecar in `src-tauri/binaries/` using Tauri's target-triple naming convention.

The GitHub Actions workflow in `.github/workflows/desktop-build.yml` builds a static `llama-server` from a pinned llama.cpp release and then creates unsigned desktop bundles for Intel Mac, Apple Silicon Mac and Windows x64.

Run icons only:

```bash
npm install
npm run icons
```

Run a Tauri development build after staging the sidecar:

```bash
npm run tauri dev
```

## Privacy boundary

The app downloads the model from Hugging Face once. Chat inference is then performed against the loopback-only bundled runtime at `127.0.0.1`; the chat transcript itself is not sent to a cloud inference API by Manifest.
