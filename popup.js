/**
 * Blackveil popup — tabs, presets, night shift, schedule, respect-site, storage sync.
 */

const DEFAULTS = {
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
  colorPaletteId: 'neutral-grey-pro',
  presetGrayscale: false,
  scheduleEnabled: false,
  scheduleMode: 'sunset',
  scheduleCustomStart: '22:00',
  scheduleCustomEnd: '07:00',
  scheduleNightStartHour: 19,
  scheduleNightEndHour: 7,
};

function paletteList() {
  return typeof self !== 'undefined' && Array.isArray(self.BLACKVEIL_PALETTE_LIST)
    ? self.BLACKVEIL_PALETTE_LIST
    : [];
}

function normalizePaletteId(id) {
  const map =
    typeof self !== 'undefined' && self.BLACKVEIL_PALETTE_BY_ID
      ? self.BLACKVEIL_PALETTE_BY_ID
      : {};
  if (id && map[id]) return id;
  return DEFAULTS.colorPaletteId;
}

/** Built-in presets: tune sliders + optional night shift / OLED / grayscale. */
const PRESET_DEFS = [
  {
    id: 'deep-void',
    label: 'Deep Void',
    brightness: 86,
    contrast: 112,
    sepia: 4,
    nightShiftWarmth: 15,
    nightShiftEnabled: false,
    rootBgTone: 'void',
    presetGrayscale: false,
  },
  {
    id: 'soft-eclipse',
    label: 'Soft Eclipse',
    brightness: 95,
    contrast: 105,
    sepia: 8,
    nightShiftWarmth: 25,
    nightShiftEnabled: false,
    rootBgTone: 'soft',
    presetGrayscale: false,
  },
  {
    id: 'sepia-night',
    label: 'Sepia Night',
    brightness: 90,
    contrast: 102,
    sepia: 20,
    nightShiftWarmth: 72,
    nightShiftEnabled: true,
    rootBgTone: 'soft',
    presetGrayscale: false,
  },
  {
    id: 'high-contrast',
    label: 'High Contrast',
    brightness: 100,
    contrast: 128,
    sepia: 0,
    nightShiftWarmth: 0,
    nightShiftEnabled: false,
    rootBgTone: 'oled',
    presetGrayscale: false,
  },
  {
    id: 'grayscale',
    label: 'Grayscale',
    brightness: 96,
    contrast: 108,
    sepia: 0,
    nightShiftWarmth: 10,
    nightShiftEnabled: false,
    rootBgTone: 'void',
    presetGrayscale: true,
  },
];

const els = {
  statusLive: document.getElementById('statusLive'),
  globalToggle: document.getElementById('globalToggle'),
  respectSiteToggle: document.getElementById('respectSiteToggle'),
  currentDomain: document.getElementById('currentDomain'),
  currentUnavailable: document.getElementById('currentUnavailable'),
  currentActions: document.getElementById('currentActions'),
  btnEnableSite: document.getElementById('btnEnableSite'),
  btnDisableSite: document.getElementById('btnDisableSite'),
  allowedList: document.getElementById('allowedList'),
  allowedListEmpty: document.getElementById('allowedListEmpty'),
  presetGrid: document.getElementById('presetGrid'),
  paletteGrid: document.getElementById('paletteGrid'),
  saveCustomPreset: document.getElementById('saveCustomPreset'),
  nightShiftToggle: document.getElementById('nightShiftToggle'),
  nightShiftWarmth: document.getElementById('nightShiftWarmth'),
  nightShiftWarmthVal: document.getElementById('nightShiftWarmthVal'),
  brightness: document.getElementById('brightness'),
  contrast: document.getElementById('contrast'),
  sepia: document.getElementById('sepia'),
  brightnessVal: document.getElementById('brightnessVal'),
  contrastVal: document.getElementById('contrastVal'),
  sepiaVal: document.getElementById('sepiaVal'),
  slidersHelp: document.getElementById('slidersHelp'),
  scheduleEnabled: document.getElementById('scheduleEnabled'),
  scheduleSunsetPanel: document.getElementById('scheduleSunsetPanel'),
  scheduleCustomPanel: document.getElementById('scheduleCustomPanel'),
  scheduleNightStartHour: document.getElementById('scheduleNightStartHour'),
  scheduleNightEndHour: document.getElementById('scheduleNightEndHour'),
  scheduleCustomStart: document.getElementById('scheduleCustomStart'),
  scheduleCustomEnd: document.getElementById('scheduleCustomEnd'),
  allowCallout: document.getElementById('allowCallout'),
  allowCalloutDomain: document.getElementById('allowCalloutDomain'),
};

