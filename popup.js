/**
 * Blackveil popup — globalEnabled, allowedSites, sliders; notifies content scripts on demand.
 */

const DEFAULTS = {
  globalEnabled: false,
  allowedSites: [],
  brightness: 95,
  contrast: 105,
  sepia: 8,
};

const els = {
  globalToggle: document.getElementById('globalToggle'),
  statusLive: document.getElementById('statusLive'),
  currentDomain: document.getElementById('currentDomain'),
  currentUnavailable: document.getElementById('currentUnavailable'),
  currentActions: document.getElementById('currentActions'),
  btnEnableSite: document.getElementById('btnEnableSite'),
  btnDisableSite: document.getElementById('btnDisableSite'),
  allowedList: document.getElementById('allowedList'),
  allowedListEmpty: document.getElementById('allowedListEmpty'),
  brightness: document.getElementById('brightness'),
  contrast: document.getElementById('contrast'),
  sepia: document.getElementById('sepia'),
  brightnessVal: document.getElementById('brightnessVal'),
  contrastVal: document.getElementById('contrastVal'),
  sepiaVal: document.getElementById('sepiaVal'),
  slidersHelp: document.getElementById('slidersHelp'),
};

let sliderSaveTimer = 0;

/** @type {{ id?: number, url?: string, domainNorm: string, isHttp: boolean } | null} */
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

function announce(msg) {
  els.statusLive.textContent = msg;
}

function savePartial(patch) {
  return chrome.storage.sync.set(patch);
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

function updateSliderLabels() {
  els.brightnessVal.textContent = els.brightness.value;
  els.contrastVal.textContent = els.contrast.value;
  els.sepiaVal.textContent = els.sepia.value;
  els.brightness.setAttribute('aria-valuetext', `${els.brightness.value} percent brightness`);
}

function applyUiFromSettings(s) {
  const globalOn = s.globalEnabled === true;
  updateGlobalToggleUi(globalOn);

  els.brightness.value = String(s.brightness ?? DEFAULTS.brightness);
  els.contrast.value = String(s.contrast ?? DEFAULTS.contrast);
  els.sepia.value = String(s.sepia ?? DEFAULTS.sepia);
  updateSliderLabels();

  renderAllowedList(Array.isArray(s.allowedSites) ? s.allowedSites : []);
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
    rm.setAttribute('aria-label', `Remove ${domain} from allowed sites`);
    rm.textContent = '×';

    rm.addEventListener('click', () => {
      chrome.storage.sync.get(DEFAULTS, async (raw) => {
        const s = { ...DEFAULTS, ...raw };
        const list = Array.isArray(s.allowedSites) ? s.allowedSites : [];
        const next = sortedUniqueDomains(
          list.filter((d) => normalizeDomainInput(d) !== domain),
        );
        await savePartial({ allowedSites: next });
        announce(`Removed ${domain}`);
        await notifyAllWebTabsRefresh();
        chrome.storage.sync.get(DEFAULTS, (r2) => applyUiFromSettings({ ...DEFAULTS, ...r2 }));
      });
    });

    li.appendChild(span);
    li.appendChild(rm);
    els.allowedList.appendChild(li);
  });
}

async function getActiveTabContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    return { id: undefined, url: undefined, domainNorm: '', isHttp: false };
  }
  if (!tab.url) {
    return { id: tab.id, url: tab.url, domainNorm: '', isHttp: false };
  }
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
}

async function notifyTabRefresh(tabId) {
  if (tabId === undefined) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'blackveil-refresh' });
  } catch {
    /* No receiver */
  }
}

async function notifyAllWebTabsRefresh() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const t of tabs) {
    if (t.id !== undefined) await notifyTabRefresh(t.id);
  }
}

els.globalToggle.addEventListener('click', async () => {
  const next = els.globalToggle.getAttribute('aria-pressed') !== 'true';
  await savePartial({ globalEnabled: next });
  updateGlobalToggleUi(next);
  announce(next ? 'Blackveil is ON for allowed sites' : 'Blackveil is OFF everywhere');
  await notifyAllWebTabsRefresh();
});

els.btnEnableSite.addEventListener('click', () => {
  if (!currentTabContext?.domainNorm || currentTabContext.id === undefined) return;

  chrome.storage.sync.get(DEFAULTS, async (raw) => {
    const s = { ...DEFAULTS, ...raw };
    const list = Array.isArray(s.allowedSites) ? [...s.allowedSites] : [];
    const norm = currentTabContext.domainNorm;
    const exists = list.some((d) => normalizeDomainInput(d) === norm);
    if (!exists) list.push(norm);
    await savePartial({
      allowedSites: sortedUniqueDomains(list),
      globalEnabled: true,
    });
    updateGlobalToggleUi(true);
    announce(`Blackveil ON — ${norm} allowed`);
    await notifyAllWebTabsRefresh();
    chrome.storage.sync.get(DEFAULTS, (r2) => applyUiFromSettings({ ...DEFAULTS, ...r2 }));
  });
});

els.btnDisableSite.addEventListener('click', async () => {
  if (!currentTabContext?.domainNorm || currentTabContext.id === undefined) return;

  const norm = currentTabContext.domainNorm;
  chrome.storage.sync.get(DEFAULTS, async (raw) => {
    const s = { ...DEFAULTS, ...raw };
    const list = Array.isArray(s.allowedSites) ? s.allowedSites : [];
    const next = sortedUniqueDomains(
      list.filter((d) => normalizeDomainInput(d) !== norm),
    );
    await savePartial({ allowedSites: next });
    announce(`Removed ${norm} from allowed sites`);
    await notifyAllWebTabsRefresh();
    chrome.storage.sync.get(DEFAULTS, (r2) => applyUiFromSettings({ ...DEFAULTS, ...r2 }));
  });
});

function scheduleSliderSave() {
  if (sliderSaveTimer) window.clearTimeout(sliderSaveTimer);
  sliderSaveTimer = window.setTimeout(() => {
    savePartial({
      brightness: Number(els.brightness.value),
      contrast: Number(els.contrast.value),
      sepia: Number(els.sepia.value),
    });
    announce('Appearance updated');
    notifyAllWebTabsRefresh();
  }, 120);
}

['brightness', 'contrast', 'sepia'].forEach((id) => {
  els[id].addEventListener('input', () => {
    updateSliderLabels();
    scheduleSliderSave();
  });
});

async function bootstrap() {
  chrome.storage.sync.get(DEFAULTS, (raw) => {
    const s = { ...DEFAULTS, ...raw };
    if (!Array.isArray(s.allowedSites)) s.allowedSites = [];
    applyUiFromSettings(s);
  });

  await refreshCurrentTabChrome();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  chrome.storage.sync.get(DEFAULTS, (raw) => {
    const s = { ...DEFAULTS, ...raw };
    if (!Array.isArray(s.allowedSites)) s.allowedSites = [];
    applyUiFromSettings(s);
  });
});

bootstrap();
