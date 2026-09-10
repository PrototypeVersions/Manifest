import * as webllm from "https://esm.run/@mlc-ai/web-llm";

const DEFAULT_MODEL = "Qwen2-0.5B-Instruct-q4f16_1-MLC";
const STORAGE_KEY = "manifest-chat-v1";
const SYSTEM_PROMPT = `You are Manifest, a thoughtful and capable AI assistant running locally in the user's browser. Be clear, useful, concise when possible, and candid about uncertainty. Do not claim access to the internet, private files, accounts, or tools unless the user has actually provided the relevant information in the conversation.`;

const $ = (id) => document.getElementById(id);
const els = {
  sidebar: $("sidebar"),
  scrim: $("scrim"),
  menuBtn: $("menuBtn"),
  newChatBtn: $("newChatBtn"),
  newChatDemoBtn: $("newChatDemoBtn"),
  clearBtn: $("clearBtn"),
  aboutBtn: $("aboutBtn"),
  settingsBtn: $("settingsBtn"),
  settingsModal: $("settingsModal"),
  aboutModal: $("aboutModal"),
  loadModelBtn: $("loadModelBtn"),
  loadNote: $("loadNote"),
  statusPill: $("statusPill"),
  progressWrap: $("progressWrap"),
  progressText: $("progressText"),
  progressBar: $("progressBar"),
  composer: $("composer"),
  promptInput: $("promptInput"),
  sendBtn: $("sendBtn"),
  messages: $("messages"),
  welcome: $("welcome"),
  chatStage: $("chatStage"),
};

let engine = null;
let loading = false;
let generating = false;
let selectedModel = localStorage.getItem("manifest-model") || DEFAULT_MODEL;
let history = loadHistory();

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(m => ["user", "assistant"].includes(m.role) && typeof m.content === "string") : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-30)));
}

function escapeHTML(value = "") {
  return value.replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
}