let sliderSaveTimer = 0;
let scheduleSaveTimer = 0;
let currentTabContext = null;

function normalizeDomainInput(raw) {
  if (raw == null || raw === '') return '';
  let s = String(raw).trim().toLowerCase();
  s = s.replace(/^https?:\/\//i, '');
  s = s.split('/')[0] || '';
  s = s.split('?')[0] || '';
  if (s.includes(':')) s = s.split(':')[0];
  if (s.startsWith('www.')) s = s.slice(4);
  return s;
}

function normalizeHostFromUrl(url) {
  try {
    const u = new URL(url);
    return normalizeDomainInput(u.hostname);
  } catch {
    return '';
  }
}

function mergeS(raw) {
  const s = { ...DEFAULTS, ...raw };
  s.allowedSites = Array.isArray(s.allowedSites) ? s.allowedSites : [];
  s.respectSiteThemes = Array.isArray(s.respectSiteThemes) ? s.respectSiteThemes : [];
  s.colorPaletteId = normalizePaletteId(s.colorPaletteId);
  return s;
}

function announce(msg) {
  els.statusLive.textContent = msg;
}

function savePartial(patch) {
  return chrome.storage.sync.set(patch);
}

function sortedUniqueDomains(list) {
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const n = normalizeDomainInput(entry);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  out.sort();
  return out;
}

function hostMatchesAllowed(hostnameNorm, allowedEntryNorm) {
  if (!hostnameNorm || !allowedEntryNorm) return false;
  if (hostnameNorm === allowedEntryNorm) return true;
  return hostnameNorm.endsWith('.' + allowedEntryNorm);
}

function isRespectOnForDomain(domainNorm, respectList) {
  const h = normalizeDomainInput(domainNorm);
  return respectList.some((entry) => hostMatchesAllowed(h, normalizeDomainInput(entry)));
}

/** Same rules as content script: exact host or subdomain of an allowed entry. */
function isDomainInAllowedList(domainNorm, allowedSites) {
  const h = normalizeDomainInput(domainNorm);
  if (!h) return false;
  const list = Array.isArray(allowedSites) ? allowedSites : [];
  return list.some((entry) => hostMatchesAllowed(h, normalizeDomainInput(entry)));
}

function updateAllowCallout(m) {
  const show =
    m.globalEnabled === true &&
    currentTabContext?.isHttp &&
    currentTabContext?.domainNorm &&
    !isDomainInAllowedList(currentTabContext.domainNorm, m.allowedSites);
  els.allowCallout.classList.toggle('hidden', !show);
  if (show) {
    els.allowCalloutDomain.textContent = currentTabContext.domainNorm;
  }
}

function updateSliderDisabled(globalOn) {
  const disabled = !globalOn;
  [els.brightness, els.contrast, els.sepia].forEach((el) => {
    el.disabled = disabled;
    el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  });
  els.slidersHelp.classList.toggle('muted-strong', disabled);
}

function updateGlobalToggleUi(globalOn) {
  els.globalToggle.textContent = globalOn ? 'Blackveil ON' : 'Blackveil OFF';
  els.globalToggle.classList.toggle('is-on', globalOn);
  els.globalToggle.setAttribute('aria-pressed', globalOn ? 'true' : 'false');
  updateSliderDisabled(globalOn);
}

function updateNightShiftUi(enabled) {
  els.nightShiftToggle.textContent = enabled ? 'Night shift ON' : 'Night shift OFF';
  els.nightShiftToggle.classList.toggle('is-on', enabled);
  els.nightShiftToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
}

function updateSliderLabels() {
  els.brightnessVal.textContent = els.brightness.value;
  els.contrastVal.textContent = els.contrast.value;
  els.sepiaVal.textContent = els.sepia.value;
  els.nightShiftWarmthVal.textContent = els.nightShiftWarmth.value;
  els.brightness.setAttribute('aria-valuetext', `${els.brightness.value} percent brightness`);
}

function highlightActivePreset(activeId) {
  els.presetGrid.querySelectorAll('.preset-chip').forEach((btn) => {
    const on = btn.dataset.presetId === activeId;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function highlightActivePalette(activeId) {
  const id = normalizePaletteId(activeId);
  els.paletteGrid.querySelectorAll('.palette-chip').forEach((btn) => {
    const on = btn.dataset.paletteId === id;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function renderPaletteGrid() {
  if (!els.paletteGrid) return;
  els.paletteGrid.innerHTML = '';
  paletteList().forEach((p) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'palette-chip';
    btn.dataset.paletteId = p.id;
    btn.setAttribute('aria-pressed', 'false');
    const sw = document.createElement('span');
    sw.className = 'palette-chip-swatch';
    ;[p.bg, p.surface, p.primary, p.accent].forEach((hex) => {
      const seg = document.createElement('span');
      seg.style.background = hex;
      seg.title = hex;
      sw.appendChild(seg);
    });
    btn.appendChild(sw);
    const lab = document.createElement('span');
    lab.textContent = p.label;
    btn.appendChild(lab);
    btn.addEventListener('click', async () => {
      await savePartial({ colorPaletteId: p.id });
      highlightActivePalette(p.id);
      announce(`Palette: ${p.label}`);
      await notifyAllWebTabsRefresh();
    });
    els.paletteGrid.appendChild(btn);
  });
}

function applyPresetToStorage(presetId, announceMsg = true) {
  const def = PRESET_DEFS.find((p) => p.id === presetId);
  if (!def) return;

  els.brightness.value = String(def.brightness);
  els.contrast.value = String(def.contrast);
  els.sepia.value = String(def.sepia);
  els.nightShiftWarmth.value = String(def.nightShiftWarmth);
  updateNightShiftUi(def.nightShiftEnabled);
  updateSliderLabels();

  savePartial({
    activePresetId: def.id,
    brightness: def.brightness,
    contrast: def.contrast,
    sepia: def.sepia,
    nightShiftWarmth: def.nightShiftWarmth,
    nightShiftEnabled: def.nightShiftEnabled,
    rootBgTone: def.rootBgTone,
    presetGrayscale: def.presetGrayscale,
  });
  highlightActivePreset(def.id);
  if (announceMsg) announce(`Preset: ${def.label}`);
  notifyAllWebTabsRefresh();
}

function renderPresetGrid() {
  els.presetGrid.innerHTML = '';
  PRESET_DEFS.forEach((def) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-chip';
    btn.dataset.presetId = def.id;
    btn.textContent = def.label;
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => applyPresetToStorage(def.id));
    els.presetGrid.appendChild(btn);
  });
  const custom = document.createElement('button');
  custom.type = 'button';
  custom.className = 'preset-chip';
  custom.dataset.presetId = 'custom';
  custom.textContent = 'Custom';
  custom.addEventListener('click', () => {
    chrome.storage.sync.get(DEFAULTS, async (raw) => {
      const s = mergeS(raw);
      const c = s.customPreset;
      if (c && typeof c === 'object') {
        els.brightness.value = String(c.brightness ?? s.brightness);
        els.contrast.value = String(c.contrast ?? s.contrast);
        els.sepia.value = String(c.sepia ?? s.sepia);
        els.nightShiftWarmth.value = String(c.nightShiftWarmth ?? s.nightShiftWarmth);
        updateNightShiftUi(Boolean(c.nightShiftEnabled));
        updateSliderLabels();
        await savePartial({
          activePresetId: 'custom',
          brightness: Number(els.brightness.value),
          contrast: Number(els.contrast.value),
          sepia: Number(els.sepia.value),
          nightShiftWarmth: Number(els.nightShiftWarmth.value),
          nightShiftEnabled: Boolean(c.nightShiftEnabled),
          rootBgTone: c.rootBgTone ?? s.rootBgTone,
          colorPaletteId: normalizePaletteId(c.colorPaletteId ?? s.colorPaletteId),
          presetGrayscale: Boolean(c.presetGrayscale),
        });
      } else {
        await savePartial({ activePresetId: 'custom' });
      }
      highlightActivePreset('custom');
      highlightActivePalette(normalizePaletteId(c?.colorPaletteId ?? s.colorPaletteId));
      announce('Custom preset');
      await notifyAllWebTabsRefresh();
    });
  });
  els.presetGrid.appendChild(custom);
}

function applyUiFromSettings(s) {
  const m = mergeS(s);
  updateGlobalToggleUi(m.globalEnabled === true);

  if (m.activePresetId === 'custom' && m.customPreset && typeof m.customPreset === 'object') {
    const c = m.customPreset;
    els.brightness.value = String(c.brightness ?? m.brightness);
    els.contrast.value = String(c.contrast ?? m.contrast);
    els.sepia.value = String(c.sepia ?? m.sepia);
    els.nightShiftWarmth.value = String(c.nightShiftWarmth ?? m.nightShiftWarmth);
    updateNightShiftUi(
      c.nightShiftEnabled !== undefined ? Boolean(c.nightShiftEnabled) : m.nightShiftEnabled === true,
    );
  } else {
    els.brightness.value = String(m.brightness);
    els.contrast.value = String(m.contrast);
    els.sepia.value = String(m.sepia);
    els.nightShiftWarmth.value = String(m.nightShiftWarmth);
    updateNightShiftUi(m.nightShiftEnabled === true);
  }

  updateSliderLabels();
  highlightActivePreset(m.activePresetId || 'soft-eclipse');
  highlightActivePalette(m.colorPaletteId);

  els.scheduleEnabled.checked = m.scheduleEnabled === true;
  document.querySelectorAll('input[name="scheduleMode"]').forEach((r) => {
    r.checked = r.value === (m.scheduleMode || 'sunset');
  });
  els.scheduleNightStartHour.value = String(m.scheduleNightStartHour ?? 19);
  els.scheduleNightEndHour.value = String(m.scheduleNightEndHour ?? 7);
  els.scheduleCustomStart.value = m.scheduleCustomStart || '22:00';
  els.scheduleCustomEnd.value = m.scheduleCustomEnd || '07:00';
  updateSchedulePanels();

  updateRespectCheckbox();
  renderAllowedList(m.allowedSites);
  updateAllowCallout(m);
}

function updateSchedulePanels() {
  const mode =
    document.querySelector('input[name="scheduleMode"]:checked')?.value || 'sunset';
  els.scheduleSunsetPanel.classList.toggle('hidden', mode !== 'sunset');
  els.scheduleCustomPanel.classList.toggle('hidden', mode !== 'custom');
}

function updateRespectCheckbox() {
  if (!currentTabContext?.domainNorm) {
    els.respectSiteToggle.disabled = true;
    els.respectSiteToggle.checked = false;
    return;
  }
  chrome.storage.sync.get(DEFAULTS, (raw) => {
    const m = mergeS(raw);
    els.respectSiteToggle.disabled = false;
    els.respectSiteToggle.checked = isRespectOnForDomain(
      currentTabContext.domainNorm,
      m.respectSiteThemes,
    );
  });
}

function renderAllowedList(allowedSites) {
  const sorted = sortedUniqueDomains(allowedSites);
  els.allowedList.innerHTML = '';
  els.allowedListEmpty.classList.toggle('hidden', sorted.length > 0);

  sorted.forEach((domain) => {
    const li = document.createElement('li');
    li.className = 'allowed-item';
    const span = document.createElement('span');
    span.className = 'allowed-domain';
    span.textContent = domain;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'remove-site';
    rm.setAttribute('aria-label', `Remove ${domain}`);
    rm.textContent = '×';
    rm.addEventListener('click', () => {
      chrome.storage.sync.get(DEFAULTS, async (raw) => {
        const m = mergeS(raw);
        const list = m.allowedSites.filter((d) => normalizeDomainInput(d) !== domain);
        const respect = m.respectSiteThemes.filter((d) => normalizeDomainInput(d) !== domain);
        await savePartial({ allowedSites: sortedUniqueDomains(list), respectSiteThemes: sortedUniqueDomains(respect) });
        announce(`Removed ${domain}`);
        await notifyAllWebTabsRefresh();
        chrome.storage.sync.get(DEFAULTS, (r2) => applyUiFromSettings(r2));
      });
    });
    li.appendChild(span);
    li.appendChild(rm);
    els.allowedList.appendChild(li);
  });
}

async function getActiveTabContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { id: undefined, url: undefined, domainNorm: '', isHttp: false };
  if (!tab.url) return { id: tab.id, url: tab.url, domainNorm: '', isHttp: false };
  const isHttp = /^https?:/i.test(tab.url);
  const domainNorm = isHttp ? normalizeHostFromUrl(tab.url) : '';
  return { id: tab.id, url: tab.url, domainNorm, isHttp };
}

function updateCurrentSiteUi() {
  if (!currentTabContext) {
    els.currentDomain.textContent = '—';
    els.currentUnavailable.classList.remove('hidden');
    els.currentActions.classList.add('hidden');
    return;
  }
  if (!currentTabContext.isHttp || !currentTabContext.domainNorm) {
    els.currentDomain.textContent = currentTabContext.url ? 'Not a web page' : '—';
    els.currentUnavailable.classList.remove('hidden');
    els.currentActions.classList.add('hidden');
    return;
  }
  els.currentDomain.textContent = currentTabContext.domainNorm;
  els.currentUnavailable.classList.add('hidden');
  els.currentActions.classList.remove('hidden');
}

async function refreshCurrentTabChrome() {
  currentTabContext = await getActiveTabContext();
  updateCurrentSiteUi();
  updateRespectCheckbox();
  chrome.storage.sync.get(DEFAULTS, (raw) => updateAllowCallout(mergeS(raw)));
}

async function notifyTabRefresh(tabId) {
  if (tabId === undefined) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'blackveil-refresh' });
  } catch {
    /* ignore */
  }
}

