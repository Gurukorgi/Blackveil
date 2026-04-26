/**
 * Blackveil service worker — storage defaults, shortcuts, schedule (alarms), context menus, tab refresh.
 */

const SCHEDULE_ALARM = 'blackveil-schedule';

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
  colorPaletteId: 'neutral-grey-pro',
  presetGrayscale: false,
  scheduleEnabled: false,
  scheduleMode: 'sunset',
  scheduleCustomStart: '22:00',
  scheduleCustomEnd: '07:00',
  scheduleNightStartHour: 19,
  scheduleNightEndHour: 7,
};

function normalizeDomainFromUrl(url) {
  try {
    const u = new URL(url);
    let h = (u.hostname || '').toLowerCase();
    if (h.startsWith('www.')) h = h.slice(4);
    return h;
  } catch {
    return '';
  }
}

function normalizeDomainEntry(raw) {
  if (raw == null || raw === '') return '';
  let s = String(raw).trim().toLowerCase();
  s = s.replace(/^https?:\/\//i, '');
  s = s.split('/')[0] || '';
  if (s.includes(':')) s = s.split(':')[0];
  if (s.startsWith('www.')) s = s.slice(4);
  return s;
}

function sortedUnique(list) {
  const seen = new Set();
  const out = [];
  for (const e of list || []) {
    const n = normalizeDomainEntry(e);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  out.sort();
  return out;
}

function mergeSettings(s) {
  return {
    ...STORAGE_DEFAULTS,
    ...s,
    allowedSites: Array.isArray(s.allowedSites) ? s.allowedSites : STORAGE_DEFAULTS.allowedSites,
    respectSiteThemes: Array.isArray(s.respectSiteThemes)
      ? s.respectSiteThemes
      : STORAGE_DEFAULTS.respectSiteThemes,
  };
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(STORAGE_DEFAULTS, (s) => resolve(mergeSettings(s)));
  });
}

async function setGlobalEnabled(next) {
  await chrome.storage.sync.set({ globalEnabled: Boolean(next) });
}

function updateChromeAction(globalEnabled) {
  const on = globalEnabled === true;
  chrome.action.setBadgeText({ text: '' });
  chrome.action.setTitle({
    title: on ? 'Blackveil — ON (allowed sites only)' : 'Blackveil — OFF',
  });
}

function minutesFromMidnight(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes();
}

function parseHHMM(s) {
  const p = String(s || '00:00').split(':');
  const h = Math.min(23, Math.max(0, parseInt(p[0], 10) || 0));
  const m = Math.min(59, Math.max(0, parseInt(p[1], 10) || 0));
  return h * 60 + m;
}

/** True during "night" window when schedule should force global ON. */
function isScheduleNightWindow(settings, now = new Date()) {
  const nowM = minutesFromMidnight(now);
  if (settings.scheduleMode === 'custom') {
    const start = parseHHMM(settings.scheduleCustomStart);
    const end = parseHHMM(settings.scheduleCustomEnd);
    if (start > end) return nowM >= start || nowM < end;
    if (start === end) return false;
    return nowM >= start && nowM < end;
  }
  const h = now.getHours();
  const ns = Number(settings.scheduleNightStartHour) ?? 19;
  const ne = Number(settings.scheduleNightEndHour) ?? 7;
  if (ns > ne) return h >= ns || h < ne;
  if (ns === ne) return false;
  return h >= ns && h < ne;
}

async function applyScheduleTick() {
  const s = await getSettings();
  if (!s.scheduleEnabled) return;
  const wantOn = isScheduleNightWindow(s);
  if (wantOn !== s.globalEnabled) {
    await chrome.storage.sync.set({ globalEnabled: wantOn });
    updateChromeAction(wantOn);
    await refreshAllContentTabs();
  }
}

function ensureScheduleAlarm(enabled) {
  if (enabled) {
    chrome.alarms.create(SCHEDULE_ALARM, { periodInMinutes: 1 });
    applyScheduleTick();
  } else {
    chrome.alarms.clear(SCHEDULE_ALARM);
  }
}

async function refreshAllContentTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'blackveil-refresh' });
    } catch {
      /* no receiver */
    }
  }
}

