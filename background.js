const ENABLED_KEY = "memojang:enabled";

const ICONS = {
  on: {
    "16": "icons/icon-on-16.png",
    "24": "icons/icon-on-24.png",
    "32": "icons/icon-on-32.png"
  },
  off: {
    "16": "icons/icon-off-16.png",
    "24": "icons/icon-off-24.png",
    "32": "icons/icon-off-32.png"
  }
};
let generation = 0;
let iconWrite = Promise.resolve();

async function updateIcon(enabled) {
  await Promise.all([
    chrome.action.setIcon({ path: ICONS[enabled ? "on" : "off"] }),
    chrome.action.setTitle({ title: enabled ? "디시 나만보이는메모장 ON" : "디시 나만보이는메모장 OFF · 원래 댓글창" })
  ]);
}

async function restoreIcon() {
  const request = ++generation;
  const settings = await chrome.storage.local.get(ENABLED_KEY);
  if (request === generation) queueIcon(settings[ENABLED_KEY] !== false);
}

function reportError(error) {
  console.error("[디시 나만보이는메모장] 아이콘을 바꾸지 못했습니다.", error);
}

function queueIcon(enabled) {
  iconWrite = iconWrite.catch(reportError).then(() => updateIcon(enabled));
  void iconWrite.catch(reportError);
}

chrome.runtime.onInstalled.addListener(() => { void restoreIcon().catch(reportError); });
chrome.runtime.onStartup.addListener(() => { void restoreIcon().catch(reportError); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[ENABLED_KEY]) {
    generation += 1;
    queueIcon(changes[ENABLED_KEY].newValue !== false);
  }
});

void restoreIcon().catch(reportError);