async function notifyAllWebTabsRefresh() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const t of tabs) {
    if (t.id !== undefined) await notifyTabRefresh(t.id);
  }
}

function markCustomIfManual() {
  savePartial({ activePresetId: 'custom' });
  highlightActivePreset('custom');
}

/* Tabs */
document.querySelectorAll('.tab-strip .tab').forEach((tabBtn) => {
  tabBtn.addEventListener('click', () => {
    const panel = tabBtn.dataset.panel;
    document.querySelectorAll('.tab-strip .tab').forEach((t) => {
      const on = t === tabBtn;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-panel').forEach((p) => {
      const show = p.id === `panel-${panel}`;
      p.classList.toggle('active', show);
      p.hidden = !show;
    });
  });
});

renderPaletteGrid();
renderPresetGrid();

els.globalToggle.addEventListener('click', async () => {
  const next = els.globalToggle.getAttribute('aria-pressed') !== 'true';
  await savePartial({ globalEnabled: next });
  updateGlobalToggleUi(next);
  announce(next ? 'Blackveil ON' : 'Blackveil OFF');
  await notifyAllWebTabsRefresh();
});

els.nightShiftToggle.addEventListener('click', async () => {
  const next = els.nightShiftToggle.getAttribute('aria-pressed') !== 'true';
  await savePartial({ nightShiftEnabled: next });
  updateNightShiftUi(next);
  markCustomIfManual();
  announce(next ? 'Night shift on' : 'Night shift off');
  await notifyAllWebTabsRefresh();
});

