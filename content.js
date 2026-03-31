/**
 * Blackveil content script — document_start. Applies when globalEnabled && allowed site.
 * Modes: invert, soft (native dark), minimal (respect + native dark), Night Shift, presets, grayscale.
 */

const STYLE_MAIN_ID = 'blackveil-main-styles';
const STYLE_SYNC_ID = 'blackveil-sync-blocker';
const DATA_ATTR = 'data-blackveil';

const STORAGE_DEFAULTS = {
  globalEnabled: false,
  allowedSites: [],
  respectSiteThemes: [],
  brightness: 95,
  contrast: 105,
  sepia: 8,
  nightShiftEnabled: false,
  nightShiftWarmth: 40,
  activePresetId: 'soft-eclipse',
  customPreset: null,
  rootBgTone: 'soft',
  presetGrayscale: false,
  scheduleEnabled: false,
  scheduleMode: 'sunset',
  scheduleCustomStart: '22:00',
  scheduleCustomEnd: '07:00',
  scheduleNightStartHour: 19,
  scheduleNightEndHour: 7,
};

const WATCHED_STORAGE_KEYS = [
  'globalEnabled',
  'allowedSites',
  'respectSiteThemes',
  'brightness',
  'contrast',
  'sepia',
  'nightShiftEnabled',
  'nightShiftWarmth',
  'activePresetId',
  'customPreset',
  'rootBgTone',
  'presetGrayscale',
  'scheduleEnabled',
  'scheduleMode',
  'scheduleCustomStart',
  'scheduleCustomEnd',
  'scheduleNightStartHour',
  'scheduleNightEndHour',
];

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

function isRespectEnabledForHost(hostname, respectList) {
  const h = normalizeHost(hostname);
  const list = Array.isArray(respectList) ? respectList : [];
  return list.some((entry) => hostMatchesAllowed(h, normalizeHost(entry)));
}

function shouldApplyVeil(settings) {
  return (
    settings.globalEnabled === true &&
    isDomainAllowed(getHostname(), settings.allowedSites)
  );
}

function rootBgFromTone(tone, mode) {
  const t = tone || 'soft';
  if (t === 'oled') return '#000000';
  if (t === 'void') return '#0a0a0a';
  return mode === 'soft' || mode === 'minimal' ? '#121212' : '#0a0a0a';
}

/** Subtle card / elevated surface on top of root bg */
function surfaceBgFromRoot(rootBg) {
  if (rootBg === '#000000') return '#0a0a0a';
  if (rootBg === '#0a0a0a') return '#141414';
  return '#1a1a1a';
}

/** Warm blue-light reduction; strength from nightShiftWarmth 0–1 when night shift on. */
function nightShiftFilterExtra(settings) {
  if (!settings.nightShiftEnabled) return '';
  const w = Math.min(1, Math.max(0, (Number(settings.nightShiftWarmth) || 0) / 100));
  const sepia = (0.28 * w).toFixed(3);
  const hue = (-22 * w).toFixed(1);
  return ` sepia(${sepia}) hue-rotate(${hue}deg)`;
}

function grayscaleExtra(settings) {
  if (!settings.presetGrayscale) return '';
  return ' grayscale(0.88)';
}

function classListMatchesDark(el) {
  if (!el || !el.classList) return false;
  const re =
    /^(dark|theme-dark|night-mode|dark-mode|dark-theme|sl-theme-dark|skin-night)$/i;
  return Array.from(el.classList).some((c) => re.test(String(c)));
}

function attributeImpliesDark(el) {
  if (!el) return false;
  const attrs = ['data-theme', 'data-color-mode', 'data-bs-theme', 'data-mantine-color-scheme'];
  for (const a of attrs) {
    const v = el.getAttribute(a);
    if (v && String(v).toLowerCase().includes('dark')) return true;
  }
  return false;
}

/**
 * True when the *page* declares a dark theme (classes, data-attributes, meta).
 * We intentionally do NOT use prefers-color-scheme alone: many users run OS dark
 * mode while sites stay light — treating that as "soft" mode made pages barely change.
 */
function detectPageDarkThemeHints() {
  const html = document.documentElement;
  const body = document.body;

  if (classListMatchesDark(html) || classListMatchesDark(body)) return true;
  if (attributeImpliesDark(html) || attributeImpliesDark(body)) return true;

  try {
    if (
      document.querySelector(
        '[data-theme="dark"],[data-color-mode="dark"],[data-bs-theme="dark"],[data-mantine-color-scheme="dark"]',
      )
    ) {
      return true;
    }
  } catch {
    /* ignore */
  }

  const meta = document.querySelector('meta[name="color-scheme"],meta[name="theme-color"]');
  if (meta) {
    const c = (meta.getAttribute('content') || '').toLowerCase();
    if (c.includes('dark')) return true;
  }

  return false;
}

/**
 * minimal = respect + page already themed dark (gentle polish only).
 * soft = page already themed dark, light filter tweak.
 * forced = typical light sites — paint surfaces/text dark (no invert / no “theme filter”).
 */
function pickStyleMode(settings) {
  const pageDark = detectPageDarkThemeHints();
  const respect = isRespectEnabledForHost(getHostname(), settings.respectSiteThemes);
  if (respect && pageDark) return 'minimal';
  if (pageDark) return 'soft';
  return 'forced';
}

