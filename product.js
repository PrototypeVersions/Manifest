const $ = id => document.getElementById(id);

const technicalModel = $("recommendedTier");
const experienceTier = $("experienceTier");
const recommendedExperience = $("recommendedExperience");
const desktopPotentialTier = $("desktopPotentialTier");
const desktopPotentialText = $("desktopPotentialText");
const activeModelLabel = $("activeModelLabel");
const loadNote = $("loadNote");
const deviceModal = $("deviceModal");
const analyzeAgainBtn = $("analyzeAgainBtn");
const useRecommendedBtn = $("useRecommendedBtn");

function browserExperienceFromModel(text = "") {
  if (/Llama 3\.2 1B/i.test(text)) return "Balanced";
  if (/Qwen2 0\.5B/i.test(text)) return "Fast";
  if (/Analyzing/i.test(text)) return "Analyzing…";
  return "Recommended";
}

function updateExperienceLabels() {
  const modelText = technicalModel?.textContent || "";
  const tier = browserExperienceFromModel(modelText);
  if (experienceTier) experienceTier.textContent = tier;
  if (recommendedExperience) recommendedExperience.textContent = tier === "Analyzing…" ? tier : `${tier} Browser AI`;
}

function updateDesktopPotential() {
  if (!desktopPotentialTier || !desktopPotentialText) return;
  const cores = navigator.hardwareConcurrency || 0;
  const memory = navigator.deviceMemory || 0;
  const hasWebGPU = !!navigator.gpu;

  if (hasWebGPU && cores >= 8 && (memory === 0 || memory >= 8)) {
    desktopPotentialTier.textContent = "Strong native potential";
    desktopPotentialText.textContent = "This browser exposes signs of a capable machine. Manifest Desktop will be able to inspect the GPU, memory and storage more directly before recommending larger or specialized local models.";
  } else if (hasWebGPU) {
    desktopPotentialTier.textContent = "Expanded native options";
    desktopPotentialText.textContent = "A native Manifest installation can use deeper hardware information than this webpage and may recommend models beyond the two lightweight browser-demo options.";
  } else {
    desktopPotentialTier.textContent = "Desktop assessment needed";
    desktopPotentialText.textContent = "The browser does not expose enough accelerated-compute information here. Manifest Desktop will perform the more complete local hardware assessment after installation.";
  }
}

function simplifyMainModelLabel() {
  if (!activeModelLabel) return;
  const text = activeModelLabel.textContent || "";
  if (/WebLLM\s*·\s*Llama 3\.2 1B/i.test(text)) activeModelLabel.textContent = "Browser AI · Balanced";
  else if (/WebLLM\s*·\s*Qwen2 0\.5B/i.test(text)) activeModelLabel.textContent = "Browser AI · Fast";
}

function simplifyLoadNote() {
  if (!loadNote) return;
  const text = loadNote.textContent || "";
  if (/Llama 3\.2 1B|Qwen2 0\.5B/i.test(text)) {
    if (/loaded locally/i.test(text)) loadNote.textContent = "Your recommended browser AI is loaded locally and ready to chat.";
    else if (/Load it to start chatting/i.test(text)) loadNote.textContent = "Manifest selected the recommended browser AI for this device. Load it to start chatting.";
    else if (/selected through WebLLM/i.test(text)) loadNote.textContent = "This browser AI is selected. Load it locally to begin chatting.";
  }
}

if (technicalModel) {
  new MutationObserver(() => {
    updateExperienceLabels();
    updateDesktopPotential();
  }).observe(technicalModel, { childList: true, characterData: true, subtree: true });
}

if (activeModelLabel) {
  new MutationObserver(simplifyMainModelLabel).observe(activeModelLabel, { childList: true, characterData: true, subtree: true });
}

if (loadNote) {
  new MutationObserver(simplifyLoadNote).observe(loadNote, { childList: true, characterData: true, subtree: true });
}

analyzeAgainBtn?.addEventListener("click", () => setTimeout(() => {
  updateExperienceLabels();
  updateDesktopPotential();
}, 0));

deviceModal?.addEventListener("toggle", () => {
  updateExperienceLabels();
  updateDesktopPotential();
});

useRecommendedBtn?.addEventListener("click", () => {
  setTimeout(() => {
    simplifyMainModelLabel();
    simplifyLoadNote();
  }, 75);
});

updateExperienceLabels();
updateDesktopPotential();
simplifyMainModelLabel();
simplifyLoadNote();