els.respectSiteToggle.addEventListener('change', async () => {
  if (!currentTabContext?.domainNorm) return;
  const on = els.respectSiteToggle.checked;
  const norm = currentTabContext.domainNorm;
  chrome.storage.sync.get(DEFAULTS, async (raw) => {
    const m = mergeS(raw);
    let list = [...m.respectSiteThemes];
    const has = list.some((d) => normalizeDomainInput(d) === norm);
    if (on && !has) list.push(norm);
    if (!on) list = list.filter((d) => normalizeDomainInput(d) !== norm);
    await savePartial({ respectSiteThemes: sortedUniqueDomains(list) });
    announce(on ? `Respecting native dark on ${norm}` : `Full styling on ${norm}`);
    await notifyAllWebTabsRefresh();
  });
});

els.btnEnableSite.addEventListener('click', () => {
  if (!currentTabContext?.domainNorm) return;
  chrome.storage.sync.get(DEFAULTS, async (raw) => {
    const m = mergeS(raw);
    const list = [...m.allowedSites];
    const norm = currentTabContext.domainNorm;
    if (!list.some((d) => normalizeDomainInput(d) === norm)) list.push(norm);
    await savePartial({ allowedSites: sortedUniqueDomains(list), globalEnabled: true });
    updateGlobalToggleUi(true);
    announce(`Blackveil ON — ${norm}`);
    await notifyAllWebTabsRefresh();
    chrome.storage.sync.get(DEFAULTS, (r2) => applyUiFromSettings(r2));
  });
});

