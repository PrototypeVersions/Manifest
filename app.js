import { RuntimeManager, WEBLLM_MODELS } from "./runtimes.js";

const LIGHT_MODEL = "Qwen2-0.5B-Instruct-q4f16_1-MLC";
const STRONG_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
const DEFAULT_MODEL = LIGHT_MODEL;
const STORAGE_KEY = "manifest-chat-v1";
const SYSTEM_PROMPT = `You are Manifest, a thoughtful and capable AI assistant running locally on the user's chosen runtime. Be clear, useful, concise when possible, and candid about uncertainty. Do not claim access to the internet, private files, accounts, or tools unless the user has actually provided the relevant information in the conversation.`;

const $ = id => document.getElementById(id);
const els = {
  sidebar: $("sidebar"), scrim: $("scrim"), menuBtn: $("menuBtn"), newChatBtn: $("newChatBtn"), newChatDemoBtn: $("newChatDemoBtn"), clearBtn: $("clearBtn"), aboutBtn: $("aboutBtn"),
  deviceModal: $("deviceModal"), deviceModalClose: $("deviceModalClose"), analyzeAgainBtn: $("analyzeAgainBtn"), loadModelBtn: $("loadModelBtn"), loadNote: $("loadNote"),
  statusPill: $("statusPill"), activeModelLabel: $("activeModelLabel"), progressWrap: $("progressWrap"), progressText: $("progressText"), progressBar: $("progressBar"),
  composer: $("composer"), promptInput: $("promptInput"), sendBtn: $("sendBtn"), messages: $("messages"), welcome: $("welcome"), chatStage: $("chatStage"),
  scanState: $("scanState"), deviceName: $("deviceName"), capacityScore: $("capacityScore"), capacityBar: $("capacityBar"), capacityLabel: $("capacityLabel"), specPlatform: $("specPlatform"), specCores: $("specCores"), specMemory: $("specMemory"), specWebGPU: $("specWebGPU"), specGPU: $("specGPU"), specBuffer: $("specBuffer"), recommendedTier: $("recommendedTier"), recommendedReason: $("recommendedReason"), useRecommendedBtn: $("useRecommendedBtn"),
  sourcesBtn: $("sourcesBtn"), sourcesModal: $("sourcesModal"), sourcesClose: $("sourcesClose"), scanSourcesBtn: $("scanSourcesBtn"), sourceSummary: $("sourceSummary"),
  ollamaEndpoint: $("ollamaEndpoint"), lmstudioEndpoint: $("lmstudioEndpoint"), lmstudioToken: $("lmstudioToken"),
  webllmSourceStatus: $("webllmSourceStatus"), ollamaSourceStatus: $("ollamaSourceStatus"), lmstudioSourceStatus: $("lmstudioSourceStatus"),
  webllmModels: $("webllmModels"), ollamaModels: $("ollamaModels"), lmstudioModels: $("lmstudioModels"),
};

const runtimeManager = new RuntimeManager({
  ollamaBaseUrl: localStorage.getItem("manifest-ollama-url") || "http://localhost:11434",
  lmStudioBaseUrl: localStorage.getItem("manifest-lmstudio-url") || "http://localhost:1234",
  lmStudioToken: localStorage.getItem("manifest-lmstudio-token") || "",
});

let loading = false;
let generating = false;
let recommendedModel = null;
let stopRequested = false;
let currentAbortController = null;
let selectedRuntimeId = localStorage.getItem("manifest-runtime") || "webllm";
let selectedModel = localStorage.getItem("manifest-model") || DEFAULT_MODEL;
let selectedModelName = localStorage.getItem("manifest-model-name") || selectedModel;
let modelChosen = localStorage.getItem("manifest-model-chosen") === "1";
let modelReady = selectedRuntimeId !== "webllm" && modelChosen;
let history = loadHistory();

if (els.ollamaEndpoint) els.ollamaEndpoint.value = runtimeManager.get("ollama").baseUrl;
if (els.lmstudioEndpoint) els.lmstudioEndpoint.value = runtimeManager.get("lmstudio").baseUrl;
if (els.lmstudioToken) els.lmstudioToken.value = runtimeManager.get("lmstudio").token;

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(m => ["user", "assistant"].includes(m.role) && typeof m.content === "string") : [];
  } catch { return []; }
}