function buildCss(settings, mode) {
  const b = Number(settings.brightness) || 95;
  const c = Number(settings.contrast) || 105;
  const s = Number(settings.sepia) || 0;
  const tone = settings.rootBgTone || 'soft';
  const rootBg = rootBgFromTone(tone, mode);
  const rootFg = mode === 'minimal' ? '#e8e8e8' : '#eaeaea';
  const ns = nightShiftFilterExtra(settings);
  const g = grayscaleExtra(settings);

  if (mode === 'minimal') {
    const bf = Math.min(1.05, 0.94 + (b / 100) * 0.1);
    const cf = Math.min(1.08, 0.98 + (c / 100) * 0.1);
    const sep = (s / 100) * 0.35;
    return `
:root { color-scheme: dark !important; }
html {
  background-color: ${rootBg} !important;
  color: ${rootFg} !important;
  filter: brightness(${bf}) contrast(${cf}) sepia(${sep})${ns}${g} !important;
}
body {
  background-color: transparent !important;
  color: inherit !important;
}
`;
  }

  if (mode === 'soft') {
    return `
:root { color-scheme: dark !important; }
html {
  background-color: ${rootBg} !important;
  color: ${rootFg} !important;
}
body {
  background-color: transparent !important;
  color: inherit !important;
}
html {
  filter: brightness(${b / 100}) contrast(${c / 100}) sepia(${s / 100})${ns}${g} !important;
}
`;
  }

  /* Structural forced dark — real surfaces & text; sliders = brightness/contrast only (+ optional grayscale). */
  const surf = surfaceBgFromRoot(rootBg);
  const link = '#8ab4f8';
  const border = '#3d3d42';
  const inputBg = '#26262b';
  const tune = `brightness(${b / 100}) contrast(${c / 100})${g}`;
  const wNight = settings.nightShiftEnabled
    ? Math.min(1, Math.max(0, (Number(settings.nightShiftWarmth) || 0) / 100))
    : 0;
  const nightOpacity = (0.04 + 0.14 * wNight).toFixed(3);

  return `
:root {
  color-scheme: dark !important;
  --bv-bg: ${rootBg};
  --bv-surface: ${surf};
  --bv-fg: ${rootFg};
  --bv-link: ${link};
  --bv-border: ${border};
  --bv-input: ${inputBg};
}
html {
  background-color: var(--bv-bg) !important;
  color: var(--bv-fg) !important;
  filter: ${tune} !important;
}
${
  settings.nightShiftEnabled
    ? `
html::after {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483646;
  background: rgba(255, 145, 75, ${nightOpacity});
  mix-blend-mode: multiply;
}`
    : ''
}
body {
  background-color: var(--bv-bg) !important;
  color: var(--bv-fg) !important;
}
main, article, section, nav, aside, header, footer, form,
[role="main"], [role="navigation"], [role="banner"], [role="contentinfo"], [role="dialog"],
[class*="container"], [class*="wrapper"], [class*="content"], [class*="layout"], [class*="Card"], [class*="card"],
[id*="content"], [id*="main"], [id*="wrapper"] {
  background-color: var(--bv-bg) !important;
  color: var(--bv-fg) !important;
  border-color: var(--bv-border) !important;
}
div {
  background-color: var(--bv-bg) !important;
  color: var(--bv-fg) !important;
  border-color: var(--bv-border) !important;
}
p, span, li, dd, dt, label, figcaption, h1, h2, h3, h4, h5, h6,
blockquote, small, strong, em, b, i, cite {
  color: var(--bv-fg) !important;
}
a, a:visited { color: var(--bv-link) !important; }
button, input, textarea, select, optgroup {
  background-color: var(--bv-input) !important;
  color: var(--bv-fg) !important;
  border-color: var(--bv-border) !important;
}
table, thead, tbody, tfoot, tr { background-color: var(--bv-bg) !important; border-color: var(--bv-border) !important; }
th, td {
  background-color: var(--bv-surface) !important;
  color: var(--bv-fg) !important;
  border-color: var(--bv-border) !important;
}
pre, code, kbd, samp {
  background-color: var(--bv-surface) !important;
  color: var(--bv-fg) !important;
  border-color: var(--bv-border) !important;
}
hr { border-color: var(--bv-border) !important; background-color: var(--bv-border) !important; }
ul, ol, dl { background-color: transparent !important; color: var(--bv-fg) !important; }
img, picture, video, canvas, iframe, embed, object {
  background-color: transparent !important;
}
svg { background-color: transparent !important; }
`;
}

function ensureSyncVeil(rootBg) {
  if (document.getElementById(STYLE_SYNC_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_SYNC_ID;
  el.textContent = `
    html { background-color: ${rootBg} !important; min-height: 100% !important; }
    body { background-color: transparent !important; }
  `;
  (document.head || document.documentElement).appendChild(el);
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

  const styleMode = pickStyleMode(settings);
  const rootBg = rootBgFromTone(settings.rootBgTone || 'soft', styleMode);
  ensureSyncVeil(rootBg);
  document.documentElement.setAttribute(DATA_ATTR, 'on');

  const cssText = buildCss(settings, styleMode);

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

function normalizeMergedSettings(raw) {
  const m = { ...STORAGE_DEFAULTS, ...raw };
  m.allowedSites = Array.isArray(m.allowedSites) ? m.allowedSites : [];
  m.respectSiteThemes = Array.isArray(m.respectSiteThemes) ? m.respectSiteThemes : [];
  return m;
}

function reloadSettingsAndApply() {
  chrome.storage.sync.get(STORAGE_DEFAULTS, (raw) => {
    currentSettings = normalizeMergedSettings(raw);
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
    attributeFilter: ['class', 'data-theme', 'data-color-mode', 'data-bs-theme'],
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
      currentSettings = normalizeMergedSettings({
        ...STORAGE_DEFAULTS,
        ...currentSettings,
      });
      applyBlackveil(currentSettings);
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'blackveil-refresh') {
      chrome.storage.sync.get(STORAGE_DEFAULTS, (raw) => {
        currentSettings = normalizeMergedSettings(raw);
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