els.btnDisableSite.addEventListener('click', () => {
  if (!currentTabContext?.domainNorm) return;
  const norm = currentTabContext.domainNorm;
  chrome.storage.sync.get(DEFAULTS, async (raw) => {
    const m = mergeS(raw);
    const list = m.allowedSites.filter((d) => normalizeDomainInput(d) !== norm);
    const respect = m.respectSiteThemes.filter((d) => normalizeDomainInput(d) !== norm);
    await savePartial({
      allowedSites: sortedUniqueDomains(list),
      respectSiteThemes: sortedUniqueDomains(respect),
    });
    announce(`Removed ${norm}`);
    await notifyAllWebTabsRefresh();
    chrome.storage.sync.get(DEFAULTS, (r2) => applyUiFromSettings(r2));
  });
});

els.saveCustomPreset.addEventListener('click', () => {
  chrome.storage.sync.get(DEFAULTS, async (raw) => {
    const m = mergeS(raw);
    const snap = {
      brightness: Number(els.brightness.value),
      contrast: Number(els.contrast.value),
      sepia: Number(els.sepia.value),
      nightShiftWarmth: Number(els.nightShiftWarmth.value),
      nightShiftEnabled: els.nightShiftToggle.getAttribute('aria-pressed') === 'true',
      rootBgTone: m.rootBgTone,
      colorPaletteId: m.colorPaletteId,
      presetGrayscale: m.presetGrayscale,
    };
    await savePartial({ customPreset: snap, activePresetId: 'custom' });
    highlightActivePreset('custom');
    announce('Custom preset saved');
    await notifyAllWebTabsRefresh();
  });
});

