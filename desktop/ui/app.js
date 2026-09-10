const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);
const setupView = $("setupView");
const chatView = $("chatView");
const analyzeBtn = $("analyzeBtn");
const profileCard = $("profileCard");
const recommendCard = $("recommendCard");
const readyCard = $("readyCard");
const installBtn = $("installBtn");
const startBtn = $("startBtn");
const setupStatus = $("setupStatus");
const downloadWrap = $("downloadWrap");
const downloadBar = $("downloadBar");
const downloadText = $("downloadText");
const downloadPercent = $("downloadPercent");
const messagesEl = $("messages");
const emptyState = $("emptyState");
const chatForm = $("chatForm");
const promptInput = $("promptInput");
const sendBtn = $("sendBtn");
const newChatBtn = $("newChatBtn");

let history = [];
let activeAssistant = null;
let generating = false;
let starting = false;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Preparing download…";
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function setStatus(text) { setupStatus.textContent = text; }

async function analyze() {
  analyzeBtn.disabled = true;
  analyzeBtn.firstChild.textContent = "Analyzing… ";
  setStatus("READING LOCAL HARDWARE / NOTHING SENT TO A SERVER");
  try {
    const p = await invoke("get_device_profile");
    $("profileSystem").textContent = `${p.os} · ${p.arch}`;
    $("profileCpu").textContent = `${p.cpu} · ${p.logicalCores} threads`;
    $("profileRam").textContent = `${p.ramGb.toFixed(1)} GB`;
    $("profileTier").textContent = p.tier;
    $("scorePill").textContent = `MANIFEST SCORE ${p.score}`;
    $("modelReason").textContent = p.reason;
    profileCard.classList.remove("hidden");
    recommendCard.classList.remove("hidden");
    setStatus("DEVICE PROFILE COMPLETE / RECOMMENDATION READY");
  } catch (err) {
    setStatus(`ANALYSIS ERROR / ${String(err)}`);
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.firstChild.textContent = "Analyze Again ";
  }
}

async function refreshInstallState() {
  try {
    const state = await invoke("get_install_state");
    if (state.installed) {
      recommendCard.classList.remove("hidden");
      readyCard.classList.remove("hidden");
      installBtn.textContent = "Installed ✓";
      installBtn.disabled = true;
      setStatus("LOCAL AI INSTALLED / READY TO START");
      return true;
    }
  } catch (_) {}
  return false;
}

async function installModel() {
  installBtn.disabled = true;
  downloadWrap.classList.remove("hidden");
  setStatus("DOWNLOADING YOUR LOCAL AI / ONE-TIME MODEL INSTALL");
  try {
    await invoke("install_recommended_model");
    downloadBar.style.width = "100%";
    downloadPercent.textContent = "100%";
    downloadText.textContent = "Verified and installed";
    installBtn.textContent = "Installed ✓";
    readyCard.classList.remove("hidden");
    setStatus("LOCAL AI INSTALLED / STARTING MANIFEST");
    await startManifest();
  } catch (err) {
    installBtn.disabled = false;
    installBtn.textContent = "Try Install Again ↓";
    setStatus(`INSTALL ERROR / ${String(err)}`);
  }
}

async function startManifest() {
  if (starting || !chatView.classList.contains("hidden")) return;
  starting = true;
  startBtn.disabled = true;
  startBtn.firstChild.textContent = "Starting… ";
  setStatus("STARTING PRIVATE LOCAL RUNTIME");
  try {
    await invoke("start_local_ai");
    setupView.classList.add("hidden");
    chatView.classList.remove("hidden");
    promptInput.focus();
  } catch (err) {
    setStatus(`START ERROR / ${String(err)}`);
    startBtn.disabled = false;
    startBtn.firstChild.textContent = "Start Manifest ";
  } finally {
    starting = false;
  }
}

function addMessage(role, content = "") {
  emptyState?.classList.add("hidden");
  const row = document.createElement("div");
  row.className = `message ${role}`;
  const label = document.createElement("div");
  label.className = "role";
  label.textContent = role === "user" ? "YOU" : "MANIFEST";
  const body = document.createElement("div");
  body.className = "content";
  body.textContent = content;
  row.append(label, body);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return body;
}

function autoSize() {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 140)}px`;
}

async function sendMessage(text) {
  if (!text.trim() || generating) return;
  const clean = text.trim();
  history.push({ role: "user", content: clean });
  addMessage("user", clean);
  activeAssistant = addMessage("assistant", "");
  activeAssistant.classList.add("typing-cursor");
  generating = true;
  sendBtn.disabled = true;
  promptInput.value = "";
  autoSize();
  try {
    await invoke("chat", { messages: history });
  } catch (err) {
    if (activeAssistant && !activeAssistant.textContent) activeAssistant.textContent = `I couldn't complete that locally: ${String(err)}`;
    activeAssistant?.classList.remove("typing-cursor");
    generating = false;
    sendBtn.disabled = false;
  }
}

analyzeBtn.addEventListener("click", analyze);
installBtn.addEventListener("click", installModel);
startBtn.addEventListener("click", startManifest);
promptInput.addEventListener("input", autoSize);
promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});
chatForm.addEventListener("submit", (e) => { e.preventDefault(); sendMessage(promptInput.value); });
newChatBtn.addEventListener("click", () => {
  history = [];
  messagesEl.querySelectorAll(".message").forEach((node) => node.remove());
  emptyState.classList.remove("hidden");
  promptInput.focus();
});

listen("model-download-progress", ({ payload }) => {
  const pct = Math.max(0, Math.min(100, payload.percent || 0));
  downloadBar.style.width = `${pct}%`;
  downloadPercent.textContent = `${Math.round(pct)}%`;
  downloadText.textContent = `${formatBytes(payload.downloaded)} of ${formatBytes(payload.total)}`;
});

listen("chat-token", ({ payload }) => {
  if (!activeAssistant) return;
  activeAssistant.textContent += payload.content || "";
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

listen("chat-done", () => {
  if (!activeAssistant) return;
  activeAssistant.classList.remove("typing-cursor");
  const answer = activeAssistant.textContent;
  if (answer) history.push({ role: "assistant", content: answer });
  activeAssistant = null;
  generating = false;
  sendBtn.disabled = false;
  promptInput.focus();
});

(async function boot() {
  const installed = await refreshInstallState();
  if (installed) {
    try {
      const p = await invoke("get_device_profile");
      $("profileSystem").textContent = `${p.os} · ${p.arch}`;
      $("profileCpu").textContent = `${p.cpu} · ${p.logicalCores} threads`;
      $("profileRam").textContent = `${p.ramGb.toFixed(1)} GB`;
      $("profileTier").textContent = p.tier;
      $("scorePill").textContent = `MANIFEST SCORE ${p.score}`;
      profileCard.classList.remove("hidden");
    } catch (_) {}
    setStatus("LOCAL AI INSTALLED / STARTING MANIFEST");
    await startManifest();
  }
})();
