# Manifest

Manifest is a static, browser-native AI chat interface designed for GitHub Pages. It uses WebLLM so model inference runs on the visitor's own device through WebGPU rather than a paid chat API.

## Models

- **Light (default):** `Qwen2-0.5B-Instruct-q4f16_1-MLC`
- **Stronger:** `Llama-3.2-1B-Instruct-q4f16_1-MLC`

The first model load downloads model assets from the public model host. Compatible browsers can cache those assets locally.

## Privacy and cost architecture

The app has no server-side inference endpoint and contains no API key. Chat history is stored in the browser's local storage. Model inference is performed locally on compatible WebGPU hardware.

This means the site owner does not pay a per-message LLM inference charge. Normal limitations of GitHub Pages, external model hosting, visitor bandwidth, browser compatibility, and model licenses still apply.

## GitHub Pages

Publish the repository from the `main` branch and `/ (root)` directory in **Settings → Pages**. The expected project-site URL is:

`https://prototypeversions.github.io/Manifest/`

## Browser requirements

A recent browser/device with WebGPU support is required. Desktop Chromium-based browsers generally provide the most reliable experience. Mobile WebGPU support varies by device and browser.
