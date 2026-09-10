import * as webllm from "https://esm.run/@mlc-ai/web-llm";

const WEBLLM_MODELS = [
  { id: "Qwen2-0.5B-Instruct-q4f16_1-MLC", name: "Qwen2 0.5B", meta: "Light · browser" },
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", name: "Llama 3.2 1B", meta: "Stronger · browser" },
];

function cleanBaseUrl(value, fallback) {
  return (value || fallback).trim().replace(/\/+$/, "");
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 3500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = options.signal;
  const onAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    return await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.("abort", onAbort);
  }
}

function connectionFailure(error, name) {
  const aborted = error?.name === "AbortError";
  return {
    status: "offline",
    models: [],
    message: aborted
      ? `${name} was not detected. Start its local server, then scan again.`
      : `${name} was not detected. If it is already running, browser permission or local access may still need to be enabled.`,
  };
}

export class WebLLMRuntime {
  constructor() {
    this.id = "webllm";
    this.name = "WebLLM";
    this.engine = null;
    this.currentModel = null;
  }

  async discover() {
    const available = !!navigator.gpu;
    return {
      status: available ? "connected" : "unavailable",
      models: WEBLLM_MODELS,
      message: available
        ? "Runs directly inside this browser with WebGPU."
        : "WebGPU is not exposed by this browser/device.",
    };
  }

  async prepare(modelId, onProgress) {
    if (!navigator.gpu) throw new Error("WebGPU is unavailable on this browser/device.");
    if (this.engine && this.currentModel === modelId) return;
    if (this.engine) {
      try { await this.engine.unload(); } catch {}
      this.engine = null;
    }
    this.engine = await webllm.CreateMLCEngine(modelId, { initProgressCallback: onProgress });
    this.currentModel = modelId;
  }

  async unload() {
    if (this.engine) {
      try { await this.engine.unload(); } catch {}
    }
    this.engine = null;
    this.currentModel = null;
  }

  stop() {
    try { this.engine?.interruptGenerate?.(); } catch {}
  }

  async *chat({ modelId, messages, signal }) {
    if (!this.engine || this.currentModel !== modelId) throw new Error("WebLLM model is not loaded.");
    const stream = await this.engine.chat.completions.create({
      messages,
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 700,
      stream: true,
    });
    for await (const chunk of stream) {
      if (signal?.aborted) {
        this.stop();
        break;
      }
      const delta = chunk?.choices?.[0]?.delta?.content || "";
      if (delta) yield delta;
    }
  }
}

export class OllamaRuntime {
  constructor(baseUrl = "http://localhost:11434") {
    this.id = "ollama";
    this.name = "Ollama";
    this.baseUrl = cleanBaseUrl(baseUrl, "http://localhost:11434");
  }

  setConfig({ baseUrl }) {
    this.baseUrl = cleanBaseUrl(baseUrl, "http://localhost:11434");
  }

  async discover() {
    try {
      const response = await fetchWithTimeout(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        return { status: response.status === 401 ? "auth" : "offline", models: [], message: response.status === 401 ? "Ollama is asking for authentication." : "Ollama responded, but Manifest could not read its model list." };
      }
      const data = await response.json();
      const models = (data.models || []).map(model => ({
        id: model.model || model.name,
        name: model.name || model.model,
        meta: [model.details?.parameter_size, model.details?.quantization_level].filter(Boolean).join(" · ") || "Local Ollama model",
      }));
      return { status: "connected", models, message: models.length ? `${models.length} installed model${models.length === 1 ? "" : "s"} found.` : "Ollama is connected. Download a model in Ollama, then scan again to make it available here." };
    } catch (error) {
      return connectionFailure(error, "Ollama");
    }
  }

  async *chat({ modelId, messages, signal }) {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId, messages, stream: true }),
      signal,
    });
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
    if (!response.body) throw new Error("Ollama did not return a response stream.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        const payload = JSON.parse(line);
        const delta = payload?.message?.content || "";
        if (delta) yield delta;
      }
    }
    if (buffer.trim()) {
      const payload = JSON.parse(buffer.trim());
      const delta = payload?.message?.content || "";
      if (delta) yield delta;
    }
  }
}

export class LMStudioRuntime {
  constructor(baseUrl = "http://localhost:1234", token = "") {
    this.id = "lmstudio";
    this.name = "LM Studio";
    this.baseUrl = cleanBaseUrl(baseUrl, "http://localhost:1234");
    this.token = token || "";
  }

  setConfig({ baseUrl, token }) {
    this.baseUrl = cleanBaseUrl(baseUrl, "http://localhost:1234");
    this.token = token || "";
  }

  headers(json = false) {
    const headers = {};
    if (json) headers["Content-Type"] = "application/json";
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }

  async discover() {
    try {
      const response = await fetchWithTimeout(`${this.baseUrl}/api/v1/models`, { headers: this.headers() });
      if (!response.ok) {
        return { status: response.status === 401 ? "auth" : "offline", models: [], message: response.status === 401 ? "LM Studio is connected but needs the local API token. Enter it above, then scan again." : "LM Studio responded, but Manifest could not read its model list." };
      }
      const data = await response.json();
      const models = (data.models || [])
        .filter(model => !model.type || model.type === "llm")
        .map(model => ({
          id: model.key,
          name: model.display_name || model.key,
          meta: [model.params_string, model.quantization?.name, model.architecture].filter(Boolean).join(" · ") || "Local LM Studio model",
        }));
      return { status: "connected", models, message: models.length ? `${models.length} local LLM${models.length === 1 ? "" : "s"} found.` : "LM Studio is connected. Download a model in LM Studio, then scan again to make it available here." };
    } catch (error) {
      return connectionFailure(error, "LM Studio");
    }
  }

  async *chat({ modelId, messages, signal }) {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({ model: modelId, messages, temperature: 0.7, top_p: 0.9, max_tokens: 700, stream: true }),
      signal,
    });
    if (!response.ok) throw new Error(`LM Studio returned HTTP ${response.status}.`);
    if (!response.body) throw new Error("LM Studio did not return a response stream.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        const payload = JSON.parse(data);
        const delta = payload?.choices?.[0]?.delta?.content || "";
        if (delta) yield delta;
      }
    }
  }
}

export class RuntimeManager {
  constructor(config = {}) {
    this.runtimes = new Map();
    this.register(new WebLLMRuntime());
    this.register(new OllamaRuntime(config.ollamaBaseUrl));
    this.register(new LMStudioRuntime(config.lmStudioBaseUrl, config.lmStudioToken));
  }

  register(runtime) { this.runtimes.set(runtime.id, runtime); }
  get(id) { return this.runtimes.get(id); }
  list() { return [...this.runtimes.values()]; }
  async discover(id) { return this.get(id).discover(); }
  async unload(id) { return this.get(id)?.unload?.(); }
  stop(id) { return this.get(id)?.stop?.(); }
}

export { WEBLLM_MODELS };