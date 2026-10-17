const ENABLED_KEY = "memojang:enabled";
const THEME_KEY = "memojang:theme";
const RECORD_PREFIX = "memojang:v1:";
const PURGE_KEY = "memojang:purge-revision";
const brandIcon = document.getElementById("brand-icon");
const enabledButton = document.getElementById("enabled");
const themeSelect = document.getElementById("theme");
const recordCount = document.getElementById("record-count");
const deleteAllButton = document.getElementById("delete-all");
const cancelDeleteButton = document.getElementById("cancel-delete");
const status = document.getElementById("status");
let deletePending = false;
let recordsVersion = 0;

function showError() {
  status.textContent = "설정을 저장하지 못했습니다.";
}

function showMode(enabled) {
  enabledButton.setAttribute("aria-checked", String(enabled));
  brandIcon.src = enabled ? "icons/icon-on.svg" : "icons/icon-off.svg";
}

chrome.storage.local.get([ENABLED_KEY, THEME_KEY]).then(settings => {
  showMode(settings[ENABLED_KEY] !== false);
  themeSelect.value = ["light", "dark"].includes(settings[THEME_KEY]) ? settings[THEME_KEY] : "auto";
}).catch(showError);

async function refreshRecords() {
  const version = ++recordsVersion;
  const stored = await chrome.storage.local.get(null);
  if (version !== recordsVersion) return;
  const keys = Object.keys(stored).filter(key => key.startsWith(RECORD_PREFIX));
  const noteCount = keys.filter(key => !key.endsWith(":draft"))
    .reduce((total, key) => total + (Array.isArray(stored[key]) ? stored[key].length : 0), 0);
  const draftCount = keys.filter(key => key.endsWith(":draft") && typeof stored[key] === "string" && stored[key].length > 0).length;
  recordCount.textContent = `저장된 댓글 ${noteCount}개 · 작성 중인 글 ${draftCount}개`;
  deleteAllButton.disabled = keys.length === 0;
}

function resetDeleteConfirmation() {
  deletePending = false;
  deleteAllButton.textContent = "전체 기록 삭제";
  cancelDeleteButton.hidden = true;
}

void refreshRecords().catch(() => {
  recordCount.textContent = "기록을 확인하지 못했습니다.";
  deleteAllButton.disabled = true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[ENABLED_KEY]) showMode(changes[ENABLED_KEY].newValue !== false);
  if (!Object.keys(changes).some(key => key.startsWith(RECORD_PREFIX))) return;
  void refreshRecords().catch(() => {
    recordCount.textContent = "기록을 확인하지 못했습니다.";
  });
});

enabledButton.addEventListener("click", async () => {
  const next = enabledButton.getAttribute("aria-checked") !== "true";
  enabledButton.disabled = true;
  try {
    await chrome.storage.local.set({ [ENABLED_KEY]: next });
    showMode(next);
    status.textContent = "";
  } catch (error) {
    showError();
  } finally {
    enabledButton.disabled = false;
  }
});

themeSelect.addEventListener("change", async () => {
  try {
    await chrome.storage.local.set({ [THEME_KEY]: themeSelect.value });
    status.textContent = "";
  } catch (error) {
    showError();
  }
});

deleteAllButton.addEventListener("click", async () => {
  if (!deletePending) {
    deletePending = true;
    deleteAllButton.textContent = "정말 모두 삭제";
    cancelDeleteButton.hidden = false;
    status.textContent = "모든 게시물의 로컬 댓글과 작성 중인 글이 지워집니다.";
    return;
  }

  deleteAllButton.disabled = true;
  cancelDeleteButton.disabled = true;
  try {
    const stored = await chrome.storage.local.get(null);
    const keys = Object.keys(stored).filter(key => key.startsWith(RECORD_PREFIX));
    if (keys.length) await chrome.storage.local.remove(keys);
    await chrome.storage.local.set({ [PURGE_KEY]: { revision: crypto.randomUUID(), scope: "all" } });
    resetDeleteConfirmation();
    await refreshRecords();
    status.textContent = "전체 기록을 삭제했습니다.";
  } catch (error) {
    status.textContent = "기록을 삭제하지 못했습니다. 다시 시도해 주세요.";
    deleteAllButton.disabled = false;
  } finally {
    cancelDeleteButton.disabled = false;
  }
});

cancelDeleteButton.addEventListener("click", () => {
  resetDeleteConfirmation();
  status.textContent = "";
});
