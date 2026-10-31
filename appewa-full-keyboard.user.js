// ==UserScript==
// @name         Appewa Full Keyboard
// @namespace    https://github.com/monkey-sking/appewa-full-keyboard
// @version      0.1.4
// @description  Add keyboard-only navigation and confirmation controls to Appewa lessons.
// @author       monkey-sking
// @homepageURL  https://github.com/monkey-sking/appewa-full-keyboard
// @supportURL   https://github.com/monkey-sking/appewa-full-keyboard/issues
// @downloadURL  https://raw.githubusercontent.com/monkey-sking/appewa-full-keyboard/main/appewa-full-keyboard.user.js
// @updateURL    https://raw.githubusercontent.com/monkey-sking/appewa-full-keyboard/main/appewa-full-keyboard.user.js
// @match        https://app.appewa.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const VERSION = "0.1.4";
  const GLOBAL_KEY = "__appewaFullKeyboard";
  const HOST_ID = "appewa-full-keyboard";
  const EDITABLE_SELECTOR =
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]):not([contenteditable="inherit"])';
  const INTERACTIVE_SELECTOR = [
    "button",
    "a[href]",
    "summary",
    '[role="button"]',
    '[role="link"]',
    '[role="radio"]',
    '[role="checkbox"]',
    '[role="option"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");
  const PRIMARY_ACTION = '[data-testid="lesson.primary_action_button"]';
  const VALIDATION_ACTION = '[data-testid$=".validation.action_button"]';
  const ANSWERS_VIEWPORT = '[data-testid$=".answers_viewport"]';
  const ITEM_ID_PREFIXES = [".answer.", ".keyboard.", ".task."];
  const ACTION_DEBOUNCE_MS = 300;

  if (window[GLOBAL_KEY]?.version) {
    return;
  }
  window[GLOBAL_KEY] = { version: VERSION };

  let uiHost = null;
  let helpPanel = null;
  let helpCloseButton = null;
  let helpBadge = null;
  let liveStatus = null;
  let helpOpen = false;
  let helpReturnFocus = null;
  let lastActionAt = 0;
  let syncQueued = false;

  function visibleElements(selector, root = document) {
    return [...root.querySelectorAll(selector)].filter(isVisible);
  }

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected) {
      return false;
    }
    if (
      element.closest(
        '[hidden], [aria-hidden="true"], [inert], [style*="display: none"]',
      )
    ) {
      return false;
    }

    const style = getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0 ||
      style.pointerEvents === "none"
    ) {
      return false;
    }

    return [...element.getClientRects()].some(
      (rect) => rect.width > 0 && rect.height > 0,
    );
  }

  function isDisabled(element) {
    return (
      element.matches(":disabled") ||
      element.getAttribute("aria-disabled") === "true" ||
      Boolean(element.closest('[disabled], [aria-disabled="true"]'))
    );
  }

  function isEditableEvent(event) {
    return event
      .composedPath()
      .some(
        (node) =>
          node instanceof Element && Boolean(node.closest(EDITABLE_SELECTOR)),
      );
  }

  function isLessonActive() {
    return (
      visibleElements(
        '[data-testid="lesson.close_button"], [data-testid="lesson.primary_action_button"]',
      ).length > 0
    );
  }

  function getCurrentExerciseBase() {
    const viewports = visibleElements(ANSWERS_VIEWPORT);
    if (viewports.length === 0) {
      return "";
    }

    const viewport = viewports[viewports.length - 1];
    const testId = viewport.getAttribute("data-testid") || "";
    return testId.endsWith(".answers_viewport")
      ? testId.slice(0, -".answers_viewport".length)
      : "";
  }

  function findActionableElement(sourceElement, scope) {
    if (sourceElement.matches(INTERACTIVE_SELECTOR)) {
      return sourceElement;
    }

    const interactiveAncestor = sourceElement.closest(INTERACTIVE_SELECTOR);
    if (interactiveAncestor && scope.contains(interactiveAncestor)) {
      return interactiveAncestor;
    }

    return (
      [...sourceElement.querySelectorAll(INTERACTIVE_SELECTOR)].find(
        (element) => scope.contains(element) && isVisible(element),
      ) || null
    );
  }

  function getAnswerCandidates() {
    const base = getCurrentExerciseBase();
    if (!base) {
      return [];
    }

    const viewport = visibleElements(ANSWERS_VIEWPORT).at(-1);
    const candidates = [];
    const seen = new Set();

    for (const element of viewport.querySelectorAll("[data-testid]")) {
      const testId = element.getAttribute("data-testid") || "";
      if (!ITEM_ID_PREFIXES.some((prefix) => testId.startsWith(base + prefix))) {
        continue;
      }

      const actionable = findActionableElement(element, viewport);
      if (
        !actionable ||
        seen.has(actionable) ||
        isDisabled(actionable) ||
        !isVisible(actionable)
      ) {
        continue;
      }

      seen.add(actionable);
      candidates.push(actionable);
    }

    return candidates;
  }

  function focusedCandidateIndex(candidates) {
    const active = document.activeElement;
    if (
      !(active instanceof Element) ||
      active === document.body ||
      active === document.documentElement
    ) {
      return -1;
    }
    return candidates.findIndex(
      (candidate) =>
        candidate === active ||
        candidate.contains(active),
    );
  }

  function focusCandidate(candidate) {
    candidate.focus();
    if (document.activeElement !== candidate) {
      candidate.setAttribute("tabindex", "-1");
      candidate.focus();
    }
  }

  function shortLabel(element) {
    return (
      element.getAttribute("aria-label") ||
      element.innerText ||
      element.textContent ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 48);
  }

  function exactCandidateLabel(element) {
    return (
      element.getAttribute("aria-label") ||
      element.innerText ||
      element.textContent ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase();
  }

  function announce(message) {
    if (liveStatus) {
      liveStatus.textContent = message;
    }
  }

  function findFocusAction() {
    const base = getCurrentExerciseBase();
    const validationActions = visibleElements(VALIDATION_ACTION).filter(
      (element) =>
        !isDisabled(element) &&
        (!base ||
          (element.getAttribute("data-testid") || "").startsWith(
            base + ".validation.",
          )),
    );

    if (validationActions.length > 0) {
      return validationActions.at(-1);
    }

    const primaryActions = visibleElements(PRIMARY_ACTION).filter(
      (element) => !isDisabled(element),
    );
    return primaryActions.at(-1) || null;
  }

  function activateAction(event) {
    const action = findFocusAction();
    if (!action) {
      announce("当前页面没有找到可用的检查或继续按钮。");
      return false;
    }

    event.preventDefault();
    if (event.repeat) {
      return true;
    }

    const now = performance.now();
    if (now - lastActionAt < ACTION_DEBOUNCE_MS) {
      return true;
    }

    lastActionAt = now;
    const label = shortLabel(action);
    action.click();
    announce(label ? `已触发：${label}` : "已触发主操作。");
    return true;
  }

  function isNativeEnterTarget(element) {
    return Boolean(
      element instanceof Element &&
        element !== document.body &&
        element.matches(
          'button, a[href], summary, input, textarea, select, [contenteditable], [role="button"], [role="link"], [role="radio"], [role="checkbox"], [role="option"], [role="tab"], [role="menuitem"]',
        ),
    );
  }

  function hasBlockingLessonDialog() {
    const exitDialog = visibleElements(
      '[data-testid="lesson.exit_confirm.modal"]',
    );
    if (exitDialog.length > 0) {
      return true;
    }

    return visibleElements('[role="dialog"][aria-modal="true"]').some(
      (dialog) =>
        !dialog.querySelector(VALIDATION_ACTION) &&
        !dialog.matches(VALIDATION_ACTION),
    );
  }

  function handleEnter(event) {
    const candidates = getAnswerCandidates();
    const activeIndex = focusedCandidateIndex(candidates);
    const active = document.activeElement;

    if (activeIndex >= 0) {
      return activateAction(event);
    }
    if (isNativeEnterTarget(active)) {
      return false;
    }
    if (hasBlockingLessonDialog()) {
      return false;
    }

    return activateAction(event);
  }

  function handleArrow(event) {
    const candidates = getAnswerCandidates();
    if (candidates.length === 0) {
      return false;
    }

    const key = event.key;
    const currentIndex = focusedCandidateIndex(candidates);
    let nextIndex;

    if (currentIndex < 0) {
      nextIndex = key === "ArrowLeft" || key === "ArrowUp" ? candidates.length - 1 : 0;
    } else {
      const delta = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
      nextIndex = (currentIndex + delta + candidates.length) % candidates.length;
    }

    event.preventDefault();
    focusCandidate(candidates[nextIndex]);
    announce(
      `第 ${nextIndex + 1} 项，共 ${candidates.length} 项：${shortLabel(
        candidates[nextIndex],
      )}`,
    );
    return true;
  }

  function handleHomeEnd(event) {
    const candidates = getAnswerCandidates();
    if (candidates.length === 0) {
      return false;
    }

    event.preventDefault();
    const target =
      event.key === "Home" ? candidates[0] : candidates[candidates.length - 1];
    focusCandidate(target);
    announce(
      `${event.key === "Home" ? "第一项" : "最后一项"}：${shortLabel(target)}`,
    );
    return true;
  }

  function handleNumber(event) {
    if (event.repeat || !/^[1-9]$/.test(event.key)) {
      return false;
    }

    const candidates = getAnswerCandidates();
    const index = Number(event.key) - 1;
    const candidate = candidates[index];
    if (!candidate) {
      return false;
    }

    event.preventDefault();
    focusCandidate(candidate);
    candidate.click();
    announce(`已选择第 ${index + 1} 项：${shortLabel(candidate)}`);
    return true;
  }

  function handleLetter(event) {
    if (event.repeat || !/^[a-z]$/i.test(event.key)) {
      return false;
    }

    const typed = event.key.toLocaleLowerCase();
    const candidate = getAnswerCandidates().find(
      (element) => exactCandidateLabel(element) === typed,
    );
    if (!candidate) {
      return false;
    }

    event.preventDefault();
    focusCandidate(candidate);
    candidate.click();
    announce(`已选择：${shortLabel(candidate)}`);
    return true;
  }

  function handleSpace(event) {
    const candidates = getAnswerCandidates();
    const activeIndex = focusedCandidateIndex(candidates);
    if (activeIndex < 0) {
      return false;
    }

    event.preventDefault();
    if (!event.repeat) {
      const candidate = candidates[activeIndex];
      candidate.click();
      announce(`已选择：${shortLabel(candidate)}`);
    }
    return true;
  }

  function findMediaControl(suffix) {
    const base = getCurrentExerciseBase();
    const controls = visibleElements(`[data-testid$="${suffix}"]`).filter(
      (element) => !isDisabled(element),
    );
    const scoped = base
      ? controls.filter((element) =>
          (element.getAttribute("data-testid") || "").startsWith(base + "."),
        )
      : [];
    return (scoped.length > 0 ? scoped : controls).at(-1) || null;
  }

  function handleAltShortcut(event) {
    if (
      !event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.repeat
    ) {
      return false;
    }

    const key = event.key.toLowerCase();
    const targets = {
      r: [".play_button", "播放音频"],
      s: [".slow_button", "慢速播放"],
      h: [".hint_button", "提示"],
    };
    const target = targets[key];
    if (!target) {
      return false;
    }

    const control = findMediaControl(target[0]);
    if (!control) {
      return false;
    }

    event.preventDefault();
    control.click();
    announce(`已触发：${target[1]}`);
    return true;
  }

  function closeHelp({ restoreFocus = true } = {}) {
    if (!helpOpen || !helpPanel) {
      return;
    }

    helpOpen = false;
    helpPanel.hidden = true;
    helpBadge?.setAttribute("aria-expanded", "false");

    const returnTarget =
      helpReturnFocus instanceof HTMLElement &&
      helpReturnFocus.isConnected &&
      helpReturnFocus !== document.body
        ? helpReturnFocus
        : null;
    helpReturnFocus = null;

    if (restoreFocus && returnTarget) {
      requestAnimationFrame(() => returnTarget.focus());
    }
  }

  function openHelp() {
    if (!helpPanel || !helpCloseButton) {
      return;
    }

    helpReturnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    helpOpen = true;
    helpPanel.hidden = false;
    helpBadge?.setAttribute("aria-expanded", "true");
    helpCloseButton.focus();
  }

  function toggleHelp() {
    if (helpOpen) {
      closeHelp();
    } else {
      openHelp();
    }
  }

  function handleKeydown(event) {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229
    ) {
      return;
    }

    const fromUi = event.composedPath().includes(uiHost);

    if (event.key === "F1") {
      if (!isLessonActive()) {
        return;
      }
      event.preventDefault();
      if (!event.repeat) {
        toggleHelp();
      }
      return;
    }

    if (event.key === "Escape" && helpOpen) {
      event.preventDefault();
      closeHelp();
      return;
    }

    if (fromUi || isEditableEvent(event)) {
      return;
    }

    if (handleAltShortcut(event)) {
      return;
    }

    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    if (!isLessonActive()) {
      return;
    }

    if (event.key === "Enter") {
      handleEnter(event);
      return;
    }

    if (event.key === " ") {
      handleSpace(event);
      return;
    }

    if (
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight"
    ) {
      handleArrow(event);
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      if (!event.repeat) {
        handleHomeEnd(event);
      }
      return;
    }

    if (handleLetter(event)) {
      return;
    }

    handleNumber(event);
  }

  function syncUiVisibility() {
    if (!uiHost) {
      return;
    }

    const active = isLessonActive();
    uiHost.hidden = !active;
    if (!active && helpOpen) {
      closeHelp({ restoreFocus: false });
    }
  }

  function scheduleUiVisibilitySync() {
    if (syncQueued) {
      return;
    }

    syncQueued = true;
    requestAnimationFrame(() => {
      syncQueued = false;
      syncUiVisibility();
    });
  }

  function createUi() {
    uiHost = document.createElement("div");
    uiHost.id = HOST_ID;
    uiHost.setAttribute("data-appewa-full-keyboard-version", VERSION);

    const shadow = uiHost.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
        }
        :host([hidden]) {
          display: none !important;
        }
        [hidden] {
          display: none !important;
        }
        .shell {
          position: fixed;
          right: 12px;
          bottom: 12px;
          z-index: 2147483647;
          color: #172019;
          font-family: "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif;
          font-size: 13px;
          line-height: 1.45;
        }
        .badge,
        .close {
          appearance: none;
          border: 0;
          cursor: pointer;
          font: inherit;
        }
        .badge {
          display: flex;
          align-items: center;
          gap: 7px;
          min-height: 34px;
          padding: 0 11px;
          border: 1px solid rgba(23, 32, 25, 0.2);
          border-radius: 999px;
          background: #f5f0df;
          box-shadow: 0 5px 18px rgba(23, 32, 25, 0.18);
          color: #172019;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.02em;
        }
        .badge:hover,
        .badge:focus-visible {
          background: #e8efc9;
          outline: 2px solid #46633c;
          outline-offset: 2px;
        }
        .badge-key {
          display: inline-grid;
          place-items: center;
          min-width: 24px;
          height: 20px;
          padding: 0 4px;
          border: 1px solid rgba(23, 32, 25, 0.3);
          border-bottom-width: 2px;
          border-radius: 5px;
          background: #fffdf5;
          font-family: "SFMono-Regular", "Cascadia Mono", monospace;
          font-size: 10px;
        }
        .panel {
          width: min(360px, calc(100vw - 24px));
          margin-bottom: 8px;
          padding: 16px 17px 15px;
          border: 1px solid rgba(23, 32, 25, 0.18);
          border-radius: 15px;
          background:
            radial-gradient(circle at 100% 0%, rgba(212, 226, 156, 0.75), transparent 38%),
            #f8f4e8;
          box-shadow: 0 14px 42px rgba(23, 32, 25, 0.24);
        }
        .panel-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }
        .title {
          margin: 0;
          font-family: "Iowan Old Style", "Songti SC", serif;
          font-size: 19px;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .subtitle {
          margin: 3px 0 0;
          color: #596359;
          font-size: 11px;
        }
        .close {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: rgba(23, 32, 25, 0.08);
          color: #172019;
          font-size: 18px;
          line-height: 1;
        }
        .close:hover,
        .close:focus-visible {
          background: #dce7b1;
          outline: 2px solid #46633c;
          outline-offset: 1px;
        }
        .rows {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 7px 11px;
          margin: 0;
        }
        .rows dt,
        .rows dd {
          margin: 0;
        }
        .rows dt {
          white-space: nowrap;
        }
        .rows dd {
          color: #364237;
        }
        kbd {
          display: inline-block;
          min-width: 19px;
          padding: 1px 5px;
          border: 1px solid rgba(23, 32, 25, 0.26);
          border-bottom-width: 2px;
          border-radius: 5px;
          background: #fffdf5;
          color: #172019;
          font-family: "SFMono-Regular", "Cascadia Mono", monospace;
          font-size: 10px;
          text-align: center;
        }
        .note {
          margin: 12px 0 0;
          padding-top: 10px;
          border-top: 1px solid rgba(23, 32, 25, 0.12);
          color: #596359;
          font-size: 11px;
        }
        .sr-only {
          position: fixed;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }
      </style>
      <div class="shell">
        <section
          class="panel"
          id="appewa-keyboard-help"
          role="dialog"
          aria-label="Appewa 全键盘快捷键"
          hidden
        >
          <div class="panel-head">
            <div>
              <h2 class="title">Appewa 全键盘</h2>
              <p class="subtitle">字母输入和网站原生操作保持不变</p>
            </div>
            <button class="close" type="button" aria-label="关闭快捷键帮助">×</button>
          </div>
          <dl class="rows">
            <dt><kbd>Enter</kbd></dt><dd>检查 / 继续 / 提交</dd>
            <dt><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd></dt><dd>聚焦上一个 / 下一个选项</dd>
            <dt><kbd>Space</kbd></dt><dd>选择当前聚焦的选项</dd>
            <dt><kbd>1</kbd>–<kbd>9</kbd></dt><dd>直接选择第 N 项</dd>
            <dt><kbd>A</kbd>–<kbd>Z</kbd></dt><dd>选择同名的单词块</dd>
            <dt><kbd>Home</kbd><kbd>End</kbd></dt><dd>第一项 / 最后一项</dd>
            <dt><kbd>Alt</kbd>+<kbd>R</kbd></dt><dd>重播可见音频</dd>
            <dt><kbd>Alt</kbd>+<kbd>S</kbd></dt><dd>慢速播放</dd>
            <dt><kbd>Alt</kbd>+<kbd>H</kbd></dt><dd>查看提示</dd>
            <dt><kbd>F1</kbd></dt><dd>打开 / 关闭本帮助</dd>
            <dt><kbd>Esc</kbd></dt><dd>只关闭本帮助</dd>
          </dl>
          <p class="note">输入框内不会拦截按键；字母、Backspace、Tab、Space 和文本输入继续使用网站原生行为。</p>
        </section>
        <button
          class="badge"
          type="button"
          aria-controls="appewa-keyboard-help"
          aria-expanded="false"
          title="Appewa 全键盘快捷键（F1）"
        >
          <span class="badge-key">F1</span>
          <span>键盘</span>
        </button>
      </div>
      <div class="sr-only" role="status" aria-live="polite"></div>
    `;

    helpPanel = shadow.querySelector(".panel");
    helpCloseButton = shadow.querySelector(".close");
    helpBadge = shadow.querySelector(".badge");
    liveStatus = shadow.querySelector('[role="status"]');

    helpBadge.addEventListener("click", toggleHelp);
    helpCloseButton.addEventListener("click", () => closeHelp());
    document.documentElement.append(uiHost);

    const observer = new MutationObserver(scheduleUiVisibilitySync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-hidden", "hidden", "style"],
    });

    syncUiVisibility();
  }

  createUi();
  document.addEventListener("keydown", handleKeydown, false);
})();