function saveHistory() { localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-30))); }
function escapeHTML(value = "") { return value.replace(/[&<>'\"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '\"':"&quot;" }[c])); }
function simpleMarkdown(text = "") {
  let safe = escapeHTML(text);
  return safe.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").split(/\n{2,}/).map(block => `<p>${block.replace(/\n/g, "<br>")}</p>`).join("");
}

function runtimeLabel(id) { return id === "webllm" ? "WebLLM" : id === "ollama" ? "Ollama" : id === "lmstudio" ? "LM Studio" : id; }
function persistSelection() {
  localStorage.setItem("manifest-runtime", selectedRuntimeId);
  localStorage.setItem("manifest-model", selectedModel);
  localStorage.setItem("manifest-model-name", selectedModelName);
  localStorage.setItem("manifest-model-chosen", modelChosen ? "1" : "0");
}

function updateActiveModelLabel() {
  if (!els.activeModelLabel) return;
  els.activeModelLabel.textContent = modelChosen ? `${runtimeLabel(selectedRuntimeId)} · ${selectedModelName}` : "No model selected";
  els.activeModelLabel.title = modelChosen ? `${runtimeLabel(selectedRuntimeId)} / ${selectedModel}` : "Choose a local AI source";
}

function scrollToBottom(force = false) {
  requestAnimationFrame(() => {
    const target = els.messages || els.chatStage;
    if (!target) return;
    const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 140;
    if (force || nearBottom) target.scrollTop = target.scrollHeight;
  });
}

function updateWelcome() {
  els.welcome.classList.toggle("hidden", history.length > 0);
  els.messages.classList.toggle("hidden", history.length === 0);
}

function renderHistory() {
  els.messages.innerHTML = "";
  history.forEach(m => addMessageNode(m.role, m.content));
  updateWelcome();
  scrollToBottom(true);
}

function addMessageNode(role, content, extraClass = "") {
  const row = document.createElement("div");
  row.className = `message ${role} ${extraClass}`.trim();
  if (role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = "M";
    row.appendChild(avatar);
  }
  const body = document.createElement("div");
  body.className = "message-body";
  body.innerHTML = simpleMarkdown(content);
  row.appendChild(body);
  els.messages.appendChild(row);
  updateWelcome();
  scrollToBottom(true);
  return { row, body };
}

function setStatus(text, ready = false) {
  els.statusPill.textContent = text;
  els.statusPill.classList.toggle("ready", ready);
  updateSendButton();
}

function setProgress(report) {
  els.progressWrap.classList.remove("hidden");
  els.progressText.textContent = report?.text || "Preparing model…";
  const numeric = typeof report?.progress === "number" ? report.progress : null;
  els.progressBar.style.width = numeric == null ? "8%" : `${Math.max(3, Math.min(100, numeric * 100))}%`;
}

function updateSendButton() {
  if (generating) {
    els.sendBtn.disabled = false;
    els.sendBtn.classList.add("ready", "stop-mode");
    els.sendBtn.setAttribute("aria-label", "Stop response");
    els.sendBtn.textContent = "■";
    return;
  }
  els.sendBtn.classList.remove("stop-mode");
  els.sendBtn.textContent = "↑";
  els.sendBtn.setAttribute("aria-label", "Send message");
  const ready = modelReady && !loading;
  els.sendBtn.classList.toggle("ready", ready);
  els.sendBtn.disabled = !ready || !els.promptInput.value.trim();
}

function formatBytes(n) {
  if (!n) return "Browser default";
  return n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : `${Math.round(n / 1048576)} MB`;
}

function platformName() {
  const ua = navigator.userAgent;
  return /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/i.test(ua) ? "iOS / iPadOS" : /Windows/i.test(ua) ? "Windows" : /Macintosh|Mac OS/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Browser device";
}

function openAnalysis() {
  if (!els.deviceModal.open) els.deviceModal.showModal();
  analyzeDevice();
}

async function analyzeDevice() {
  els.scanState.classList.add("active");
  els.scanState.innerHTML = "<i></i> Analyzing";
  els.recommendedTier.textContent = "Analyzing…";
  els.recommendedReason.textContent = "Manifest is reading the hardware capabilities this browser safely exposes.";
  const cores = navigator.hardwareConcurrency || null;
  const memory = navigator.deviceMemory || null;
  let adapter = null, info = null, maxBuffer = 0;
  try {
    if (navigator.gpu) {
      adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (adapter) { info = adapter.info || null; maxBuffer = Number(adapter.limits?.maxBufferSize || 0); }
    }
  } catch (error) { console.warn("Device analysis WebGPU query failed", error); }

  const webgpu = !!adapter;
  let score = 15;
  if (webgpu) score += 35;
  if (cores) score += Math.min(20, cores * 2);
  if (memory) score += Math.min(20, memory * 2.5);
  if (maxBuffer >= 1073741824) score += 10; else if (maxBuffer >= 536870912) score += 6;
  score = Math.min(100, Math.round(score));
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const stronger = webgpu && !mobile && (memory == null || memory >= 8) && (cores == null || cores >= 6);
  recommendedModel = stronger ? STRONG_MODEL : LIGHT_MODEL;
  const gpuLabel = [info?.vendor, info?.architecture].filter(Boolean).join(" / ") || (webgpu ? "WebGPU adapter available" : "Not exposed");

  els.deviceName.textContent = mobile ? "Mobile device" : "Desktop / Laptop";
  els.specPlatform.textContent = platformName();
  els.specCores.textContent = cores ? String(cores) : "Not exposed";
  els.specMemory.textContent = memory ? `~${memory} GB reported` : "Not exposed";
  els.specWebGPU.textContent = webgpu ? "Available" : "Unavailable";
  els.specGPU.textContent = gpuLabel;
  els.specBuffer.textContent = webgpu ? formatBytes(maxBuffer) : "—";
  els.capacityScore.textContent = `${score} / 100`;
  els.capacityBar.style.width = `${score}%`;
  els.capacityLabel.textContent = webgpu ? "Browser-local accelerated AI is available on this device." : "This browser does not currently expose WebGPU, so local GPU inference is unavailable here.";
  els.recommendedTier.textContent = stronger ? "Llama 3.2 1B" : "Qwen2 0.5B";
  els.recommendedReason.textContent = stronger ? "Your exposed browser capabilities support trying the stronger WebLLM model in this prototype." : webgpu ? "Manifest recommends the lighter WebLLM model for a more reliable browser-local experience on this device." : "WebGPU is required for the current browser-local prototype.";
  els.useRecommendedBtn.disabled = !webgpu;
  els.scanState.innerHTML = "<i></i> Analysis complete";
  localStorage.setItem("manifest-device-score", String(score));
}

async function switchSelection(runtimeId, modelId, modelName) {
  if (selectedRuntimeId === "webllm" && (runtimeId !== "webllm" || selectedModel !== modelId)) {
    await runtimeManager.unload("webllm");
  }
  selectedRuntimeId = runtimeId;
  selectedModel = modelId;
  selectedModelName = modelName || modelId;
  modelChosen = true;
  modelReady = runtimeId !== "webllm";
  persistSelection();
  updateActiveModelLabel();

  if (runtimeId === "webllm") {
    setStatus("Selected");
    els.loadModelBtn.disabled = false;
    els.loadModelBtn.textContent = "Load Selected Model";
    els.loadNote.textContent = `${selectedModelName} is selected through WebLLM. Load it into this browser to begin chatting.`;
  } else {
    setStatus(`Ready · ${runtimeLabel(runtimeId)}`, true);
    els.loadModelBtn.disabled = true;
    els.loadModelBtn.textContent = "Model ready";
    els.loadNote.textContent = `${selectedModelName} will run through ${runtimeLabel(runtimeId)} on this computer.`;
  }
  updateSendButton();
}

async function applyRecommended() {
  if (!recommendedModel) return;
  const name = recommendedModel === STRONG_MODEL ? "Llama 3.2 1B" : "Qwen2 0.5B";
  await switchSelection("webllm", recommendedModel, name);
  els.deviceModal.close();
  els.loadModelBtn.textContent = "Load Recommended Model";
  els.loadNote.textContent = `Manifest selected ${name} for this browser. Load it to start chatting.`;
}

async function loadSelectedModel() {
  if (loading || generating || !modelChosen) return false;
  if (selectedRuntimeId !== "webllm") {
    modelReady = true;
    setStatus(`Ready · ${runtimeLabel(selectedRuntimeId)}`, true);
    updateSendButton();
    return true;
  }
  loading = true;
  modelReady = false;
  els.loadModelBtn.disabled = true;
  updateSendButton();
  setStatus("Loading…");
  setProgress({ text: "Starting WebLLM engine…", progress: 0.01 });
  try {
    await runtimeManager.get("webllm").prepare(selectedModel, setProgress);
    modelReady = true;
    setStatus("Ready · WebLLM", true);
    els.loadModelBtn.textContent = "Model ready";
    els.loadNote.textContent = `${selectedModelName} is loaded locally in this browser.`;
    els.progressWrap.classList.add("hidden");
    updateSendButton();
    return true;
  } catch (error) {
    console.error(error);
    modelReady = false;
    setStatus("Load failed");
    els.loadModelBtn.disabled = false;
    els.loadModelBtn.textContent = "Try loading again";
    els.loadNote.textContent = error?.message || "The WebLLM model could not load on this device.";
    return false;
  } finally {
    loading = false;
    updateSendButton();
  }
}

function sourceEls(id) {
  return id === "webllm" ? [els.webllmSourceStatus, els.webllmModels] : id === "ollama" ? [els.ollamaSourceStatus, els.ollamaModels] : [els.lmstudioSourceStatus, els.lmstudioModels];
}

function setSourceStatus(id, status, message) {
  const [statusEl] = sourceEls(id);
  if (!statusEl) return;
  statusEl.className = `source-status ${status || "scanning"}`;
  statusEl.textContent = status === "connected" ? "Connected" : status === "unavailable" ? "Unavailable" : status === "auth" ? "Needs token" : status === "scanning" ? "Scanning…" : "Not connected";
  statusEl.title = message || "";
}

function renderModels(runtimeId, result) {
  const [, container] = sourceEls(runtimeId);
  if (!container) return;
  container.innerHTML = "";
  if (!result.models?.length) {
    const empty = document.createElement("p");
    empty.className = "source-empty";
    empty.textContent = result.message || "No models found.";
    container.appendChild(empty);
    return;
  }
  result.models.forEach(model => {
    const row = document.createElement("div");
    row.className = "source-model-row";
    const info = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = model.name || model.id;
    const small = document.createElement("small");
    small.textContent = model.meta || model.id;
    info.append(strong, small);
    const button = document.createElement("button");
    const active = modelChosen && selectedRuntimeId === runtimeId && selectedModel === model.id;
    button.type = "button";
    button.textContent = active ? "Selected" : "Use";
    button.disabled = active;
    button.addEventListener("click", async () => {
      await switchSelection(runtimeId, model.id, model.name || model.id);
      els.sourcesModal.close();
    });
    row.append(info, button);
    container.appendChild(row);
  });
}

function applyRuntimeConfig() {
  const ollamaUrl = els.ollamaEndpoint?.value.trim() || "http://localhost:11434";
  const lmstudioUrl = els.lmstudioEndpoint?.value.trim() || "http://localhost:1234";
  const token = els.lmstudioToken?.value || "";
  runtimeManager.get("ollama").setConfig({ baseUrl: ollamaUrl });
  runtimeManager.get("lmstudio").setConfig({ baseUrl: lmstudioUrl, token });
  localStorage.setItem("manifest-ollama-url", ollamaUrl);
  localStorage.setItem("manifest-lmstudio-url", lmstudioUrl);
  localStorage.setItem("manifest-lmstudio-token", token);
}

async function scanSources() {
  applyRuntimeConfig();
  els.scanSourcesBtn.disabled = true;
  els.scanSourcesBtn.textContent = "Scanning…";
  els.sourceSummary.textContent = "Searching this browser and local inference servers…";
  ["webllm", "ollama", "lmstudio"].forEach(id => setSourceStatus(id, "scanning", "Scanning"));

  const results = await Promise.all(["webllm", "ollama", "lmstudio"].map(async id => [id, await runtimeManager.discover(id)]));
  let connected = 0, models = 0;
  for (const [id, result] of results) {
    if (result.status === "connected") connected += 1;
    models += result.models?.length || 0;
    setSourceStatus(id, result.status, result.message);
    renderModels(id, result);
  }
  els.sourceSummary.textContent = `${connected} source${connected === 1 ? "" : "s"} connected · ${models} model${models === 1 ? "" : "s"} visible to Manifest`;
  els.scanSourcesBtn.disabled = false;
  els.scanSourcesBtn.textContent = "Scan Again";
}

async function openSources() {
  if (!els.sourcesModal.open) els.sourcesModal.showModal();
  await scanSources();
}

function stopGeneration() {
  if (!generating) return;
  stopRequested = true;
  currentAbortController?.abort();
  runtimeManager.stop(selectedRuntimeId);
  setStatus("Stopping…");
}

async function sendMessage(text) {
  const prompt = text.trim();
  if (!prompt || generating) return;
  if (!modelChosen) { openAnalysis(); return; }
  if (!modelReady) {
    els.promptInput.value = prompt;
    const loaded = await loadSelectedModel();
    if (!loaded) return;
  }

  generating = true;
  stopRequested = false;
  currentAbortController = new AbortController();
  els.promptInput.value = "";
  autoResize();
  updateSendButton();
  history.push({ role: "user", content: prompt });
  saveHistory();
  addMessageNode("user", prompt);
  const node = addMessageNode("assistant", "Thinking…", "thinking");
  let answer = "";

  try {
    const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...history.slice(-18).map(({ role, content }) => ({ role, content }))];
    const runtime = runtimeManager.get(selectedRuntimeId);
    node.row.classList.remove("thinking");
    for await (const delta of runtime.chat({ modelId: selectedModel, messages, signal: currentAbortController.signal })) {
      if (stopRequested) break;
      answer += delta;
      node.body.innerHTML = simpleMarkdown(answer || "Thinking…");
      scrollToBottom(true);
    }
    if (stopRequested) {
      if (!answer.trim()) answer = "Response stopped.";
    } else if (!answer.trim()) {
      answer = "I wasn't able to generate a response.";
    }
    node.body.innerHTML = simpleMarkdown(answer);
    history.push({ role: "assistant", content: answer });
    saveHistory();
    setStatus(`Ready · ${runtimeLabel(selectedRuntimeId)}`, true);
  } catch (error) {
    if (stopRequested || error?.name === "AbortError") {
      if (!answer.trim()) answer = "Response stopped.";
      node.body.innerHTML = simpleMarkdown(answer);
      history.push({ role: "assistant", content: answer });
      saveHistory();
      setStatus(`Ready · ${runtimeLabel(selectedRuntimeId)}`, true);
    } else {
      console.error(error);
      node.row.classList.remove("thinking");
      node.body.innerHTML = simpleMarkdown(`I hit a local inference error through ${runtimeLabel(selectedRuntimeId)}. ${error?.message || "Please try again."}`);
      setStatus("Runtime error");
    }
  } finally {
    generating = false;
    stopRequested = false;
    currentAbortController = null;
    autoResize();
    updateSendButton();
    scrollToBottom(true);
  }
}

function resetConversation() {
  history = [];
  saveHistory();
  renderHistory();
  els.promptInput.value = "";
  autoResize();
  updateSendButton();
}

function autoResize() {
  els.promptInput.style.height = "auto";
  els.promptInput.style.height = `${Math.min(160, els.promptInput.scrollHeight)}px`;
  updateSendButton();
}

els.loadModelBtn.addEventListener("click", async () => {
  if (!modelChosen) { openAnalysis(); return; }
  if (!modelReady) await loadSelectedModel();
});
els.deviceModalClose?.addEventListener("click", () => els.deviceModal.close());
els.analyzeAgainBtn?.addEventListener("click", analyzeDevice);
els.useRecommendedBtn?.addEventListener("click", applyRecommended);
els.sourcesBtn?.addEventListener("click", openSources);
els.sourcesClose?.addEventListener("click", () => els.sourcesModal.close());
els.scanSourcesBtn?.addEventListener("click", scanSources);
els.ollamaEndpoint?.addEventListener("change", applyRuntimeConfig);
els.lmstudioEndpoint?.addEventListener("change", applyRuntimeConfig);
els.lmstudioToken?.addEventListener("change", applyRuntimeConfig);
els.composer.addEventListener("submit", event => {
  event.preventDefault();
  if (generating) { stopGeneration(); return; }
  sendMessage(els.promptInput.value);
});
els.sendBtn.addEventListener("click", event => {
  if (generating) { event.preventDefault(); stopGeneration(); }
});
els.promptInput.addEventListener("input", autoResize);
els.promptInput.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (generating) { stopGeneration(); return; }
    els.composer.requestSubmit();
  }
});
document.querySelectorAll(".suggestion").forEach(button => button.addEventListener("click", () => sendMessage(button.dataset.prompt || "")));
els.newChatBtn?.addEventListener("click", resetConversation);
els.newChatDemoBtn?.addEventListener("click", resetConversation);
els.clearBtn?.addEventListener("click", resetConversation);

renderModels("webllm", { models: WEBLLM_MODELS, message: "Browser models" });
setSourceStatus("webllm", navigator.gpu ? "connected" : "unavailable", navigator.gpu ? "WebGPU available" : "WebGPU unavailable");
setSourceStatus("ollama", "offline", "Open Local AI Sources to scan");
setSourceStatus("lmstudio", "offline", "Open Local AI Sources to scan");
updateActiveModelLabel();
renderHistory();
autoResize();
updateSendButton();
