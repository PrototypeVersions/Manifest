const cards = {
  apple: document.getElementById('appleCard'),
  intel: document.getElementById('intelCard'),
  windows: document.getElementById('windowsCard')
};
const primary = document.getElementById('primaryDownload');
const recommendation = document.getElementById('recommendationText');

function recommend(type, label, href, detail) {
  Object.values(cards).forEach(card => card?.classList.remove('recommended'));
  cards[type]?.classList.add('recommended');
  if (primary) {
    primary.href = href;
    primary.innerHTML = `${label} <span>↓</span>`;
  }
  if (recommendation) recommendation.textContent = detail;
}

const links = {
  apple: 'https://github.com/PrototypeVersions/Manifest/releases/download/v0.1.0/Manifest-0.1.0-Apple-Silicon.dmg',
  intel: 'https://github.com/PrototypeVersions/Manifest/releases/download/v0.1.0/Manifest-0.1.0-Intel.dmg',
  windows: 'https://github.com/PrototypeVersions/Manifest/releases/download/v0.1.0/Manifest-0.1.0-Windows-x64.exe'
};

async function detectPlatform() {
  const ua = navigator.userAgent || '';
  const platform = navigator.userAgentData?.platform || navigator.platform || '';

  if (/Windows/i.test(ua) || /Windows/i.test(platform)) {
    recommend('windows', 'Download for Windows', links.windows, 'This browser appears to be running on Windows, so the x64 installer is highlighted below.');
    return;
  }

  if (/Mac/i.test(ua) || /Mac/i.test(platform)) {
    let arch = '';
    try {
      if (navigator.userAgentData?.getHighEntropyValues) {
        const values = await navigator.userAgentData.getHighEntropyValues(['architecture', 'bitness']);
        arch = String(values.architecture || '').toLowerCase();
      }
    } catch (_) {}

    if (/x86|amd64/.test(arch)) {
      recommend('intel', 'Download for Intel Mac', links.intel, 'This browser reports an Intel Mac, so the Intel build is highlighted below.');
    } else {
      recommend('apple', 'Download for Apple Silicon', links.apple, 'For modern Macs with an M1, M2, M3, M4 or later chip, use the Apple Silicon build highlighted below.');
    }
    return;
  }

  if (primary) primary.href = '#downloads';
  if (recommendation) recommendation.textContent = 'Choose the platform that matches the computer where you want to run Manifest.';
}

detectPlatform();