function contextMenusRemoveAll() {
  return new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function contextMenuCreate(props) {
  return new Promise((resolve) => {
    chrome.contextMenus.create(props, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

/** Serialized rebuild: overlapping onInstalled + onStartup could create duplicate ids before removeAll finished. */
let contextMenuSetupChain = Promise.resolve();

function buildContextMenus() {
  contextMenuSetupChain = contextMenuSetupChain
    .catch(() => {})
    .then(async () => {
      await contextMenusRemoveAll();
      await contextMenuCreate({
        id: 'bv-enable-site',
        title: 'Enable Blackveil on this site',
        contexts: ['page'],
      });
      await contextMenuCreate({
        id: 'bv-disable-site',
        title: 'Disable Blackveil on this site',
        contexts: ['page'],
      });
      await contextMenuCreate({
        id: 'bv-toggle-night',
        title: 'Toggle Night Shift',
        contexts: ['page', 'frame'],
      });
    });
  return contextMenuSetupChain;
}

chrome.runtime.onInstalled.addListener(() => {
  buildContextMenus();

  chrome.storage.sync.get(STORAGE_DEFAULTS, (s) => {
    const patch = {};
    for (const k of Object.keys(STORAGE_DEFAULTS)) {
      if (s[k] === undefined) patch[k] = STORAGE_DEFAULTS[k];
    }
    const done = () => {
      const ge =
        s.globalEnabled !== undefined ? s.globalEnabled : STORAGE_DEFAULTS.globalEnabled;
      updateChromeAction(ge);
      ensureScheduleAlarm(mergeSettings({ ...s, ...patch }).scheduleEnabled);
    };
    if (Object.keys(patch).length) {
      chrome.storage.sync.set(patch, done);
    } else {
      done();
    }
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.globalEnabled) {
    updateChromeAction(changes.globalEnabled.newValue === true);
  }
  if (changes.scheduleEnabled) {
    ensureScheduleAlarm(changes.scheduleEnabled.newValue === true);
  }
  const scheduleKeys = [
    'scheduleMode',
    'scheduleCustomStart',
    'scheduleCustomEnd',
    'scheduleNightStartHour',
    'scheduleNightEndHour',
  ];
  if (scheduleKeys.some((k) => changes[k])) {
    applyScheduleTick();
  }
});

chrome.runtime.onStartup.addListener(() => {
  buildContextMenus();
  getSettings().then((s) => ensureScheduleAlarm(s.scheduleEnabled));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SCHEDULE_ALARM) applyScheduleTick();
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-blackveil' || command === 'toggle-global-ctrl') {
    const s = await getSettings();
    const next = !s.globalEnabled;
    await setGlobalEnabled(next);
    updateChromeAction(next);
    await refreshAllContentTabs();
    return;
  }
  if (command === 'toggle-night-shift') {
    const s = await getSettings();
    await chrome.storage.sync.set({ nightShiftEnabled: !s.nightShiftEnabled });
    await refreshAllContentTabs();
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.pageUrl || tab?.url || '';
  if (!/^https?:/i.test(url)) return;

  if (info.menuItemId === 'bv-toggle-night') {
    const s = await getSettings();
    await chrome.storage.sync.set({ nightShiftEnabled: !s.nightShiftEnabled });
    await refreshAllContentTabs();
    return;
  }

  const host = normalizeDomainFromUrl(url);
  if (!host) return;

  const s = await getSettings();
  let list = Array.isArray(s.allowedSites) ? [...s.allowedSites] : [];

  if (info.menuItemId === 'bv-enable-site') {
    if (!list.some((d) => normalizeDomainEntry(d) === host)) {
      list.push(host);
    }
    await chrome.storage.sync.set({
      allowedSites: sortedUnique(list),
      globalEnabled: true,
    });
    updateChromeAction(true);
  } else if (info.menuItemId === 'bv-disable-site') {
    list = list.filter((d) => normalizeDomainEntry(d) !== host);
    await chrome.storage.sync.set({ allowedSites: sortedUnique(list) });
  }

  await refreshAllContentTabs();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'blackveil-get-global-enabled') {
    getSettings().then((s) => sendResponse({ globalEnabled: s.globalEnabled }));
    return true;
  }
  if (msg?.type === 'blackveil-set-global-enabled') {
    setGlobalEnabled(msg.globalEnabled).then(() => {
      updateChromeAction(msg.globalEnabled);
      sendResponse({ ok: true });
    });
    return true;
  }
});

getSettings().then((s) => {
  updateChromeAction(s.globalEnabled);
  ensureScheduleAlarm(s.scheduleEnabled);
});
