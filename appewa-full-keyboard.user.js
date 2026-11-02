// ==UserScript==
// @name         Appewa Full Keyboard
// @namespace    https://github.com/monkey-sking/appewa-full-keyboard
// @version      0.2.1
// @description  Keyboard navigation, a local mistake notebook, and optional AI review for Appewa lessons.
// @author       monkey-sking
// @homepageURL  https://github.com/monkey-sking/appewa-full-keyboard
// @supportURL   https://github.com/monkey-sking/appewa-full-keyboard/issues
// @downloadURL  https://raw.githubusercontent.com/monkey-sking/appewa-full-keyboard/refs/heads/main/appewa-full-keyboard.user.js
// @updateURL    https://raw.githubusercontent.com/monkey-sking/appewa-full-keyboard/refs/heads/main/appewa-full-keyboard.user.js
// @match        https://app.appewa.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      api.openai.com
// @connect      api.deepseek.com
// @connect      openrouter.ai
// @connect      api.moonshot.cn
// @connect      dashscope.aliyuncs.com
// @connect      generativelanguage.googleapis.com
// @connect      localhost
// @connect      127.0.0.1
// @connect      *
// ==/UserScript==

(() => {
  "use strict";

  const VERSION = "0.2.1";
  const GLOBAL_KEY = "__appewaFullKeyboard";
  const HOST_ID = "appewa-full-keyboard";
  const MISTAKES_KEY = "appewa-ai-mistakes-v1";
  const AI_SETTINGS_KEY = "appewa-ai-settings-v1";
  const AI_API_KEY_KEY = "appewa-ai-secret-v1";
  const AI_SUMMARY_KEY = "appewa-ai-summary-v1";
  const MAX_MISTAKES = 100;
  const MAX_SUMMARY_MISTAKES = 30;
  const INCORRECT_FEEDBACK_RESET_MS = 300;
  const AI_TIMEOUT_MS = 60000;
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
  const CONTROL_SELECTOR = [
    "button",
    "a[href]",
    "summary",
    "input",
    "select",
    "textarea",
    '[role="button"]',
    '[role="link"]',
    '[role="radio"]',
    '[role="checkbox"]',
    '[role="option"]',
    '[role="tab"]',
    '[role="menuitem"]',
  ].join(",");
  const PRIMARY_ACTION = '[data-testid="lesson.primary_action_button"]';
  const VALIDATION_ACTION = '[data-testid$=".validation.action_button"]';
  const COMPLETION_SCREEN = [
    '[data-testid="lesson.completion_result.screen"]',
    '[data-testid="lesson.completion.screen"]',
  ].join(",");
  const COMPLETION_ACTION = [
    '[data-testid="lesson.completion_result.continue_button"]',
    '[data-testid="lesson.completion.continue_button"]',
    '[data-testid="lesson.completion.more_phrases_button"]',
    '[data-testid="lesson.wordsFollowupSurface.continue"]',
    '[data-testid="vocabulary_training.completion.continue_button"]',
  ].join(",");
  const COMPLETION_RATING_STAR =
    '[data-testid^="lesson.completion.feedback_star."]';
  const ROADMAP_SCREEN = '[data-testid="screen.roadmap"]';
  const ROADMAP_CONTINUE = '[data-testid="roadmap.continue_button"]';
  const ENERGY_ACTIVITY_POPUP = '[data-testid="energy.activity_popup"]';
  const ENERGY_ACTIVITY_PRIMARY =
    '[data-testid="energy.activity_popup.primary_button"]';
  const ROADMAP_ACTION_FALLBACKS = [
    '[data-testid="roadmap.test_suggestion.primary_action"]',
    '[data-testid="roadmap.section_change.action"]',
  ];
  const ANSWERS_VIEWPORT = '[data-testid$=".answers_viewport"]';
  const INCORRECT_FEEDBACK =
    '[data-testid$=".validation.title.incorrect"]';
  const ITEM_ID_PREFIXES = [".answer.", ".keyboard.", ".task."];
  const ACTION_DEBOUNCE_MS = 300;
  const AMBIGUOUS_LETTER_DELAY_MS = 300;
  const LETTER_BUFFER_TIMEOUT_MS = 1200;
  const DEFAULT_AI_SETTINGS = {
    apiUrl: "https://api.openai.com/v1",
    model: "",
  };
  const AI_MODEL_EXCLUDE_PATTERN =
    /(audio|dall-e|embed|image|moderation|realtime|rerank|speech|transcri|tts|video|whisper)/i;

  if (window[GLOBAL_KEY]?.version) {
    return;
  }
  window[GLOBAL_KEY] = { version: VERSION };

  let uiHost = null;
  let helpPanel = null;
  let helpCloseButton = null;
  let helpBadge = null;
  let mistakePanel = null;
  let mistakeCloseButton = null;
  let mistakeBadge = null;
  let mistakeCount = null;
  let mistakeList = null;
  let mistakeEmpty = null;
  let aiUrlInput = null;
  let aiModelInput = null;
  let aiKeyInput = null;
  let aiSaveButton = null;
  let aiGenerateButton = null;
  let aiClearButton = null;
  let aiOutput = null;
  let aiError = null;
  let aiSettings = { ...DEFAULT_AI_SETTINGS };
  let liveStatus = null;
  let helpOpen = false;
  let mistakesOpen = false;
  let helpReturnFocus = null;
  let mistakesReturnFocus = null;
  let lastActionAt = -Infinity;
  let letterBuffer = "";
  let letterBufferAt = 0;
  let pendingCandidate = null;
  let pendingCandidateTimer = null;
  let syncQueued = false;
  let mistakeScanQueued = false;
  let mistakes = [];
  let lastSummary = "";
  let incorrectFeedbackBase = "";
  let incorrectFeedbackResetTimer = null;
  let aiBusy = false;
  let aiSettingsBusy = false;

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

  function isInViewport(element) {
    const rect = element.getBoundingClientRect();
    return (
      rect.bottom > 0 &&
      rect.top < window.innerHeight &&
      rect.right > 0 &&
      rect.left < window.innerWidth
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
        [
          '[data-testid="lesson.close_button"]',
          '[data-testid="lesson.primary_action_button"]',
          COMPLETION_SCREEN,
          COMPLETION_ACTION,
          ROADMAP_SCREEN,
          ROADMAP_CONTINUE,
        ].join(","),
      ).length > 0 || Boolean(findFallbackContinueAction())
    );
  }

  function storageKey(key) {
    return `appewa-full-keyboard:${key}`;
  }

  function readStoredValue(key, fallback) {
    try {
      if (typeof GM_getValue === "function") {
        return GM_getValue(key, fallback);
      }

      const raw = localStorage.getItem(storageKey(key));
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeStoredValue(key, value) {
    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(key, value);
        return;
      }

      localStorage.setItem(storageKey(key), JSON.stringify(value));
    } catch {
      // The notebook still works for the current page when storage is blocked.
    }
  }

  function compactText(value, maxLength = 600) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  function readElementText(element, maxLength = 600) {
    if (!(element instanceof Element)) {
      return "";
    }
    return compactText(element.innerText || element.textContent || "", maxLength);
  }

  function findVisibleTestId(testId) {
    return visibleElements("[data-testid]")
      .filter((element) => element.getAttribute("data-testid") === testId)
      .at(-1);
  }

  function currentIncorrectExerciseBase() {
    const title = visibleElements(INCORRECT_FEEDBACK).at(-1);
    const testId = title?.getAttribute("data-testid") || "";
    return testId.endsWith(".validation.title.incorrect")
      ? testId.slice(0, -".validation.title.incorrect".length)
      : "";
  }

  function selectedAnswerText(base) {
    const prefixes = ITEM_ID_PREFIXES.map((prefix) => base + prefix);
    const selectedNodes = visibleElements("[data-testid]").filter((element) => {
      const testId = element.getAttribute("data-testid") || "";
      if (!prefixes.some((prefix) => testId.startsWith(prefix))) {
        return false;
      }

      return (
        testId.endsWith(".highlighted") ||
        element.getAttribute("aria-pressed") === "true" ||
        element.getAttribute("aria-selected") === "true" ||
        element.getAttribute("aria-checked") === "true"
      );
    });

    const parts = selectedNodes
      .map((element) => readElementText(element, 180))
      .filter(Boolean);

    if (parts.length === 0) {
      const viewport = findVisibleTestId(base + ".answers_viewport");
      if (viewport) {
        for (const input of viewport.querySelectorAll("input, textarea")) {
          if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
            if (input.value.trim()) {
              parts.push(compactText(input.value, 180));
            }
          }
        }
      }
    }

    return compactText([...new Set(parts)].join(" / "), 600);
  }

  function parseCorrectAnswer(feedbackText) {
    const labeled = feedbackText.match(
      /(?:正确答案|正确回答|correct answer)\s*[:：]\s*(.+?)(?:\s+(?:继续|continue)|\s*$)/i,
    );
    return compactText(labeled?.[1] || "", 400);
  }

  function lessonIdsFromLocation() {
    const parts = location.pathname.split("/").filter(Boolean);
    const lessonIndex = parts.indexOf("lesson");
    return {
      lessonId: lessonIndex >= 0 ? parts[lessonIndex + 1] || "" : "",
      exerciseId: new URLSearchParams(location.search).get("exerciseId") || "",
    };
  }

  function recordCurrentMistake() {
    const base = currentIncorrectExerciseBase();
    if (!base) {
      if (incorrectFeedbackBase && !incorrectFeedbackResetTimer) {
        incorrectFeedbackResetTimer = window.setTimeout(() => {
          incorrectFeedbackResetTimer = null;
          if (!currentIncorrectExerciseBase()) {
            incorrectFeedbackBase = "";
          }
        }, INCORRECT_FEEDBACK_RESET_MS);
      }
      return false;
    }
    if (incorrectFeedbackResetTimer) {
      clearTimeout(incorrectFeedbackResetTimer);
      incorrectFeedbackResetTimer = null;
    }
    if (incorrectFeedbackBase === base) {
      return false;
    }

    const title = findVisibleTestId(base + ".validation.title.incorrect");
    const popup = findVisibleTestId(base + ".validation");
    const feedback = readElementText(popup || title, 1200);
    const questionElement = findVisibleTestId(base + ".questions");
    const answerViewport = findVisibleTestId(base + ".answers_viewport");
    const question = readElementText(questionElement, 1000);
    const selected = selectedAnswerText(base);
    const answerArea = readElementText(answerViewport, 1000);
    const correctAnswer = parseCorrectAnswer(feedback);
    const now = Date.now();
    incorrectFeedbackBase = base;

    const ids = lessonIdsFromLocation();
    const mistake = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date(now).toISOString(),
      lessonId: ids.lessonId,
      exerciseId: ids.exerciseId,
      exerciseBase: base,
      question: question || "（图片、音频或不含文字的题目）",
      selected: selected || answerArea || "（未识别到选择内容）",
      answerArea: answerArea || "",
      correctAnswer,
      feedback,
    };

    mistakes.unshift(mistake);
    mistakes = mistakes.slice(0, MAX_MISTAKES);
    writeStoredValue(MISTAKES_KEY, mistakes);
    renderMistakeUi();
    announce(
      `已记录错题 ${mistakes.length} 道。按 Alt+M 打开 AI 错题本。`,
    );
    return true;
  }

  function scheduleMistakeScan() {
    if (mistakeScanQueued) {
      return;
    }

    mistakeScanQueued = true;
    requestAnimationFrame(() => {
      mistakeScanQueued = false;
      recordCurrentMistake();
    });
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
    const controlDescendant = [
      ...sourceElement.querySelectorAll(CONTROL_SELECTOR),
    ].find(
      (element) =>
        scope.contains(element) &&
        isVisible(element) &&
        !isDisabled(element),
    );
    if (controlDescendant) {
      return controlDescendant;
    }

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

  function tokenTypingLabel(element) {
    return exactCandidateLabel(element)
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^\p{L}]/gu, "");
  }

  function isLetterKey(key) {
    return /^\p{L}$/u.test(key);
  }

  function resetLetterBuffer() {
    clearPendingCandidate();
    letterBuffer = "";
    letterBufferAt = 0;
  }

  function clearPendingCandidate() {
    if (pendingCandidateTimer !== null) {
      clearTimeout(pendingCandidateTimer);
      pendingCandidateTimer = null;
    }
    pendingCandidate = null;
  }

  function commitPendingCandidate() {
    if (!pendingCandidate) {
      return false;
    }
    const candidate = pendingCandidate;
    clearPendingCandidate();
    resetLetterBuffer();
    focusCandidate(candidate);
    activateElement(candidate);
    announce(`已选择：${shortLabel(candidate)}`);
    return true;
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
    if (primaryActions.length > 0) {
      return primaryActions.at(-1);
    }

    const energyAction = findEnergyActivityAction();
    if (energyAction) {
      return energyAction;
    }

    const completionActions = visibleElements(COMPLETION_ACTION).filter(
      (element) => !isDisabled(element),
    );
    if (completionActions.length > 0) {
      return completionActions.at(-1);
    }

    const roadmapContinue = visibleElements(ROADMAP_CONTINUE).find(
      (element) => !isDisabled(element),
    );
    if (roadmapContinue) {
      return roadmapContinue;
    }

    for (const selector of ROADMAP_ACTION_FALLBACKS) {
      const roadmapAction = visibleElements(selector).find(
        (element) => !isDisabled(element) && isInViewport(element),
      );
      if (roadmapAction) {
        return roadmapAction;
      }
    }

    // Some completion variants render the continue button without a test ID.
    for (const screen of visibleElements(COMPLETION_SCREEN).reverse()) {
      const fallback = [...screen.querySelectorAll("button, [role='button']")]
        .filter((element) => !isDisabled(element))
        .find((element) =>
          /^(下一页|继续|continue|next)$/i.test(shortLabel(element)),
        );
      if (fallback) {
        return fallback;
      }
    }

    const fallbackContinue = findFallbackContinueAction();
    if (fallbackContinue) {
      return fallbackContinue;
    }

    return null;
  }

  function findFallbackContinueAction() {
    const candidates = visibleElements("button, [role='button']").filter(
      (element) => {
        if (isDisabled(element) || !isInViewport(element)) {
          return false;
        }
        if (uiHost && (element === uiHost || uiHost.contains(element))) {
          return false;
        }
        if (element.closest(ANSWERS_VIEWPORT)) {
          return false;
        }
        if (element.closest(ENERGY_ACTIVITY_POPUP)) {
          return false;
        }
        const label = shortLabel(element);
        return /^(继续|下一步|完成|检查|下一页|开始|continue|next|check|finish|start)$/i.test(
          label,
        );
      },
    );

    if (candidates.length === 0) {
      return null;
    }

    const deduplicated = candidates.filter(
      (element) =>
        !candidates.some(
          (other) => other !== element && other.contains(element),
        ),
    );

    deduplicated.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      return rectB.bottom - rectA.bottom;
    });

    return deduplicated[0] || null;
  }

  function activateElement(element) {
    if (!element || typeof element.click !== "function") {
      return;
    }

    try {
      const rect = element.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      const eventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX,
        clientY,
      };

      if (typeof PointerEvent === "function") {
        element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
        element.dispatchEvent(new PointerEvent("pointerup", eventInit));
      }
      element.dispatchEvent(new MouseEvent("mousedown", eventInit));
      element.dispatchEvent(new MouseEvent("mouseup", eventInit));
    } catch {
      // Fallback to plain click if synthetic pointer events fail.
    }

    element.click();
  }

  function findEnergyActivityAction() {
    const primary = visibleElements(ENERGY_ACTIVITY_PRIMARY).find(
      (element) => !isDisabled(element),
    );
    if (primary) {
      return primary;
    }

    const popup = visibleElements(ENERGY_ACTIVITY_POPUP).at(-1);
    if (!popup) {
      return null;
    }

    return (
      [...popup.querySelectorAll("button, [role='button']")].find(
        (element) =>
          !isDisabled(element) && /^(开始|start)$/i.test(shortLabel(element)),
      ) || null
    );
  }

  function getCompletionRatingCandidates() {
    if (visibleElements(COMPLETION_SCREEN).length === 0) {
      return [];
    }

    return visibleElements(COMPLETION_RATING_STAR).filter(
      (element) => !isDisabled(element),
    );
  }

  function activateAction(event) {
    const action = findFocusAction();
    if (!action) {
      announce("当前页面没有找到可用的检查或继续按钮。");
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) {
      return true;
    }

    const now = performance.now();
    if (now - lastActionAt < ACTION_DEBOUNCE_MS) {
      return true;
    }

    lastActionAt = now;
    const label = shortLabel(action);
    activateElement(action);
    announce(label ? `已触发：${label}` : "已触发主操作。");
    return true;
  }

  function isTrueNativeButton(element) {
    return Boolean(
      element instanceof Element &&
        (element.tagName === "BUTTON" ||
          (element.tagName === "INPUT" &&
            /^(button|submit|reset)$/i.test(element.type))),
    );
  }

  function isNativeEnterTarget(element) {
    return Boolean(
      element instanceof Element &&
        element !== document.body &&
        element.matches(
          'button, a[href], summary, input, textarea, select, [contenteditable]',
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

    if (findEnergyActivityAction()) {
      return false;
    }

    return visibleElements('[role="dialog"][aria-modal="true"]').some(
      (dialog) =>
        !dialog.querySelector(VALIDATION_ACTION) &&
        !dialog.matches(VALIDATION_ACTION),
    );
  }

  function handleEnter(event) {
    if (commitPendingCandidate()) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    const action = findFocusAction();
    const energyAction = findEnergyActivityAction();
    const candidates = getAnswerCandidates();
    const activeIndex = focusedCandidateIndex(candidates);
    const active = document.activeElement;
    const activeInEnergyPopup =
      active instanceof Element &&
      Boolean(active.closest(ENERGY_ACTIVITY_POPUP));

    if (
      active instanceof Element &&
      action &&
      (active === action || action.contains(active)) &&
      isTrueNativeButton(active)
    ) {
      // Let the browser handle subsequent Enter presses natively for true native buttons.
      return false;
    }
    if (
      activeIndex < 0 &&
      isNativeEnterTarget(active) &&
      (!energyAction || activeInEnergyPopup) &&
      active !== action &&
      !action?.contains(active)
    ) {
      return false;
    }
    if (hasBlockingLessonDialog()) {
      return false;
    }

    if (!action) {
      announce("当前页面没有找到可用的检查或继续按钮。");
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) {
      return true;
    }

    const now = performance.now();
    if (now - lastActionAt < ACTION_DEBOUNCE_MS) {
      return true;
    }

    lastActionAt = now;
    focusCandidate(action);
    const label = shortLabel(action);
    activateElement(action);
    announce(label ? `已触发：${label}` : "已触发主操作。");
    return true;
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
      const ratingCandidates = getCompletionRatingCandidates();
      const ratingCandidate = ratingCandidates[index];
      if (!ratingCandidate) {
        return false;
      }

      event.preventDefault();
      activateElement(ratingCandidate);
      announce(`已评价 ${index + 1} 星`);
      return true;
    }

    event.preventDefault();
    focusCandidate(candidate);
    activateElement(candidate);
    announce(`已选择第 ${index + 1} 项：${shortLabel(candidate)}`);
    return true;
  }

  function handleLetter(event) {
    if (event.repeat || !isLetterKey(event.key)) {
      return false;
    }

    const now = performance.now();
    if (now - letterBufferAt > LETTER_BUFFER_TIMEOUT_MS) {
      resetLetterBuffer();
    }

    const key = event.key
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLocaleLowerCase();
    let candidates = getAnswerCandidates().filter((element) =>
      tokenTypingLabel(element),
    );
    let typed = letterBuffer + key;

    const matchesPrefixOrExact = candidates.some((element) => {
      const label = tokenTypingLabel(element);
      return label === typed || label.startsWith(typed);
    });

    if (!matchesPrefixOrExact && pendingCandidate) {
      commitPendingCandidate();
      candidates = getAnswerCandidates().filter((element) =>
        tokenTypingLabel(element),
      );
      typed = key;
    }

    let exact = candidates.find(
      (element) => tokenTypingLabel(element) === typed,
    );
    let hasLonger = candidates.some((element) => {
      const label = tokenTypingLabel(element);
      return label.startsWith(typed) && label.length > typed.length;
    });

    if (exact && !hasLonger) {
      event.preventDefault();
      clearPendingCandidate();
      resetLetterBuffer();
      focusCandidate(exact);
      activateElement(exact);
      announce(`已选择：${shortLabel(exact)}`);
      return true;
    }

    if (exact && hasLonger) {
      event.preventDefault();
      clearPendingCandidate();
      pendingCandidate = exact;
      focusCandidate(exact);
      pendingCandidateTimer = setTimeout(() => {
        commitPendingCandidate();
      }, AMBIGUOUS_LETTER_DELAY_MS);
      letterBuffer = typed;
      letterBufferAt = now;
      announce(`正在匹配：${shortLabel(exact)}（继续输入或稍候确认）`);
      return true;
    }

    if (hasLonger) {
      event.preventDefault();
      clearPendingCandidate();
      letterBuffer = typed;
      letterBufferAt = now;
      announce(`正在匹配：${typed}`);
      return true;
    }

    // If the current sequence is not a prefix, treat the key as a fresh start.
    typed = key;
    exact = candidates.find(
      (element) => tokenTypingLabel(element) === typed,
    );
    hasLonger = candidates.some((element) => {
      const label = tokenTypingLabel(element);
      return label.startsWith(typed) && label.length > typed.length;
    });

    if (exact && !hasLonger) {
      event.preventDefault();
      clearPendingCandidate();
      resetLetterBuffer();
      focusCandidate(exact);
      activateElement(exact);
      announce(`已选择：${shortLabel(exact)}`);
      return true;
    }

    if (exact && hasLonger) {
      event.preventDefault();
      clearPendingCandidate();
      pendingCandidate = exact;
      focusCandidate(exact);
      pendingCandidateTimer = setTimeout(() => {
        commitPendingCandidate();
      }, AMBIGUOUS_LETTER_DELAY_MS);
      letterBuffer = typed;
      letterBufferAt = now;
      announce(`正在匹配：${shortLabel(exact)}（继续输入或稍候确认）`);
      return true;
    }

    if (hasLonger) {
      event.preventDefault();
      clearPendingCandidate();
      letterBuffer = typed;
      letterBufferAt = now;
      announce(`正在匹配：${typed}`);
      return true;
    }

    clearPendingCandidate();
    resetLetterBuffer();
    return false;
  }

  function handleSpace(event) {
    if (commitPendingCandidate()) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    const candidates = getAnswerCandidates();
    const activeIndex = focusedCandidateIndex(candidates);
    if (activeIndex < 0) {
      return false;
    }

    event.preventDefault();
    if (!event.repeat) {
      const candidate = candidates[activeIndex];
      activateElement(candidate);
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

  function loadPersistedState() {
    const storedMistakes = readStoredValue(MISTAKES_KEY, []);
    if (Array.isArray(storedMistakes)) {
      mistakes = storedMistakes
        .filter(
          (mistake) =>
            mistake &&
            typeof mistake === "object" &&
            typeof mistake.at === "string",
        )
        .slice(0, MAX_MISTAKES);
    }

    const storedSettings = readStoredValue(AI_SETTINGS_KEY, null);
    if (storedSettings && typeof storedSettings === "object") {
      aiSettings = {
        ...DEFAULT_AI_SETTINGS,
        apiUrl: compactText(storedSettings.apiUrl, 500) || DEFAULT_AI_SETTINGS.apiUrl,
        model: compactText(storedSettings.model, 200),
      };
    }

    const storedSummary = readStoredValue(AI_SUMMARY_KEY, "");
    lastSummary = typeof storedSummary === "string" ? storedSummary : "";
  }

  function formatMistakeTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function renderMistakeUi() {
    if (mistakeCount) {
      mistakeCount.textContent = String(mistakes.length);
    }
    if (mistakeBadge) {
      mistakeBadge.setAttribute(
        "aria-label",
        `打开 AI 错题本，已记录 ${mistakes.length} 道错题`,
      );
      const badgeCount = mistakeBadge.querySelector(".badge-count");
      if (badgeCount) {
        badgeCount.textContent = String(mistakes.length);
      }
    }
    if (!mistakeList || !mistakeEmpty) {
      return;
    }

    mistakeEmpty.hidden = mistakes.length > 0;
    mistakeList.hidden = mistakes.length === 0;
    mistakeList.replaceChildren();

    for (const mistake of mistakes) {
      const item = document.createElement("li");
      item.className = "mistake-item";

      const question = document.createElement("p");
      question.className = "mistake-question";
      question.textContent = mistake.question || "未识别到题目文字";
      item.append(question);

      const answer = document.createElement("p");
      answer.className = "mistake-answer";
      answer.textContent = `你的答案：${mistake.selected || mistake.answerArea || "未识别"}`;
      item.append(answer);

      const correctionText =
        mistake.correctAnswer ||
        compactText(
          String(mistake.feedback || "").replace(
            /^(不正确|错误|incorrect|not quite)\s*/i,
            "",
          ),
          220,
        );
      if (correctionText) {
        const correction = document.createElement("p");
        correction.className = "mistake-correction";
        correction.textContent = `正确信息：${correctionText}`;
        item.append(correction);
      }

      const time = document.createElement("time");
      time.className = "mistake-time";
      time.dateTime = mistake.at;
      time.textContent = formatMistakeTime(mistake.at);
      item.append(time);
      mistakeList.append(item);
    }

    if (lastSummary && aiOutput) {
      aiOutput.hidden = false;
      aiOutput.textContent = lastSummary;
    }
  }

  function normalizeAiEndpoint(value) {
    const input = compactText(value, 500);
    if (!input) {
      throw new Error("请填写接口地址。");
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(input);
    } catch {
      throw new Error("接口地址格式不正确。");
    }

    const localHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      parsedUrl.hostname,
    );
    if (parsedUrl.protocol !== "https:" && !localHost) {
      throw new Error("远程接口必须使用 HTTPS；HTTP 只允许本机模型地址。");
    }
    if (parsedUrl.username || parsedUrl.password) {
      throw new Error("接口地址里不要包含用户名或密码。");
    }
    if (parsedUrl.search || parsedUrl.hash) {
      throw new Error("接口地址不要包含查询参数或锚点。");
    }

    let basePath = parsedUrl.pathname.replace(/\/+$/, "");
    const hasChatSuffix = /\/chat\/completions$/i.test(basePath);
    if (hasChatSuffix) {
      basePath = basePath.replace(/\/chat\/completions$/i, "");
    }
    if (!basePath && !hasChatSuffix) {
      if (parsedUrl.hostname === "openrouter.ai") {
        basePath = "/api/v1";
      } else if (parsedUrl.hostname === "dashscope.aliyuncs.com") {
        basePath = "/compatible-mode/v1";
      } else {
        basePath = "/v1";
      }
    }

    const baseUrl = new URL(parsedUrl.origin + basePath);
    const chatUrl = new URL(baseUrl);
    chatUrl.pathname = `${basePath}/chat/completions`;
    const modelsUrl = new URL(baseUrl);
    modelsUrl.pathname = `${basePath}/models`;

    return {
      baseUrl: baseUrl.toString().replace(/\/$/, ""),
      chatUrl: chatUrl.toString(),
      modelsUrl: modelsUrl.toString(),
      host: parsedUrl.host,
      localHost,
    };
  }

  function scoreAiModel(modelId) {
    const id = modelId.toLowerCase();
    const preferred = [
      [/^gpt-4\.1-mini$/, 120],
      [/^gpt-4o-mini$/, 115],
      [/^gpt-4\.1$/, 110],
      [/^gpt-4o$/, 105],
      [/^openai\/gpt-4\.1-mini$/, 120],
      [/^openai\/gpt-4o-mini$/, 115],
      [/^deepseek-chat$/, 110],
      [/^qwen-plus$/, 105],
      [/^qwen-turbo$/, 100],
      [/^moonshot-v1-(8k|32k)$/, 95],
      [/^openrouter\/auto$/, 90],
      [/claude.*haiku/, 85],
      [/gemini.*flash/, 80],
      [/(chat|instruct)/, 40],
    ];
    const match = preferred.find(([pattern]) => pattern.test(id));
    return match ? match[1] : 0;
  }

  function chooseAiModel(modelIds) {
    const uniqueModels = [];
    const seen = new Set();
    for (const value of modelIds) {
      const id = compactText(value, 200);
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      uniqueModels.push(id);
    }

    const chatModels = uniqueModels.filter(
      (modelId) => !AI_MODEL_EXCLUDE_PATTERN.test(modelId),
    );
    const candidates = chatModels.length > 0 ? chatModels : uniqueModels;
    let selected = "";
    let selectedScore = -1;
    for (const modelId of candidates) {
      const score = scoreAiModel(modelId);
      if (score > selectedScore) {
        selected = modelId;
        selectedScore = score;
      }
    }
    return selected;
  }

  function fallbackAiModelForHost(hostname) {
    if (hostname === "api.openai.com") {
      return "gpt-4.1-mini";
    }
    if (hostname === "api.deepseek.com") {
      return "deepseek-chat";
    }
    if (hostname === "api.moonshot.cn") {
      return "moonshot-v1-8k";
    }
    if (hostname === "dashscope.aliyuncs.com") {
      return "qwen-plus";
    }
    return "";
  }

  async function discoverAiModel({ modelsUrl, apiKey, hostname }) {
    let response;
    try {
      response = await requestAiJson({
        url: modelsUrl,
        apiKey,
        method: "GET",
      });
    } catch (error) {
      const fallback = fallbackAiModelForHost(hostname);
      if (fallback) {
        return {
          model: fallback,
          warning: `${error instanceof Error ? error.message : String(error)} 已使用常用模型 ${fallback}。`,
        };
      }
      throw error;
    }

    let payload;
    try {
      payload = JSON.parse(response.text);
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const detail = compactText(
        payload?.error?.message || payload?.message || response.text,
        300,
      );
      throw new Error(
        `模型列表读取失败（HTTP ${response.status}）${detail ? `：${detail}` : ""}`,
      );
    }

    const modelEntries = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : Array.isArray(payload)
          ? payload
          : [];
    const modelIds = modelEntries.map((entry) =>
      typeof entry === "string" ? entry : entry?.id || entry?.name || "",
    );
    const model = chooseAiModel(modelIds);
    if (!model) {
      throw new Error("服务没有返回可用模型，请在“模型（可选）”中手动填写。");
    }
    return { model, warning: "" };
  }

  function setAiSettingsBusy(busy) {
    aiSettingsBusy = busy;
    if (aiSaveButton) {
      aiSaveButton.disabled = busy;
      aiSaveButton.textContent = busy ? "正在识别模型…" : "保存设置";
    }
    if (aiGenerateButton) {
      aiGenerateButton.disabled = busy || aiBusy;
    }
  }

  async function saveAiSettings({ announceSuccess = true } = {}) {
    if (!aiUrlInput || !aiModelInput || !aiKeyInput) {
      return false;
    }
    if (aiSettingsBusy) {
      return false;
    }

    const apiUrl = compactText(aiUrlInput.value, 500);
    let endpoint;
    try {
      endpoint = normalizeAiEndpoint(apiUrl);
    } catch (error) {
      showAiError(error instanceof Error ? error.message : String(error));
      return false;
    }

    let previousHost = "";
    try {
      previousHost = new URL(aiSettings.apiUrl).host;
    } catch {
      previousHost = "";
    }

    const enteredApiKey = aiKeyInput.value.trim();
    const storedApiKey = readStoredValue(AI_API_KEY_KEY, "");
    const apiKey =
      enteredApiKey ||
      (previousHost && previousHost === endpoint.host ? storedApiKey : "");
    if (!apiKey && !endpoint.localHost) {
      showAiError("请填写 API Key。");
      return false;
    }

    let model = compactText(aiModelInput.value, 200);
    if (
      previousHost &&
      previousHost !== endpoint.host &&
      model === aiSettings.model
    ) {
      model = "";
    }

    let warning = "";
    setAiSettingsBusy(true);
    try {
      if (!model) {
        const discovered = await discoverAiModel({
          modelsUrl: endpoint.modelsUrl,
          apiKey,
          hostname: new URL(endpoint.baseUrl).hostname,
        });
        model = discovered.model;
        warning = discovered.warning;
        aiModelInput.value = model;
      }
    } catch (error) {
      showAiError(
        `${error instanceof Error ? error.message : String(error)} 请展开“模型（可选）”手动填写。`,
      );
      return false;
    } finally {
      setAiSettingsBusy(false);
    }

    aiSettings = { apiUrl: endpoint.baseUrl, model };
    writeStoredValue(AI_SETTINGS_KEY, aiSettings);
    if (enteredApiKey) {
      writeStoredValue(AI_API_KEY_KEY, enteredApiKey);
      aiKeyInput.value = "";
    }

    aiKeyInput.placeholder = readStoredValue(AI_API_KEY_KEY, "")
      ? "已保存（留空则继续使用）"
      : "本地模型可留空";
    showAiError(warning);
    if (announceSuccess) {
      announce("AI 接口设置已保存，模型已自动识别。");
    }
    return true;
  }

  function showAiError(message) {
    if (!aiError) {
      return;
    }
    aiError.textContent = message;
    aiError.hidden = !message;
  }

  function setAiBusy(busy) {
    aiBusy = busy;
    if (aiGenerateButton) {
      aiGenerateButton.disabled = busy;
      aiGenerateButton.textContent = busy ? "正在分析…" : "生成 AI 总结";
    }
    if (aiSaveButton) {
      aiSaveButton.disabled = busy;
    }
    if (aiClearButton) {
      aiClearButton.disabled = busy;
    }
  }

  function requestAiJson({ url, apiKey, body, method = "POST" }) {
    const headers = { Accept: "application/json" };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const data = body === undefined ? undefined : JSON.stringify(body);
    const gmRequest =
      typeof GM_xmlhttpRequest === "function"
        ? GM_xmlhttpRequest
        : typeof GM !== "undefined" &&
            typeof GM.xmlHttpRequest === "function"
          ? GM.xmlHttpRequest.bind(GM)
          : null;

    if (gmRequest) {
      return new Promise((resolve, reject) => {
        const request = {
          method,
          url,
          headers,
          timeout: AI_TIMEOUT_MS,
          onload(response) {
            resolve({
              ok: response.status >= 200 && response.status < 300,
              status: response.status,
              text: response.responseText || "",
            });
          },
          onerror() {
            reject(new Error("网络请求失败，请检查接口地址和网络。"));
          },
          ontimeout() {
            reject(new Error("AI 请求超时，请稍后重试。"));
          },
        };
        if (data !== undefined) {
          request.data = data;
        }
        gmRequest(request);
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    return fetch(url, {
      method,
      headers,
      body: data,
      signal: controller.signal,
    })
      .then(async (response) => ({
        ok: response.ok,
        status: response.status,
        text: await response.text(),
      }))
      .catch((error) => {
        if (error?.name === "AbortError") {
          throw new Error("AI 请求超时，请稍后重试。");
        }
        throw new Error(
          "浏览器阻止了跨域请求。请使用 Tampermonkey 的网络权限或支持 CORS 的接口。",
        );
      })
      .finally(() => clearTimeout(timer));
  }

  function extractAiContent(payload) {
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      return content.trim();
    }
    if (Array.isArray(content)) {
      return content
        .map((part) =>
          typeof part === "string"
            ? part
            : typeof part?.text === "string"
              ? part.text
              : "",
        )
        .join("\n")
        .trim();
    }
    return "";
  }

  async function generateAiSummary() {
    if (aiBusy) {
      return;
    }
    if (mistakes.length === 0) {
      showAiError("还没有错题。答错一次后会自动记录。");
      return;
    }
    if (!(await saveAiSettings({ announceSuccess: false }))) {
      return;
    }

    const apiKey = readStoredValue(AI_API_KEY_KEY, "");
    let endpoint;
    try {
      endpoint = normalizeAiEndpoint(aiSettings.apiUrl);
    } catch (error) {
      showAiError(error instanceof Error ? error.message : String(error));
      return;
    }
    const summaryMistakes = mistakes
      .slice(0, MAX_SUMMARY_MISTAKES)
      .map((mistake) => ({
        question: compactText(mistake.question, 500),
        learnerAnswer: compactText(
          mistake.selected || mistake.answerArea,
          500,
        ),
        correctAnswer: compactText(mistake.correctAnswer, 300),
        feedback: compactText(mistake.feedback, 500),
      }));

    setAiBusy(true);
    showAiError("");
    aiOutput.hidden = false;
    aiOutput.textContent = "正在分析错题，请稍候…";

    try {
      const response = await requestAiJson({
        url: endpoint.chatUrl,
        apiKey,
        body: {
          model: aiSettings.model,
          messages: [
            {
              role: "system",
              content:
                "你是严谨的语言学习教练。只根据用户提供的错题记录分析，不要编造没出现的知识点。用中文回答，结构依次为：主要问题、错误模式、3 个针对性小练习、下次复习重点。引用具体错题，不要输出空泛鼓励。",
            },
            {
              role: "user",
              content: `请分析以下 ${summaryMistakes.length} 条错题记录：\n${JSON.stringify(
                summaryMistakes,
                null,
                2,
              )}`,
            },
          ],
        },
      });

      let payload;
      try {
        payload = JSON.parse(response.text);
      } catch {
        throw new Error(
          `接口返回的不是 JSON（HTTP ${response.status}）。`,
        );
      }

      if (!response.ok) {
        const detail = compactText(
          payload?.error?.message ||
            payload?.message ||
            response.text,
          500,
        );
        throw new Error(
          `AI 接口报错（HTTP ${response.status}）${detail ? `：${detail}` : ""}`,
        );
      }

      const summary = extractAiContent(payload);
      if (!summary) {
        throw new Error("AI 接口没有返回可显示的总结内容。");
      }

      lastSummary = summary;
      writeStoredValue(AI_SUMMARY_KEY, summary);
      aiOutput.textContent = summary;
      announce("AI 错题总结已生成。");
    } catch (error) {
      aiOutput.hidden = true;
      showAiError(error instanceof Error ? error.message : String(error));
    } finally {
      setAiBusy(false);
    }
  }

  function clearMistakes() {
    if (
      mistakes.length > 0 &&
      !window.confirm("确定清空本地错题记录和上次 AI 总结吗？")
    ) {
      return;
    }

    mistakes = [];
    lastSummary = "";
    incorrectFeedbackBase = currentIncorrectExerciseBase();
    if (incorrectFeedbackResetTimer) {
      clearTimeout(incorrectFeedbackResetTimer);
      incorrectFeedbackResetTimer = null;
    }
    writeStoredValue(MISTAKES_KEY, mistakes);
    writeStoredValue(AI_SUMMARY_KEY, "");
    if (aiOutput) {
      aiOutput.textContent = "";
      aiOutput.hidden = true;
    }
    showAiError("");
    renderMistakeUi();
    announce("本地错题记录已清空。");
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

  function closeMistakesPanel({ restoreFocus = true } = {}) {
    if (!mistakesOpen || !mistakePanel) {
      return;
    }

    mistakesOpen = false;
    mistakePanel.hidden = true;
    mistakeBadge?.setAttribute("aria-expanded", "false");

    const returnTarget =
      mistakesReturnFocus instanceof HTMLElement &&
      mistakesReturnFocus.isConnected &&
      mistakesReturnFocus !== document.body
        ? mistakesReturnFocus
        : null;
    mistakesReturnFocus = null;

    if (restoreFocus && returnTarget) {
      requestAnimationFrame(() => returnTarget.focus());
    }
  }

  function openMistakesPanel() {
    if (!mistakePanel || !mistakeCloseButton) {
      return;
    }

    if (helpOpen) {
      closeHelp({ restoreFocus: false });
    }
    mistakesReturnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    mistakesOpen = true;
    mistakePanel.hidden = false;
    mistakeBadge?.setAttribute("aria-expanded", "true");
    renderMistakeUi();
    mistakeCloseButton.focus();
  }

  function toggleMistakesPanel() {
    if (mistakesOpen) {
      closeMistakesPanel();
    } else {
      openMistakesPanel();
    }
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

    if (mistakesOpen) {
      closeMistakesPanel({ restoreFocus: false });
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

    if (
      event.key === "Backspace" &&
      (letterBuffer || pendingCandidate) &&
      !event.composedPath().includes(uiHost) &&
      !isEditableEvent(event)
    ) {
      event.preventDefault();
      clearPendingCandidate();
      letterBuffer = letterBuffer.slice(0, -1);
      letterBufferAt = performance.now();
      announce(letterBuffer ? `正在匹配：${letterBuffer}` : "已清除输入匹配");
      return;
    }

    if (
      !isLetterKey(event.key) &&
      event.key !== "'" &&
      event.key !== "’" &&
      event.key !== "-" &&
      event.key !== "Enter" &&
      event.key !== " "
    ) {
      clearPendingCandidate();
      resetLetterBuffer();
    }

    if (event.key === "'" || event.key === "’" || event.key === "-") {
      if (letterBuffer) {
        event.preventDefault();
        clearPendingCandidate();
        announce(`正在匹配：${letterBuffer}`);
        return;
      }
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

    if (
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "m"
    ) {
      if (!isLessonActive()) {
        return;
      }
      event.preventDefault();
      if (!event.repeat) {
        toggleMistakesPanel();
      }
      return;
    }

    if (
      mistakesOpen &&
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      event.key === "Enter"
    ) {
      event.preventDefault();
      if (!event.repeat) {
        void generateAiSummary();
      }
      return;
    }

    if (event.key === "Escape" && (helpOpen || mistakesOpen)) {
      event.preventDefault();
      if (helpOpen) {
        closeHelp();
      } else {
        closeMistakesPanel();
      }
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
    if (!active && mistakesOpen) {
      closeMistakesPanel({ restoreFocus: false });
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
        .badge-row {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 7px;
        }
        .badge--mistake {
          background: #fff8e5;
        }
        .badge--mistake[aria-expanded="true"] {
          background: #dce7b1;
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
        .badge-count {
          display: inline-grid;
          place-items: center;
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          border-radius: 999px;
          background: #46633c;
          color: #fffdf5;
          font-size: 10px;
          line-height: 1;
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
        .mistake-panel {
          width: min(520px, calc(100vw - 24px));
          max-height: min(720px, calc(100vh - 78px));
          overflow-y: auto;
          overscroll-behavior: contain;
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
        .mistake-summary {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin: -2px 0 10px;
          color: #596359;
          font-size: 11px;
        }
        .mistake-summary strong {
          color: #172019;
          font-size: 15px;
        }
        .mistake-tip {
          padding: 2px 7px;
          border-radius: 999px;
          background: rgba(70, 99, 60, 0.09);
          font-family: "SFMono-Regular", "Cascadia Mono", monospace;
          font-size: 10px;
          white-space: nowrap;
        }
        .mistake-list {
          display: grid;
          gap: 8px;
          max-height: 310px;
          margin: 0 0 12px;
          padding: 0 3px 0 0;
          overflow-y: auto;
          list-style: none;
        }
        .mistake-item {
          padding: 10px 11px;
          border: 1px solid rgba(23, 32, 25, 0.12);
          border-radius: 10px;
          background: rgba(255, 253, 245, 0.88);
        }
        .mistake-item p {
          margin: 0;
        }
        .mistake-question {
          color: #172019;
          font-weight: 700;
        }
        .mistake-answer {
          margin-top: 4px !important;
          color: #8b3e31;
        }
        .mistake-correction {
          margin-top: 3px !important;
          color: #365d35;
        }
        .mistake-time {
          display: block;
          margin-top: 5px;
          color: #7a8278;
          font-size: 10px;
        }
        .mistake-empty {
          margin: 0 0 13px;
          padding: 14px 13px;
          border: 1px dashed rgba(23, 32, 25, 0.2);
          border-radius: 10px;
          background: rgba(255, 253, 245, 0.5);
          color: #596359;
        }
        .ai-config {
          margin-top: 12px;
          border-top: 1px solid rgba(23, 32, 25, 0.12);
          padding-top: 10px;
        }
        .ai-config summary {
          cursor: pointer;
          color: #364237;
          font-size: 12px;
          font-weight: 700;
        }
        .ai-fields {
          display: grid;
          gap: 8px;
          margin-top: 10px;
        }
        .field {
          display: grid;
          gap: 3px;
          color: #596359;
          font-size: 10px;
        }
        .field input {
          box-sizing: border-box;
          width: 100%;
          min-height: 31px;
          padding: 5px 8px;
          border: 1px solid rgba(23, 32, 25, 0.2);
          border-radius: 7px;
          background: #fffdf5;
          color: #172019;
          font: inherit;
          font-size: 12px;
        }
        .field input:focus-visible {
          outline: 2px solid #46633c;
          outline-offset: 1px;
        }
        .ai-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
          margin-top: 11px;
        }
        .action {
          min-height: 32px;
          padding: 5px 11px;
          border: 1px solid rgba(23, 32, 25, 0.22);
          border-radius: 7px;
          background: #fffdf5;
          color: #172019;
          cursor: pointer;
          font: inherit;
          font-size: 12px;
          font-weight: 700;
        }
        .action:hover,
        .action:focus-visible {
          outline: 2px solid #46633c;
          outline-offset: 1px;
        }
        .action:disabled {
          cursor: wait;
          opacity: 0.55;
        }
        .action-primary {
          border-color: #46633c;
          background: #46633c;
          color: #fffdf5;
        }
        .action-danger {
          margin-left: auto;
          color: #8b3e31;
        }
        .privacy {
          margin: 9px 0 0;
          color: #6c756b;
          font-size: 10px;
        }
        .ai-error {
          margin: 9px 0 0;
          padding: 7px 8px;
          border-radius: 7px;
          background: rgba(139, 62, 49, 0.1);
          color: #8b3e31;
          font-size: 11px;
        }
        .ai-output {
          max-height: 300px;
          margin: 10px 0 0;
          padding: 10px;
          overflow: auto;
          border: 1px solid rgba(23, 32, 25, 0.12);
          border-radius: 9px;
          background: #fffdf5;
          color: #263229;
          font: 11px/1.55 "SFMono-Regular", "Cascadia Mono", monospace;
          white-space: pre-wrap;
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
              <p class="subtitle">当前版本 ${VERSION} · 字母输入和网站原生操作保持不变</p>
            </div>
            <button class="close" type="button" aria-label="关闭快捷键帮助">×</button>
          </div>
          <dl class="rows">
            <dt><kbd>Enter</kbd></dt><dd>检查 / 继续 / 提交 / 下一页 / Roadmap 继续 / 弹层开始</dd>
            <dt><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd></dt><dd>聚焦上一个 / 下一个选项</dd>
            <dt><kbd>Space</kbd></dt><dd>选择当前聚焦的选项</dd>
            <dt><kbd>1</kbd>–<kbd>9</kbd></dt><dd>直接选择第 N 项；完成页按 1–5 评价星级</dd>
            <dt><kbd>A</kbd>–<kbd>Z</kbd></dt><dd>连续输入词块文字，如 <kbd>a</kbd><kbd>m</kbd> 选择 am</dd>
            <dt><kbd>Home</kbd><kbd>End</kbd></dt><dd>第一项 / 最后一项</dd>
            <dt><kbd>Alt</kbd>+<kbd>R</kbd></dt><dd>重播可见音频</dd>
            <dt><kbd>Alt</kbd>+<kbd>S</kbd></dt><dd>慢速播放</dd>
            <dt><kbd>Alt</kbd>+<kbd>H</kbd></dt><dd>查看提示</dd>
            <dt><kbd>Alt</kbd>+<kbd>M</kbd></dt><dd>打开 / 关闭 AI 错题本</dd>
            <dt><kbd>Alt</kbd>+<kbd>Enter</kbd></dt><dd>错题本打开时生成 AI 总结</dd>
            <dt><kbd>F1</kbd></dt><dd>打开 / 关闭本帮助</dd>
            <dt><kbd>Esc</kbd></dt><dd>只关闭脚本面板</dd>
          </dl>
          <p class="note">输入框内不会拦截按键；字母、Backspace、Tab、Space 和文本输入继续使用网站原生行为。</p>
        </section>
        <section
          class="panel mistake-panel"
          id="appewa-mistake-notebook"
          role="dialog"
          aria-label="AI 错题本"
          hidden
        >
          <div class="panel-head">
            <div>
              <h2 class="title">AI 错题本</h2>
              <p class="subtitle">错题只保存在本机；点击生成时才会发送精简记录</p>
            </div>
            <button class="close" type="button" aria-label="关闭 AI 错题本">×</button>
          </div>
          <div class="mistake-summary">
            <span>已记录 <strong class="mistake-count">0</strong> 道错题</span>
            <span class="mistake-tip">Alt+M</span>
          </div>
          <p class="mistake-empty">答错后会自动记录题目、你的答案和页面给出的正确答案。</p>
          <ol class="mistake-list" hidden></ol>
          <details class="ai-config">
            <summary>AI 接口设置（OpenAI 兼容）</summary>
            <div class="ai-fields">
              <label class="field">
                接口地址
                <input
                  class="ai-url"
                  type="url"
                  spellcheck="false"
                  autocomplete="off"
                  placeholder="https://api.openai.com/v1"
                />
              </label>
              <label class="field">
                API Key
                <input
                  class="ai-key"
                  type="password"
                  spellcheck="false"
                  autocomplete="new-password"
                  placeholder="只保存在本机脚本存储中"
                />
              </label>
              <label class="field">
                模型（可选）
                <input
                  class="ai-model"
                  type="text"
                  spellcheck="false"
                  autocomplete="off"
                  placeholder="留空自动识别，通常无需填写"
                />
              </label>
            </div>
          </details>
          <div class="ai-actions">
            <button class="action ai-save" type="button">保存设置</button>
            <button class="action action-primary ai-generate" type="button">
              生成 AI 总结
            </button>
            <button class="action action-danger ai-clear" type="button">
              清空错题
            </button>
          </div>
          <p class="privacy">
            点击生成后，最多发送最近 ${MAX_SUMMARY_MISTAKES} 道错题的题目、你的答案、正确答案与反馈；不发送账号信息。API Key 不写入仓库。
          </p>
          <p class="ai-error" role="alert" hidden></p>
          <pre class="ai-output" tabindex="0" hidden></pre>
        </section>
        <div class="badge-row">
          <button
            class="badge badge--mistake"
            type="button"
            aria-controls="appewa-mistake-notebook"
            aria-expanded="false"
            title="AI 错题本（Alt+M）"
          >
            <span class="badge-key">M</span>
            <span>AI 错题</span>
            <span class="badge-count">0</span>
          </button>
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
      </div>
      <div class="sr-only" role="status" aria-live="polite"></div>
    `;

    helpPanel = shadow.querySelector("#appewa-keyboard-help");
    helpCloseButton = helpPanel.querySelector(".close");
    helpBadge = shadow.querySelector(
      '[aria-controls="appewa-keyboard-help"]',
    );
    mistakePanel = shadow.querySelector("#appewa-mistake-notebook");
    mistakeCloseButton = mistakePanel.querySelector(".close");
    mistakeBadge = shadow.querySelector(
      '[aria-controls="appewa-mistake-notebook"]',
    );
    mistakeCount = mistakePanel.querySelector(".mistake-count");
    mistakeList = mistakePanel.querySelector(".mistake-list");
    mistakeEmpty = mistakePanel.querySelector(".mistake-empty");
    aiUrlInput = mistakePanel.querySelector(".ai-url");
    aiModelInput = mistakePanel.querySelector(".ai-model");
    aiKeyInput = mistakePanel.querySelector(".ai-key");
    aiSaveButton = mistakePanel.querySelector(".ai-save");
    aiGenerateButton = mistakePanel.querySelector(".ai-generate");
    aiClearButton = mistakePanel.querySelector(".ai-clear");
    aiOutput = mistakePanel.querySelector(".ai-output");
    aiError = mistakePanel.querySelector(".ai-error");
    liveStatus = shadow.querySelector('[role="status"]');

    aiUrlInput.value = aiSettings.apiUrl;
    aiModelInput.value = aiSettings.model;
    aiKeyInput.placeholder = readStoredValue(AI_API_KEY_KEY, "")
      ? "已保存（留空则继续使用）"
      : "本地模型可留空";

    helpBadge.addEventListener("click", toggleHelp);
    helpCloseButton.addEventListener("click", () => closeHelp());
    mistakeBadge.addEventListener("click", toggleMistakesPanel);
    mistakeCloseButton.addEventListener("click", () => closeMistakesPanel());
    aiSaveButton.addEventListener("click", () => {
      void saveAiSettings();
    });
    aiGenerateButton.addEventListener("click", () => {
      void generateAiSummary();
    });
    aiClearButton.addEventListener("click", clearMistakes);
    document.documentElement.append(uiHost);

    const observer = new MutationObserver(() => {
      scheduleUiVisibilitySync();
      scheduleMistakeScan();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-hidden", "hidden", "style"],
    });

    syncUiVisibility();
    renderMistakeUi();
    scheduleMistakeScan();
  }

  loadPersistedState();
  createUi();
  // Appewa uses React Native Web Pressables, whose key handlers stop
  // propagation for Enter. Capture the event before those handlers run.
  document.addEventListener("keydown", handleKeydown, true);
})();
