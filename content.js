/**
 * Blackveil content script — document_start. Applies when globalEnabled && allowed site.
 * Modes: invert, soft (native dark), minimal (respect + native dark), Night Shift, presets, grayscale.
 */

const STYLE_MAIN_ID = 'blackveil-main-styles';
const STYLE_SYNC_ID = 'blackveil-sync-blocker';
const DATA_ATTR = 'data-blackveil';

const DEFAULT_PALETTE_ID = 'neutral-grey-pro';

const STORAGE_DEFAULTS = {
  globalEnabled: false,
  allowedSites: [],
  respectSiteThemes: [],
  brightness: 95,
  contrast: 98,
  sepia: 8,
  nightShiftEnabled: false,
  nightShiftWarmth: 40,
  activePresetId: 'soft-eclipse',
  customPreset: null,
  rootBgTone: 'soft',
  colorPaletteId: DEFAULT_PALETTE_ID,
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
  'colorPaletteId',
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

function paletteMap() {
  return typeof self !== 'undefined' && self.BLACKVEIL_PALETTE_BY_ID
    ? self.BLACKVEIL_PALETTE_BY_ID
    : typeof globalThis !== 'undefined' && globalThis.BLACKVEIL_PALETTE_BY_ID
      ? globalThis.BLACKVEIL_PALETTE_BY_ID
      : {};
}

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return { r: 24, g: 24, b: 27 };
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToChannel(x) {
  return Math.min(255, Math.max(0, Math.round(x)));
}

function rgbToHex(r, g, b) {
  return (
    '#' +
    [r, g, b]
      .map((c) => rgbToChannel(c).toString(16).padStart(2, '0'))
      .join('')
  );
}

function mixHex(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const u = Math.min(1, Math.max(0, t));
  return rgbToHex(A.r + (B.r - A.r) * u, A.g + (B.g - A.g) * u, A.b + (B.b - A.b) * u);
}

/** Presets still set rootBgTone: nudge palette colors toward black for void / oled. */
function applyToneToHex(hex, tone) {
  const t = tone || 'soft';
  if (t === 'void') return mixHex(hex, '#000000', 0.12);
  if (t === 'oled') return mixHex(hex, '#000000', 0.28);
  return hex;
}

/**
 * Resolved colors for the active palette (+ optional tone). Maps design tokens to CSS.
 */
function getPaletteTokens(settings) {
  const map = paletteMap();
  const id = settings.colorPaletteId || DEFAULT_PALETTE_ID;
  const base = map[id] || map[DEFAULT_PALETTE_ID];
  if (!base) {
    return {
      rootBg: '#18181B',
      surface: '#27272A',
      fg: '#E4E4E7',
      link: '#2563EB',
      border: '#3f3f46',
      input: '#3f3f46',
    };
  }
  const tone = settings.rootBgTone || 'soft';
  const rootBg = applyToneToHex(base.bg, tone);
  const surface = applyToneToHex(base.surface, tone);
  return {
    rootBg,
    surface,
    fg: base.textMain,
    link: base.primary,
    border: mixHex(surface, base.textMuted, 0.5),
    input: mixHex(surface, rootBg, 0.4),
    accent: base.accent,
    secondary: base.secondary,
    muted: base.textMuted,
  };
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

function isGoogleDocsEditorHost() {
  const h = getHostname();
  return h === 'docs.google.com';
}

function isNicholasAccountsHost() {
  return getHostname() === 'accounts.nicholasidoko.com';
}

/**
 * minimal = respect + page already themed dark (gentle polish only).
 * soft = page already themed dark, light filter tweak.
 * invert-canvas-app = Google Docs/Sheets Kix — canvas must NOT be counter-inverted or the page stays white with illegible ink.
 * forced = typical light sites — structural !important (breaks canvas editors if misapplied).
 */
function pickStyleMode(settings) {
  const pageDark = detectPageDarkThemeHints();
  const respect = isRespectEnabledForHost(getHostname(), settings.respectSiteThemes);
  if (respect && pageDark) return 'minimal';
  if (pageDark) return 'soft';
  if (isGoogleDocsEditorHost()) return 'invert-canvas-app';
  return 'forced';
}

function buildCss(settings, mode) {
  const b = Number(settings.brightness) || 95;
  const c = Number(settings.contrast) || 98;
  const s = Number(settings.sepia) || 0;
  const tokens = getPaletteTokens(settings);
  const { rootBg, surface, fg: rootFg, link, border, input, muted } = tokens;
  const ns = nightShiftFilterExtra(settings);
  const g = grayscaleExtra(settings);
  const preserveNicholasWhatsAppUi = isNicholasAccountsHost();
  /** Darker ink + input-toned chip so search / contact field icons are not light-on-light vs --bv-fg spans. */
  const iconAdorn = mixHex(muted, rootBg, 0.52);
  /* Text-like controls only: applying background-image:none to all inputs removed checkbox/radio marks. */
  const formFixCss = `
button, textarea, select, optgroup,
input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="tel"],
input[type="email"], input[type="password"], input[type="number"], input[type="date"],
input[type="datetime-local"], input[type="time"], input[type="month"], input[type="week"],
input[type="submit"], input[type="reset"], input[type="button"] {
  background-color: var(--bv-input) !important;
  background-image: none !important;
  color: var(--bv-fg) !important;
  -webkit-text-fill-color: var(--bv-fg) !important;
  border: 1px solid var(--bv-border) !important;
  box-shadow: none !important;
  outline: none !important;
  caret-color: var(--bv-fg) !important;
}
input[type="checkbox"], input[type="radio"] {
  background-color: var(--bv-input) !important;
  accent-color: var(--bv-link) !important;
  color: var(--bv-fg) !important;
  border: 1px solid var(--bv-border) !important;
  caret-color: var(--bv-fg) !important;
}
input[type="range"] {
  accent-color: var(--bv-link) !important;
}
input[type="file"] {
  color: var(--bv-fg) !important;
  border-color: var(--bv-border) !important;
}
input[type="color"] {
  border: 1px solid var(--bv-border) !important;
}
textarea, [contenteditable=""], [contenteditable="true"], [role="textbox"] {
  background-color: var(--bv-input) !important;
  background-image: none !important;
  color: var(--bv-fg) !important;
  -webkit-text-fill-color: var(--bv-fg) !important;
  caret-color: var(--bv-fg) !important;
}
[contenteditable], [role="textbox"],
.ql-container, .ql-editor, .ProseMirror,
.DraftEditor-root, .public-DraftEditor-content {
  background-color: var(--bv-input) !important;
  background-image: none !important;
  color: var(--bv-fg) !important;
  -webkit-text-fill-color: var(--bv-fg) !important;
}
[contenteditable] *, [role="textbox"] *,
.ql-editor *, .ProseMirror *, .DraftEditor-root * {
  background-image: none !important;
  color: var(--bv-fg) !important;
  -webkit-text-fill-color: var(--bv-fg) !important;
}
input::placeholder, textarea::placeholder, [contenteditable]::placeholder {
  color: var(--bv-muted) !important;
}
`;

  /* Native + custom dropdown panels: forced mode sets light text on all li/span; pale menus become unreadable. */
  const dropdownPanelCss = `
select option, select optgroup option {
  background-color: var(--bv-surface) !important;
  color: var(--bv-fg) !important;
}
[role="listbox"],
[role="menu"],
[role="menu"] [role="presentation"],
[class*="Listbox"],
[class*="listbox"],
[class*="Menu-list"],
[class*="menu-list"],
[class*="Dropdown-menu"],
[class*="dropdown-menu"],
[class*="Select-menu"],
[class*="select-menu"],
[class*="popover-content"][class*="select"],
[class*="combobox"] + [class*="list"],
[class*="ComboboxOptions"],
[class*="OptionsList"],
[data-headlessui-state] [role="option"],
[data-radix-popper-content-wrapper] [role="listbox"],
[data-radix-popper-content-wrapper] [role="option"],
.MuiPaper-root.MuiMenu-paper,
.MuiAutocomplete-popper .MuiPaper-root,
.MuiPopover-paper {
  background-color: var(--bv-surface) !important;
  color: var(--bv-fg) !important;
}
[role="listbox"] [role="option"],
[role="menu"] [role="menuitem"],
[role="menuitemradio"],
[role="menuitemcheckbox"],
.MuiMenuItem-root,
.MuiAutocomplete-option,
.MuiListItemButton-root,
[class*="MenuItem"],
[class*="menu-item"],
[class*="dropdown-option"],
[class*="select-option"],
[data-headlessui-state][role="option"] {
  background-color: var(--bv-surface) !important;
  color: var(--bv-fg) !important;
  -webkit-text-fill-color: var(--bv-fg) !important;
}
[role="listbox"] li,
[role="menu"] li {
  background-color: var(--bv-surface) !important;
  color: var(--bv-fg) !important;
  -webkit-text-fill-color: var(--bv-fg) !important;
}
[role="listbox"] li:hover,
[role="menu"] li:hover {
  background-color: var(--bv-input) !important;
  color: var(--bv-fg) !important;
}
[role="option"]:hover,
[role="menuitem"]:hover,
.MuiMenuItem-root:hover,
.MuiAutocomplete-option:hover,
.MuiListItemButton-root:hover,
[class*="MenuItem"]:hover {
  background-color: var(--bv-input) !important;
  color: var(--bv-fg) !important;
}
[role="option"][aria-selected="true"],
.Mui-selected.MuiMenuItem-root,
.MuiAutocomplete-option[aria-selected="true"] {
  background-color: var(--bv-input) !important;
  color: var(--bv-link) !important;
}
`;

  const inputAffixCss = `
span:has(+ input[type="search"]),
div:has(+ input[type="search"]),
i:has(+ input[type="search"]),
span:has(+ input[type="text"][placeholder*="search" i]),
div:has(+ input[type="text"][placeholder*="search" i]),
i:has(+ input[type="text"][placeholder*="search" i]),
span:has(+ input[type="text"][placeholder*="Search"]),
div:has(+ input[type="text"][placeholder*="Search"]),
i:has(+ input[type="text"][placeholder*="Search"]) {
  background-color: var(--bv-input) !important;
  color: ${iconAdorn} !important;
  -webkit-text-fill-color: ${iconAdorn} !important;
}
span:has(+ input[type="search"]) svg,
div:has(+ input[type="search"]) svg,
i:has(+ input[type="search"]) svg,
span:has(+ input[type="text"][placeholder*="search" i]) svg,
div:has(+ input[type="text"][placeholder*="search" i]) svg,
i:has(+ input[type="text"][placeholder*="search" i]) svg,
span:has(+ input[type="text"][placeholder*="Search"]) svg,
div:has(+ input[type="text"][placeholder*="Search"]) svg,
i:has(+ input[type="text"][placeholder*="Search"]) svg {
  color: ${iconAdorn} !important;
  fill: ${iconAdorn} !important;
  stroke: ${iconAdorn} !important;
}
div:has(> input[type="search"]) > *:first-child:not(input),
div:has(> input[type="text"][placeholder*="search" i]) > *:first-child:not(input),
div:has(> input[type="text"][placeholder*="Search"]) > *:first-child:not(input) {
  background-color: var(--bv-input) !important;
  color: ${iconAdorn} !important;
  -webkit-text-fill-color: ${iconAdorn} !important;
}
div:has(> input[type="search"]) > *:first-child:not(input) svg,
div:has(> input[type="text"][placeholder*="search" i]) > *:first-child:not(input) svg,
div:has(> input[type="text"][placeholder*="Search"]) > *:first-child:not(input) svg {
  color: ${iconAdorn} !important;
  fill: ${iconAdorn} !important;
  stroke: ${iconAdorn} !important;
}
.MuiInputBase-root:has(input[type="search"]) .MuiInputAdornment-positionStart,
.MuiInputBase-root:has(input[placeholder*="search" i]) .MuiInputAdornment-positionStart,
[class*="InputBase-root"]:has(input[type="search"]) [class*="InputAdornment-positionStart"],
[class*="InputBase-root"]:has(input[placeholder*="search" i]) [class*="InputAdornment-positionStart"] {
  background-color: var(--bv-input) !important;
  color: ${iconAdorn} !important;
  -webkit-text-fill-color: ${iconAdorn} !important;
}
.MuiInputBase-root:has(input[type="search"]) .MuiInputAdornment-positionStart svg,
.MuiInputBase-root:has(input[placeholder*="search" i]) .MuiInputAdornment-positionStart svg,
[class*="InputBase-root"]:has(input[type="search"]) [class*="InputAdornment"] svg,
[class*="InputBase-root"]:has(input[placeholder*="search" i]) [class*="InputAdornment"] svg {
  color: ${iconAdorn} !important;
  fill: ${iconAdorn} !important;
  stroke: ${iconAdorn} !important;
}
`;

  const siteSpecificUiGuardCss = preserveNicholasWhatsAppUi
    ? `
/* Preserve native WhatsApp inbox hierarchy on this host. */
.chat-composer-input-wrap,
#chat-message-input,
.chat-composer-actions,
.chat-emoji-dropdown .btn,
.chat-media-dropdown .btn,
#chat-send-button,
.chat-bubble,
.chat-quoted-reply,
.chat-contact-card,
.chat-media-preview figure,
.chat-reply-preview {
  background: revert !important;
  background-color: revert !important;
  border: revert !important;
  box-shadow: revert !important;
  outline: revert !important;
  color: revert !important;
  -webkit-text-fill-color: revert !important;
}
#chat-send-button .chat-send-button-label,
#chat-send-button .material-icons {
  color: revert !important;
  -webkit-text-fill-color: revert !important;
}
`
    : '';

  if (mode === 'minimal') {
    const bf = Math.min(1.05, 0.94 + (b / 100) * 0.1);
    const cf = Math.min(1.08, 0.98 + (c / 100) * 0.1);
    const sep = (s / 100) * 0.35;
    return `
:root {
  color-scheme: dark !important;
  --bv-fg: ${rootFg};
  --bv-link: ${link};
  --bv-border: ${border};
  --bv-input: ${input};
  --bv-surface: ${surface};
  --bv-muted: ${muted};
}
html {
  background-color: ${rootBg} !important;
  color: ${rootFg} !important;
  filter: brightness(${bf}) contrast(${cf}) sepia(${sep})${ns}${g} !important;
}
body {
  background-color: transparent !important;
  color: inherit !important;
}
a, a:visited { color: ${link} !important; }
${formFixCss}${inputAffixCss}${dropdownPanelCss}${siteSpecificUiGuardCss}
`;
  }

  if (mode === 'soft') {
    return `
:root {
  color-scheme: dark !important;
  --bv-fg: ${rootFg};
  --bv-link: ${link};
  --bv-border: ${border};
  --bv-input: ${input};
  --bv-surface: ${surface};
  --bv-muted: ${muted};
}
html {
  background-color: ${rootBg} !important;
  color: ${rootFg} !important;
}
body {
  background-color: transparent !important;
  color: inherit !important;
}
a, a:visited { color: ${link} !important; }
html {
  filter: brightness(${b / 100}) contrast(${c / 100}) sepia(${s / 100})${ns}${g} !important;
}
${formFixCss}${inputAffixCss}${dropdownPanelCss}${siteSpecificUiGuardCss}
`;
  }

  /* Google Docs: editor draws to <canvas>. Global invert + counter-invert on canvas restored a white “paper”
   * and broke contrast. Counter-invert everything except canvas so tiles stay inverted (dark + readable). */
  if (mode === 'invert-canvas-app') {
    return `
:root { color-scheme: dark !important; }
html {
  background-color: ${rootBg} !important;
  filter: invert(1) hue-rotate(180deg) brightness(${b / 100}) contrast(${c / 100}) sepia(${s / 100})${ns}${g} !important;
}
body { background-color: transparent !important; }
input, textarea, [contenteditable], [role="textbox"] {
  /* After page invert, this maps to a visible light caret. */
  caret-color: #000 !important;
}
img, picture, video, svg, iframe,
[role="img"], object, embed {
  filter: invert(1) hue-rotate(180deg) !important;
}
[style*="background-image"]:not(canvas) {
  filter: invert(1) hue-rotate(180deg) !important;
}
`;
  }

  /* Structural recolor — palette + light text; sliders = brightness/contrast only (+ optional grayscale). */
  const surf = surface;
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
  --bv-input: ${input};
  --bv-muted: ${muted};
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
[id*="content"], [id*="main"], [id*="wrapper"],
div[class*="container"], div[class*="wrapper"], div[class*="content"], div[class*="layout"],
div[class*="panel"], div[class*="section"], div[class*="body"],
div[id*="content"], div[id*="main"], div[id*="root"] {
  background-color: var(--bv-bg) !important;
  color: var(--bv-fg) !important;
}
div {
  background-color: transparent !important;
}
/* Preserve transparency on decorative/overlay elements to avoid flattening the UI. */
div[style*="background: transparent"], div[style*="background-color: transparent"],
div[aria-hidden="true"], div[class*="icon"], div[class*="avatar"], div[class*="badge"] {
  background-color: transparent !important;
}
/* Chat app specific: keep outer bubble themed, but avoid nested opaque layers. */
.chat-bubble-body {
  background-color: var(--bv-bg) !important;
  box-shadow: none !important;
  outline: none !important;
}
[class^="chat-template-"], [class*=" chat-template-"] {
  background-color: transparent !important;
  box-shadow: none !important;
  outline: none !important;
}
[class^="chat-template-"] *, [class*=" chat-template-"] * {
  background-color: transparent !important;
}
.chat-bubble-body::before, .chat-bubble-body::after {
  display: none !important;
  content: none !important;
  background: none !important;
  border: none !important;
}
p, span, li, dd, dt, label, figcaption, h1, h2, h3, h4, h5, h6,
blockquote, small, strong, em, b, i, cite {
  color: var(--bv-fg) !important;
}
a, a:visited { color: var(--bv-link) !important; }
${formFixCss}${inputAffixCss}${dropdownPanelCss}${siteSpecificUiGuardCss}
table, thead, tbody, tfoot, tr { background-color: var(--bv-bg) !important; }
th, td {
  background-color: var(--bv-surface) !important;
  color: var(--bv-fg) !important;
}
pre, code, kbd, samp {
  background-color: var(--bv-surface) !important;
  color: var(--bv-fg) !important;
}
hr { background-color: var(--bv-border) !important; }
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
  const rootBg = getPaletteTokens(settings).rootBg;
  ensureSyncVeil(rootBg);
  document.documentElement.setAttribute(DATA_ATTR, 'on');

  const cssText = buildCss(settings, styleMode);

  let style = document.getElementById(STYLE_MAIN_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_MAIN_ID;
  }
  style.textContent = cssText;
  // Keep Blackveil style last so late app styles don't override !important rules.
  (document.head || document.documentElement).appendChild(style);

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
  if (!m.colorPaletteId || !paletteMap()[m.colorPaletteId]) {
    m.colorPaletteId = DEFAULT_PALETTE_ID;
  }
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
