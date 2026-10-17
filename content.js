(() => {
  "use strict";

  const ROOT_ID = "memojang-root";
  const STORAGE_PREFIX = "memojang:v1:";
  const ENABLED_KEY = "memojang:enabled";
  const THEME_KEY = "memojang:theme";
  const PURGE_KEY = "memojang:purge-revision";
  const MAX_LENGTH = 10000;

  let currentKey = null;
  let currentHost = null;
  let currentAnchor = null;
  let currentView = null;
  let loadVersion = 0;
  let mountQueued = false;
  let settingsLoaded = false;
  let enabled = true;
  let themeSetting = "auto";
  let hiddenNative = null;
  let nativeDisplay = "";
  let nativeDisplayPriority = "";
  let ownPurgeRevision = null;
  const recentViews = new Set();

  function formatTime(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const pad = value => String(value).padStart(2, "0");
    return `${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function getPost() {
    const url = new URL(location.href);
    if (url.hostname !== "gall.dcinside.com" || !/\/(?:board\/view|mgallery\/board\/view|mini\/board\/view|person\/board\/view)\/?$/.test(url.pathname)) {
      return null;
    }
    const gallery = url.searchParams.get("id");
    const number = url.searchParams.get("no");
    if (!gallery || !number) return null;
    return {
      number,
      key: `${STORAGE_PREFIX}${url.pathname.replace(/\/$/, "")}:${gallery}:${number}`
    };
  }

  function findAnchor(number) {
    return document.getElementById(`comment_wrap_${number}`);
  }

  function restoreNativeForm() {
    if (!hiddenNative) return;
    if (nativeDisplay) {
      hiddenNative.style.setProperty("display", nativeDisplay, nativeDisplayPriority);
    } else {
      hiddenNative.style.removeProperty("display");
    }
    hiddenNative = null;
  }

  function findNativeForm(anchor, number) {
    const container = anchor.closest("#focus_cmt") || anchor.parentElement;
    const textarea = document.getElementById(`memo_${number}`);
    if (!container || !textarea || !container.contains(textarea)) return null;
    let form = textarea;
    while (form.parentElement && form.parentElement !== container) form = form.parentElement;
    return form.parentElement === container && !form.contains(anchor) && !form.contains(currentHost) ? form : null;
  }

  function syncNativeForm(anchor, number) {
    const form = enabled ? findNativeForm(anchor, number) : null;
    if (hiddenNative && (hiddenNative !== form || !enabled)) restoreNativeForm();
    if (!enabled || !form || hiddenNative === form) return;
    hiddenNative = form;
    nativeDisplay = form.style.getPropertyValue("display");
    nativeDisplayPriority = form.style.getPropertyPriority("display");
    form.style.setProperty("display", "none", "important");
  }

  function detectTheme(anchor) {
    if (themeSetting !== "auto") return themeSetting;
    for (let element = anchor; element; element = element.parentElement) {
      const color = getComputedStyle(element).backgroundColor;
      const values = color.match(/[\d.]+/g)?.map(Number);
      if (!values || values.length < 3 || (values.length > 3 && values[3] < 0.5)) continue;
      const brightness = (values[0] * 299 + values[1] * 587 + values[2] * 114) / 1000;
      return brightness < 145 ? "dark" : "light";
    }
    return "light";
  }

  function applyPageState(anchor, number) {
    if (!currentHost || !currentView) return;
    currentView.attachToCommentList(anchor);
    currentView.setEnabled(enabled);
    currentView.setTheme(detectTheme(anchor));
    syncNativeForm(anchor, number);
  }

  function scheduleMount() {
    if (mountQueued) return;
    mountQueued = true;
    requestAnimationFrame(() => {
      mountQueued = false;
      void mount();
    });
  }

  async function mount() {
    if (!settingsLoaded) return;
    const post = getPost();
    if (!post) {
      void currentView?.flushDraft();
      currentView?.detach();
      restoreNativeForm();
      currentHost?.remove();
      currentHost = null;
      currentAnchor = null;
      currentView = null;
      currentKey = null;
      return;
    }
    const anchor = findAnchor(post.number);
    if (!anchor || !anchor.parentNode) {
      if (currentKey && currentKey !== post.key) {
        void currentView?.flushDraft();
        currentView?.detach();
        restoreNativeForm();
        currentHost?.remove();
        currentHost = null;
        currentAnchor = null;
        currentView = null;
        currentKey = null;
      }
      return;
    }

    if (currentKey === post.key && currentHost && currentHost.isConnected && currentAnchor === anchor) {
      applyPageState(anchor, post.number);
      return;
    }

    const version = ++loadVersion;
    void currentView?.flushDraft();
    currentView?.detach();
    restoreNativeForm();
    currentHost?.remove();
    currentHost = null;
    currentAnchor = null;
    currentView = null;
    currentKey = post.key;

    const host = document.createElement("section");
    host.id = ROOT_ID;
    host.setAttribute("aria-label", "디시 나만보이는메모장: 나만 보는 댓글");
    host.style.cssText = "display:block;clear:both;width:100%;box-sizing:border-box;";
    anchor.insertAdjacentElement("afterend", host);
    const shadow = host.attachShadow({ mode: "closed" });
    const siteNickname = document.getElementById(`gall_nick_name_${post.number}`)?.value || "나";
    let view;
    try {
      view = createView(shadow, post.key, siteNickname);
    } catch (error) {
      shadow.textContent = "디시 나만보이는메모장을 표시하지 못했습니다. 확장 프로그램과 게시물을 새로고침해 주세요.";
      currentHost = host;
      currentAnchor = anchor;
      console.error("[디시 나만보이는메모장] 댓글 UI 생성 실패", error);
      return;
    }
    recentViews.add(view);
    if (recentViews.size > 12) recentViews.delete(recentViews.values().next().value);
    currentHost = host;
    currentAnchor = anchor;
    currentView = view;
    applyPageState(anchor, post.number);

    try {
      const result = await chrome.storage.local.get([post.key, `${post.key}:draft`]);
      if (version !== loadVersion || !host.isConnected) return;
      view.setData(result[post.key], result[`${post.key}:draft`]);
    } catch (error) {
      if (version === loadVersion) view.showStatus("저장된 메모를 불러오지 못했습니다.", true);
    }
  }

  function createView(shadow, storageKey, siteNickname) {
    const inlineHost = document.createElement("li");
    inlineHost.id = "memojang-inline-comments";
    inlineHost.setAttribute("aria-label", "디시 나만보이는메모장: 나만 보는 댓글");
    inlineHost.style.cssText = "display:block;list-style:none;margin:0;padding:0;border:0;";
    const inlineSurface = document.createElement("div");
    inlineHost.append(inlineSurface);
    const inlineShadow = inlineSurface.attachShadow({ mode: "closed" });
    inlineShadow.innerHTML = `
      <style>
        :host { display:block; color-scheme:light; --mj-text:#333; --mj-muted:#999; --mj-border:#ddd; --mj-accent:#3b4890; }
        :host([data-theme="dark"]) { color-scheme:dark; --mj-text:#ddd; --mj-muted:#999; --mj-border:#454545; --mj-accent:#777fcb; }
        * { box-sizing:border-box; }
        .list { list-style:none; margin:0; padding:0; color:var(--mj-text); font:13px/1.5 -apple-system,BlinkMacSystemFont,"Malgun Gothic",sans-serif; }
        .note { display:grid; grid-template-columns:190px minmax(0,1fr) 135px; gap:6px; min-height:36px; padding:9px 3px 7px; border-top:1px solid var(--mj-border); align-items:start; }
        .name { font-weight:normal; }
        .badge { margin-left:6px; padding:1px 5px; border:1px solid var(--mj-border); color:var(--mj-muted); font-size:11px; white-space:nowrap; }
        .body { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; }
        .meta { text-align:right; white-space:nowrap; }
        time { color:var(--mj-muted); font-size:12px; }
        .actions { display:flex; justify-content:flex-end; gap:8px; margin-top:3px; }
        .text-button { padding:0; border:0; color:var(--mj-muted); background:none; font:inherit; font-size:11px; cursor:pointer; }
        .text-button:hover { color:var(--mj-accent); text-decoration:underline; }
        .text-button.danger:hover { color:#c15367; }
        @media (max-width:640px) { .note { grid-template-columns:1fr; } .meta { text-align:left; } .actions { justify-content:flex-start; } }
      </style>
      <ul class="list" aria-label="나만 보는 댓글"></ul>`;

    shadow.innerHTML = `
      <style>
        :host {
          display: block; color-scheme: light;
          --mj-bg: #fff; --mj-text: #252525; --mj-muted: #777;
          --mj-border: #d8d8d8; --mj-editor: #fff; --mj-compose: #f7f7f7;
          --mj-accent: #3b4890; --mj-button: #3b4890; --mj-button-text: #fff;
        }
        :host([data-theme="dark"]) {
          color-scheme: dark;
          --mj-bg: #151515; --mj-text: #ddd; --mj-muted: #999;
          --mj-border: #454545; --mj-editor: #151515; --mj-compose: #242424;
          --mj-accent: #626cb8; --mj-button: #5d68b7; --mj-button-text: #fff;
        }
        :host([data-enabled="off"]) .box { display: none; }
        :host(:not([data-enabled="off"])) .off-bar { display: none; }
        * { box-sizing: border-box; }
        .box { margin: 0 0 14px; color: var(--mj-text); background: var(--mj-bg); font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Malgun Gothic", sans-serif; }
        .off-bar { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; padding:8px 12px; margin:0 0 8px; border-top:2px solid var(--mj-accent); color:var(--mj-muted); background:var(--mj-bg); font:12px/1.5 -apple-system,BlinkMacSystemFont,"Malgun Gothic",sans-serif; }
        .off-bar strong { color:var(--mj-text); }
        .off-count { color:var(--mj-muted); }
        .off-status { flex:1; min-width:80px; color:#c15367; }
        .enable-toggle { padding:5px 10px; border:1px solid var(--mj-accent); color:var(--mj-accent); background:transparent; font:inherit; cursor:pointer; }
        .enable-toggle:hover { background:var(--mj-compose); }
        .heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; min-height: 42px; padding: 7px 12px; border-top: 2px solid var(--mj-accent); border-bottom: 1px solid var(--mj-border); }
        .heading strong { font-size: 14px; }
        .heading .count { margin-left: 8px; color: var(--mj-muted); font-weight: normal; }
        .badge { margin-left: 8px; padding: 1px 5px; border: 1px solid var(--mj-border); color: var(--mj-muted); font-size: 11px; font-weight: normal; white-space: nowrap; }
        .heading-actions { display: flex; align-items: center; gap: 7px; }
        .mode-toggle, .clear-post, .cancel-clear { padding: 3px 7px; border: 1px solid var(--mj-border); color: var(--mj-text); background: transparent; font: inherit; cursor: pointer; }
        .mode-toggle:hover, .cancel-clear:hover { border-color: var(--mj-accent); }
        .clear-post { color: var(--mj-muted); }
        .clear-post:hover { border-color: #b4495b; color: #b4495b; }
        .list { list-style: none; padding: 0; margin: 0; }
        .empty { padding: 13px 12px; border-bottom: 1px solid var(--mj-border); color: var(--mj-muted); }
        .note { display: grid; grid-template-columns: 190px minmax(0, 1fr) 135px; gap: 6px; align-items: start; min-height: 46px; padding: 10px 7px; border-bottom: 1px solid var(--mj-border); }
        .name { font-weight: 700; }
        .note .badge { margin-left: 5px; }
        .body { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
        .meta { text-align: right; white-space: nowrap; }
        time { color: var(--mj-muted); font-size: 11px; }
        .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 3px; }
        .text-button { padding: 0; border: 0; color: var(--mj-muted); background: none; font: inherit; font-size: 11px; cursor: pointer; }
        .text-button:hover { color: var(--mj-accent); text-decoration: underline; }
        .text-button.danger:hover { color: #c15367; }
        .composer { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 0; padding: 12px 7px; border-bottom: 1px solid var(--mj-accent); background: var(--mj-compose); }
        .nick-column { padding-right: 12px; }
        .nick-column label { display: block; margin: 0 0 4px; color: var(--mj-muted); font-size: 11px; }
        .nick-column input { width: 100%; height: 34px; padding: 6px 8px; border: 1px solid var(--mj-border); color: var(--mj-text); background: var(--mj-editor); font: inherit; }
        .nick-column small { display: block; margin-top: 6px; color: var(--mj-muted); font-size: 11px; }
        textarea { display: block; width: 100%; min-height: 105px; resize: vertical; padding: 9px 10px; border: 1px solid var(--mj-border); outline: none; color: var(--mj-text); background: var(--mj-editor); font: inherit; }
        textarea:focus, .nick-column input:focus { border-color: var(--mj-accent); outline: none; }
        textarea::placeholder { color: var(--mj-muted); }
        .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-height: 38px; margin-top: 6px; }
        .status { flex: 1; min-width: 140px; color: var(--mj-muted); font-size: 11px; }
        .status.error { color: #c15367; }
        .length, .shortcut { color: var(--mj-muted); font-size: 11px; }
        .primary, .secondary { min-height: 31px; padding: 5px 12px; border-radius: 2px; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
        .primary { border: 1px solid var(--mj-button); background: var(--mj-button); color: var(--mj-button-text); }
        .primary:hover { filter: brightness(1.1); }
        .primary:disabled { opacity: .55; cursor: default; }
        .secondary { border: 1px solid var(--mj-border); background: var(--mj-editor); color: var(--mj-text); }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
        @media (max-width: 640px) {
          .note { grid-template-columns: 1fr; }
          .meta { text-align: left; }
          .actions { display: inline-flex; margin: 0 0 0 8px; }
          .composer { grid-template-columns: 1fr; gap: 9px; }
          .nick-column { padding: 0; }
          .nick-column input { max-width: 180px; }
        }
        [hidden] { display: none !important; }
      </style>
      <div class="off-bar" role="region" aria-label="나만 보기 모드">
        <span><strong>나만 보기 OFF</strong> · 원래 댓글창 사용 중</span>
        <span class="off-count"></span>
        <span class="off-status" role="status" aria-live="polite"></span>
        <button class="enable-toggle" type="button">나만 보기 켜기</button>
      </div>
      <div class="box">
        <div class="heading">
          <div><strong>디시 나만보이는메모장</strong><span class="count" aria-live="polite"></span><span class="badge">이 Chrome에만 보임</span></div>
          <div class="heading-actions">
            <button class="clear-post" type="button">이 글 기록 삭제</button>
            <button class="cancel-clear" type="button" hidden>취소</button>
            <button class="mode-toggle" type="button" title="원래 댓글 입력창으로 전환">나만 보기 끄기</button>
          </div>
        </div>
        <ul class="list" aria-label="나만 보는 댓글"></ul>
        <div class="empty">아직 쓴 메모가 없습니다.</div>
        <div class="composer">
          <div class="nick-column">
            <label for="memojang-nick">닉네임</label>
            <input id="memojang-nick" type="text" maxlength="20" autocomplete="off">
            <small>다른 사람에게 보이지 않음</small>
          </div>
          <div class="editor-column">
            <label class="sr-only" for="memojang-text">나만 보는 댓글</label>
            <textarea id="memojang-text" maxlength="${MAX_LENGTH}" placeholder="댓글을 입력하세요. 이 Chrome에만 저장되고 사이트에는 전송되지 않습니다."></textarea>
            <div class="bar">
              <span class="status" role="status" aria-live="polite">이 Chrome에만 저장·표시됩니다. 다른 사람은 볼 수 없습니다.</span>
              <span class="shortcut">Enter 등록 · Shift+Enter 줄바꿈</span>
              <span class="length">0 / ${MAX_LENGTH}</span>
              <button class="secondary cancel" type="button" hidden>수정 취소</button>
              <button class="primary save" type="button">나만 보기 등록</button>
            </div>
          </div>
        </div>
      </div>`;

    const list = shadow.querySelector(".list");
    const inlineList = inlineShadow.querySelector(".list");
    const empty = shadow.querySelector(".empty");
    const count = shadow.querySelector(".count");
    const textarea = shadow.querySelector("textarea");
    const length = shadow.querySelector(".length");
    const status = shadow.querySelector(".status");
    const saveButton = shadow.querySelector(".save");
    const cancelButton = shadow.querySelector(".cancel");
    const label = shadow.querySelector('label[for="memojang-text"]');
    const nicknameInput = shadow.querySelector("#memojang-nick");
    const modeToggle = shadow.querySelector(".mode-toggle");
    const enableToggle = shadow.querySelector(".enable-toggle");
    const offCount = shadow.querySelector(".off-count");
    const offStatus = shadow.querySelector(".off-status");
    const clearPostButton = shadow.querySelector(".clear-post");
    const cancelClearButton = shadow.querySelector(".cancel-clear");
    nicknameInput.value = siteNickname.slice(0, 20);
    let notes = [];
    let editingId = null;
    let draftBeforeEdit = "";
    let nicknameBeforeEdit = "";
    let pendingDeleteId = null;
    let draftTimer = null;
    let draftWrite = Promise.resolve();
    let recordWrite = Promise.resolve();
    let recordEpoch = 0;
    let clearing = false;
    let clearPending = false;
    let nativeCommentList = null;
    let modeEnabled = true;

    function syncInline() {
      const shouldAttach = modeEnabled && notes.length > 0 && shadow.host.isConnected && nativeCommentList?.isConnected;
      if (shouldAttach && inlineHost !== nativeCommentList.lastElementChild) nativeCommentList.append(inlineHost);
      if (!shouldAttach && inlineHost.isConnected) inlineHost.remove();
      list.hidden = Boolean(shouldAttach);
    }

    function resetClearConfirmation() {
      clearPending = false;
      clearPostButton.textContent = "이 글 기록 삭제";
      cancelClearButton.hidden = true;
    }

    // The site receives no input events from this panel's bubbling phase.
    for (const type of ["keydown", "keyup", "keypress", "input", "change", "submit"]) {
      shadow.addEventListener(type, event => event.stopPropagation());
      inlineShadow.addEventListener(type, event => event.stopPropagation());
    }
    inlineShadow.addEventListener("click", event => event.stopPropagation());

    function showStatus(message, isError = false) {
      status.textContent = message;
      status.classList.toggle("error", isError);
    }

    function updateLength() {
      length.textContent = `${textarea.value.length} / ${MAX_LENGTH}`;
    }

    function clearEdit() {
      editingId = null;
      draftBeforeEdit = "";
      nicknameBeforeEdit = "";
      label.textContent = "나만 보는 댓글";
      saveButton.textContent = "나만 보기 등록";
      cancelButton.hidden = true;
    }

    function createNoteItem(note) {
        const item = document.createElement("li");
        item.className = "note";
        const author = document.createElement("div");
        author.className = "author";
        const name = document.createElement("strong");
        name.className = "name";
        name.textContent = note.nickname || "나";
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = "이 Chrome에만 보임";
        author.append(name, badge);
        const body = document.createElement("p");
        body.className = "body";
        body.textContent = note.text;
        const meta = document.createElement("div");
        meta.className = "meta";
        const date = document.createElement("time");
        date.dateTime = note.createdAt;
        date.textContent = formatTime(note.createdAt) + (note.editedAt ? " · 수정됨" : "");
        const actions = document.createElement("div");
        actions.className = "actions";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "text-button";
        edit.textContent = "수정";
        edit.addEventListener("click", () => {
          pendingDeleteId = null;
          clearTimeout(draftTimer);
          if (editingId === null) {
            draftBeforeEdit = textarea.value;
            nicknameBeforeEdit = nicknameInput.value;
          }
          editingId = note.id;
          textarea.value = note.text;
          nicknameInput.value = note.nickname || "나";
          label.textContent = "나만 보는 댓글 수정";
          saveButton.textContent = "수정 저장";
          cancelButton.hidden = false;
          updateLength();
          textarea.focus();
          render();
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "text-button danger";
        remove.textContent = pendingDeleteId === note.id ? "삭제 확인" : "삭제";
        remove.setAttribute("aria-label", pendingDeleteId === note.id ? "이 메모 삭제 확인" : "이 메모 삭제");
        remove.addEventListener("click", async () => {
          if (pendingDeleteId !== note.id) {
            pendingDeleteId = note.id;
            render();
            showStatus("삭제 확인을 한 번 더 누르면 메모가 지워집니다.");
            return;
          }
          const next = notes.filter(entry => entry.id !== note.id);
          const epoch = recordEpoch;
          if (await persist(next) && epoch === recordEpoch) {
            notes = next;
            pendingDeleteId = null;
            if (editingId === note.id) {
              const savedDraft = draftBeforeEdit;
              const savedNickname = nicknameBeforeEdit;
              clearEdit();
              textarea.value = savedDraft;
              nicknameInput.value = savedNickname;
              updateLength();
              void saveDraft();
            }
            render();
            showStatus("메모를 삭제했습니다.");
          }
        });
        actions.append(edit, remove);
        meta.append(date, actions);
        item.append(author, body, meta);
        return item;
    }

    function render() {
      list.replaceChildren();
      inlineList.replaceChildren();
      count.textContent = `나만 보는 댓글 ${notes.length}개`;
      offCount.textContent = `나만 보는 댓글 ${notes.length}개`;
      empty.hidden = notes.length > 0;
      for (const note of notes) {
        list.append(createNoteItem(note));
        inlineList.append(createNoteItem(note));
      }
      syncInline();
    }

    async function persist(next) {
      if (clearing) return false;
      const write = recordWrite.then(() => chrome.storage.local.set({ [storageKey]: next }));
      recordWrite = write.catch(() => {});
      try {
        await write;
        return true;
      } catch (error) {
        showStatus("저장하지 못했습니다. Chrome 저장 공간을 확인해 주세요.", true);
        return false;
      }
    }

    async function saveDraft(value = textarea.value) {
      const epoch = recordEpoch;
      draftWrite = draftWrite.then(async () => {
        if (epoch !== recordEpoch) return;
        try {
          if (value) {
            await chrome.storage.local.set({ [`${storageKey}:draft`]: value });
          } else {
            await chrome.storage.local.remove(`${storageKey}:draft`);
          }
        } catch (error) {
          showStatus("임시 글을 저장하지 못했습니다.", true);
        }
      });
      return draftWrite;
    }

    async function clearRecords(message) {
      if (clearing) return false;
      clearing = true;
      recordEpoch += 1;
      clearTimeout(draftTimer);
      saveButton.disabled = true;
      clearPostButton.disabled = true;
      textarea.disabled = true;
      nicknameInput.disabled = true;
      await Promise.all([draftWrite, recordWrite]);
      try {
        await chrome.storage.local.remove([storageKey, `${storageKey}:draft`]);
        notes = [];
        pendingDeleteId = null;
        clearEdit();
        resetClearConfirmation();
        textarea.value = "";
        nicknameInput.value = siteNickname.slice(0, 20);
        updateLength();
        render();
        showStatus(message);
        return true;
      } catch (error) {
        showStatus("기록을 삭제하지 못했습니다. 다시 시도해 주세요.", true);
        return false;
      } finally {
        clearing = false;
        saveButton.disabled = false;
        clearPostButton.disabled = false;
        textarea.disabled = false;
        nicknameInput.disabled = false;
      }
    }

    textarea.addEventListener("input", () => {
      updateLength();
      if (editingId !== null) return;
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => { void saveDraft(); }, 500);
    });

    textarea.addEventListener("keydown", event => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      if (!saveButton.disabled) saveButton.click();
    });

    async function changeMode(next) {
      modeToggle.disabled = true;
      enableToggle.disabled = true;
      try {
        await chrome.storage.local.set({ [ENABLED_KEY]: next });
        offStatus.textContent = "";
      } catch (error) {
        const message = next ? "나만 보기를 켜지 못했습니다." : "나만 보기를 끄지 못했습니다.";
        showStatus(message, true);
        offStatus.textContent = message;
      } finally {
        modeToggle.disabled = false;
        enableToggle.disabled = false;
      }
    }

    modeToggle.addEventListener("click", () => { void changeMode(false); });
    enableToggle.addEventListener("click", () => { void changeMode(true); });

    clearPostButton.addEventListener("click", async () => {
      if (!clearPending) {
        clearPending = true;
        clearPostButton.textContent = "정말 삭제";
        cancelClearButton.hidden = false;
        showStatus("이 게시물의 메모와 작성 중인 글을 모두 지웁니다.");
        return;
      }
      if (!await clearRecords("이 글의 기록을 삭제했습니다.")) return;
      const revision = crypto.randomUUID();
      ownPurgeRevision = revision;
      try {
        await chrome.storage.local.set({ [PURGE_KEY]: { revision, scope: storageKey } });
      } catch (error) {
        showStatus("이 글의 기록은 삭제됐지만 다른 탭에는 아직 반영되지 않았습니다.", true);
      }
    });

    cancelClearButton.addEventListener("click", () => {
      resetClearConfirmation();
      showStatus("삭제를 취소했습니다.");
    });

    saveButton.addEventListener("click", async () => {
      const value = textarea.value.trim();
      if (!value) {
        showStatus("내용을 입력해 주세요.", true);
        textarea.focus();
        return;
      }
      saveButton.disabled = true;
      textarea.disabled = true;
      clearTimeout(draftTimer);
      const epoch = recordEpoch;
      await draftWrite;
      if (epoch !== recordEpoch || clearing) {
        if (!clearing) {
          saveButton.disabled = false;
          textarea.disabled = false;
        }
        return;
      }
      const now = new Date().toISOString();
      const wasEditing = editingId !== null;
      const draftToRestore = draftBeforeEdit;
      const nicknameToRestore = nicknameBeforeEdit;
      const nickname = nicknameInput.value.trim() || "나";
      const next = editingId === null
        ? [...notes, { id: crypto.randomUUID(), nickname, text: value, createdAt: now }]
        : notes.map(note => note.id === editingId ? { ...note, nickname, text: value, editedAt: now } : note);
      if (await persist(next) && epoch === recordEpoch) {
        notes = next;
        clearEdit();
        textarea.value = wasEditing ? draftToRestore : "";
        if (wasEditing) nicknameInput.value = nicknameToRestore;
        updateLength();
        await saveDraft();
        if (epoch !== recordEpoch) {
          if (!clearing) {
            saveButton.disabled = false;
            textarea.disabled = false;
          }
          return;
        }
        render();
        showStatus("이 Chrome에만 저장했습니다. 다른 사람은 볼 수 없습니다.");
      }
      if (!clearing) {
        saveButton.disabled = false;
        textarea.disabled = false;
      }
    });

    cancelButton.addEventListener("click", () => {
      textarea.value = draftBeforeEdit;
      nicknameInput.value = nicknameBeforeEdit;
      clearEdit();
      updateLength();
      void saveDraft();
      showStatus("수정을 취소했습니다.");
    });

    return {
      storageKey,
      showStatus,
      attachToCommentList(anchor) {
        nativeCommentList = anchor.querySelector(".comment_box > ul.cmt_list");
        syncInline();
      },
      detach() {
        nativeCommentList = null;
        inlineHost.remove();
      },
      setEnabled(next) {
        modeEnabled = next;
        shadow.host.dataset.enabled = next ? "on" : "off";
        syncInline();
      },
      setTheme(theme) {
        if (shadow.host.dataset.theme !== theme) shadow.host.dataset.theme = theme;
        if (inlineSurface.dataset.theme !== theme) inlineSurface.dataset.theme = theme;
      },
      flushDraft() {
        if (clearing) return draftWrite;
        clearTimeout(draftTimer);
        return saveDraft(editingId === null ? textarea.value : draftBeforeEdit);
      },
      clearRecords,
      setData(storedNotes, storedDraft) {
        if (recordEpoch !== 0) return;
        notes = Array.isArray(storedNotes)
          ? storedNotes.filter(note => note && typeof note.id === "string" && typeof note.text === "string" && typeof note.createdAt === "string")
          : [];
        textarea.value = typeof storedDraft === "string" ? storedDraft.slice(0, MAX_LENGTH) : "";
        updateLength();
        render();
      }
    };
  }

  chrome.storage.local.get([ENABLED_KEY, THEME_KEY]).then(settings => {
    enabled = settings[ENABLED_KEY] !== false;
    themeSetting = ["light", "dark"].includes(settings[THEME_KEY]) ? settings[THEME_KEY] : "auto";
  }).catch(() => {}).finally(() => {
    settingsLoaded = true;
    scheduleMount();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[ENABLED_KEY]) {
      if (changes[ENABLED_KEY].newValue === false) void currentView?.flushDraft();
      enabled = changes[ENABLED_KEY].newValue !== false;
      scheduleMount();
    }
    if (changes[THEME_KEY]) {
      themeSetting = ["light", "dark"].includes(changes[THEME_KEY].newValue) ? changes[THEME_KEY].newValue : "auto";
      scheduleMount();
    }
    if (changes[PURGE_KEY]) {
      const purge = changes[PURGE_KEY].newValue;
      const revision = typeof purge === "object" ? purge?.revision : purge;
      const scope = typeof purge === "object" ? purge?.scope : "all";
      for (const view of recentViews) {
        if (revision === ownPurgeRevision && view === currentView) continue;
        if (scope === "all" || scope === view.storageKey) {
          void view.clearRecords("저장된 기록을 삭제했습니다.");
        }
      }
    }
  });

  const observer = new MutationObserver(scheduleMount);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style"]
  });
  addEventListener("popstate", scheduleMount);
  addEventListener("pagehide", () => { void currentView?.flushDraft(); });
})();