function simpleMarkdown(text = "") {
  const codeBlocks = [];
  let safe = escapeHTML(text);
  safe = safe.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const token = `@@CODEBLOCK_${codeBlocks.length}@@`;
    codeBlocks.push(`<pre><code>${code.trim()}</code></pre>`);
    return token;
  });
  safe = safe
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .split(/\n{2,}/)
    .map(block => block.startsWith("@@CODEBLOCK_") ? block : `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("");
  codeBlocks.forEach((block, i) => { safe = safe.replace(`@@CODEBLOCK_${i}@@`, block); });
  return safe;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    if (els.chatStage) els.chatStage.scrollTop = els.chatStage.scrollHeight;
  });
}

function updateWelcome() {
  els.welcome.classList.toggle("hidden", history.length > 0);
  els.messages.classList.toggle("hidden", history.length === 0);
}

function renderHistory() {
  els.messages.innerHTML = "";
  history.forEach(message => addMessageNode(message.role, message.content));
  updateWelcome();
  scrollToBottom();
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
  scrollToBottom();
  return { row, body };
}

function setStatus(text, ready = false) {
  els.statusPill.textContent = text;
  els.statusPill.classList.toggle("ready", ready);
}

function setProgress(report) {
  els.progressWrap.classList.remove("hidden");
  const text = report?.text || "Preparing model…";
  els.progressText.textContent = text;
  const numeric = typeof report?.progress === "number" ? report.progress : null;
  els.progressBar.style.width = numeric == null ? "8%" : `${Math.max(3, Math.min(100, numeric * 100))}%`;
}

function getSelectedModelFromUI() {
  return document.querySelector('input[name="model"]:checked')?.value || DEFAULT_MODEL;
}

function syncModelUI() {
  const input = document.querySelector(`input[name="model"][value="${CSS.escape(selectedModel)}"]`);
  if (input) input.checked = true;
}

async function loadModel() {
  if (loading || generating) return;
  if (!navigator.gpu) {
    setStatus("WebGPU unavailable");
    els.loadNote.textContent = "This browser/device does not expose WebGPU. Try a recent Chrome or Edge browser on compatible hardware.";
    return;
  }

  loading = true;
  els.loadModelBtn.disabled = true;
  els.sendBtn.disabled = true;
  setStatus("Loading…");
  setProgress({ text: "Starting local AI engine…", progress: 0.01 });

  try {
    engine = await webllm.CreateMLCEngine(selectedModel, {
      initProgressCallback: setProgress,
    });
    setStatus("Ready", true);
    els.loadModelBtn.textContent = "Model ready";
    els.loadNote.textContent = "Loaded locally. You can start chatting.";
    els.progressWrap.classList.add("hidden");
    els.sendBtn.disabled = !els.promptInput.value.trim();
    els.promptInput.focus();
  } catch (error) {
    console.error(error);
    engine = null;
    setStatus("Load failed");
    els.loadModelBtn.disabled = false;
    els.loadModelBtn.textContent = "Try loading again";
    els.loadNote.textContent = "The model could not load on this device. A desktop Chromium browser may work better, or try the Light model.";
    els.progressText.textContent = error?.message || "Model load failed.";
  } finally {
    loading = false;
  }
}

async function sendMessage(text) {
  const prompt = text.trim();
  if (!prompt || generating) return;

  if (!engine) {
    els.promptInput.value = prompt;
    autoResize();
    await loadModel();
    if (!engine) return;
  }

  generating = true;
  els.promptInput.value = "";
  autoResize();
  els.sendBtn.disabled = true;

  history.push({ role: "user", content: prompt });
  saveHistory();
  addMessageNode("user", prompt);

  const assistantNode = addMessageNode("assistant", "Thinking…", "thinking");
  let answer = "";

  try {
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.slice(-18).map(({ role, content }) => ({ role, content })),
    ];

    const stream = await engine.chat.completions.create({
      messages,
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 700,
      stream: true,
    });

    assistantNode.row.classList.remove("thinking");
    for await (const chunk of stream) {
      const delta = chunk?.choices?.[0]?.delta?.content || "";
      if (!delta) continue;
      answer += delta;
      assistantNode.body.innerHTML = simpleMarkdown(answer);
      scrollToBottom();
    }

    if (!answer.trim()) answer = "I wasn't able to generate a response.";
    assistantNode.body.innerHTML = simpleMarkdown(answer);
    history.push({ role: "assistant", content: answer });
    saveHistory();
  } catch (error) {
    console.error(error);
    const msg = `I hit a local inference error on this device. ${error?.message ? `(${error.message})` : "Please try again."}`;
    assistantNode.row.classList.remove("thinking");
    assistantNode.body.innerHTML = simpleMarkdown(msg);
  } finally {
    generating = false;
    els.sendBtn.disabled = !els.promptInput.value.trim();
    els.promptInput.focus();
  }
}

function resetConversation() {
  history = [];
  saveHistory();
  renderHistory();
  els.promptInput.value = "";
  autoResize();
  els.promptInput.focus();
}

function autoResize() {
  els.promptInput.style.height = "auto";
  els.promptInput.style.height = `${Math.min(160, els.promptInput.scrollHeight)}px`;
  els.sendBtn.disabled = generating || loading || !els.promptInput.value.trim();
}

function openSidebar() {
  els.sidebar.classList.add("open");
  els.scrim.classList.add("show");
}
function closeSidebar() {
  els.sidebar.classList.remove("open");
  els.scrim.classList.remove("show");
}

els.loadModelBtn.addEventListener("click", loadModel);
els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage(els.promptInput.value);
});
els.promptInput.addEventListener("input", autoResize);
els.promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    els.composer.requestSubmit();
  }
});

document.querySelectorAll(".suggestion").forEach(button => {
  button.addEventListener("click", () => {
    els.promptInput.value = button.dataset.prompt || "";
    autoResize();
    sendMessage(els.promptInput.value);
  });
});

els.newChatBtn.addEventListener("click", () => { resetConversation(); closeSidebar(); });
els.newChatDemoBtn?.addEventListener("click", resetConversation);
els.clearBtn.addEventListener("click", () => { resetConversation(); closeSidebar(); });
els.menuBtn.addEventListener("click", openSidebar);
els.scrim.addEventListener("click", closeSidebar);
els.settingsBtn.addEventListener("click", () => { syncModelUI(); els.settingsModal.showModal(); });
els.aboutBtn.addEventListener("click", () => { closeSidebar(); els.aboutModal.showModal(); });

document.querySelectorAll('input[name="model"]').forEach(input => {
  input.addEventListener("change", async () => {
    const next = getSelectedModelFromUI();
    if (next === selectedModel) return;
    selectedModel = next;
    localStorage.setItem("manifest-model", selectedModel);
    if (engine) {
      try { await engine.unload(); } catch {}
      engine = null;
    }
    setStatus("Not loaded");
    els.loadModelBtn.disabled = false;
    els.loadModelBtn.textContent = "Load AI model";
    els.loadNote.textContent = "Model changed. Load it when you're ready.";
  });
});

syncModelUI();
renderHistory();
autoResize();