function scheduleSliderSave() {
  if (sliderSaveTimer) window.clearTimeout(sliderSaveTimer);
  sliderSaveTimer = window.setTimeout(() => {
    markCustomIfManual();
    savePartial({
      brightness: Number(els.brightness.value),
      contrast: Number(els.contrast.value),
      sepia: Number(els.sepia.value),
      nightShiftWarmth: Number(els.nightShiftWarmth.value),
    });
    announce('Look updated');
    notifyAllWebTabsRefresh();
  }, 120);
}

['brightness', 'contrast', 'sepia', 'nightShiftWarmth'].forEach((id) => {
  els[id].addEventListener('input', () => {
    updateSliderLabels();
    scheduleSliderSave();
  });
});

function saveScheduleFromUi() {
  const mode = document.querySelector('input[name="scheduleMode"]:checked')?.value || 'sunset';
  savePartial({
    scheduleEnabled: els.scheduleEnabled.checked,
    scheduleMode: mode,
    scheduleCustomStart: els.scheduleCustomStart.value,
    scheduleCustomEnd: els.scheduleCustomEnd.value,
    scheduleNightStartHour: Math.min(23, Math.max(0, parseInt(els.scheduleNightStartHour.value, 10) || 19)),
    scheduleNightEndHour: Math.min(23, Math.max(0, parseInt(els.scheduleNightEndHour.value, 10) || 7)),
  });
  announce(els.scheduleEnabled.checked ? 'Schedule on' : 'Schedule off');
}

els.scheduleEnabled.addEventListener('change', () => {
  saveScheduleFromUi();
});

document.querySelectorAll('input[name="scheduleMode"]').forEach((r) => {
  r.addEventListener('change', () => {
    updateSchedulePanels();
    if (scheduleSaveTimer) window.clearTimeout(scheduleSaveTimer);
    scheduleSaveTimer = window.setTimeout(saveScheduleFromUi, 50);
  });
});

[els.scheduleNightStartHour, els.scheduleNightEndHour, els.scheduleCustomStart, els.scheduleCustomEnd].forEach(
  (inp) => {
    inp.addEventListener('change', () => {
      if (scheduleSaveTimer) window.clearTimeout(scheduleSaveTimer);
      scheduleSaveTimer = window.setTimeout(saveScheduleFromUi, 80);
    });
  },
);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  chrome.storage.sync.get(DEFAULTS, (raw) => applyUiFromSettings(raw));
});

async function bootstrap() {
  chrome.storage.sync.get(DEFAULTS, (raw) => applyUiFromSettings(raw));
  await refreshCurrentTabChrome();
}

bootstrap();
