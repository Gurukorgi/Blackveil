/**
 * Blackveil service worker (MV3) — defaults, keyboard toggle, storage-driven toolbar title.
 */

const STORAGE_DEFAULTS = {
  globalEnabled: false,
  allowedSites: [],
  brightness: 95,
  contrast: 105,
  sepia: 8,
};

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(STORAGE_DEFAULTS, (s) => {
      resolve({
        ...STORAGE_DEFAULTS,
        ...s,
        allowedSites: Array.isArray(s.allowedSites) ? s.allowedSites : STORAGE_DEFAULTS.allowedSites,
      });
    });
  });
}

async function setGlobalEnabled(next) {
  await chrome.storage.sync.set({ globalEnabled: Boolean(next) });
}

function updateChromeAction(globalEnabled) {
  const on = globalEnabled === true;
  chrome.action.setBadgeText({ text: '' });
  chrome.action.setTitle({
    title: on
      ? 'Blackveil — ON (allowed sites only)'
      : 'Blackveil — OFF',
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(STORAGE_DEFAULTS, (s) => {
    const patch = {};
    for (const k of Object.keys(STORAGE_DEFAULTS)) {
      if (s[k] === undefined) patch[k] = STORAGE_DEFAULTS[k];
    }
    const done = () => {
      const ge =
        s.globalEnabled !== undefined ? s.globalEnabled : STORAGE_DEFAULTS.globalEnabled;
      updateChromeAction(ge);
    };
    if (Object.keys(patch).length) {
      chrome.storage.sync.set(patch, done);
    } else {
      done();
    }
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.globalEnabled) return;
  updateChromeAction(changes.globalEnabled.newValue === true);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-blackveil') return;
  const s = await getSettings();
  const next = !s.globalEnabled;
  await setGlobalEnabled(next);
  updateChromeAction(next);

  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'blackveil-refresh' });
    } catch {
      /* no content script */
    }
  }
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

getSettings().then((s) => updateChromeAction(s.globalEnabled));
