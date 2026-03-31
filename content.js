/**
 * Blackveil content script — document_start on http(s), all frames.
 * Dark mode applies only when globalEnabled && current host is in allowedSites (normalized match).
 */

const STYLE_MAIN_ID = 'blackveil-main-styles';
const STYLE_SYNC_ID = 'blackveil-sync-blocker';
const DATA_ATTR = 'data-blackveil';

const STORAGE_DEFAULTS = {
  globalEnabled: false,
  allowedSites: [],
  brightness: 95,
  contrast: 105,
  sepia: 8,
};

const WATCHED_STORAGE_KEYS = ['globalEnabled', 'allowedSites', 'brightness', 'contrast', 'sepia'];

let currentSettings = { ...STORAGE_DEFAULTS };
let observer = null;
let debounceTimer = 0;

function normalizeHost(hostname) {
  if (!hostname) return '';
  let h = String(hostname).toLowerCase().trim();
  if (h.startsWith('www.')) h = h.slice(4);
  return h;
}

function getHostname() {
  try {
    return normalizeHost(location.hostname || '');
  } catch {
    return '';
  }
}

/** True if host equals allowed entry or is a subdomain of it (e.g. m.youtube.com vs youtube.com). */
function hostMatchesAllowed(hostnameNorm, allowedEntryNorm) {
  if (!hostnameNorm || !allowedEntryNorm) return false;
  if (hostnameNorm === allowedEntryNorm) return true;
  return hostnameNorm.endsWith('.' + allowedEntryNorm);
}

function isDomainAllowed(hostname, allowedSites) {
  const h = normalizeHost(hostname);
  const list = Array.isArray(allowedSites) ? allowedSites : [];
  return list.some((entry) => hostMatchesAllowed(h, normalizeHost(entry)));
}

function shouldApplyVeil(settings) {
  return (
    settings.globalEnabled === true &&
    isDomainAllowed(getHostname(), settings.allowedSites)
  );
}

/** Anti-FOUC veil — only injected when we are about to show dark styling. */
function ensureSyncVeil() {
  if (document.getElementById(STYLE_SYNC_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_SYNC_ID;
  el.textContent = `
    html { background-color: #0a0a0a !important; min-height: 100% !important; }
    body { background-color: transparent !important; }
  `;
  (document.head || document.documentElement).appendChild(el);
}

function detectAlreadyDarkPreference() {
  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;

  const html = document.documentElement;
  const body = document.body;
  const classHints = /^(dark|theme-dark|night-mode|dark-mode)$/i;
  const hasDarkClass =
    (html &&
      Array.from(html.classList || []).some((c) => classHints.test(String(c)))) ||
    (body &&
      Array.from(body.classList || []).some((c) => classHints.test(String(c))));

  let dataThemeDark = false;
  try {
    const t =
      html && (html.getAttribute('data-theme') || html.getAttribute('data-color-mode'));
    dataThemeDark = t && String(t).toLowerCase().includes('dark');
  } catch {
    /* ignore */
  }

  return Boolean(prefersDark || hasDarkClass || dataThemeDark);
}

function buildCss(settings, softMode) {
  const b = Number(settings.brightness) || 95;
  const c = Number(settings.contrast) || 105;
  const s = Number(settings.sepia) || 0;
  const rootBg = softMode ? '#121212' : '#0a0a0a';
  const rootFg = softMode ? '#e6e6e6' : '#eaeaea';

  if (softMode) {
    return `
:root {
  color-scheme: dark !important;
}
html {
  background-color: ${rootBg} !important;
  color: ${rootFg} !important;
}
body {
  background-color: transparent !important;
  color: inherit !important;
}
html {
  filter: brightness(${b / 100}) contrast(${c / 100}) sepia(${s / 100}) !important;
}
`;
  }

  return `
:root {
  color-scheme: dark !important;
}
html {
  background-color: ${rootBg} !important;
  filter: invert(1) hue-rotate(180deg) brightness(${b / 100}) contrast(${c / 100}) sepia(${s / 100}) !important;
}
body {
  background-color: transparent !important;
}
img, picture, video, canvas, svg, iframe,
[role="img"],
object,
embed {
  filter: invert(1) hue-rotate(180deg) !important;
}
[style*="background-image"] {
  filter: invert(1) hue-rotate(180deg) !important;
}
`;
}

function removeBlackveil() {
  document.documentElement.removeAttribute(DATA_ATTR);
  const main = document.getElementById(STYLE_MAIN_ID);
  if (main) main.remove();
  const sync = document.getElementById(STYLE_SYNC_ID);
  if (sync) sync.remove();
}

function applyBlackveil(settings) {
  if (!shouldApplyVeil(settings)) {
    removeBlackveil();
    return;
  }

  ensureSyncVeil();
  document.documentElement.setAttribute(DATA_ATTR, 'on');

  const soft = detectAlreadyDarkPreference();
  const cssText = buildCss(settings, soft);

  let style = document.getElementById(STYLE_MAIN_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_MAIN_ID;
    (document.head || document.documentElement).appendChild(style);
  }
  style.textContent = cssText;

  const sync = document.getElementById(STYLE_SYNC_ID);
  if (sync) {
    sync.textContent = `
      html { background-color: transparent !important; min-height: 100% !important; }
    `;
  }
}

function reloadSettingsAndApply() {
  chrome.storage.sync.get(STORAGE_DEFAULTS, (raw) => {
    currentSettings = { ...STORAGE_DEFAULTS, ...raw };
    if (!Array.isArray(currentSettings.allowedSites)) {
      currentSettings.allowedSites = [];
    }
    applyBlackveil(currentSettings);
  });
}

function scheduleApply() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => applyBlackveil(currentSettings), 16);
}

function attachObserver() {
  if (observer) return;
  observer = new MutationObserver(() => scheduleApply());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'data-color-mode'],
    subtree: true,
  });
}

function init() {
  reloadSettingsAndApply();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    let touched = false;
    for (const k of WATCHED_STORAGE_KEYS) {
      if (changes[k]) {
        currentSettings[k] = changes[k].newValue ?? STORAGE_DEFAULTS[k];
        touched = true;
      }
    }
    if (touched) {
      if (
        changes.allowedSites &&
        !Array.isArray(currentSettings.allowedSites)
      ) {
        currentSettings.allowedSites = [];
      }
      applyBlackveil(currentSettings);
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'blackveil-refresh') {
      chrome.storage.sync.get(STORAGE_DEFAULTS, (raw) => {
        currentSettings = { ...STORAGE_DEFAULTS, ...raw };
        if (!Array.isArray(currentSettings.allowedSites)) {
          currentSettings.allowedSites = [];
        }
        applyBlackveil(currentSettings);
        sendResponse({ ok: true });
      });
      return true;
    }
  });

  window.addEventListener(
    'pageshow',
    () => {
      applyBlackveil(currentSettings);
    },
    true,
  );

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') applyBlackveil(currentSettings);
  });

  attachObserver();
}

init();
