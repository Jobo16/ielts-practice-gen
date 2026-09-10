
/*
 * IELTS Academic Reading practice controller (dependency-free).
 *
 * Required shell IDs: #part-title, #part-instruction, #passage-pane,
 * #passage-content, #splitter, #questions-pane, #questions-content,
 * #part-nav, #prev-button, #next-button, #submit-button, #messages-button,
 * #messages-view, #options-button, #options-menu, #show-notes-button,
 * #selection-menu, #highlight-action, #note-action, #notes-host,
 * #submit-dialog, #review-banner, #review-score, #review-accuracy,
 * #review-completion, #review-elapsed, #reset-practice-button,
 * and #live-status. Missing optional hosts are ignored gracefully.
 */
(function () {
  'use strict';

  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const STATE_STORAGE_PREFIX = 'ielts-reading-unified-runtime.v2';
  const STATE_VERSION = 11;
  const REVIEW_TRANSLATION_SIDECAR = window.__IELTS_REVIEW_TRANSLATIONS__ || null;
  const REVIEW_TRANSLATION_SOURCE_BINDING = window.__IELTS_REVIEW_TRANSLATION_SOURCE_BINDING__ || null;
  const REVIEW_TRANSLATION_SET_ID = 'zyz-reading-translation.zh-CN.full170.t007';
  const REVIEW_TRANSLATION_CANONICAL_SHA256 = 'c782692295a95e43e1bd4c69970c00bd3f019e000f2826294880c22cf8bc7b7c';
  const REVIEW_TRANSLATION_UNIT_STATUSES = new Set([
    'pending-human-confirmation',
    'qa-passed-awaiting-human-confirmation',
    'qa-passed-awaiting-human-review',
  ]);
  const TEST_SECONDS = 60 * 60;
  const HIGHLIGHT_LEVELS = 2;
  const HIGHLIGHT_SCHEMA_VERSION = 'zyz-reading-highlight.v2';
  const HIGHLIGHT_CONTEXT_CHARS = 32;
  const CONTENT_CATALOG_URL = 'data/content-sets.json';
  const DISTRIBUTION_POLICY_SURFACES = Object.freeze(['review', 'print', 'export']);
  const PUBLISHER_AUTHORIZATION_SCHEMA = 'zyz-reading-walks-publisher-authorization.v1';
  const PUBLISHER_SIGNATURE_SCHEMA = 'zyz-reading-walks-publisher-signature.v1';
  const PUBLISHER_SIGNATURE_ALGORITHM = 'Ed25519';
  const PUBLISHER_CANONICALIZATION = 'recursive-key-sort-json.v1';
  const PUBLISHER_TRUSTED_SPKI_BASE64 = 'UNSIGNED-INTERNAL-BUILD';
  const EXPECTED_PUBLISHER_ID = 'zyz-reading-walks';
  const EXPECTED_PUBLISHER_PRODUCT = 'ielts-reading-student-runtime';
  const EXPECTED_PUBLISHER_NAME = String.fromCharCode(90, 89, 90, 32, 82, 69, 65, 68, 73, 78, 71, 32, 87, 65, 76, 75, 83);
  const EXPECTED_COPYRIGHT_NOTICE = `${String.fromCharCode(169)} 2026 ${EXPECTED_PUBLISHER_NAME}`;
  const DEFAULT_DISTRIBUTION_POLICY = Object.freeze({
    schemaVersion: 'ielts-reading-distribution-policy.v1',
    mode: 'internal',
    branding: Object.freeze({ publisherDisplayName: null, attributionText: null }),
    watermark: Object.freeze({
      enabled: false,
      visibility: 'disabled',
      textTemplate: null,
      surfaces: Object.freeze([]),
      personalization: 'none',
    }),
    integrity: Object.freeze({ mode: 'artifact-receipt', algorithm: 'none' }),
    hardening: Object.freeze({
      profile: 'development',
      minify: false,
      sourceMaps: false,
      obfuscation: 'none',
      stripPrivateMetadata: false,
      externalNetwork: 'deny',
    }),
    answerDelivery: 'embedded-after-submit',
  });

  const model = {
    parts: [],
    questions: new Map(),
    groups: new Map(),
    questionNumbers: [],
    partQuestionNumbers: new Map(),
    responseNumberById: new Map(),
  };

  let runtimeIndex = null;
  let contentCatalog = null;
  let activeContentSet = null;
  let state = defaultState();
  let els = {};
  let timerHandle = 0;
  let timerFlashHandle = 0;
  let lastTimerRenderedSecond = null;
  let statusHandle = 0;
  let highlightPromptHandle = 0;
  let forceHighlightSelfCheckFailure = false;
  let currentSelection = null;
  let selectionMenuMode = 'selection';
  let selectionReturnFocus = null;
  let activeNoteId = null;
  let pendingDeleteNoteId = null;
  let dragState = null;
  let keyboardDrag = null;
  let splitterDrag = null;
  let lastFocusedBeforeOverlay = null;
  let optionsPanel = 'root';
  let suppressNextQuestionLabelClick = false;
  let suppressQuestionLabelClickHandle = 0;
  let questionChoicePointer = null;
  let endingGeometryFrame = 0;
  let currentReviewReport = null;
  let reviewOverviewCollapsed = false;
  let reviewTranslationVisible = true;
  let reviewTranslationLastAnchor = null;
  let fullscreenBusy = false;
  let verifiedPublisherAuthorization = null;
  let panViewportResizeObserver = null;
  let parentZoomActive = false;

  function defaultState() {
    const partNumbers = model.parts.length ? model.parts.map((part) => Number(part.number)) : [1, 2, 3];
    const firstPart = partNumbers[0] || 1;
    const lastQuestionByPart = {};
    const highlights = {};
    const questionHighlights = {};
    partNumbers.forEach((partNumber) => {
      const numbers = model.partQuestionNumbers.get(partNumber) || [];
      lastQuestionByPart[partNumber] = numbers[0] || 1;
      highlights[partNumber] = [];
      questionHighlights[partNumber] = [];
    });
    const configuredTimer = timerPolicy();
    const now = Date.now();
    return {
      version: STATE_VERSION,
      part: firstPart,
      currentQuestion: model.questionNumbers[0] || 1,
      lastQuestionByPart,
      answers: {},
      questionFlags: {},
      highlights,
      questionHighlights,
      notes: [],
      showNotes: false,
      submitted: false,
      result: null,
      split: 50,
      fontScale: 1,
      contrast: false,
      contrastMode: 'black-white',
      remainingSeconds: configuredTimer.enabled ? configuredTimer.durationSeconds : TEST_SECONDS,
      timerRunning: false,
      timerStartedAt: null,
      timerDeadlineAt: null,
      timerExpiredAt: null,
      timerExpired: false,
      timerWarning10Shown: false,
      timerWarning5Shown: false,
      timerAnnouncementMarks: [],
      timerLastObservedAt: null,
      overtimeSeconds: 0,
      submissionReason: null,
      clockAnomaly: false,
      attemptStartedAt: configuredTimer.enabled ? null : now,
      submittedAt: null,
      elapsedSeconds: null,
      attemptNumber: null,
      attemptMarker: null,
      submissionId: null,
      partElapsedMilliseconds: {},
      partActiveStartedAt: configuredTimer.enabled ? null : now,
      partTimingComplete: true,
      updatedAt: now,
    };
  }

  function stateStorageKey() {
    const packageId = runtimeIndex?.manifest?.packageId || runtimeIndex?.candidate?.assessmentId || activeContentSet?.setId || 'unloaded';
    const version = runtimeIndex?.manifest?.contentVersion || 'draft';
    return `${STATE_STORAGE_PREFIX}.${packageId}.${version}`;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    els = {
      appPanViewport: byId('app-pan-viewport'),
      app: byId('app'),
      appHeader: byId('app-header'),
      examShell: byId('exam-shell'),
      partIntro: byId('part-intro'),
      partTitle: byId('part-title'),
      partInstruction: byId('part-instruction'),
      t35PartReviewUtilityHost: byId('t35-part-review-utility-host'),
      t35ReviewCompactUtilityHost: byId('t35-review-compact-utility-host'),
      t35ReviewViewControl: byId('t35-review-view-control'),
      t36ReviewModeTools: byId('t36-review-mode-tools'),
      t36EvidenceModeSlot: byId('t36-evidence-mode-slot'),
      partFullscreenHost: byId('part-fullscreen-host'),
      reviewCompactFullscreenHost: byId('review-compact-fullscreen-host'),
      fullscreenButton: byId('fullscreen-button'),
      fullscreenIcon: byId('fullscreen-icon'),
      passagePane: byId('passage-pane'),
      passageContent: byId('passage-content'),
      splitter: byId('splitter'),
      questionsPane: byId('questions-pane'),
      questionsContent: byId('questions-content'),
      footerContent: byId('footer-content'),
      partNav: byId('part-nav'),
      prevButton: byId('prev-button'),
      nextButton: byId('next-button'),
      submitButton: byId('submit-button'),
      messagesButton: byId('messages-button'),
      messagesView: byId('messages-view'),
      messagesCloseButton: byId('messages-close-button'),
      messagesContent: byId('messages-content'),
      optionsButton: byId('options-button'),
      optionsMenu: byId('options-menu'),
      optionsContent: byId('options-content'),
      optionsTitle: byId('options-title'),
      optionsBackButton: byId('options-back-button'),
      optionsCloseButton: byId('options-close-button'),
      showNotesButton: byId('show-notes-button'),
      selectionMenu: byId('selection-menu'),
      highlightAction: byId('highlight-action'),
      noteAction: byId('note-action'),
      notesHost: byId('notes-host'),
      submitDialog: byId('submit-dialog'),
      cancelSubmitButton: byId('cancel-submit-button'),
      confirmSubmitButton: byId('confirm-submit-button'),
      submitDescription: byId('submit-dialog-description'),
      reviewBanner: byId('review-banner'),
      reviewScore: byId('review-score'),
      reviewBandMetric: byId('review-band-metric'),
      reviewBand: byId('review-band'),
      reviewAccuracy: byId('review-accuracy'),
      reviewCompletion: byId('review-completion'),
      reviewElapsed: byId('review-elapsed'),
      reviewAssignmentTitle: byId('review-assignment-title'),
      reviewAssignmentCode: byId('review-assignment-code'),
      reviewAssignmentCodeValue: byId('review-assignment-code-value'),
      reviewPassages: byId('review-passages'),
      reviewSubmittedAt: byId('review-submitted-at'),
      reviewTimerMeta: byId('review-timer-meta'),
      reviewPartScores: byId('review-part-scores'),
      reviewCompactBar: byId('review-compact-bar'),
      reviewCompactPart: byId('review-compact-part'),
      reviewCompactScore: byId('review-compact-score'),
      reviewCompactElapsed: byId('review-compact-elapsed'),
      reviewCollapseButton: byId('review-collapse-button'),
      reviewExpandButton: byId('review-expand-button'),
      openHomeworkReceiptButton: byId('open-homework-receipt-button'),
      homeworkReceiptDialog: byId('homework-receipt-dialog'),
      homeworkReceiptContent: byId('homework-receipt-content'),
      closeHomeworkReceiptButton: byId('close-homework-receipt-button'),
      copyHomeworkReceiptButton: byId('copy-homework-receipt-button'),
      downloadHomeworkReceiptButton: byId('download-homework-receipt-button'),
      reviewDetail: byId('review-detail'),
      resetButton: byId('reset-practice-button'),
      liveStatus: byId('live-status'),
      highlightStatus: byId('highlight-status'),
      timer: byId('timer'),
      timerStartGate: byId('timer-start-gate'),
      timerStartButton: byId('timer-start-button'),
      timerStartLimit: byId('timer-start-limit'),
      timerStartCard: document.querySelector('.timer-start-card'),
      testTakerId: byId('test-taker-id'),
    };
  }

  function syncAppPanRange() {
    const viewport = els.appPanViewport;
    if (!viewport) return;
    const visual = window.visualViewport;
    const visualScale = Number(visual?.scale) || 1;
    const isVisualZoomed = visualScale > 1.001;
    const zoomActive = isVisualZoomed || parentZoomActive;
    viewport.classList.toggle('is-visual-zoomed', isVisualZoomed);
    viewport.classList.toggle('is-parent-zoom-active', parentZoomActive);

    /* The top-level student shell owns layout-zoom movement. Chromium owns
       visual-viewport movement. In either case this nested viewport must keep
       a zero offset and release pane-edge gestures to its actual owner. */
    if (zoomActive) {
      if (Math.abs(viewport.scrollLeft) > 0.01) viewport.scrollLeft = 0;
      if (Math.abs(viewport.scrollTop) > 0.01) viewport.scrollTop = 0;
      return;
    }
    const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    if (viewport.scrollLeft > maximum) viewport.scrollLeft = maximum;
  }

  function isVisualZoomActive() {
    return parentZoomActive || (Number(window.visualViewport?.scale) || 1) > 1.001;
  }

  function handleParentZoomState(event) {
    if (event.source !== window.parent || event.data?.type !== 'zyz-student-runner-zoom-state.v1') return;
    parentZoomActive = Boolean(event.data.zoomActive);
    syncAppPanRange();
  }

  function wheelPixels(event, reference) {
    const raw = event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY)
      ? event.deltaY
      : event.deltaX;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return raw * 16;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return raw * Math.max(1, reference?.clientWidth || window.innerWidth);
    return raw;
  }

  function horizontalScrollerWithRoom(target, delta) {
    const viewport = els.appPanViewport;
    let element = target instanceof Element ? target : null;
    while (element && element !== viewport) {
      if (element.matches('.table-completion-scroll, .diagram-viewport')) {
        const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
        const canMove = delta < 0 ? element.scrollLeft > 0.5 : element.scrollLeft < maximum - 0.5;
        if (maximum > 0.5 && canMove) return element;
      }
      element = element.parentElement;
    }
    return null;
  }

  function handleAppPanWheel(event) {
    const viewport = els.appPanViewport;
    if (!viewport || event.defaultPrevented || splitterDrag) return;
    const horizontalIntent = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
    /* Let Chromium consume horizontal trackpad gestures during pinch zoom.
       Preventing them here creates a competing offset and breaks the reverse
       trip back to the true left edge on macOS. */
    if (isVisualZoomActive()) {
      /* Some Chromium automation paths, and occasionally the first inertial
         frame after a physical pinch, expose the new visual scale before a
         visualViewport resize callback has run. Synchronise here as a second
         line of defence, then leave the gesture completely native. */
      syncAppPanRange();
      return;
    }
    if (!horizontalIntent) return;
    const delta = wheelPixels(event, viewport);
    if (!Number.isFinite(delta) || Math.abs(delta) < 0.01) return;

    const nestedScroller = horizontalScrollerWithRoom(event.target, delta);
    if (nestedScroller) {
      if (!event.shiftKey) return;
      const before = nestedScroller.scrollLeft;
      nestedScroller.scrollLeft += delta;
      if (Math.abs(nestedScroller.scrollLeft - before) > 0.01) event.preventDefault();
      return;
    }

    syncAppPanRange();
    const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    if (maximum <= 0.5) return;
    const before = viewport.scrollLeft;
    viewport.scrollLeft = Math.max(0, Math.min(maximum, before + delta));
    if (Math.abs(viewport.scrollLeft - before) > 0.01) event.preventDefault();
  }

  function h(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function homeworkReportRuntime() {
    if (!window.IELTSHomeworkReport) throw new Error('The homework report runtime was not loaded.');
    return window.IELTSHomeworkReport;
  }

  function attemptLedgerRuntime() {
    if (!window.IELTSAttemptLedger) throw new Error('The attempt ledger runtime was not loaded.');
    return window.IELTSAttemptLedger;
  }

  function assignmentSnapshotHash() {
    return String(runtimeIndex?.manifest?.extensions?.homeworkSnapshot?.snapshotHash || '').trim();
  }

  function reviewMode() {
    const value = runtimeIndex?.manifest?.extensions?.homeworkSnapshot?.reviewMode;
    return value === 'score-only' ? 'score-only' : 'full-review';
  }

  function fullReviewEnabled() {
    return reviewMode() === 'full-review';
  }

  function reviewTranslationSourceUnits(part) {
    if (!part) return [];
    const units = [];
    if (part.titleVisible !== false && part.title) units.push({ unitId: 'title', blockId: null, sourceText: part.title });
    if (part.lead) units.push({ unitId: 'lead', blockId: null, sourceText: part.lead });
    (part.paragraphs || []).forEach((paragraph) => {
      if (paragraph.blockId && paragraph.text) units.push({
        unitId: `block:${paragraph.blockId}`,
        blockId: paragraph.blockId,
        sourceText: paragraph.text,
      });
    });
    (part.footnotes || []).forEach((footnote) => {
      if (footnote.blockId && footnote.text) units.push({
        unitId: `block:${footnote.blockId}`,
        blockId: footnote.blockId,
        sourceText: footnote.text,
      });
    });
    return units;
  }

  function reviewTranslationBinding(part) {
    if (!reviewAnswerAnalysisEnabled() || !part?.passageId || !REVIEW_TRANSLATION_SIDECAR) return null;
    if (REVIEW_TRANSLATION_SIDECAR.translationRuntimeContractVersion !== 'zyz-reading-review-translation-runtime.v1' ||
        REVIEW_TRANSLATION_SIDECAR.translationSetId !== REVIEW_TRANSLATION_SET_ID ||
        REVIEW_TRANSLATION_SIDECAR.integrity?.algorithm !== 'sha256-canonical-json' ||
        REVIEW_TRANSLATION_SIDECAR.integrity?.payloadSha256 !== REVIEW_TRANSLATION_CANONICAL_SHA256 ||
        REVIEW_TRANSLATION_SIDECAR.locale !== 'zh-CN' || !Array.isArray(REVIEW_TRANSLATION_SIDECAR.passages) ||
        !REVIEW_TRANSLATION_SOURCE_BINDING || REVIEW_TRANSLATION_SOURCE_BINDING.translationSetId !== REVIEW_TRANSLATION_SET_ID ||
        REVIEW_TRANSLATION_SOURCE_BINDING.canonicalPayloadSha256 !== REVIEW_TRANSLATION_CANONICAL_SHA256) return null;
    const matches = REVIEW_TRANSLATION_SIDECAR.passages.filter((entry) => entry?.passageId === part.passageId);
    if (matches.length !== 1 || !Array.isArray(matches[0].units)) return null;
    const expected = reviewTranslationSourceUnits(part);
    const hiddenTitle = part.titleVisible === false && part.title
      ? [{ unitId: 'title', blockId: null, sourceText: part.title }]
      : [];
    const bindable = [...hiddenTitle, ...expected];
    const supplied = matches[0].units;
    if (!expected.length || supplied.length !== bindable.length) return null;
    const byId = new Map();
    for (const unit of supplied) {
      if (!unit || typeof unit.unitId !== 'string' || byId.has(unit.unitId) ||
          !REVIEW_TRANSLATION_UNIT_STATUSES.has(unit.status) || typeof unit.translationZh !== 'string' || !unit.translationZh.trim()) return null;
      byId.set(unit.unitId, unit);
    }
    for (const sourceUnit of bindable) {
      const unit = byId.get(sourceUnit.unitId);
      const sourceBinding = REVIEW_TRANSLATION_SOURCE_BINDING.units?.[`${part.passageId}\u0000${sourceUnit.unitId}`];
      if (!unit || unit.passageId !== part.passageId || unit.blockId !== sourceUnit.blockId || unit.sourceText !== sourceUnit.sourceText ||
          !sourceBinding || sourceBinding.blockId !== sourceUnit.blockId || sourceBinding.sourceText !== sourceUnit.sourceText ||
          sourceBinding.sourceTextSha256 !== unit.sourceTextSha256) return null;
    }
    return { passage: matches[0], byId, expected };
  }


  function renderReviewTranslationUnit(binding, unitId) {
    if (!binding || !reviewTranslationVisible) return '';
    const unit = binding.byId.get(unitId);
    if (!unit) return '';
    return `<p class="review-translation-text review-translation-unit" lang="zh-CN"
      data-review-translation-node="true" data-review-translation-for="${h(unitId)}"
      data-annotation-exclude="true">${h(unit.translationZh)}</p>`;
  }

  function captureReviewTranslationScrollAnchor() {
    if (!els.passagePane || !els.passageContent) return null;
    const paneRect = els.passagePane.getBoundingClientRect();
    const candidates = [...els.passageContent.querySelectorAll('[data-review-translation-source-unit]')];
    const source = candidates.find((element) => element.getBoundingClientRect().bottom > paneRect.top + 1) || candidates[0];
    if (!source) return { unitId: null, blockId: null, withinBlockOffset: 0, fallbackScrollTop: els.passagePane.scrollTop };
    const rect = source.getBoundingClientRect();
    return {
      unitId: source.dataset.reviewTranslationSourceUnit || null,
      blockId: source.dataset.reviewTranslationBlockId || null,
      withinBlockOffset: paneRect.top - rect.top,
      fallbackScrollTop: els.passagePane.scrollTop,
    };
  }

  function restoreReviewTranslationScrollAnchor(anchor) {
    if (!anchor || !els.passagePane || !els.passageContent) return;
    const target = [...els.passageContent.querySelectorAll('[data-review-translation-source-unit]')]
      .find((element) => element.dataset.reviewTranslationSourceUnit === anchor.unitId);
    if (!target) {
      els.passagePane.scrollTop = anchor.fallbackScrollTop;
      return;
    }
    const paneTop = els.passagePane.getBoundingClientRect().top;
    const targetTop = target.getBoundingClientRect().top;
    const desiredTop = paneTop - anchor.withinBlockOffset;
    els.passagePane.scrollTop += targetTop - desiredTop;
  }


  const T36_DEMO_SCOPE = Object.freeze({
    passageCount: 170,
    sidecarPassageCount: 170,
    sidecarScoreSlotCount: 2261,
    locatorEligibility: 'full-library-sidecar-with-five-human-decisions-accepted',
  });
  const T36_EVIDENCE_ANCHOR_SIDECAR = __ZYZ_JSON__("data/controller/const-t36-evidence-anchor-sidecar.json");
  const t36SidecarByScoreSlot = new Map(T36_EVIDENCE_ANCHOR_SIDECAR.entries.map((entry) => [entry.scoreSlotId, entry]));
  const t36EvidenceIndexByScoreSlot = new Map();
  const t36RuntimeDiagnostics = [];
  let t35ReviewView = 'answer-analysis';
  let t35ReviewLocatorTimer = 0;
  let t36EvidenceCueTimer = 0;
  let t36RightReviewTargetTimer = 0;
  let t36RightReviewTargetElement = null;
  let t36CurrentEvidenceMarkerButton = null;
  let t36EvidenceDisplayMode = 'always';
  let t36EvidenceRenderEpoch = 0;
  let t36EvidenceHashEpoch = -1;
  let t36EvidenceBlockHashCache = new Map();
  let t36EvidencePersistentKey = '';
  let t36EvidencePendingKey = '';
  let t36EvidencePendingRevision = 0;
  let t36EvidenceBuildRevision = 0;
  let t36EvidenceRefreshRaf = 0;
  const t36EvidenceRefreshReasons = new Set();
  let t36EvidenceMarkerRecords = [];
  let t36EvidenceMarkerRaf = 0;
  let t36EvidenceResizeObserver = null;
  let t36EvidenceMutationObserver = null;
  let t36EvidenceObserversReady = false;


  function t35ReviewDomContract({ submitted, fullReview, view }) {
    const reviewEnabled = Boolean(submitted && fullReview);
    const answerAnalysis = reviewEnabled && view === 'answer-analysis';
    return Object.freeze({
      showReviewViewControl: reviewEnabled,
      showAnswerAnalysis: answerAnalysis,
      showTranslationNodes: answerAnalysis,
      showSelfCorrection: reviewEnabled && view === 'self-correction',
    });
  }

  function t35CurrentReviewDomContract() {
    return t35ReviewDomContract({
      submitted: Boolean(state.submitted),
      fullReview: fullReviewEnabled(),
      view: t35ReviewView,
    });
  }

  function reviewAnswerAnalysisEnabled() {
    return t35CurrentReviewDomContract().showAnswerAnalysis;
  }

  function t35ReviewStatusEnglish(status) {
    if (status === 'correct') return 'Correct';
    if (status === 'partial') return 'Partially correct';
    if (status === 'incorrect') return 'Incorrect';
    return 'Unanswered';
  }

  function t35SelfCorrectionReviewMarkup({ questionLabel, status, supplied, reviewFor, scoreSlotId = '' }) {
    return `<div class="answer-review review-feedback ${h(status)} self-correction-review"
      data-review-for="${h(reviewFor)}"${scoreSlotId ? ` data-score-slot-id="${h(scoreSlotId)}"` : ''}
      data-t35-self-correction="true">
      ${answerReviewHeadingMarkup(questionLabel, t35ReviewStatusEnglish(status))}
      <dl class="answer-comparison"><div><dt>你的答案</dt><dd>${h(reviewValue(supplied))}</dd></div></dl>
    </div>`;
  }

  function t36CustomHighlightAvailable() {
    return typeof CSS !== 'undefined' && Boolean(CSS.highlights) && typeof Highlight === 'function';
  }

  function t36AttemptDisplayNumbersForScoreSlot(scoreSlotId) {
    if (!state.submitted) return [];
    const stableId = String(scoreSlotId || '');
    if (!stableId) return [];
    return model.questionNumbers.filter((number) => scoreSlotForQuestion(number)?.scoreSlotId === stableId);
  }

  function t36CurrentPassageEvidenceEntries() {
    if (!reviewAnswerAnalysisEnabled()) return [];
    const passageId = partModel(state.part)?.passageId || '';
    if (!passageId) return [];
    return T36_EVIDENCE_ANCHOR_SIDECAR.entries.filter((entry) =>
      entry.passageId === passageId && t36AttemptDisplayNumbersForScoreSlot(entry.scoreSlotId).length > 0);
  }

  function t36EvidenceModeControlMarkup() {
    const pressed = t36EvidenceDisplayMode === 'always' && t36CustomHighlightAvailable();
    const disabled = !t36CustomHighlightAvailable();
    const accessibleState = disabled
      ? '原文定位，当前浏览器不支持整篇显示；逐题定位仍可使用'
      : pressed ? '原文定位，已开启；点击关闭' : '原文定位，已关闭；点击开启';
    return `<button id="t36-evidence-mode-control" class="t36-evidence-mode-control" type="button"
      aria-pressed="${pressed}" aria-label="${accessibleState}" data-t36-evidence-state="${pressed ? 'on' : 'off'}"
      ${disabled ? 'disabled title="当前浏览器不支持整篇显示；逐题定位仍可使用。"' : ''}>
      <span class="t36-evidence-mode-label">原文定位</span>
    </button>`;
  }

  function t36SyncEvidenceModeControl(enabled) {
    const slot = els.t36EvidenceModeSlot;
    if (!slot) return;
    const shouldExist = Boolean(enabled && reviewAnswerAnalysisEnabled() && t36CurrentPassageEvidenceEntries().length);
    if (!shouldExist) {
      if (slot.childElementCount) slot.replaceChildren();
      t36ClearPersistentEvidenceOverview();
      return;
    }
    if (!t36CustomHighlightAvailable()) t36EvidenceDisplayMode = 'click';
    const expectedPressed = t36EvidenceDisplayMode === 'always' && t36CustomHighlightAvailable();
    const accessibleState = t36CustomHighlightAvailable()
      ? expectedPressed ? '原文定位，已开启；点击关闭' : '原文定位，已关闭；点击开启'
      : '原文定位，当前浏览器不支持整篇显示；逐题定位仍可使用';
    let control = slot.firstElementChild;
    if (!control) {
      slot.innerHTML = t36EvidenceModeControlMarkup();
      control = slot.firstElementChild;
      control.addEventListener('click', t36HandleEvidenceModeToggle);
    } else {
      control.setAttribute('aria-pressed', String(expectedPressed));
      control.setAttribute('aria-label', accessibleState);
      control.dataset.t36EvidenceState = expectedPressed ? 'on' : 'off';
    }
    t36EnsureEvidenceMarkerObservers();
    if (expectedPressed) t36SchedulePersistentEvidenceRefresh('mode-sync');
    else t36ClearPersistentEvidenceOverview();
  }

  function t35SyncReviewUtilityPlacement() {
    const viewControl = els.t35ReviewViewControl;
    const modeTools = els.t36ReviewModeTools;
    const enabled = t35CurrentReviewDomContract().showReviewViewControl;
    const target = state.submitted && reviewOverviewCollapsed
      ? els.t35ReviewCompactUtilityHost
      : els.t35PartReviewUtilityHost;
    if (modeTools && target && modeTools.parentElement !== target) target.prepend(modeTools);
    if (modeTools) modeTools.hidden = !enabled;
    if (viewControl) {
      viewControl.hidden = !enabled;
      viewControl.dataset.currentView = t35ReviewView;
      viewControl.querySelectorAll('input[name="t35-review-view"]').forEach((radio) => {
        radio.checked = radio.value === t35ReviewView;
        radio.disabled = !enabled;
      });
    }
    t36SyncEvidenceModeControl(enabled);
    if (els.reviewCollapseButton) els.reviewCollapseButton.hidden = !state.submitted;
    if (els.reviewExpandButton) els.reviewExpandButton.hidden = !state.submitted;
  }

  function t36SidecarEntry(scoreSlotId) {
    if (!reviewAnswerAnalysisEnabled()) return null;
    const entry = t36SidecarByScoreSlot.get(String(scoreSlotId || '')) || null;
    const part = partModel(state.part);
    if (!entry || part?.passageId !== entry.passageId) return null;
    return t36AttemptDisplayNumbersForScoreSlot(entry.scoreSlotId).length ? entry : null;
  }

  function t36EvidenceIndex(entry) {
    const current = Number(t36EvidenceIndexByScoreSlot.get(entry.scoreSlotId) || 0);
    return Math.max(0, Math.min(entry.evidence.length - 1, current));
  }

  function t36EvidenceNavigationMarkup(scoreSlotId, questionNumber) {
    const entry = t36SidecarEntry(scoreSlotId);
    if (!entry || !entry.evidence.length) return '';
    const index = t36EvidenceIndex(entry);
    const count = entry.evidence.length;
    const steps = count > 1 ? `<button class="t36-evidence-step" type="button" data-t36-evidence-shift="-1" aria-label="上一条证据" ${index === 0 ? 'disabled' : ''}>‹</button>
      <span class="t36-evidence-index" data-t36-evidence-index aria-live="polite">${index + 1}/${count}</span>
      <button class="t36-evidence-step" type="button" data-t36-evidence-shift="1" aria-label="下一条证据" ${index === count - 1 ? 'disabled' : ''}>›</button>` : '';
    const label = entry.locatorKind === 'not-given-related-scope' ? '相关范围' :
      entry.locatorKind === 'matching-headings-target-paragraph' ? '对应段落' :
        entry.locatorKind === 'manual-review-paragraph-fallback' ? '段落兜底' : '定位';
    return `<span class="t36-evidence-nav" data-t36-score-slot="${h(scoreSlotId)}" data-t36-question="${h(questionNumber)}" data-t36-evidence-count="${count}">
      ${steps}<button class="t36-review-locator-button" type="button" data-t36-evidence-locate aria-label="第 ${h(questionNumber)} 题，${h(label)}">${h(label)}</button>
    </span>`;
  }

  function t36ChoiceSetCorrectAnswerRows(group) {
    const scoreSlots = scoreSlotsForTask(group.taskId);
    if (!scoreSlots.length || !scoreSlots.every((scoreSlot) => t36SidecarEntry(scoreSlot.scoreSlotId))) return '';
    const resolvedRows = scoreSlots.map((scoreSlot) => ({
      scoreSlot,
      displayNumbers: t36AttemptDisplayNumbersForScoreSlot(scoreSlot.scoreSlotId),
    }));
    if (resolvedRows.some((row) => row.displayNumbers.length !== 1)) return '';
    const resolvedNumbers = resolvedRows.map((row) => row.displayNumbers[0]);
    if (new Set(resolvedNumbers).size !== resolvedNumbers.length) return '';
    const rows = resolvedRows.map(({ scoreSlot, displayNumbers }) => {
      const entry = t36SidecarEntry(scoreSlot.scoreSlotId);
      const review = runtimeIndex.reviews.get(scoreSlot.scoreSlotId);
      const questionNumber = displayNumbers[0];
      const answer = review?.answerDisplay || entry.answerDisplay;
      return `<div class="t36-choice-correct-row" data-t36-choice-answer-row data-score-slot-id="${h(scoreSlot.scoreSlotId)}" data-task-id="${h(group.taskId)}">
        <span class="t36-choice-answer-label">第 ${h(questionNumber)} 题正确答案</span>
        <strong class="t36-choice-answer-text">${h(answer)}</strong>
        ${t36EvidenceNavigationMarkup(scoreSlot.scoreSlotId, questionNumber)}
      </div>`;
    }).join('');
    return `<div class="t36-choice-correct-rows" aria-label="逐项正确答案与原文定位">${rows}</div>`;
  }

  function t36ClearActiveEvidenceCue() {
    window.clearTimeout(t36EvidenceCueTimer);
    t36EvidenceCueTimer = 0;
    if (typeof CSS !== 'undefined' && CSS.highlights) CSS.highlights.delete('zyz-t36-evidence-cue');
    els.passageContent?.querySelectorAll('[data-t36-review-locator-target]').forEach((element) => {
      element.removeAttribute('data-t36-review-locator-target');
      element.removeAttribute('data-t36-anchor-diagnostic');
    });
  }

  function t35ClearReviewLocator() {
    window.clearTimeout(t35ReviewLocatorTimer);
    t35ReviewLocatorTimer = 0;
    els.passageContent?.querySelectorAll('[data-t35-review-locator-target]').forEach((element) => {
      element.removeAttribute('data-t35-review-locator-target');
    });
    t36ClearActiveEvidenceCue();
    t36ClearRightReviewTarget();
    t36ClearPersistentEvidenceOverview();
  }

  function t35ReviewLocatorDescriptor(scoreSlotId, questionNumber) {
    if (!reviewAnswerAnalysisEnabled()) return null;
    const part = partModel(state.part);
    if (!part?.passageId) return null;
    const scoreSlot = runtimeIndex?.scoreSlots?.get(String(scoreSlotId || ''));
    const review = runtimeIndex?.reviews?.get(String(scoreSlotId || ''));
    const evidence = Array.isArray(review?.evidence) ? review.evidence : [];
    const primaryEvidence = evidence[0] || null;
    const blockId = String(primaryEvidence?.blockId || '');
    if (!scoreSlot || !review || !blockId) return null;
    const sourceUnit = [...(part.paragraphs || []), ...(part.footnotes || [])].find((entry) => entry?.blockId === blockId);
    if (!sourceUnit) return null;
    const question = model.questions.get(Number(questionNumber));
    const group = question && model.groups.get(question.groupId);
    const descriptor = {
      blockId,
      kind: 'evidence-paragraph',
      strategy: 'paragraph',
      evidenceIndex: 0,
      evidenceCount: evidence.length,
      announcement: `第 ${questionNumber} 题已定位到原文证据段落。`,
    };
    if (review.answerDisplay === 'NOT GIVEN') {
      return { ...descriptor, kind: 'not-given-range', strategy: 'range', announcement: `第 ${questionNumber} 题为 NOT GIVEN；已定位到相关信息范围所在段落，不表示唯一答案句。` };
    }
    if (group?.questionType === 'matching_headings') {
      return { ...descriptor, kind: 'matching-heading-paragraph', strategy: 'whole-paragraph', announcement: `第 ${questionNumber} 题已定位到对应完整段落。` };
    }
    if (evidence.length > 1) {
      return { ...descriptor, kind: 'primary-evidence-paragraph', strategy: 'evidence-cycle', announcement: `第 ${questionNumber} 题包含多条证据；当前已定位到第 1 条主证据段落。` };
    }
    return descriptor;
  }

  function t35ReviewLocatorButtonMarkup(scoreSlotId, questionNumber, status) {
    const t36Markup = t36EvidenceNavigationMarkup(scoreSlotId, questionNumber);
    if (t36Markup) return t36Markup;
    if (status === 'correct') return '';
    const descriptor = t35ReviewLocatorDescriptor(scoreSlotId, questionNumber);
    if (!descriptor) return '';
    const buttonLabel = descriptor.kind === 'not-given-range' ? '定位相关信息范围' :
      descriptor.kind === 'matching-heading-paragraph' ? '定位对应段落' :
        descriptor.kind === 'primary-evidence-paragraph' ? '定位主证据段落' : '定位原文段落';
    return `<button class="t35-review-locator-button" type="button"
      data-t35-review-locate-score-slot="${h(scoreSlotId)}" data-t35-review-locate-question="${h(questionNumber)}"
      data-t35-review-locator-block-id="${h(descriptor.blockId)}"
      data-t35-review-locator-kind="${h(descriptor.kind)}" data-t35-review-locator-strategy="${h(descriptor.strategy)}"
      data-t35-review-locator-evidence-index="${h(descriptor.evidenceIndex)}" data-t35-review-locator-evidence-count="${h(descriptor.evidenceCount)}"
      data-t35-review-locator-state="idle" aria-label="第 ${h(questionNumber)} 题，${h(buttonLabel)}">${h(buttonLabel)}</button>`;
  }

  function t35ReviewExplanationHeadingMarkup(scoreSlotId, questionNumber, status, options = {}) {
    const locator = options.suppressLocator ? '' : t35ReviewLocatorButtonMarkup(scoreSlotId, questionNumber, status);
    return `<div class="t35-review-evidence-heading"><strong>解析与原文依据</strong>${locator}</div>`;
  }

  async function t36Sha256(value) {
    if (!globalThis.crypto?.subtle) return null;
    const bytes = new TextEncoder().encode(value);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function t36RangeBoundary(root, offset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let cursor = 0;
    let node = walker.nextNode();
    while (node) {
      const length = node.nodeValue?.length || 0;
      if (offset <= cursor + length) return { node, offset: Math.max(0, offset - cursor) };
      cursor += length;
      node = walker.nextNode();
    }
    return null;
  }

  function t36DomRange(root, startOffset, endOffset) {
    const start = t36RangeBoundary(root, startOffset);
    const end = t36RangeBoundary(root, endOffset);
    if (!start || !end) return null;
    const range = new Range();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  }

  function t36RecordDiagnostic(entry, evidenceIndex, reason) {
    const diagnostic = Object.freeze({
      recordedAt: new Date().toISOString(),
      passageId: entry.passageId,
      scoreSlotId: entry.scoreSlotId,
      evidenceIndex,
      reason,
      fallback: 'bound-blockId-paragraph-cue',
    });
    t36RuntimeDiagnostics.push(diagnostic);
    console.warn('[T36 anchor fallback]', diagnostic);
  }

  function t36SyncEvidenceNavigation(entry, index) {
    els.questionsContent?.querySelectorAll(`[data-t36-score-slot="${CSS.escape(entry.scoreSlotId)}"]`).forEach((nav) => {
      nav.dataset.t36EvidenceCurrent = String(index);
      const counter = nav.querySelector('[data-t36-evidence-index]');
      if (counter) counter.textContent = `${index + 1}/${entry.evidence.length}`;
      nav.querySelectorAll('[data-t36-evidence-shift]').forEach((button) => {
        const shift = Number(button.dataset.t36EvidenceShift);
        button.disabled = shift < 0 ? index === 0 : index === entry.evidence.length - 1;
      });
    });
  }

  function t36HashBlockOnce(blockId, sourceText, renderEpoch) {
    if (t36EvidenceHashEpoch !== renderEpoch) {
      t36EvidenceHashEpoch = renderEpoch;
      t36EvidenceBlockHashCache = new Map();
    }
    const existing = t36EvidenceBlockHashCache.get(blockId);
    if (existing && existing.sourceText === sourceText) return existing.promise;
    const promise = t36Sha256(sourceText);
    t36EvidenceBlockHashCache.set(blockId, { sourceText, promise });
    return promise;
  }

  function t36PersistentEvidenceShouldRender() {
    return Boolean(t36EvidenceDisplayMode === 'always' && reviewAnswerAnalysisEnabled() &&
      t36CustomHighlightAvailable() && t36CurrentPassageEvidenceEntries().length);
  }

  function t36RemovePersistentEvidenceOverviewVisuals({ preserveLayout = false } = {}) {
    if (typeof CSS !== 'undefined' && CSS.highlights) {
      CSS.highlights.delete('zyz-t36-evidence-overview');
      CSS.highlights.delete('zyz-t36-evidence-overview-student-overlap');
    }
    els.passageContent?.querySelectorAll('[data-t36-evidence-overview-scope], [data-t36-evidence-overview-fallback]').forEach((element) => {
      element.removeAttribute('data-t36-evidence-overview-scope');
      element.removeAttribute('data-t36-evidence-overview-fallback');
    });
    els.passagePane?.classList.toggle('t36-evidence-overview-active', preserveLayout);
    els.passagePane?.querySelector(':scope > .t36-evidence-marker-layer')?.remove();
    t36EvidenceMarkerRecords = [];
    t36EvidencePersistentKey = '';
    window.cancelAnimationFrame(t36EvidenceMarkerRaf);
    t36EvidenceMarkerRaf = 0;
  }

  function t36ClearPersistentEvidenceOverview(options = {}) {
    t36EvidenceBuildRevision += 1;
    t36EvidencePendingKey = '';
    t36EvidencePendingRevision = 0;
    window.cancelAnimationFrame(t36EvidenceRefreshRaf);
    t36EvidenceRefreshRaf = 0;
    t36EvidenceRefreshReasons.clear();
    t36RemovePersistentEvidenceOverviewVisuals(options);
  }

  function t36SchedulePersistentEvidenceRefresh(reason = 'dom-refresh') {
    if (!t36PersistentEvidenceShouldRender()) return false;
    t36EvidenceBuildRevision += 1;
    t36EvidenceRefreshReasons.add(String(reason || 'dom-refresh'));
    els.passagePane?.classList.add('t36-evidence-overview-active');
    if (t36EvidenceRefreshRaf) return true;
    t36EvidenceRefreshRaf = window.requestAnimationFrame(() => {
      // The bilingual decorator also settles structural work in animation frames.
      // Commit one frame later so every Range is built against the final wrapper DOM.
      t36EvidenceRefreshRaf = window.requestAnimationFrame(() => {
        t36EvidenceRefreshRaf = 0;
        const reasons = [...t36EvidenceRefreshReasons];
        t36EvidenceRefreshReasons.clear();
        void t36RenderPersistentEvidenceOverview({
          force: true,
          silent: true,
          reason: reasons.join(',') || 'scheduled-refresh',
        });
      });
    });
    return true;
  }

  function t36MarkerReferenceRect(record) {
    const target = record.blockId
      ? els.passageContent?.querySelector(`[data-review-translation-block-id="${CSS.escape(record.blockId)}"]`)
      : record.target;
    if (target && Number.isInteger(record.anchorStartOffset) && Number.isInteger(record.anchorEndOffset)) {
      const contentRoot = target.querySelector('.passage-paragraph-text') || target;
      const range = t36DomRange(contentRoot, record.anchorStartOffset, record.anchorEndOffset);
      if (range) {
        const rects = [...range.getClientRects()].filter((rect) => rect.width || rect.height);
        const rect = rects[0] || range.getBoundingClientRect();
        if (rect && Number.isFinite(rect.top) && (rect.width || rect.height)) return rect;
      }
    }
    return target?.getBoundingClientRect() || null;
  }

  function t36LayoutEvidenceMarkers() {
    t36EvidenceMarkerRaf = 0;
    const pane = els.passagePane;
    const layer = pane?.querySelector(':scope > .t36-evidence-marker-layer');
    if (!pane || !layer || !t36EvidenceMarkerRecords.length) return;
    const paneRect = pane.getBoundingClientRect();
    layer.style.height = `${Math.max(pane.scrollHeight, pane.clientHeight)}px`;
    const positioned = t36EvidenceMarkerRecords.map((record) => ({
      ...record,
      rect: t36MarkerReferenceRect(record),
    })).filter((record) => record.rect).sort((left, right) => left.rect.top - right.rect.top);
    let previousBottom = -Infinity;
    for (const record of positioned) {
      const desiredTop = record.rect.top - paneRect.top + pane.scrollTop;
      const top = Math.max(desiredTop, previousBottom + 4);
      record.marker.style.top = `${Math.max(2, top)}px`;
      record.marker.hidden = false;
      previousBottom = top + Math.max(20, record.marker.offsetHeight || 20);
    }
  }

  function t36QueueEvidenceMarkerLayout() {
    if (t36EvidenceMarkerRaf) return;
    t36EvidenceMarkerRaf = window.requestAnimationFrame(t36LayoutEvidenceMarkers);
  }

  function t36EnsureEvidenceMarkerObservers() {
    if (t36EvidenceObserversReady || !els.passagePane) return;
    t36EvidenceObserversReady = true;
    els.passagePane.addEventListener('scroll', t36QueueEvidenceMarkerLayout, { passive: true });
    window.addEventListener('resize', t36QueueEvidenceMarkerLayout, { passive: true });
    if (typeof ResizeObserver === 'function') {
      t36EvidenceResizeObserver = new ResizeObserver(t36QueueEvidenceMarkerLayout);
      t36EvidenceResizeObserver.observe(els.passagePane);
      if (els.passageContent) t36EvidenceResizeObserver.observe(els.passageContent);
    }
    if (typeof MutationObserver === 'function' && els.passageContent) {
      t36EvidenceMutationObserver = new MutationObserver((mutations) => {
        if (!mutations.some((mutation) => mutation.type === 'childList')) return;
        if (t36PersistentEvidenceShouldRender()) {
          t36SchedulePersistentEvidenceRefresh('passage-child-list');
        } else if (t36EvidenceMarkerRecords.length) {
          t36QueueEvidenceMarkerLayout();
        }
      });
      t36EvidenceMutationObserver.observe(els.passageContent, { childList: true, subtree: true });
    }
  }

  function t36RangeTouchesStudentAnnotation(range) {
    if (!els.passageContent) return false;
    return [...els.passageContent.querySelectorAll('.passage-highlight, [data-note-id], [data-note-anchor]')].some((element) => {
      try { return range.intersectsNode(element); } catch { return false; }
    });
  }

  function t36EvidenceMarkerLabel(entry, evidenceIndex) {
    const displayNumbers = t36AttemptDisplayNumbersForScoreSlot(entry.scoreSlotId);
    if (displayNumbers.length !== 1) return '';
    const base = `Q${displayNumbers[0]}`;
    if (entry.locatorKind === 'not-given-related-scope') return `${base} · 范围`;
    if (entry.locatorKind === 'matching-headings-target-paragraph') return `${base} · 段落`;
    if (entry.locatorKind === 'manual-review-paragraph-fallback') return `${base} · 段落`;
    return entry.evidence.length > 1 ? `${base} · ${evidenceIndex + 1}/${entry.evidence.length}` : base;
  }

  function t36EvidenceMarkerAction(entry, evidenceIndex) {
    const displayNumbers = t36AttemptDisplayNumbersForScoreSlot(entry.scoreSlotId);
    const displayNumber = displayNumbers.length === 1 ? Number(displayNumbers[0]) : NaN;
    const label = t36EvidenceMarkerLabel(entry, evidenceIndex);
    if (!label || !Number.isInteger(displayNumber) || !entry.evidence[evidenceIndex]) return null;
    const scoreSlotId = String(entry.scoreSlotId || '');
    if (!scoreSlotId) return null;
    return Object.freeze({
      key: `${scoreSlotId}\u0000${displayNumber}\u0000${evidenceIndex}`,
      scoreSlotId,
      displayNumber,
      evidenceIndex,
      label,
    });
  }

  function t36AddMarkerCandidate(markerGroups, key, action, reference) {
    if (!action) return;
    const existing = markerGroups.get(key);
    if (existing) {
      existing.actions.set(action.key, action);
      return;
    }
    markerGroups.set(key, { actions: new Map([[action.key, action]]), ...reference });
  }

  function t36ClearRightReviewTarget() {
    window.clearTimeout(t36RightReviewTargetTimer);
    t36RightReviewTargetTimer = 0;
    if (t36RightReviewTargetElement) {
      t36RightReviewTargetElement.removeAttribute('data-t36-right-jump-target');
      if (t36RightReviewTargetElement.dataset.t36RightJumpTemporaryTabindex === 'true') {
        t36RightReviewTargetElement.removeAttribute('tabindex');
        delete t36RightReviewTargetElement.dataset.t36RightJumpTemporaryTabindex;
      }
    }
    if (t36CurrentEvidenceMarkerButton) t36CurrentEvidenceMarkerButton.removeAttribute('data-t36-marker-current');
    t36RightReviewTargetElement = null;
    t36CurrentEvidenceMarkerButton = null;
  }

  function t36UniqueVisibleRightTarget(selector) {
    const candidates = [...(els.questionsContent?.querySelectorAll(selector) || [])]
      .filter((element) => !element.hidden && !element.closest('[hidden]'));
    return candidates.length === 1 ? candidates[0] : null;
  }

  function t36RightReviewTargetForAction(entry, action) {
    const stableSelector = CSS.escape(action.scoreSlotId);
    const displaySelector = CSS.escape(String(action.displayNumber));
    const choiceRow = t36UniqueVisibleRightTarget(`.t36-choice-correct-row[data-score-slot-id="${stableSelector}"]`);
    if (choiceRow) return choiceRow;
    if (entry.locatorKind === 'matching-headings-target-paragraph') {
      const matchingReview = t36UniqueVisibleRightTarget(`.matching-review-item .answer-review[data-review-for="${displaySelector}"]`);
      if (matchingReview) return matchingReview;
    }
    const ordinaryReview = t36UniqueVisibleRightTarget(`.answer-review[data-review-for="${displaySelector}"]`);
    if (ordinaryReview) return ordinaryReview;
    const stableFallback = t36UniqueVisibleRightTarget(`[data-score-slot-id="${stableSelector}"]`);
    if (stableFallback) return stableFallback;
    const questionFallback = t36UniqueVisibleRightTarget(`[data-question="${displaySelector}"]`);
    if (questionFallback) return questionFallback;
    return t36UniqueVisibleRightTarget(`[data-questions~="${displaySelector}"]`);
  }

  function t36ScrollOnlyQuestionsPaneToTarget(target) {
    const pane = els.questionsPane;
    if (!pane || !target || !pane.contains(target)) return false;
    const paneRect = pane.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const desiredTop = pane.scrollTop + targetRect.top - paneRect.top - Math.max(0, (pane.clientHeight - targetRect.height) / 2);
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    pane.scrollTo({ top: Math.max(0, desiredTop), behavior: reducedMotion ? 'auto' : 'smooth' });
    return true;
  }

  function t36HandleEvidenceMarkerActivate(event) {
    const button = event?.currentTarget;
    if (!button?.matches('button.t36-evidence-marker')) return false;
    event.preventDefault();
    event.stopPropagation();
    const scoreSlotId = String(button.dataset.t36ScoreSlotId || '');
    const displayNumber = Number(button.dataset.t36DisplayNumber);
    const evidenceIndex = Number(button.dataset.t36EvidenceIndex);
    const entry = t36SidecarEntry(scoreSlotId);
    const mappedNumbers = t36AttemptDisplayNumbersForScoreSlot(scoreSlotId);
    const identityValid = Boolean(entry && mappedNumbers.length === 1 && mappedNumbers[0] === displayNumber &&
      Number.isInteger(evidenceIndex) && evidenceIndex >= 0 && evidenceIndex < entry.evidence.length);
    if (!identityValid) {
      announceStatus('原文定位题号身份校验未通过，未执行右侧跳转。');
      return false;
    }
    const keyboardActivation = Number(event.detail) === 0;
    const leftScrollTop = els.passagePane?.scrollTop || 0;
    t36EvidenceIndexByScoreSlot.set(scoreSlotId, evidenceIndex);
    t36SyncEvidenceNavigation(entry, evidenceIndex);
    window.requestAnimationFrame(() => {
      const currentEntry = t36SidecarEntry(scoreSlotId);
      const stillMapped = t36AttemptDisplayNumbersForScoreSlot(scoreSlotId);
      const target = currentEntry && stillMapped.length === 1 && stillMapped[0] === displayNumber
        ? t36RightReviewTargetForAction(currentEntry, { scoreSlotId, displayNumber })
        : null;
      if (!target || !els.questionsPane?.contains(target)) {
        if (els.passagePane) els.passagePane.scrollTop = leftScrollTop;
        announceStatus(`第 ${displayNumber} 题的右侧答案解析目标不存在或不唯一，未执行跳转。`);
        return;
      }
      t36ClearRightReviewTarget();
      t36CurrentEvidenceMarkerButton = button;
      button.setAttribute('data-t36-marker-current', 'true');
      t36RightReviewTargetElement = target;
      target.setAttribute('data-t36-right-jump-target', 'true');
      if (keyboardActivation) {
        const alreadyFocusable = target.matches('a[href], button, input, select, textarea, [tabindex]');
        if (!alreadyFocusable) {
          target.setAttribute('tabindex', '-1');
          target.dataset.t36RightJumpTemporaryTabindex = 'true';
        }
      }
      t36ScrollOnlyQuestionsPaneToTarget(target);
      if (els.passagePane) els.passagePane.scrollTop = leftScrollTop;
      if (keyboardActivation) target.focus({ preventScroll: true });
      t36RightReviewTargetTimer = window.setTimeout(t36ClearRightReviewTarget, 2200);
      window.requestAnimationFrame(() => {
        if (els.passagePane) els.passagePane.scrollTop = leftScrollTop;
      });
      announceStatus(`已跳到右侧第 ${displayNumber} 题答案解析。`);
    });
    return true;
  }

  function t36HandleEvidenceModeToggle(event) {
    if (!event?.currentTarget?.matches('#t36-evidence-mode-control')) return false;
    if (!t36CustomHighlightAvailable()) {
      announceStatus('当前浏览器不支持整篇显示；逐题定位仍可使用。');
      return false;
    }
    t36EvidenceDisplayMode = t36EvidenceDisplayMode === 'always' ? 'click' : 'always';
    t36ClearActiveEvidenceCue();
    if (t36EvidenceDisplayMode === 'always') {
      t36SyncEvidenceModeControl(true);
      announceStatus('原文定位已开启。');
    } else {
      t36ClearPersistentEvidenceOverview();
      t36SyncEvidenceModeControl(true);
      announceStatus('原文定位已关闭；逐题定位仍可临时显示。');
    }
    return true;
  }

  async function t36RenderPersistentEvidenceOverview(options = {}) {
    const force = options?.force === true;
    const silent = options?.silent === true;
    if (!t36PersistentEvidenceShouldRender()) {
      t36ClearPersistentEvidenceOverview();
      return false;
    }
    const part = partModel(state.part);
    const passageId = part?.passageId || '';
    const renderEpoch = t36EvidenceRenderEpoch;
    const entries = t36CurrentPassageEvidenceEntries();
    if (!passageId || !entries.length) {
      t36ClearPersistentEvidenceOverview();
      return false;
    }
    const buildKey = `${renderEpoch}:${passageId}:always`;
    if (!force && t36EvidencePersistentKey === buildKey &&
        els.passagePane?.querySelector(':scope > .t36-evidence-marker-layer')) return true;
    if (!force && t36EvidencePendingKey === buildKey && t36EvidencePendingRevision === t36EvidenceBuildRevision) return true;

    const buildRevision = ++t36EvidenceBuildRevision;
    t36EvidencePendingKey = buildKey;
    t36EvidencePendingRevision = buildRevision;
    els.passagePane?.classList.add('t36-evidence-overview-active');
    const sourceUnits = new Map([...(part.paragraphs || []), ...(part.footnotes || [])].map((unit) => [unit.blockId, unit]));
    const uniqueBlocks = new Map();
    for (const entry of entries) {
      for (const evidence of entry.evidence) {
        const unit = sourceUnits.get(evidence.blockId);
        if (unit && !uniqueBlocks.has(evidence.blockId)) uniqueBlocks.set(evidence.blockId, String(unit.text || ''));
      }
    }
    const hashes = new Map(await Promise.all([...uniqueBlocks].map(async ([blockId, sourceText]) => [
      blockId,
      await t36HashBlockOnce(blockId, sourceText, renderEpoch),
    ])));
    const currentBuild = buildRevision === t36EvidenceBuildRevision && renderEpoch === t36EvidenceRenderEpoch &&
      partModel(state.part)?.passageId === passageId && t36PersistentEvidenceShouldRender();
    if (!currentBuild) {
      if (t36EvidencePendingRevision === buildRevision) {
        t36EvidencePendingKey = '';
        t36EvidencePendingRevision = 0;
      }
      return false;
    }

    const exactRanges = [];
    const overlapRanges = [];
    const attributeUpdates = [];
    const markerGroups = new Map();
    let evidenceCount = 0;
    for (const entry of entries) {
      for (const [evidenceIndex, evidence] of entry.evidence.entries()) {
        const sourceUnit = sourceUnits.get(evidence.blockId);
        const target = els.passageContent?.querySelector(`[data-review-translation-block-id="${CSS.escape(evidence.blockId)}"]`);
        if (!sourceUnit || !target) {
          t36RecordDiagnostic(entry, evidenceIndex, 'bound-block-not-rendered');
          continue;
        }
        evidenceCount += 1;
        const sourceText = String(sourceUnit.text || '');
        const actualHash = hashes.get(evidence.blockId);
        const anchorsValid = Boolean(actualHash && evidence.anchors.every((anchor) =>
          anchor.blockId === evidence.blockId && anchor.sourceTextSha256 === actualHash &&
          Number.isInteger(anchor.startOffset) && Number.isInteger(anchor.endOffset) &&
          anchor.startOffset >= 0 && anchor.endOffset > anchor.startOffset && anchor.endOffset <= sourceText.length &&
          (anchor.sourceText == null || sourceText.slice(anchor.startOffset, anchor.endOffset) === anchor.sourceText)));
        const action = t36EvidenceMarkerAction(entry, evidenceIndex);
        const semanticWholeBlock = entry.locatorKind === 'not-given-related-scope' ||
          entry.locatorKind === 'matching-headings-target-paragraph' ||
          entry.locatorKind === 'manual-review-paragraph-fallback';
        if (anchorsValid && semanticWholeBlock) {
          if (entry.locatorKind === 'manual-review-paragraph-fallback') {
            attributeUpdates.push({ target, name: 'data-t36-evidence-overview-fallback', value: 'neutral-bound-paragraph' });
          } else {
            attributeUpdates.push({ target, name: 'data-t36-evidence-overview-scope', value: entry.locatorKind });
          }
          t36AddMarkerCandidate(markerGroups, `scope:${entry.locatorKind}:${evidence.blockId}`, action, {
            target,
            blockId: evidence.blockId,
          });
          continue;
        }
        const contentRoot = target.querySelector('.passage-paragraph-text') || target;
        const ranges = anchorsValid && contentRoot.textContent === sourceText
          ? evidence.anchors.map((anchor) => t36DomRange(contentRoot, anchor.startOffset, anchor.endOffset))
          : [];
        if (!semanticWholeBlock && ranges.length === evidence.anchors.length && ranges.every(Boolean)) {
          for (const range of ranges) {
            (t36RangeTouchesStudentAnnotation(range) ? overlapRanges : exactRanges).push(range);
          }
          const rangeKey = evidence.anchors.map((anchor) => `${anchor.blockId}:${anchor.startOffset}:${anchor.endOffset}`).join('|');
          t36AddMarkerCandidate(markerGroups, `exact:${rangeKey}`, action, {
            target,
            blockId: evidence.blockId,
            anchorStartOffset: evidence.anchors[0].startOffset,
            anchorEndOffset: evidence.anchors[0].endOffset,
          });
          continue;
        }
        const reason = !anchorsValid ? 'hash-offset-or-source-slice-invalid' : 'css-highlight-range-unavailable';
        attributeUpdates.push({ target, name: 'data-t36-evidence-overview-fallback', value: 'neutral-bound-paragraph' });
        t36RecordDiagnostic(entry, evidenceIndex, reason);
        t36AddMarkerCandidate(markerGroups, `fallback:${entry.scoreSlotId}:${evidenceIndex}`, action, {
          target,
          blockId: evidence.blockId,
        });
      }
    }

    const markerLayer = document.createElement('div');
    markerLayer.className = 't36-evidence-marker-layer';
    markerLayer.dataset.t36EvidenceBuildRevision = String(buildRevision);
    markerLayer.setAttribute('aria-label', '原文定位题号，跳到右侧答案解析');
    const markerRecords = [];
    for (const group of markerGroups.values()) {
      const markerGroup = document.createElement('span');
      markerGroup.className = 't36-evidence-marker-group';
      markerGroup.hidden = true;
      for (const action of group.actions.values()) {
        const marker = document.createElement('button');
        marker.className = 't36-evidence-marker';
        marker.type = 'button';
        marker.textContent = action.label;
        marker.dataset.t36ScoreSlotId = action.scoreSlotId;
        marker.dataset.t36DisplayNumber = String(action.displayNumber);
        marker.dataset.t36EvidenceIndex = String(action.evidenceIndex);
        marker.setAttribute('aria-label', `${action.label}，跳到右侧第 ${action.displayNumber} 题答案解析`);
        marker.addEventListener('click', t36HandleEvidenceMarkerActivate);
        markerGroup.append(marker);
      }
      markerLayer.append(markerGroup);
      markerRecords.push({
        marker: markerGroup,
        target: group.target || null,
        blockId: group.blockId || '',
        anchorStartOffset: Number.isInteger(group.anchorStartOffset) ? group.anchorStartOffset : null,
        anchorEndOffset: Number.isInteger(group.anchorEndOffset) ? group.anchorEndOffset : null,
      });
    }

    if (buildRevision !== t36EvidenceBuildRevision || renderEpoch !== t36EvidenceRenderEpoch ||
        partModel(state.part)?.passageId !== passageId || !t36PersistentEvidenceShouldRender()) {
      if (t36EvidencePendingRevision === buildRevision) {
        t36EvidencePendingKey = '';
        t36EvidencePendingRevision = 0;
      }
      return false;
    }
    const passageScrollTop = els.passagePane?.scrollTop || 0;
    t36RemovePersistentEvidenceOverviewVisuals({ preserveLayout: true });
    for (const update of attributeUpdates) {
      if (els.passageContent?.contains(update.target)) update.target.setAttribute(update.name, update.value);
    }
    if (exactRanges.length) CSS.highlights.set('zyz-t36-evidence-overview', new Highlight(...exactRanges));
    if (overlapRanges.length) CSS.highlights.set('zyz-t36-evidence-overview-student-overlap', new Highlight(...overlapRanges));
    els.passagePane.append(markerLayer);
    t36EvidenceMarkerRecords = markerRecords;
    t36EvidencePersistentKey = buildKey;
    if (t36EvidencePendingRevision === buildRevision) {
      t36EvidencePendingKey = '';
      t36EvidencePendingRevision = 0;
    }
    if (els.passagePane) els.passagePane.scrollTop = passageScrollTop;
    t36QueueEvidenceMarkerLayout();
    const questionCount = new Set(entries.flatMap((entry) => t36AttemptDisplayNumbersForScoreSlot(entry.scoreSlotId))).size;
    if (!silent) announceStatus(`本篇已显示 ${questionCount} 道题的 ${evidenceCount} 处原文定位。`);
    return true;
  }

  async function t36LocateReviewEvidence(scoreSlotId, questionNumber) {
    const entry = t36SidecarEntry(scoreSlotId);
    if (!entry) return false;
    const evidenceIndex = t36EvidenceIndex(entry);
    const evidence = entry.evidence[evidenceIndex];
    const part = partModel(state.part);
    const passageId = part?.passageId || '';
    const renderEpoch = t36EvidenceRenderEpoch;
    const sourceUnit = [...(part.paragraphs || []), ...(part.footnotes || [])].find((unit) => unit?.blockId === evidence.blockId);
    const selector = `[data-review-translation-block-id="${CSS.escape(evidence.blockId)}"]`;
    const target = els.passageContent?.querySelector(selector);
    if (!sourceUnit || !target) {
      announceStatus(`第 ${questionNumber} 题的已绑定段落未出现在当前文章中，未执行跳转。`);
      return false;
    }
    t36ClearActiveEvidenceCue();
    t36SyncEvidenceNavigation(entry, evidenceIndex);
    const sourceText = String(sourceUnit.text || '');
    const expectedHash = evidence.anchors[0]?.sourceTextSha256 || '';
    const actualHash = await t36HashBlockOnce(evidence.blockId, sourceText, renderEpoch);
    if (renderEpoch !== t36EvidenceRenderEpoch || partModel(state.part)?.passageId !== passageId || !reviewAnswerAnalysisEnabled()) return false;
    const anchorsValid = Boolean(actualHash && actualHash === expectedHash && evidence.anchors.every((anchor) =>
      anchor.blockId === evidence.blockId &&
      Number.isInteger(anchor.startOffset) && Number.isInteger(anchor.endOffset) &&
      anchor.startOffset >= 0 && anchor.endOffset > anchor.startOffset && anchor.endOffset <= sourceText.length &&
      (anchor.sourceText == null || sourceText.slice(anchor.startOffset, anchor.endOffset) === anchor.sourceText)));
    const semanticWholeBlock = entry.locatorKind === 'not-given-related-scope' || entry.locatorKind === 'matching-headings-target-paragraph' || entry.locatorKind === 'manual-review-paragraph-fallback';
    let usedExactCue = false;
    if (anchorsValid && !semanticWholeBlock && t36CustomHighlightAvailable()) {
      const contentRoot = target.querySelector('.passage-paragraph-text') || target;
      if (contentRoot.textContent === sourceText) {
        const ranges = evidence.anchors.map((anchor) => t36DomRange(contentRoot, anchor.startOffset, anchor.endOffset));
        if (ranges.every(Boolean)) {
          CSS.highlights.set('zyz-t36-evidence-cue', new Highlight(...ranges));
          usedExactCue = true;
        }
      }
    }
    const stateValue = semanticWholeBlock
      ? (entry.locatorKind === 'not-given-related-scope' ? 'related-scope' :
        entry.locatorKind === 'matching-headings-target-paragraph' ? 'target-paragraph' : 'fallback-paragraph')
      : usedExactCue ? 'exact-evidence' : 'fallback-paragraph';
    if (!semanticWholeBlock && !usedExactCue) {
      const reason = !anchorsValid ? 'hash-offset-or-source-slice-invalid' : 'css-highlight-range-unavailable';
      target.setAttribute('data-t36-anchor-diagnostic', reason);
      t36RecordDiagnostic(entry, evidenceIndex, reason);
    }
    target.setAttribute('data-t36-review-locator-target', stateValue);
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
    t36EvidenceCueTimer = window.setTimeout(t36ClearActiveEvidenceCue, 3200);
    const countMessage = entry.evidence.length > 1 ? `，第 ${evidenceIndex + 1}/${entry.evidence.length} 条证据` : '';
    const message = entry.locatorKind === 'not-given-related-scope'
      ? `第 ${questionNumber} 题为 NOT GIVEN；已定位相关信息范围，不表示唯一答案句。`
      : entry.locatorKind === 'matching-headings-target-paragraph'
        ? `第 ${questionNumber} 题已定位整个对应段落。`
        : entry.locatorKind === 'manual-review-paragraph-fallback'
          ? `第 ${questionNumber} 题的精确证据待人工确认；当前仅定位到已绑定段落。`
          : usedExactCue
          ? `第 ${questionNumber} 题已定位并提示原文证据${countMessage}。`
          : `第 ${questionNumber} 题的精确锚点校验未通过；已安全回退到绑定段落并记录诊断。`;
    announceStatus(message);
    return true;
  }

  async function t36ShiftEvidence(scoreSlotId, questionNumber, delta) {
    const entry = t36SidecarEntry(scoreSlotId);
    if (!entry || entry.evidence.length < 2) return false;
    const current = t36EvidenceIndex(entry);
    const next = Math.max(0, Math.min(entry.evidence.length - 1, current + Number(delta || 0)));
    t36EvidenceIndexByScoreSlot.set(entry.scoreSlotId, next);
    t36SyncEvidenceNavigation(entry, next);
    return t36LocateReviewEvidence(entry.scoreSlotId, questionNumber);
  }

  function t35LocateReviewEvidence(scoreSlotId, questionNumber) {
    const descriptor = t35ReviewLocatorDescriptor(scoreSlotId, questionNumber);
    if (!descriptor) {
      announceStatus(`第 ${questionNumber} 题没有有效的网页段落定位，未执行跳转。`);
      return false;
    }
    const selector = `[data-review-translation-block-id="${CSS.escape(descriptor.blockId)}"]`;
    const target = els.passageContent?.querySelector(selector);
    if (!target) {
      announceStatus(`第 ${questionNumber} 题的段落锚点未出现在当前文章中，未执行跳转。`);
      return false;
    }
    t35ClearReviewLocator();
    const stateValue = descriptor.kind === 'not-given-range' ? 'located-range' :
      descriptor.kind === 'matching-heading-paragraph' ? 'located-whole-paragraph' :
        descriptor.kind === 'primary-evidence-paragraph' ? 'located-evidence-1' : 'located-paragraph';
    target.setAttribute('data-t35-review-locator-target', stateValue);
    els.questionsContent?.querySelector(`[data-t35-review-locate-score-slot="${CSS.escape(String(scoreSlotId || ''))}"]`)
      ?.setAttribute('data-t35-review-locator-state', stateValue);
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
    t35ReviewLocatorTimer = window.setTimeout(() => {
      target.removeAttribute('data-t35-review-locator-target');
      t35ReviewLocatorTimer = 0;
    }, 2400);
    announceStatus(descriptor.announcement);
    return true;
  }

  function t35SetReviewView(nextView) {
    if (!t35CurrentReviewDomContract().showReviewViewControl) return false;
    const normalized = nextView === 'self-correction' ? 'self-correction' : 'answer-analysis';
    if (normalized === t35ReviewView) {
      t35SyncReviewUtilityPlacement();
      return true;
    }
    notifyAnnotationMutation('review-view-change', true);
    closeSelectionMenu();
    const passageAnchor = captureReviewTranslationScrollAnchor();
    const questionsScrollTop = els.questionsPane?.scrollTop || 0;
    const enteringAnswerAnalysis = t35ReviewView === 'self-correction' && normalized === 'answer-analysis';
    if (enteringAnswerAnalysis) t36EvidenceDisplayMode = t36CustomHighlightAvailable() ? 'always' : 'click';
    reviewTranslationVisible = normalized === 'answer-analysis';
    t35ReviewView = normalized;
    t35ClearReviewLocator();
    if (els.reviewDetail) {
      els.reviewDetail.hidden = true;
      els.reviewDetail.innerHTML = '';
    }
    renderPassage();
    renderQuestions();
    applyPreferences();
    renderFooter();
    t35SyncReviewUtilityPlacement();
    window.requestAnimationFrame(() => {
      restoreReviewTranslationScrollAnchor(passageAnchor);
      if (els.questionsPane) els.questionsPane.scrollTop = questionsScrollTop;
      els.t35ReviewViewControl?.querySelector(`input[name="t35-review-view"][value="${normalized}"]`)
        ?.focus({ preventScroll: true });
    });
    announceStatus(normalized === 'self-correction'
      ? '已切换到自主订正。仅显示原题、你的原答案和答题状态。'
      : '已切换到答案解析。完整答案、解析、证据定位和全文中英对照已恢复。');
    return true;
  }

  function t35HandleReviewViewChange(event) {
    const nextView = event?.target?.value;
    if (!event?.target?.matches('input[type="radio"][name="t35-review-view"]') ||
        (nextView !== 'self-correction' && nextView !== 'answer-analysis')) {
      t35SyncReviewUtilityPlacement();
      return false;
    }
    return t35SetReviewView(nextView);
  }

  window.__T36_EVIDENCE_NAVIGATION_DEMO__ = Object.freeze({
    schemaVersion: 'zyz-reading-t36-evidence-bidirectional-jump-button-refinement-demo.v1',
    scope: T36_DEMO_SCOPE,
    samplePassageIds: Object.freeze(T36_EVIDENCE_ANCHOR_SIDECAR.samplePassages.map((entry) => entry.passageId)),
    sampleScoreSlotIds: Object.freeze(T36_EVIDENCE_ANCHOR_SIDECAR.entries.map((entry) => entry.scoreSlotId)),
    defaultView: 'answer-analysis',
    evidenceDisplayModes: Object.freeze(['click', 'always']),
    defaultEvidenceDisplayMode: 'always',
    evidenceDisplayControl: 'single-button-aria-pressed',
    visibleEvidenceControlText: '原文定位',
    canonicalToAttemptDisplayMapping: 'inverse-of-scoreSlotForQuestion',
    passageMarkerElement: 'native-button-per-scoreSlot-displayNumber-evidenceIndex',
    reverseNavigationTarget: 'right-answer-analysis-only',
    answerAnalysisTransitionDefaultEvidenceMode: 'always',
    evidenceDisplayPreferencePersistence: 'current-review-session-memory-only',
    persistent: false,
    reviewViewControl: 'two-segment-native-radio-group',
    answerAnalysisAlwaysIncludesBilingualTranslation: true,
    demoStorageNamespace: 'zyz-reading-t36-evidence-toggle-display-number-fix-demo-only-20260903-r3',
    anchorSchemaVersion: T36_EVIDENCE_ANCHOR_SIDECAR.schemaVersion,
    anchorValidation: 'blockId-plus-sourceTextSha256-plus-offsets-plus-source-slice',
    invalidAnchorFallback: 'bound-blockId-paragraph-cue-with-diagnostic',
    locatorUsesRuntimeTextSearch: false,
    locatorUsesFuzzySearch: false,
    locatorUsesAiInference: false,
    annotationPersistenceWritesAdded: 0,
    getState: () => Object.freeze({ view: t35ReviewView, evidenceDisplayMode: t36EvidenceDisplayMode, submitted: Boolean(state.submitted), passageId: partModel(state.part)?.passageId || null }),
    attemptDisplayNumbersForScoreSlot: (scoreSlotId) => Object.freeze([...t36AttemptDisplayNumbersForScoreSlot(scoreSlotId)]),
    getDiagnostics: () => Object.freeze(t36RuntimeDiagnostics.map((entry) => Object.freeze({ ...entry }))),
  });

  function timerPolicy() {
    const raw = runtimeIndex?.manifest?.extensions?.homeworkSnapshot?.timerPolicy;
    if (!raw || raw.enabled !== true) {
      return Object.freeze({ enabled: false, durationSeconds: 0, expiryAction: 'continue' });
    }
    const durationSeconds = Number(raw.durationSeconds);
    const validDuration = Number.isInteger(durationSeconds) && durationSeconds >= 60 && durationSeconds <= 10800;
    return Object.freeze({
      enabled: validDuration,
      durationSeconds: validDuration ? durationSeconds : 0,
      expiryAction: raw.expiryAction === 'submit' ? 'submit' : 'continue',
    });
  }

  function attemptLedgerStorageKey() {
    const hash = assignmentSnapshotHash();
    return /^[0-9a-f]{64}$/iu.test(hash)
      ? `${STATE_STORAGE_PREFIX}.attempt-ledger.v1.${hash.toLowerCase()}`
      : null;
  }

  function clearAttemptIdentity(target) {
    target.attemptNumber = null;
    target.attemptMarker = null;
    target.submissionId = null;
  }

  function readAttemptLedger() {
    const key = attemptLedgerStorageKey();
    if (!key) return { ok: false, key: null, raw: null, ledger: null };
    try {
      const raw = localStorage.getItem(key);
      const sanitized = attemptLedgerRuntime().sanitizeLedger(raw, assignmentSnapshotHash());
      return { ok: sanitized.valid, key, raw, ledger: sanitized.ledger };
    } catch (error) {
      console.warn('Could not read the local submission ledger.', error);
      return { ok: false, key, raw: null, ledger: null };
    }
  }

  function reconcileAttemptIdentity(target, savedVersion) {
    if (!target.submitted || savedVersion < 9) {
      clearAttemptIdentity(target);
      return;
    }
    const submissionId = typeof target.submissionId === 'string' ? target.submissionId : '';
    const attemptNumber = Number(target.attemptNumber);
    const ledgerRead = readAttemptLedger();
    const seenIndex = ledgerRead.ok && submissionId
      ? ledgerRead.ledger.seenSubmissionIds.indexOf(submissionId)
      : -1;
    const expectedNumber = seenIndex + 1;
    const expectedMarker = attemptLedgerRuntime().formatAttemptMarker(
      ledgerRead.ledger?.assignmentCode,
      expectedNumber,
    );
    if (seenIndex < 0 || !Number.isInteger(attemptNumber) || attemptNumber !== expectedNumber ||
        target.attemptMarker !== expectedMarker) {
      clearAttemptIdentity(target);
    }
  }

  function newSubmissionId(submittedAt) {
    let random = '';
    try {
      random = typeof window.crypto?.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    } catch (_error) {
      random = Math.random().toString(36).slice(2);
    }
    return `submission.${String(submittedAt)}.${random}`;
  }

  function recordCurrentSubmission(result, submittedAt) {
    clearAttemptIdentity(state);
    const ledgerRead = readAttemptLedger();
    if (!ledgerRead.ok || !ledgerRead.key) return false;
    const submissionId = newSubmissionId(submittedAt);
    const recorded = attemptLedgerRuntime().recordSubmission(
      ledgerRead.raw,
      assignmentSnapshotHash(),
      {
        submissionId,
        submittedAt,
        elapsedSeconds: state.elapsedSeconds,
        earnedMarks: Number(result?.earnedMarks),
        availableMarks: Number(result?.availableMarks),
        answered: Number(result?.answered),
        total: Number(result?.total),
        migrated: false,
      },
    );
    if (!recorded.recorded || !recorded.record) return false;
    try {
      localStorage.setItem(ledgerRead.key, JSON.stringify(recorded.ledger));
    } catch (error) {
      console.warn('Could not save the local submission ledger.', error);
      return false;
    }
    state.submissionId = recorded.record.submissionId;
    state.attemptNumber = recorded.record.attemptNumber;
    state.attemptMarker = recorded.record.attemptMarker;
    return true;
  }

  function nl(value) {
    return h(value || '').replace(/\n/g, '<br>');
  }

  function normalizeAnswer(value) {
    return String(value == null ? '' : value)
      .normalize('NFKC')
      .trim()
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u2010-\u2015-]/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function registerBuiltInQuestionTypes() {
    const registry = window.IELTSQuestionTypeRegistry;
    if (!registry) throw new Error('The question type registry was not loaded.');
    [
      { questionType: 'true_false_not_given', interactionVariant: 'single_choice', layoutVariant: 'statement_list', rendererId: 'tfng', responseMode: 'single-option', optionDisplay: 'text-only' },
      { questionType: 'yes_no_not_given', interactionVariant: 'single_choice', layoutVariant: 'statement_list', rendererId: 'tfng', responseMode: 'single-option', optionDisplay: 'text-only' },
      { questionType: 'multiple_choice', interactionVariant: 'single_choice', layoutVariant: 'option_list', rendererId: 'single-choice', responseMode: 'single-option', optionDisplay: 'text-only' },
      { questionType: 'note_completion', interactionVariant: 'text_entry', layoutVariant: 'notes', rendererId: 'completion', responseMode: 'text' },
      { questionType: 'summary_completion', interactionVariant: 'text_entry', layoutVariant: 'prose', rendererId: 'completion', responseMode: 'text' },
      { questionType: 'sentence_completion', interactionVariant: 'text_entry', layoutVariant: 'sentence_list', rendererId: 'sentence-completion', responseMode: 'text' },
      { questionType: 'short_answer', interactionVariant: 'text_entry', layoutVariant: 'short_question_list', rendererId: 'short-answer', responseMode: 'text' },
      { questionType: 'table_completion', interactionVariant: 'text_entry', layoutVariant: 'table', rendererId: 'table-completion', responseMode: 'text' },
      { questionType: 'flowchart_completion', interactionVariant: 'text_entry', layoutVariant: 'flow_chart', rendererId: 'flow-chart-completion', responseMode: 'text' },
      { questionType: 'diagram_labelling', interactionVariant: 'text_entry', layoutVariant: 'diagram', rendererId: 'diagram-labelling', responseMode: 'text' },
      { questionType: 'summary_completion', interactionVariant: 'option_mapping', layoutVariant: 'prose', rendererId: 'summary-option-bank', responseMode: 'mapping', matchingMode: 'drag', optionDisplay: 'text-only' },
      { questionType: 'matching_headings', interactionVariant: 'option_mapping', layoutVariant: 'passage_attached_targets', rendererId: 'matching-headings', responseMode: 'mapping', matchingMode: 'drag', passageTargets: true },
      { questionType: 'multiple_choice', interactionVariant: 'choice_set', layoutVariant: 'option_list', rendererId: 'choice-set', responseMode: 'choice-set', footerUnit: 'task' },
      { questionType: 'matching_information', interactionVariant: 'option_mapping', layoutVariant: 'matching_grid', rendererId: 'matching-grid', responseMode: 'mapping', matchingMode: 'grid' },
      { questionType: 'matching_features', interactionVariant: 'option_mapping', layoutVariant: 'matching_grid', rendererId: 'matching-grid', responseMode: 'mapping', matchingMode: 'grid' },
      { questionType: 'classification', interactionVariant: 'option_mapping', layoutVariant: 'matching_grid', rendererId: 'matching-grid', responseMode: 'mapping', matchingMode: 'grid' },
      { questionType: 'matching_sentence_endings', interactionVariant: 'option_mapping', layoutVariant: 'sentence_ending_gaps', rendererId: 'matching-endings', responseMode: 'mapping', matchingMode: 'drag', optionDisplay: 'text-only' },
    ].forEach((definition) => {
      if (!registry.resolve(definition)) registry.register(definition);
    });
  }

  function typeDefinition(groupOrTask) {
    const task = groupOrTask && (groupOrTask.v2Task || groupOrTask);
    return window.IELTSQuestionTypeRegistry?.resolve(task) || null;
  }

  function matchingOptions(group) {
    return (group && (group.options || group.choices || group.headings)) || [];
  }

  function matchingOption(group, optionId) {
    const normalizedId = normalizeAnswer(optionId);
    return matchingOptions(group).find((option) => normalizeAnswer(option.id) === normalizedId) || null;
  }

  function matchingOptionText(group, optionId) {
    const option = matchingOption(group, optionId);
    return option ? String(option.text || option.id) : '';
  }

  function isGridMatchingGroup(group) {
    return typeDefinition(group)?.matchingMode === 'grid';
  }

  function isDragMatchingGroup(group) {
    return typeDefinition(group)?.matchingMode === 'drag';
  }

  function allowsOptionReuse(group) {
    return String(group && group.reuse || '').toLowerCase() === 'allowed';
  }

  function headingText(group, headingId) {
    const heading = group && (group.headings || []).find((candidate) => candidate.id === headingId);
    return heading ? heading.text : '';
  }

  function headingTextForGroup(groupId, headingId) {
    return matchingOptionText(model.groups.get(groupId), headingId);
  }

  function normalizeV2Package(raw) {
    const core = window.IELTSV2Core;
    const adapter = window.IELTSV2CandidateAdapter;
    if (!core) throw new Error("The IELTS Reading v2 runtime core was not loaded.");
    if (!adapter) throw new Error("The IELTS Reading v2 candidate adapter was not loaded.");
    runtimeIndex = core.indexPackage(raw);
    assertSupportedRuntimeDistributionPolicy();
    return adapter.adapt(runtimeIndex.candidate, window.IELTSQuestionTypeRegistry);
  }

  function assertSupportedRuntimeDistributionPolicy() {
    const policy = distributionPolicy();
    if (policy.integrity?.mode !== 'artifact-receipt' || policy.integrity?.algorithm !== 'none') {
      throw new Error('This runtime has no WebCrypto signature verifier; signed-metadata distribution fails closed.');
    }
    if (policy.mode === 'homework-assessed' || policy.answerDelivery !== 'embedded-after-submit') {
      throw new Error('This runtime supports only embedded-after-submit review; assessed and external answer delivery fail closed.');
    }
  }

  function bytesFromBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function hex(bytes) {
    return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  async function verifyPublisherAuthorization() {
    verifiedPublisherAuthorization = null;
    const policy = distributionPolicy();
    const extensions = runtimeIndex?.manifest?.extensions || {};
    const authorization = extensions.publisherAuthorization;
    if (authorization === undefined) {
      if (policy.branding?.publisherDisplayName === EXPECTED_PUBLISHER_NAME ||
          policy.watermark?.textTemplate === EXPECTED_COPYRIGHT_NOTICE) {
        throw new Error('固定版权缺少可验证的品牌授权；练习已停止加载。');
      }
      return;
    }
    if (!crypto?.subtle || PUBLISHER_TRUSTED_SPKI_BASE64 === 'UNSIGNED-INTERNAL-BUILD') {
      throw new Error('当前浏览器无法验证固定版权授权，请使用新版 Chrome。');
    }
    if (hasOwn(extensions, 'sourceAuthorization')) {
      throw new Error('学生练习包含不应公开的授权来源字段；练习已停止加载。');
    }
    if (!hasExactKeys(authorization, ['payload', 'signature']) ||
        !hasExactKeys(authorization.payload, ['schemaVersion', 'publisherId', 'publicNotice', 'product']) ||
        !hasExactKeys(authorization.signature, [
          'schemaVersion', 'algorithm', 'canonicalization', 'payloadSha256',
          'publicKeyFingerprintSha256', 'signatureBase64',
        ])) {
      throw new Error('固定版权授权结构无效；练习已停止加载。');
    }
    const { payload, signature } = authorization;
    if (payload.schemaVersion !== PUBLISHER_AUTHORIZATION_SCHEMA ||
        payload.publisherId !== EXPECTED_PUBLISHER_ID ||
        payload.publicNotice !== EXPECTED_COPYRIGHT_NOTICE ||
        payload.product !== EXPECTED_PUBLISHER_PRODUCT ||
        signature.schemaVersion !== PUBLISHER_SIGNATURE_SCHEMA ||
        signature.algorithm !== PUBLISHER_SIGNATURE_ALGORITHM ||
        signature.canonicalization !== PUBLISHER_CANONICALIZATION ||
        !/^[0-9a-f]{64}$/u.test(signature.payloadSha256 || '') ||
        !/^[0-9a-f]{64}$/u.test(signature.publicKeyFingerprintSha256 || '') ||
        typeof signature.signatureBase64 !== 'string') {
      throw new Error('固定版权授权内容无效；练习已停止加载。');
    }
    if (policy.branding?.publisherDisplayName !== EXPECTED_PUBLISHER_NAME ||
        (policy.branding.attributionText !== null &&
          (typeof policy.branding.attributionText !== 'string' || !policy.branding.attributionText.trim() ||
            /\r|\n/u.test(policy.branding.attributionText) || policy.branding.attributionText.length > 160)) ||
        policy.watermark?.enabled !== true || policy.watermark.visibility !== 'after-submit' ||
        policy.watermark.textTemplate !== EXPECTED_COPYRIGHT_NOTICE ||
        canonicalValue(policy.watermark.surfaces) !== canonicalValue(['review', 'print']) ||
        policy.watermark.personalization !== 'none') {
      throw new Error('固定版权与授权策略不一致；练习已停止加载。');
    }
    const spkiBytes = bytesFromBase64(PUBLISHER_TRUSTED_SPKI_BASE64);
    const fingerprint = hex(await crypto.subtle.digest('SHA-256', spkiBytes));
    if (fingerprint !== signature.publicKeyFingerprintSha256) {
      throw new Error('固定版权签发密钥不受信任；练习已停止加载。');
    }
    const canonicalPayload = canonicalValue(payload);
    const payloadBytes = new TextEncoder().encode(canonicalPayload);
    const payloadSha256 = hex(await crypto.subtle.digest('SHA-256', payloadBytes));
    if (payloadSha256 !== signature.payloadSha256) {
      throw new Error('固定版权授权摘要不一致；练习已停止加载。');
    }
    if (!window.ZYZEd25519Compat) throw new Error('固定版权离线兼容验证器未加载；练习已停止加载。');
    const signatureVerification = await window.ZYZEd25519Compat.verifyDetached({
      spkiBytes,
      signatureBytes: bytesFromBase64(signature.signatureBase64),
      messageBytes: payloadBytes,
    });
    if (!signatureVerification.valid) throw new Error('固定版权授权签名无效；练习已停止加载。');
    verifiedPublisherAuthorization = authorization;
  }

  function distributionPolicy() {
    const manifestPolicy = runtimeIndex?.manifest?.distributionPolicy;
    const snapshotPolicy = runtimeIndex?.manifest?.extensions?.homeworkSnapshot?.distributionPolicy;
    if (manifestPolicy === undefined && snapshotPolicy === undefined) return DEFAULT_DISTRIBUTION_POLICY;
    if (manifestPolicy !== undefined && snapshotPolicy !== undefined &&
        canonicalValue(manifestPolicy) !== canonicalValue(snapshotPolicy)) {
      throw new Error('Distribution policy differs between manifest and homework snapshot; runtime fails closed.');
    }
    const raw = manifestPolicy ?? snapshotPolicy;
    const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
    const requiredRecords = ['branding', 'watermark', 'integrity', 'hardening'];
    const allowedTokens = new Set(['publisher', 'attribution', 'assignment', 'fingerprint', 'studentAlias']);
    if (!record(raw) || raw.schemaVersion !== DEFAULT_DISTRIBUTION_POLICY.schemaVersion ||
        !hasExactKeys(raw, ['schemaVersion', 'mode', 'branding', 'watermark', 'integrity', 'hardening', 'answerDelivery']) ||
        !hasExactKeys(raw.branding, ['publisherDisplayName', 'attributionText']) ||
        !hasExactKeys(raw.watermark, ['enabled', 'visibility', 'textTemplate', 'surfaces', 'personalization']) ||
        !hasExactKeys(raw.integrity, ['mode', 'algorithm', 'keyId', 'publicKeySpkiBase64', 'signatureBase64', 'signedPayloadSha256'], ['mode', 'algorithm']) ||
        !hasExactKeys(raw.hardening, ['profile', 'minify', 'sourceMaps', 'obfuscation', 'stripPrivateMetadata', 'externalNetwork']) ||
        hasForbiddenDistributionKey(raw) ||
        !['internal', 'homework-self-study', 'homework-assessed'].includes(raw.mode) ||
        !requiredRecords.every((key) => record(raw[key])) ||
        !['embedded-after-submit', 'not-embedded', 'server-release'].includes(raw.answerDelivery) ||
        typeof raw.watermark.enabled !== 'boolean' ||
        !['disabled', 'after-submit'].includes(raw.watermark.visibility) ||
        (raw.watermark.textTemplate !== null && typeof raw.watermark.textTemplate !== 'string') ||
        /\r|\n/.test(raw.watermark.textTemplate || '') ||
        !Array.isArray(raw.watermark.surfaces) ||
        raw.watermark.surfaces.length !== new Set(raw.watermark.surfaces).size ||
        raw.watermark.surfaces.some((surface) => !DISTRIBUTION_POLICY_SURFACES.includes(surface)) ||
        [...String(raw.watermark.textTemplate || '').matchAll(/\{([^{}]+)\}/g)].some((match) => !allowedTokens.has(match[1])) ||
        !['none', 'assignment', 'student-alias'].includes(raw.watermark.personalization) ||
        !['artifact-receipt', 'signed-metadata'].includes(raw.integrity.mode) ||
        !['none', 'ECDSA-P256-SHA256'].includes(raw.integrity.algorithm) ||
        !['development', 'standard', 'hardened'].includes(raw.hardening.profile) ||
        raw.hardening.externalNetwork !== 'deny') {
      throw new Error('Distribution policy is present but invalid; runtime fails closed.');
    }
    if (raw.watermark.enabled === false && (raw.watermark.visibility !== 'disabled' ||
        raw.watermark.textTemplate !== null || raw.watermark.surfaces.length || raw.watermark.personalization !== 'none')) {
      throw new Error('Disabled watermark policy is inconsistent; runtime fails closed.');
    }
    if (raw.watermark.enabled === true && (raw.watermark.visibility !== 'after-submit' ||
        !String(raw.watermark.textTemplate || '').trim() || !raw.watermark.surfaces.length)) {
      throw new Error('Enabled watermark policy is incomplete; runtime fails closed.');
    }
    return raw;
  }

  function canonicalValue(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function hasForbiddenDistributionKey(value) {
    if (Array.isArray(value)) return value.some(hasForbiddenDistributionKey);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, child]) => {
      const normalized = key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
      return new Set([
        'privatekey', 'privatesigningkey', 'signingkey', 'secret', 'secretkey', 'clientsecret',
        'apikey', 'accesstoken', 'seed', 'passphrase', 'password', 'studentname', 'studentfullname',
        'studentemail', 'studentphone', 'studentmobile', 'studentid', 'studentidentifier',
        'studentnumber', 'studentaddress', 'studentdateofbirth',
      ]).has(normalized) || hasForbiddenDistributionKey(child);
    });
  }

  function hasExactKeys(value, allowed, required = allowed) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).every((key) => allowed.includes(key)) &&
      required.every((key) => hasOwn(value, key));
  }

  function resolvedWatermarkText(policy) {
    const template = policy.watermark.textTemplate;
    if (typeof template !== 'string' || !template || /\r|\n/.test(template)) return '';
    const snapshot = runtimeIndex?.manifest?.extensions?.homeworkSnapshot || {};
    const externalContext = window.__IELTS_DISTRIBUTION_CONTEXT__ || {};
    const studentAlias = typeof externalContext.studentAlias === 'string' &&
      externalContext.studentAlias.trim() && !/\r|\n/.test(externalContext.studentAlias)
      ? externalContext.studentAlias.trim().slice(0, 80) : '';
    if (policy.watermark.personalization === 'student-alias' && !studentAlias) return '';
    const replacements = {
      publisher: policy.branding?.publisherDisplayName || '',
      attribution: policy.branding?.attributionText || '',
      assignment: snapshot.snapshotId || '',
      fingerprint: String(snapshot.snapshotHash || '').slice(0, 12),
      studentAlias,
    };
    let unknownToken = false;
    const result = template.replace(/\{([^{}]+)\}/g, (match, token) => {
      if (!hasOwn(replacements, token)) {
        unknownToken = true;
        return '';
      }
      return replacements[token];
    });
    return unknownToken ? '' : result;
  }

  function distributionWatermarkText(surface) {
    if (!state.submitted || !DISTRIBUTION_POLICY_SURFACES.includes(surface)) return '';
    const policy = distributionPolicy();
    if (policy.watermark.enabled !== true || policy.watermark.visibility !== 'after-submit' ||
        !policy.watermark.surfaces.includes(surface)) return '';
    // Keep the signed legal notice in the authorization payload, while the
    // learner-facing fixed line uses the concise verified publisher name.
    if (verifiedPublisherAuthorization && policy.branding?.publisherDisplayName === EXPECTED_PUBLISHER_NAME) {
      return EXPECTED_PUBLISHER_NAME;
    }
    return resolvedWatermarkText(policy);
  }

  function distributionClassWatermarkText(surface) {
    if (!verifiedPublisherAuthorization || !state.submitted || !DISTRIBUTION_POLICY_SURFACES.includes(surface)) return '';
    const policy = distributionPolicy();
    if (policy.watermark.enabled !== true || policy.watermark.visibility !== 'after-submit' ||
        !policy.watermark.surfaces.includes(surface)) return '';
    const value = policy.branding?.attributionText;
    if (typeof value !== 'string' || !value.trim() || /\r|\n/u.test(value)) return '';
    const text = value.trim().slice(0, 160);
    // A teacher may have entered the publisher line as the optional class note
    // while testing. Once the verified fixed line uses that same concise name,
    // suppress the redundant second line instead of displaying a duplicate.
    return text === EXPECTED_PUBLISHER_NAME || text === EXPECTED_COPYRIGHT_NOTICE ? '' : text;
  }

  function indexModel() {
    model.questions.clear();
    model.groups.clear();
    model.partQuestionNumbers.clear();
    model.responseNumberById.clear();
    model.parts.forEach((part) => {
      const numbers = [];
      part.groups.forEach((group) => {
        group.questionNumbers = group.items.map((item) => item.number);
        model.groups.set(group.id, group);
        group.items.forEach((item) => {
          if (model.questions.has(item.number)) throw new Error(`Duplicate question number ${item.number} in the v2 package data.`);
          numbers.push(item.number);
          model.responseNumberById.set(item.responseSlotId, item.number);
          model.questions.set(item.number, {
            ...item,
            part: part.number,
            groupId: group.id,
            taskId: group.taskId,
          });
        });
      });
      model.partQuestionNumbers.set(Number(part.number), [...new Set(numbers)].sort((a, b) => a - b));
    });
    model.questionNumbers = [...model.questions.keys()].sort((a, b) => a - b);
  }

  async function loadData() {
    let packageData = window.__IELTS_V2_PACKAGE__ || null;
    if (!packageData) {
      contentCatalog = window.__IELTS_CONTENT_CATALOG__ || null;
      if (!contentCatalog) {
        const catalogResponse = await fetch(new URL(CONTENT_CATALOG_URL, document.baseURI));
        if (!catalogResponse.ok) throw new Error(`${CONTENT_CATALOG_URL}: HTTP ${catalogResponse.status}`);
        contentCatalog = await catalogResponse.json();
      }
      const requestedSetId = new URL(document.URL).searchParams.get('set');
      activeContentSet = (contentCatalog.sets || []).find((set) => set.setId === requestedSetId)
        || (contentCatalog.sets || []).find((set) => set.setId === contentCatalog.defaultSetId)
        || (contentCatalog.sets || [])[0];
      if (!activeContentSet) throw new Error('The content catalog does not contain a set.');
      if (activeContentSet.loader?.type !== 'v2-package') {
        throw new Error(`The primary unified runtime only accepts v2-package loaders; found ${activeContentSet.loader?.type || '(missing)'}.`);
      }
      const packageResponse = await fetch(new URL(activeContentSet.loader.url, document.baseURI));
      if (!packageResponse.ok) throw new Error(`${activeContentSet.loader.url}: HTTP ${packageResponse.status}`);
      packageData = await packageResponse.json();
    }
    model.parts = normalizeV2Package(packageData);
    await verifyPublisherAuthorization();
    indexModel();
  }

  function loadState() {
    const fresh = defaultState();
    try {
      const saved = JSON.parse(localStorage.getItem(stateStorageKey()) || 'null');
      if (!saved || typeof saved !== 'object') return fresh;
      const savedVersion = Number(saved.version) || 0;
      const merged = {
        ...fresh,
        ...saved,
        lastQuestionByPart: { ...fresh.lastQuestionByPart, ...(saved.lastQuestionByPart || {}) },
        answers: saved.answers && typeof saved.answers === 'object' ? saved.answers : {},
        questionFlags: normalizedQuestionFlags(saved.questionFlags),
        highlights: { ...fresh.highlights, ...(saved.highlights || {}) },
        questionHighlights: { ...fresh.questionHighlights, ...(saved.questionHighlights || {}) },
        notes: Array.isArray(saved.notes) ? saved.notes : [],
      };
      // v0.1 exposed per-diagram zoom buttons.  The student surface no longer
      // has that exam-inaccurate control, so discard any saved legacy zoom map
      // instead of carrying an inert private field into future saves.
      delete merged.diagramZooms;
      if (merged.submitted && Object.prototype.hasOwnProperty.call(saved, 'reviewQuestionFlags')) {
        merged.reviewQuestionFlags = normalizedQuestionFlags(saved.reviewQuestionFlags);
      } else delete merged.reviewQuestionFlags;
      merged.version = STATE_VERSION;
      const availableParts = model.parts.map((part) => Number(part.number));
      if (!availableParts.includes(Number(merged.part))) merged.part = availableParts[0] || 1;
      merged.part = Number(merged.part);
      const partQuestions = model.partQuestionNumbers.get(merged.part) || [];
      Object.keys(merged.lastQuestionByPart).forEach((key) => {
        const partNumber = Number(key);
        const numbers = model.partQuestionNumbers.get(partNumber) || [];
        if (!numbers.includes(Number(merged.lastQuestionByPart[key]))) merged.lastQuestionByPart[key] = numbers[0] || model.questionNumbers[0] || 1;
      });
      if (!model.questions.has(Number(merged.currentQuestion)) || partForQuestion(Number(merged.currentQuestion)) !== merged.part) {
        merged.currentQuestion = partQuestions[0] || model.questionNumbers[0] || 1;
      }
      merged.currentQuestion = Number(merged.currentQuestion);
      merged.split = Math.max(30, Math.min(70, Number(merged.split) || 50));
      merged.fontScale = [1, 1.1875, 1.375].includes(Number(merged.fontScale)) ? Number(merged.fontScale) : 1;
      if (!['black-white', 'white-black', 'yellow-black'].includes(merged.contrastMode)) {
        merged.contrastMode = merged.contrast ? 'white-black' : 'black-white';
      }
      const report = homeworkReportRuntime();
      const now = Date.now();
      if (savedVersion < 8) {
        // Version 7 and earlier never recorded a trustworthy start time.  A
        // continuing practice starts timing at migration; an already submitted
        // practice must say "未记录" instead of inventing a duration.
        merged.attemptStartedAt = merged.submitted ? null : now;
        merged.submittedAt = null;
        merged.elapsedSeconds = null;
      } else {
        merged.attemptStartedAt = report.sanitizeTimestamp(saved.attemptStartedAt);
        merged.submittedAt = report.sanitizeTimestamp(saved.submittedAt);
        if (!merged.submitted) {
          merged.attemptStartedAt = merged.attemptStartedAt ?? now;
          merged.submittedAt = null;
          merged.elapsedSeconds = null;
        } else {
          merged.elapsedSeconds = report.elapsedSeconds({
            startedAt: merged.attemptStartedAt,
            submittedAt: merged.submittedAt,
            elapsedSeconds: saved.elapsedSeconds,
          });
          if (merged.submittedAt !== null && merged.attemptStartedAt !== null &&
              merged.submittedAt < merged.attemptStartedAt) {
            merged.submittedAt = null;
            merged.elapsedSeconds = null;
          }
        }
      }
      if (savedVersion < 9) {
        // Version 8 knew the total first-open-to-submit duration, but it did
        // not record which Passage was visible.  Start collecting from this
        // migration point for continuing work, while keeping the eventual
        // per-Passage report explicitly unavailable rather than inventing old
        // timings.
        merged.partElapsedMilliseconds = {};
        merged.partActiveStartedAt = merged.submitted || document.visibilityState === 'hidden' ? null : now;
        merged.partTimingComplete = false;
      } else {
        merged.partElapsedMilliseconds = {
          ...report.sanitizePartElapsedMilliseconds(saved.partElapsedMilliseconds, availableParts),
        };
        merged.partTimingComplete = saved.partTimingComplete === true;
        merged.partActiveStartedAt = report.sanitizeTimestamp(saved.partActiveStartedAt);
        if (merged.submitted || document.visibilityState === 'hidden') merged.partActiveStartedAt = null;
        else merged.partActiveStartedAt = merged.partActiveStartedAt ?? now;
      }
      const configuredTimer = timerPolicy();
      if (configuredTimer.enabled) {
        merged.timerStartedAt = report.sanitizeTimestamp(saved.timerStartedAt);
        merged.timerDeadlineAt = merged.timerStartedAt === null
          ? null
          : merged.timerStartedAt + (configuredTimer.durationSeconds * 1000);
        merged.timerLastObservedAt = report.sanitizeTimestamp(saved.timerLastObservedAt);
        merged.clockAnomaly = saved.clockAnomaly === true ||
          (merged.timerLastObservedAt !== null && now + 5000 < merged.timerLastObservedAt);
        merged.timerExpired = merged.timerDeadlineAt !== null && now >= merged.timerDeadlineAt;
        merged.timerExpiredAt = merged.timerExpired
          ? (report.sanitizeTimestamp(saved.timerExpiredAt) ?? merged.timerDeadlineAt)
          : null;
        merged.remainingSeconds = merged.timerDeadlineAt === null
          ? configuredTimer.durationSeconds
          : Math.max(0, Math.ceil((merged.timerDeadlineAt - now) / 1000));
        merged.overtimeSeconds = merged.timerDeadlineAt === null
          ? 0
          : Math.max(0, Math.floor((now - merged.timerDeadlineAt) / 1000));
        merged.timerRunning = !merged.submitted && merged.timerStartedAt !== null;
        merged.timerWarning10Shown = saved.timerWarning10Shown === true;
        merged.timerWarning5Shown = saved.timerWarning5Shown === true;
        merged.timerAnnouncementMarks = Array.isArray(saved.timerAnnouncementMarks)
          ? saved.timerAnnouncementMarks.filter((value) => [600, 300, 60, 30, 10, 0].includes(Number(value))).map(Number)
          : [];
        merged.submissionReason = ['manual', 'timeout', 'manual-after-timeout'].includes(saved.submissionReason)
          ? saved.submissionReason
          : null;
        if (!merged.submitted && merged.timerStartedAt === null) {
          merged.attemptStartedAt = null;
          merged.partActiveStartedAt = null;
          merged.partElapsedMilliseconds = {};
          merged.partTimingComplete = true;
          merged.elapsedSeconds = null;
        } else if (!merged.submitted) {
          merged.attemptStartedAt = merged.timerStartedAt;
          if (document.visibilityState !== 'hidden') merged.partActiveStartedAt = merged.partActiveStartedAt ?? now;
        }
      } else {
        merged.remainingSeconds = TEST_SECONDS;
        merged.timerRunning = false;
        merged.timerStartedAt = null;
        merged.timerDeadlineAt = null;
        merged.timerExpiredAt = null;
        merged.timerExpired = false;
        merged.overtimeSeconds = 0;
        merged.submissionReason = merged.submitted ? (saved.submissionReason || 'manual') : null;
        merged.clockAnomaly = false;
      }
      reconcileAttemptIdentity(merged, savedVersion);
      return merged;
    } catch (error) {
      console.warn('Could not restore saved practice state.', error);
      return fresh;
    }
  }

  function saveState() {
    state.updatedAt = Date.now();
    try {
      localStorage.setItem(stateStorageKey(), JSON.stringify(state));
    } catch (error) {
      console.warn('Could not save practice state.', error);
    }
  }

  function notifyAnnotationMutation(reason, flush) {
    try {
      window.dispatchEvent(new CustomEvent('zyz-student-annotation-mutation.v1', {
        detail: { reason: String(reason || 'annotation'), flush: flush === true },
      }));
    } catch (_error) { /* the ordinary saved state remains available to the runner bridge */ }
  }

  function settleCurrentPartTiming(endedAt) {
    if (state.submitted || state.partActiveStartedAt === null) return;
    const settled = homeworkReportRuntime().settlePartTiming({
      elapsedMillisecondsByPart: state.partElapsedMilliseconds,
      allowedParts: model.parts.map((part) => Number(part.number)),
      part: state.part,
      activePartStartedAt: state.partActiveStartedAt,
      endedAt: endedAt === undefined ? Date.now() : endedAt,
    });
    state.partElapsedMilliseconds = { ...settled.elapsedMillisecondsByPart };
    state.partActiveStartedAt = null;
  }

  function resumeCurrentPartTiming(startedAt) {
    if (state.submitted || document.visibilityState === 'hidden' || state.partActiveStartedAt !== null ||
        (timerPolicy().enabled && state.timerStartedAt === null)) return;
    state.partActiveStartedAt = homeworkReportRuntime().sanitizeTimestamp(startedAt === undefined ? Date.now() : startedAt);
  }

  function setActivePart(partNumber, changedAt) {
    const nextPart = Number(partNumber);
    const now = changedAt === undefined ? Date.now() : changedAt;
    if (nextPart !== Number(state.part)) {
      notifyAnnotationMutation('part-change', true);
      settleCurrentPartTiming(now);
    }
    state.part = nextPart;
    resumeCurrentPartTiming(now);
  }

  function persistCurrentPartTiming() {
    settleCurrentPartTiming(Date.now());
    saveState();
    notifyAnnotationMutation('pagehide', true);
  }

  function handleVisibilityChange() {
    const now = Date.now();
    if (document.visibilityState === 'hidden') settleCurrentPartTiming(now);
    else resumeCurrentPartTiming(now);
    saveState();
  }

  function partForQuestion(number) {
    const question = model.questions.get(Number(number));
    return question ? question.part : (model.parts[0] && model.parts[0].number) || 1;
  }

  function partModel(partNumber) {
    return model.parts.find((part) => part.number === Number(partNumber));
  }

  function questionsForPart(partNumber) {
    return model.partQuestionNumbers.get(Number(partNumber)) || [];
  }

  function totalQuestionCount() {
    return model.questionNumbers.length;
  }

  function firstQuestion() {
    return model.questionNumbers[0] || 1;
  }

  function lastQuestion() {
    return model.questionNumbers[model.questionNumbers.length - 1] || 1;
  }

  // T53: optional, stable-response-slot bookmarks; independent of answers and annotations.
  function normalizedQuestionFlags(value) {
    const flags = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return flags;
    model.responseNumberById.forEach((_number, id) => {
      if (Object.prototype.hasOwnProperty.call(value, id) && value[id] === true) flags[id] = true;
    });
    return flags;
  }

  function questionFlagNumbers(number) {
    const question = model.questions.get(Number(number));
    if (!question) return [];
    const group = model.groups.get(question.groupId);
    return group && typeDefinition(group)?.footerUnit === 'task'
      ? group.questionNumbers.filter((value) => model.questions.has(Number(value)))
      : [Number(number)];
  }

  function effectiveQuestionFlags() {
    return state.submitted && Object.prototype.hasOwnProperty.call(state, 'reviewQuestionFlags')
      ? state.reviewQuestionFlags : state.questionFlags;
  }

  function isQuestionFlagged(number) {
    return questionFlagNumbers(number).some((value) => effectiveQuestionFlags()?.[responseIdForQuestion(value)] === true);
  }

  function questionFlagIcon() {
    return '<svg viewBox="0 0 20 24" aria-hidden="true" focusable="false"><path d="M5 3.25h10a.75.75 0 0 1 .75.75v16L10 16.5 4.25 20V4A.75.75 0 0 1 5 3.25Z" /></svg>';
  }

  function questionFlagLabel(number) {
    const numbers = questionFlagNumbers(number);
    const label = numbers.length > 1 ? `${numbers[0]}–${numbers[numbers.length - 1]}` : String(numbers[0]);
    return `第 ${label} 题：${isQuestionFlagged(number) ? '已标记' : '未标记'}${isQuestionFlagged(number) ? '，点击取消标记' : '，点击标记待检查'}${state.submitted ? '（复盘标记）' : ''}`;
  }

  function createQuestionFlag(number) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'question-flag-button';
    button.dataset.questionFlag = String(number);
    button.dataset.annotationExclude = 'true';
    button.innerHTML = questionFlagIcon();
    return button;
  }

  // One overlay lives outside both canonical annotation surfaces. It is never
  // inserted into a label, table header, sentence, or diagram.
  let activeQuestionFlagButton = null;
  let questionFlagFrame = 0;
  let questionFlagResizeObserver = null;
  let questionFlagEventsBound = false;

  function activeQuestionFlagAnchor(number = state.currentQuestion) {
    const question = model.questions.get(Number(number));
    const group = question && model.groups.get(question.groupId);
    if (!group || !partModel(state.part)?.groups.includes(group)) return null;
    const passage = Boolean(typeDefinition(group)?.passageTargets);
    const container = passage ? els.passageContent : els.questionsContent;
    const pane = passage ? els.passagePane : els.questionsPane;
    if (!container || !pane) return null;
    const scope = passage ? container : container.querySelector(`[data-group-id="${CSS.escape(group.id)}"]`);
    if (!scope) return null;
    let anchor, kind;
    if (typeDefinition(group)?.footerUnit === 'task') {
      const unit = scope.querySelector('.multi-question');
      anchor = unit?.querySelector('.question-prompt') || unit;
      kind = 'choice-set-prompt';
    } else {
      const row = scope.querySelector(`tr[data-question="${number}"]`);
      const input = scope.querySelector(`input[data-answer-question="${number}"]:not([type="radio"]):not([type="checkbox"])`);
      const drop = scope.querySelector(`[data-drop-question="${number}"]`);
      const item = scope.querySelector(`[data-question="${number}"]`);
      if (row) { anchor = row; kind = 'matching-grid-row'; }
      else if (input) { anchor = input; kind = input.closest('.diagram-labelling') ? 'diagram-input-line' : 'completion-input-line'; }
      else if (drop) { anchor = drop; kind = passage ? 'passage-drop-line' : 'question-drop-line'; }
      else { anchor = item?.querySelector('.question-prompt') || item; kind = 'question-prompt'; }
    }
    return anchor ? { anchor, container, pane, kind, surface: passage ? 'passage' : 'questions' } : null;
  }

  function questionFlagNumberFromTarget(target) {
    if (!target?.closest || target.closest('[data-question-flag]')) return null;
    const answer = target.closest('[data-answer-question], [data-grid-question], [data-drop-question], [data-multiple-group]');
    if (!answer && state.submitted) {
      const row = target.closest('[data-question]');
      const number = Number(row?.dataset.question);
      if (model.questions.has(number)) return number;
      const unit = target.closest('.multi-question');
      const group = unit && model.groups.get(unit.closest('[data-group-id]')?.dataset.groupId);
      return group && typeDefinition(group)?.footerUnit === 'task' ? group.questionNumbers[0] : null;
    }
    if (!answer || (!state.submitted && answer.disabled)) return null;
    let number;
    if (answer.dataset.multipleGroup) {
      const group = model.groups.get(answer.dataset.multipleGroup);
      number = group?.questionNumbers.includes(Number(state.currentQuestion)) ? Number(state.currentQuestion) : group?.questionNumbers[0];
    } else number = Number(answer.dataset.answerQuestion || answer.dataset.gridQuestion || answer.dataset.dropQuestion);
    if (!model.questions.has(Number(number))) return null;
    const id = answer.dataset.responseSlotId;
    if (id && responseIdForQuestion(number) !== id) return null;
    return Number(number);
  }

  function activateQuestionFlagFromTarget(event) {
    const number = questionFlagNumberFromTarget(event.target);
    if (number == null) return;
    if (state.currentQuestion !== number) setCurrentQuestion(number, false);
    else scheduleQuestionFlagPosition();
  }

  function ensureActiveQuestionFlag() {
    if (activeQuestionFlagButton?.isConnected) return activeQuestionFlagButton;
    const button = createQuestionFlag(state.currentQuestion);
    button.classList.add('question-flag-active');
    button.hidden = true;
    button.addEventListener('pointerdown', handleQuestionFlagPointer);
    button.addEventListener('click', handleQuestionFlagClick);
    document.body.appendChild(button);
    activeQuestionFlagButton = button;
    return button;
  }

  function mountQuestionFlags() {
    ensureActiveQuestionFlag();
    scheduleQuestionFlagPosition();
  }

  function scheduleQuestionFlagPosition() {
    if (questionFlagFrame) return;
    questionFlagFrame = window.requestAnimationFrame(() => {
      questionFlagFrame = 0;
      positionActiveQuestionFlag();
    });
  }

  function reviewQuestionFlagAnchors(number = state.currentQuestion) {
    if (!state.submitted || !els.questionsContent || !els.questionsPane) return [];
    const question = model.questions.get(Number(number));
    const group = question && model.groups.get(question.groupId);
    if (!group || !partModel(state.part)?.groups.includes(group)) return [];
    const labels = new Set([String(Number(number))]);
    if (typeDefinition(group)?.footerUnit === 'task') labels.add(reviewQuestionRangeLabel(group.questionNumbers));
    const scoreSlot = scoreSlotForQuestion(number);
    const scoreNumbers = (scoreSlot?.responseSlotIds || []).map((id) => model.responseNumberById.get(id)).filter(Number.isFinite);
    if (scoreNumbers.includes(Number(number))) labels.add(reviewQuestionRangeLabel(scoreNumbers));
    return [...els.questionsContent.querySelectorAll('.answer-review[data-review-for]')]
      .filter((card) => labels.has(card.getAttribute('data-review-for')))
      .map((card) => ({ anchor: card.querySelector('.answer-review-heading'), container: els.questionsContent,
        pane: els.questionsPane, kind: 'review-heading', surface: 'questions' }))
      .filter((located) => located.anchor);
  }

  function questionFlagPositionForAnchor(located) {
    if (!located || !located.anchor.isConnected || !located.anchor.getClientRects().length) return null;
    const { anchor, container, pane, kind, surface } = located;
    const rect = anchor.getBoundingClientRect();
    const paneRect = pane.getBoundingClientRect();
    const contentRect = container.getBoundingClientRect();
    const viewport = window.visualViewport;
    const topBoundary = Math.max(paneRect.top, viewport?.offsetTop || 0);
    const bottomBoundary = Math.min(paneRect.bottom, (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight));
    const center = (rect.top + rect.bottom) / 2;
    const top = center - 15;
    const left = contentRect.right - 38;
    // Never pin an offscreen question to the viewport edge. Nested horizontal
    // tables retain their own scrolling; the flag remains outside their right edge.
    if (rect.width <= 0 || rect.height <= 0 || top < topBoundary + 2 || top + 30 > bottomBoundary - 2 || rect.right <= paneRect.left || rect.left >= paneRect.right) return null;
    let clipLeft = Math.max(paneRect.left, viewport?.offsetLeft || 0);
    let clipRight = Math.min(paneRect.right, (viewport?.offsetLeft || 0) + (viewport?.width || window.innerWidth));
    let clipTop = topBoundary, clipBottom = bottomBoundary;
    if (left < clipLeft + 2 || left + 30 > clipRight - 2) return null;
    for (let ancestor = anchor.parentElement; ancestor && ancestor !== pane; ancestor = ancestor.parentElement) {
      const style = window.getComputedStyle(ancestor);
      const clipsX = /(auto|scroll|hidden|clip)/.test(style.overflowX);
      const clipsY = /(auto|scroll|hidden|clip)/.test(style.overflowY);
      if (clipsX || clipsY) {
        const bounds = ancestor.getBoundingClientRect();
        if (clipsX) { clipLeft = Math.max(clipLeft, bounds.left); clipRight = Math.min(clipRight, bounds.right); }
        if (clipsY) { clipTop = Math.max(clipTop, bounds.top); clipBottom = Math.min(clipBottom, bounds.bottom); }
      }
    }
    if (rect.right <= clipLeft || rect.left >= clipRight || center < clipTop || center > clipBottom) return null;
    const blockers = [document.getElementById('pane-nav'), els.selectionMenu, els.optionsMenu];
    if (blockers.some((element) => {
      if (!element || element.hidden || !element.getClientRects().length) return false;
      const bounds = element.getBoundingClientRect();
      return left < bounds.right + 4 && left + 30 > bounds.left - 4 && top < bounds.bottom + 4 && top + 30 > bounds.top - 4;
    })) return null;
    return { left, top, kind, surface };
  }

  function positionActiveQuestionFlag() {
    const button = activeQuestionFlagButton;
    if (!button) return;
    button.hidden = true;
    let positioned = questionFlagPositionForAnchor(activeQuestionFlagAnchor());
    if (!positioned && state.submitted) {
      positioned = reviewQuestionFlagAnchors().map(questionFlagPositionForAnchor).find(Boolean);
    }
    if (!positioned) return;
    const { left, top, kind, surface } = positioned;
    const number = Number(state.currentQuestion);
    const flagged = isQuestionFlagged(number);
    button.dataset.questionFlag = String(number);
    button.dataset.flagAnchorKind = kind;
    button.dataset.flagSurface = surface;
    button.classList.toggle('is-flagged', flagged);
    button.setAttribute('aria-pressed', String(flagged));
    button.setAttribute('aria-label', questionFlagLabel(number));
    button.title = questionFlagLabel(number);
    button.disabled = false;
    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
    button.hidden = false;
  }

  function bindQuestionFlagEvents() {
    if (questionFlagEventsBound) return;
    questionFlagEventsBound = true;
    [els.questionsContent, els.passageContent].filter(Boolean).forEach((container) => {
      container.addEventListener('focusin', activateQuestionFlagFromTarget);
      container.addEventListener('pointerdown', activateQuestionFlagFromTarget, { capture: true });
      container.addEventListener('load', scheduleQuestionFlagPosition, true);
    });
    document.addEventListener('scroll', scheduleQuestionFlagPosition, { capture: true, passive: true });
    window.addEventListener('resize', scheduleQuestionFlagPosition, { passive: true });
    document.addEventListener('fullscreenchange', scheduleQuestionFlagPosition);
    window.visualViewport?.addEventListener('resize', scheduleQuestionFlagPosition, { passive: true });
    window.visualViewport?.addEventListener('scroll', scheduleQuestionFlagPosition, { passive: true });
    if (typeof ResizeObserver === 'function') {
      questionFlagResizeObserver = new ResizeObserver(scheduleQuestionFlagPosition);
      [els.questionsContent, els.passageContent, els.questionsPane, els.passagePane].filter(Boolean)
        .forEach((element) => questionFlagResizeObserver.observe(element));
    }
    document.fonts?.ready.then(scheduleQuestionFlagPosition);
    document.fonts?.addEventListener?.('loadingdone', scheduleQuestionFlagPosition);
  }

  function syncQuestionFlags() {
    scheduleQuestionFlagPosition();
    els.partNav?.querySelectorAll('[data-part-flag-summary]').forEach((icon) => {
      const partNumber = Number(icon.dataset.partFlagSummary);
      const flagged = partNumber !== Number(state.part) && questionsForPart(partNumber).some(isQuestionFlagged);
      icon.hidden = !flagged;
      const tab = icon.parentElement.querySelector('.part-tab');
      if (tab) {
        if (flagged) tab.setAttribute('aria-description', 'Has marked questions');
        else tab.removeAttribute('aria-description');
      }
    });
    els.footerContent?.querySelectorAll('[data-question-flag-nav]').forEach((icon) => {
      const flagged = isQuestionFlagged(Number(icon.dataset.questionFlagNav));
      icon.hidden = !flagged;
      const button = icon.closest('[data-nav-question]');
      if (button) {
        const base = button.getAttribute('aria-label').replace(/, marked for review$/, '');
        button.setAttribute('aria-label', `${base}${flagged ? ', marked for review' : ''}`);
      }
    });
  }

  function toggleQuestionFlag(number) {
    const numbers = questionFlagNumbers(number);
    if (!numbers.length) return false;
    const flagged = isQuestionFlagged(number);
    const flags = { ...(effectiveQuestionFlags() || {}) };
    numbers.forEach((value) => {
      const id = responseIdForQuestion(value);
      if (flagged) delete flags[id];
      else flags[id] = true;
    });
    if (state.submitted) state.reviewQuestionFlags = flags;
    else state.questionFlags = flags;
    saveState();
    syncQuestionFlags();
    if (state.submitted) notifyAnnotationMutation('question-flag', true);
    return true;
  }

  function handleQuestionFlagClick(event) {
    const button = event.target.closest('[data-question-flag]');
    if (!button) return false;
    event.preventDefault();
    event.stopPropagation();
    toggleQuestionFlag(Number(button.dataset.questionFlag));
    return true;
  }

  function handleQuestionFlagPointer(event) {
    if (!event.target.closest('[data-question-flag]')) return;
    // Preserve the current input caret / selection and bypass drag / annotation gestures.
    event.preventDefault();
    event.stopPropagation();
  }

  function responseIdForQuestion(number) {
    return model.questions.get(Number(number))?.responseSlotId || '';
  }

  function answerForQuestion(number) {
    const responseSlotId = responseIdForQuestion(number);
    return responseSlotId ? String(state.answers[responseSlotId] == null ? '' : state.answers[responseSlotId]) : '';
  }

  function setResponseAction(action) {
    state.answers = window.IELTSV2Core.reduceResponses(runtimeIndex, state.answers, action);
  }

  function setAnswerForQuestion(number, value, actionType) {
    const responseSlotId = responseIdForQuestion(number);
    if (!responseSlotId) return false;
    const responseSlot = runtimeIndex.responseSlots.get(responseSlotId);
    const type = actionType || (responseSlot?.responseKind === 'text' ? 'set-text' : 'set-option');
    setResponseAction(type === 'set-text'
      ? { type, responseSlotId, value }
      : { type, responseSlotId, optionId: value });
    return true;
  }

  function clearAnswerForQuestion(number) {
    const responseSlotId = responseIdForQuestion(number);
    if (!responseSlotId) return false;
    setResponseAction({ type: 'clear', responseSlotId });
    return true;
  }

  function requireSubmittedPrivateAccess() {
    if (!state.submitted) throw new Error('Answer-key and review data are unavailable before submission.');
  }

  function runtimeScore() {
    requireSubmittedPrivateAccess();
    return window.IELTSV2Core.scoreAll(runtimeIndex, state.answers);
  }

  function scoreSlotsForTask(taskId) {
    requireSubmittedPrivateAccess();
    return [...runtimeIndex.scoreSlots.values()].filter((scoreSlot) => scoreSlot.taskId === taskId);
  }

  function scoreResultForQuestion(number) {
    const scoreSlot = scoreSlotForQuestion(number);
    return scoreSlot ? runtimeScore().byId.get(scoreSlot.scoreSlotId) || null : null;
  }

  function scoreSlotForQuestion(number) {
    requireSubmittedPrivateAccess();
    const question = model.questions.get(Number(number));
    if (!question) return null;
    const group = model.groups.get(question.groupId);
    if (typeDefinition(group)?.footerUnit === 'task') {
      const index = group.questionNumbers.indexOf(Number(number));
      return scoreSlotsForTask(group.taskId)[index] || null;
    }
    return (runtimeIndex.scoreSlotsByResponse.get(question.responseSlotId) || [])[0] || null;
  }

  function acceptedValuesForQuestion(number) {
    return (scoreSlotForQuestion(number)?.accepted || []).map((entry) => String(entry.value));
  }

  function reviewForQuestion(number) {
    requireSubmittedPrivateAccess();
    const scoreSlot = scoreSlotForQuestion(number);
    return scoreSlot ? runtimeIndex.reviews.get(scoreSlot.scoreSlotId) || null : null;
  }

  function optionDisplay(group, optionId, mode) {
    const itemOptions = (group.v2Task?.content?.items || []).flatMap((item) => item.options || [])
      .map((option) => ({ id: option.optionId, label: '', text: option.text }));
    const option = matchingOption(group, optionId)
      || (group.choices || []).find((choice) => choice.id === optionId)
      || itemOptions.find((choice) => choice.id === optionId);
    if (!option) return 'No answer';
    if (mode === 'text-only') return option.text || option.label || option.id;
    if (mode === 'label-only') return option.label || option.text || option.id;
    const label = option.label || '';
    return label && label !== option.text ? `${label} — ${option.text}` : option.text || label || option.id;
  }

  function multipleAnswers(group) {
    const saved = (group.responseSlotIds || []).map((responseSlotId) => state.answers[responseSlotId]).filter(Boolean);
    const canonicalByNormalized = new Map((group.choices || []).map((choice) => [
      normalizeAnswer(choice.id),
      String(choice.id),
    ]));
    const selected = [];
    const used = new Set();
    const limit = Math.max(1, Number(group.rules?.maxSelections) || (group.questionNumbers || []).length || 2);
    for (const value of saved) {
      const normalized = normalizeAnswer(value);
      const canonical = canonicalByNormalized.get(normalized);
      if (!canonical || used.has(normalized)) continue;
      selected.push(canonical);
      used.add(normalized);
      if (selected.length >= limit) break;
    }
    return selected;
  }

  function choiceSetEvaluation(group) {
    const selected = multipleAnswers(group);
    const numbers = group.questionNumbers || [];
    if (!state.submitted) {
      const slots = numbers.map((number, index) => ({
        number,
        answer: selected[index] || '',
        status: selected[index] ? 'answered' : 'unanswered',
      }));
      return { selected, correctAnswers: [], slots, correct: 0, incorrect: 0, unanswered: slots.filter((slot) => slot.status === 'unanswered').length, total: slots.length };
    }
    const score = runtimeScore();
    const taskScores = scoreSlotsForTask(group.taskId);
    const correctAnswers = taskScores.flatMap((scoreSlot) => (scoreSlot.accepted || []).map((entry) => String(entry.value)));
    const correctNormalized = new Set(correctAnswers.map(normalizeAnswer));
    const slots = (group.questionNumbers || []).map((number, index) => {
      const answer = selected[index] || '';
      return {
        number,
        answer,
        status: !answer ? 'unanswered' : correctNormalized.has(normalizeAnswer(answer)) ? 'correct' : 'incorrect',
      };
    });
    const scoreResults = taskScores.map((scoreSlot) => score.byId.get(scoreSlot.scoreSlotId)).filter(Boolean);
    const correct = scoreResults.filter((slot) => slot.status === 'correct').length;
    const incorrect = scoreResults.filter((slot) => slot.status === 'incorrect').length;
    const unanswered = scoreResults.filter((slot) => slot.status === 'unanswered').length;
    return { selected, correctAnswers, slots, correct, incorrect, unanswered, total: slots.length };
  }

  function choiceSetGroupStatus(group) {
    const evaluation = choiceSetEvaluation(group);
    if (!state.submitted) return evaluation.selected.length ? 'answered' : '';
    if (evaluation.correct === evaluation.total) return 'correct';
    if (evaluation.correct > 0) return 'partial';
    if (evaluation.incorrect > 0) return 'incorrect';
    return 'unanswered';
  }

  function isAnswered(number) {
    const question = model.questions.get(Number(number));
    if (!question) return false;
    const group = model.groups.get(question.groupId);
    if (typeDefinition(group)?.responseMode === 'choice-set') {
      const position = group.questionNumbers.indexOf(Number(number));
      return Boolean(multipleAnswers(group)[position]);
    }
    if (state.submitted) {
      const scoreSlot = scoreSlotForQuestion(number);
      if (scoreSlot?.evaluation === 'atomic-unordered-text-set') {
        return scoreResultForQuestion(number)?.status !== 'unanswered';
      }
    }
    return normalizeAnswer(answerForQuestion(number)) !== '';
  }

  function userAnswer(number) {
    const question = model.questions.get(Number(number));
    if (!question) return '';
    const group = model.groups.get(question.groupId);
    if (typeDefinition(group)?.responseMode === 'choice-set') {
      const position = group.questionNumbers.indexOf(Number(number));
      return choiceSetEvaluation(group).slots[position]?.answer || '';
    }
    return answerForQuestion(number);
  }

  function displayAnswer(number, value) {
    const question = model.questions.get(Number(number));
    const responseSlot = question && runtimeIndex.responseSlots.get(question.responseSlotId);
    if (question && responseSlot?.responseKind === 'option') {
      const group = model.groups.get(question.groupId);
      return optionDisplay(group, value, typeDefinition(group)?.optionDisplay);
    }
    return String(value || 'No answer');
  }

  function isCorrect(number) {
    const question = model.questions.get(Number(number));
    if (!question || !isAnswered(number)) return false;
    const group = model.groups.get(question.groupId);
    if (typeDefinition(group)?.responseMode === 'choice-set') {
      const position = group.questionNumbers.indexOf(Number(number));
      return choiceSetEvaluation(group).slots[position]?.status === 'correct';
    }
    return scoreResultForQuestion(number)?.status === 'correct';
  }

  function answerStatus(number) {
    if (!isAnswered(number)) return 'unanswered';
    if (!state.submitted) return 'answered';
    return isCorrect(number) ? 'correct' : 'incorrect';
  }

  function countProgress(partNumber) {
    return questionsForPart(partNumber).filter(isAnswered).length;
  }

  function isVisibleResponseFilled(number) {
    const question = model.questions.get(Number(number));
    if (!question) return false;
    const group = model.groups.get(question.groupId);
    if (typeDefinition(group)?.responseMode === 'choice-set') {
      const position = group.questionNumbers.indexOf(Number(number));
      return Boolean(multipleAnswers(group)[position]);
    }
    return normalizeAnswer(answerForQuestion(number)) !== '';
  }

  function partScoreSummaries(score) {
    return model.parts.map((part, index) => {
      const taskIds = new Set((part.groups || []).map((group) => group.taskId));
      const slots = score.slots.filter((slot) => taskIds.has(slot.taskId));
      const questionNumbers = questionsForPart(Number(part.number));
      const statuses = questionNumbers.map((number) => {
        if (!isVisibleResponseFilled(number)) return 'unanswered';
        return isCorrect(number) ? 'correct' : 'incorrect';
      });
      return {
        part: Number(part.number) || index + 1,
        label: `Passage ${Number(part.number) || index + 1}`,
        title: String(part.title || ''),
        difficultyTier: String(part.difficultyTier || ''),
        earnedMarks: slots.reduce((sum, slot) => sum + Number(slot.earnedMarks || 0), 0),
        availableMarks: slots.reduce((sum, slot) => sum + Number(slot.availableMarks || 0), 0),
        answered: statuses.filter((status) => status !== 'unanswered').length,
        total: statuses.length,
        statusCounts: {
          correct: statuses.filter((status) => status === 'correct').length,
          incorrect: statuses.filter((status) => status === 'incorrect').length,
          unanswered: statuses.filter((status) => status === 'unanswered').length,
        },
      };
    });
  }

  function calculateResult() {
    const score = runtimeScore();
    const statuses = model.questionNumbers.map((number) => {
      if (!isVisibleResponseFilled(number)) return 'unanswered';
      return isCorrect(number) ? 'correct' : 'incorrect';
    });
    const correct = statuses.filter((status) => status === 'correct').length;
    const incorrect = statuses.filter((status) => status === 'incorrect').length;
    const unanswered = statuses.filter((status) => status === 'unanswered').length;
    return {
      correct,
      incorrect,
      unanswered,
      total: model.questionNumbers.length,
      answered: correct + incorrect,
      earnedMarks: Number(score.earnedMarks || 0),
      availableMarks: Number(score.availableMarks || 0),
      scoreSlotCounts: {
        correct: Number(score.correct || 0),
        incorrect: Number(score.incorrect || 0),
        unanswered: Number(score.unanswered || 0),
        total: score.slots.length,
      },
      partScores: partScoreSummaries(score),
    };
  }

  function answerValueAttribute(number) {
    return h(answerForQuestion(number));
  }

  function questionClasses(number, extra) {
    const classes = ['question'];
    if (extra) classes.push(extra);
    if (isAnswered(number)) classes.push('is-answered');
    if (state.submitted && fullReviewEnabled()) classes.push(`is-${answerStatus(number)}`);
    if (Number(number) === Number(state.currentQuestion)) classes.push('is-current');
    return classes.join(' ');
  }

  function renderInlineRuns(runs) {
    return (runs || []).map((run) => {
      const text = h(run.text);
      if (run.style === 'strong') return `<strong>${text}</strong>`;
      if (run.style === 'em') return `<em>${text}</em>`;
      if (run.style === 'strong-em') return `<strong><em>${text}</em></strong>`;
      return text;
    }).join('');
  }

  function renderInstructions(group) {
    return `<div class="question-instructions">${(group.instructions || []).map((instruction, index) => {
      const runs = group.instructionInlines && group.instructionInlines[index]
        ? group.instructionInlines[index]
        : [{ style: 'text', text: instruction }];
      return `<p>${renderInlineRuns(runs)}</p>`;
    }).join('')}</div>`;
  }

  function renderChoiceKey(group) {
    if (!group.choices || !group.choices.length) return '';
    return `<dl class="choice-key">${group.choices.map((choice) =>
      `<div><dt>${h(choice.id)}</dt><dd>${h(choice.text)}</dd></div>`
    ).join('')}</dl>`;
  }

  function reviewStatusLabel(status) {
    if (status === 'correct') return '正确';
    if (status === 'partial') return '部分正确';
    if (status === 'incorrect') return '错误';
    return '未作答';
  }

  function reviewValue(value) {
    return value === 'No answer' || value === '' || value == null ? '未作答' : value;
  }

  function reviewQuestionRangeLabel(numbers) {
    const values = [...new Set((numbers || []).map(Number).filter(Number.isFinite))].sort((left, right) => left - right);
    if (!values.length) return '';
    if (values.length === 1) return String(values[0]);
    const contiguous = values.every((value, index) => index === 0 || value === values[index - 1] + 1);
    return contiguous ? `${values[0]}–${values[values.length - 1]}` : values.join('、');
  }

  function answerReviewHeadingMarkup(questionLabel, resultLabel) {
    const label = String(questionLabel || '').trim();
    return `<div class="answer-review-heading">
      ${label ? `<strong class="answer-review-question-number">第 ${h(label)} 题</strong>` : ''}
      <strong class="review-result">${h(resultLabel)}</strong>
    </div>`;
  }

  function reviewAuxiliaryText(item) {
    if (typeof item === 'string') return item;
    return item?.text || item?.whyNot || item?.explanation || '';
  }

  function reviewEvidenceText(review) {
    return (review?.evidence || []).map((entry) => [
      entry?.location ? `定位：${entry.location}` : '',
      entry?.quote ? `原文：${entry.quote}` : '',
      entry?.translation && entry.translation !== '—' ? `译文：${entry.translation}` : '',
    ].filter(Boolean).join('\n')).filter(Boolean);
  }

  function reviewQuestionTranslation(review) {
    return review?.extensions?.zhReviewV01?.questionTranslation ||
      review?.extensions?.questionTranslation || review?.questionTranslation || '';
  }

  function reviewHeadingTranslation(review) {
    const matchingHeading = review?.extensions?.zhReviewV01?.matchingHeading;
    return matchingHeading?.headingTranslation || '';
  }

  function chinesePrimaryExplanation(review, options = {}) {
    const distractors = options.includeDistractors === false ? [] :
      (review?.distractors || []).map(reviewAuxiliaryText).filter(Boolean).map((text) => `干扰项说明：${text}`);
    const formatNotes = (review?.formatNotes || []).map(reviewAuxiliaryText).filter(Boolean).map((text) => `格式与易错点：${text}`);
    const questionTranslation = options.includeQuestionTranslation === false ? '' : reviewQuestionTranslation(review);
    return [
      ...(options.prefix || []),
      questionTranslation ? `题干翻译：${questionTranslation}` : '',
      review?.explanation,
      ...distractors,
      ...formatNotes,
      ...reviewEvidenceText(review),
    ].filter(Boolean).join('\n\n') || '本题暂缺完整中文解析。';
  }

  function reviewMarkup(number) {
    if (!state.submitted || !fullReviewEnabled()) return '';
    const question = model.questions.get(Number(number));
    if (!question) return '';
    const status = answerStatus(number);
    const statusLabel = reviewStatusLabel(status);
    const group = model.groups.get(question.groupId);
    const supplied = displayAnswer(number, userAnswer(number));
    const review = reviewForQuestion(number);
    const scoreSlot = scoreSlotForQuestion(number);
    if (scoreSlot?.evaluation === 'atomic-unordered-text-set' && scoreSlot.responseSlotIds.length > 1) {
      return atomicTextSetReviewMarkup(scoreSlot);
    }
    const scoreNumbers = (scoreSlot?.responseSlotIds || [])
      .map((responseSlotId) => model.responseNumberById.get(responseSlotId))
      .filter(Number.isFinite);
    const questionLabel = reviewQuestionRangeLabel(scoreNumbers.length ? scoreNumbers : [number]);
    if (!reviewAnswerAnalysisEnabled()) return t35SelfCorrectionReviewMarkup({
      questionLabel, status, supplied, reviewFor: number, scoreSlotId: scoreSlot?.scoreSlotId || '',
    });
    const accepted = (scoreSlot?.accepted || [])[0]?.value || '';
    const correct = review?.answerDisplay || (group ? optionDisplay(group, accepted, typeDefinition(group)?.optionDisplay) : accepted) || 'No answer';
    const explanation = chinesePrimaryExplanation(review);
    return `
      <div class="answer-review review-feedback ${status}" data-review-for="${number}">
        ${answerReviewHeadingMarkup(questionLabel, statusLabel)}
        <dl class="answer-comparison">
          <div><dt>你的答案</dt><dd>${h(reviewValue(supplied))}</dd></div>
          <div><dt>正确答案</dt><dd>${h(reviewValue(correct))}</dd></div>
        </dl>
        <div class="source-explanation">${t35ReviewExplanationHeadingMarkup(scoreSlot?.scoreSlotId || '', number, status)}<p>${nl(explanation)}</p></div>
      </div>`;
  }

  function atomicTextSetReviewMarkup(scoreSlot) {
    if (!state.submitted || !fullReviewEnabled() || !scoreSlot) return '';
    const result = runtimeScore().byId.get(scoreSlot.scoreSlotId);
    const status = result?.status || 'unanswered';
    const statusLabel = reviewStatusLabel(status);
    const numbers = scoreSlot.responseSlotIds.map((responseSlotId) => model.responseNumberById.get(responseSlotId)).filter(Number.isFinite);
    const range = reviewQuestionRangeLabel(numbers);
    const supplied = scoreSlot.responseSlotIds.map((responseSlotId) => reviewValue(String(state.answers[responseSlotId] || 'No answer')));
    if (!reviewAnswerAnalysisEnabled()) return t35SelfCorrectionReviewMarkup({
      questionLabel: range, status, supplied: supplied.join(' · '), reviewFor: range, scoreSlotId: scoreSlot.scoreSlotId,
    });
    const canonicalByMember = new Map();
    (scoreSlot.accepted || []).forEach((entry, index) => {
      const memberId = String(entry.setMemberId || `member-${index + 1}`);
      if (entry.verification === 'canonical' || !canonicalByMember.has(memberId)) canonicalByMember.set(memberId, String(entry.value));
    });
    const correct = [...canonicalByMember.values()];
    const review = runtimeIndex.reviews.get(scoreSlot.scoreSlotId);
    const explanation = chinesePrimaryExplanation(review, {
      includeDistractors: false,
      prefix: ['两个空构成一组不分顺序的答案；只有两个答案都正确，才获得该组全部分数。'],
    });
    return `<div class="answer-review review-feedback ${status} atomic-text-set-review" data-review-for="${h(range)}" data-score-slot-id="${h(scoreSlot.scoreSlotId)}">
      ${answerReviewHeadingMarkup(range, `${statusLabel} · ${Number(result?.earnedMarks || 0)}/${Number(result?.availableMarks || scoreSlot.marks || 0)} 分`)}
      <dl class="answer-comparison">
        <div><dt>你的答案</dt><dd>${h(supplied.join(' · '))}</dd></div>
        <div><dt>正确答案</dt><dd>${h(`${correct.join(' · ')}（顺序不限）`)}</dd></div>
      </dl>
      <div class="source-explanation">${t35ReviewExplanationHeadingMarkup(scoreSlot.scoreSlotId, numbers[0] || range, status)}<p>${nl(explanation)}</p></div>
    </div>`;
  }

  function choiceSetReviewMarkup(group) {
    if (!state.submitted || !fullReviewEnabled()) return '';
    const evaluation = choiceSetEvaluation(group);
    const status = choiceSetGroupStatus(group);
    const statusLabel = reviewStatusLabel(status);
    const range = reviewQuestionRangeLabel(group.questionNumbers || group.items.map((item) => item.number));
    const locatorScoreSlot = scoreSlotsForTask(group.taskId)[0] || null;
    if (!reviewAnswerAnalysisEnabled()) return t35SelfCorrectionReviewMarkup({
      questionLabel: range, status, supplied: evaluation.selected.length ? evaluation.selected.map((id) => optionDisplay(group, id, 'text-only')).join(', ') : '未作答',
      reviewFor: range, scoreSlotId: locatorScoreSlot?.scoreSlotId || '',
    });
    const explanation = [...new Set(scoreSlotsForTask(group.taskId)
      .map((scoreSlot) => runtimeIndex.reviews.get(scoreSlot.scoreSlotId))
      .filter(Boolean)
      .map((review) => chinesePrimaryExplanation(review)))]
      .join('\n\n') ||
      '本题暂缺完整中文解析。';
    const breakdown = evaluation.slots.map((slot, index) => {
      const label = slot.answer ? `所选答案：${optionDisplay(group, slot.answer, 'text-only')}` : `第 ${index + 1} 个选择：未作答`;
      const result = slot.status === 'correct' ? '正确 · 1 分' :
        slot.status === 'incorrect' ? '错误 · 0 分' : '未作答 · 0 分';
      return `<li class="${slot.status}"><span>${h(label)}</span><strong>${result}</strong></li>`;
    }).join('');
    const t36CorrectRows = t36ChoiceSetCorrectAnswerRows(group);
    return `
      <div class="answer-review review-feedback ${status}" data-review-for="${h(range)}">
        ${answerReviewHeadingMarkup(range, `${statusLabel} · ${evaluation.correct}/${evaluation.total} 分`)}
        <dl class="answer-comparison">
          <div><dt>你的答案</dt><dd>${h(evaluation.selected.length ? evaluation.selected.map((id) => optionDisplay(group, id, 'text-only')).join(', ') : '未作答')}</dd></div>
          ${t36CorrectRows ? '' : `<div><dt>正确答案</dt><dd>${h(evaluation.correctAnswers.map((id) => optionDisplay(group, id, 'text-only')).join(', '))}</dd></div>`}
        </dl>
        ${t36CorrectRows}
        <ol class="choice-set-score-breakdown" aria-label="各选项得分">${breakdown}</ol>
        <div class="source-explanation">${t35ReviewExplanationHeadingMarkup(locatorScoreSlot?.scoreSlotId || '', group.questionNumbers?.[0] || group.items?.[0]?.number || range, status, { suppressLocator: Boolean(t36CorrectRows) })}<p>${nl(explanation)}</p></div>
      </div>`;
  }

  function matchingReviewMarkup(item, group) {
    if (!state.submitted || !fullReviewEnabled()) return '';
    const status = answerStatus(item.number);
    const statusLabel = reviewStatusLabel(status);
    const selectedId = userAnswer(item.number);
    const definition = typeDefinition(group);
    const labelFor = (id) => optionDisplay(group, id, definition?.optionDisplay);
    const correctId = acceptedValuesForQuestion(item.number)[0] || '';
    const correctOption = labelFor(correctId);
    const review = reviewForQuestion(item.number);
    const scoreSlot = scoreSlotForQuestion(item.number);
    if (!reviewAnswerAnalysisEnabled()) return `<section class="matching-review-item">
      <h4>${renderItemPrompt(group, item)}</h4>
      ${t35SelfCorrectionReviewMarkup({ questionLabel: String(item.number), status, supplied: labelFor(selectedId), reviewFor: item.number, scoreSlotId: scoreSlot?.scoreSlotId || '' })}
    </section>`;
    const isHeading = group.questionType === 'matching_headings';
    const headingTranslation = isHeading ? reviewHeadingTranslation(review) : '';
    const sourceExplanation = chinesePrimaryExplanation(review, {
      includeDistractors: false,
      includeQuestionTranslation: !isHeading,
    });
    const noun = isHeading ? 'heading' :
      group.questionType === 'matching_sentence_endings' ? 'ending' :
        group.questionType === 'classification' ? 'group' : 'option';
    const nounLabel = noun === 'heading' ? '标题' : noun === 'ending' ? '句尾' : noun === 'group' ? '类别' : '选项';
    const explanation = isHeading ? sourceExplanation : `正确${nounLabel}：${correctOption}\n\n${sourceExplanation}`;
    return `<section class="matching-review-item">
      <h4>${renderItemPrompt(group, item)}</h4>
      <div class="answer-review review-feedback ${status}" data-review-for="${item.number}">
        ${answerReviewHeadingMarkup(String(item.number), statusLabel)}
        <dl class="answer-comparison">
          <div><dt>你的答案</dt><dd>${h(reviewValue(labelFor(selectedId)))}</dd></div>
          ${isHeading
            ? `<div data-review-field="correct-heading"><dt><strong>正确标题</strong></dt><dd>${h(correctOption)}</dd></div>`
            : `<div><dt>正确答案</dt><dd>${h(correctOption)}</dd></div>`}
        </dl>
        ${isHeading ? `<div class="heading-translation" data-review-field="heading-translation"><strong>标题翻译</strong><p>${h(headingTranslation)}</p></div>` : ''}
        <div class="source-explanation" ${isHeading ? 'data-review-field="explanation-evidence"' : ''}>${t35ReviewExplanationHeadingMarkup(scoreSlot?.scoreSlotId || '', item.number, status)}<p>${nl(explanation)}</p></div>
      </div>
    </section>`;
  }

  function sourceItemForRuntimeItem(group, item) {
    return (group.contentItems || []).find((candidate) =>
      candidate.itemId === item.itemId || candidate.responseSlotIds?.includes(item.responseSlotId)) ||
      (group.v2Task?.content?.items || []).find((candidate) =>
        candidate.itemId === item.itemId || candidate.responseSlotIds?.includes(item.responseSlotId)) || null;
  }

  function renderItemPrompt(group, item) {
    const sourceItem = sourceItemForRuntimeItem(group, item);
    const runs = Array.isArray(item.promptInlines) && item.promptInlines.length
      ? item.promptInlines
      : Array.isArray(sourceItem?.textInlines) && sourceItem.textInlines.length
        ? sourceItem.textInlines
        : [{ style: 'text', text: item.prompt }];
    return renderInlineRuns(runs);
  }

  function itemChoices(group, item) {
    const sourceItem = sourceItemForRuntimeItem(group, item);
    if (sourceItem?.options?.length) {
      return sourceItem.options.map((option) => ({ id: option.id || option.optionId, text: option.text }));
    }
    return group.choices || [];
  }

  function renderSingleOptionList(group, listClass = '') {
    return `${renderInstructions(group)}
      <div class="choice-question-list ${h(listClass)}">${group.items.map((item) => {
        const selected = answerForQuestion(item.number);
        const choices = itemChoices(group, item);
        return `<article class="${questionClasses(item.number, 'choice-question')}" data-question="${item.number}" tabindex="-1">
          <div class="question-prompt">
            <span class="question-number" aria-hidden="true">${item.number}</span>
            <p class="question-text"><span class="sr-only">Question ${item.number}. </span>${renderItemPrompt(group, item)}</p>
          </div>
          <fieldset class="choice-list"><legend class="sr-only">Answer question ${item.number}</legend>
            ${choices.map((choice) => `<label class="choice ${selected === choice.id ? 'is-selected' : ''}">
              <input type="radio" name="question-${item.number}" value="${h(choice.id)}" data-answer-question="${item.number}" ${selected === choice.id ? 'checked' : ''} ${state.submitted ? 'disabled' : ''}>
              <span>${h(choice.text || choice.id)}</span>
            </label>`).join('')}
          </fieldset>
          ${reviewMarkup(item.number)}
        </article>`;
      }).join('')}</div>`;
  }

  function renderTfng(group) {
    return renderSingleOptionList(group, 'statement-choice-list');
  }

  function renderSingleChoice(group) {
    return renderSingleOptionList(group, 'single-choice-list');
  }

  function renderHeadingToken(heading, sourceQuestion, placeholder) {
    const source = sourceQuestion ? ` data-source-question="${sourceQuestion}"` : '';
    const placeholderState = placeholder ? ' is-source-placeholder' : '';
    return `<button class="heading-token${placeholderState}" type="button" data-heading-id="${h(heading.id)}"${source}
      aria-label="${h(heading.text)}" aria-grabbed="false" ${placeholder ? 'aria-hidden="true" tabindex="-1"' : ''} ${state.submitted ? 'disabled' : ''}>
      <span class="heading-token-text">${h(heading.text)}</span>
    </button>`;
  }

  function renderMatchingHeadings(group) {
    const assigned = new Set(group.items.map((item) => answerForQuestion(item.number)).filter(Boolean));
    return `${renderInstructions(group)}
      <div class="matching-headings" data-heading-group="${h(group.id)}">
        <section class="heading-bank-wrap" aria-labelledby="${group.id}-bank-title">
          <h3 id="${group.id}-bank-title">${h(group.listTitle || 'List of Headings')}</h3>
          <div class="heading-token-list heading-bank" data-heading-bank="${h(group.id)}" data-heading-group="${h(group.id)}" tabindex="${state.submitted ? '-1' : '0'}" role="button" aria-label="Heading list. Drop a placed heading here to clear it.">
            ${group.headings.map((heading) => renderHeadingToken(heading, 0, assigned.has(heading.id))).join('')}
          </div>
        </section>
        ${state.submitted && fullReviewEnabled() ? `<div class="matching-review-list">${group.items.map((item) => matchingReviewMarkup(item, group)).join('')}</div>` : ''}
      </div>`;
  }

  function renderMatchingGrid(group) {
    const options = matchingOptions(group);
    const showsSemanticKey = group.questionType === 'matching_features' || group.questionType === 'classification';
    const hasKey = showsSemanticKey && options.some((option) => String(option.text || '') && String(option.text) !== String(option.label || option.id));
    const keyTitle = group.listTitle || (showsSemanticKey ? 'List of options' : 'Options');
    const optionKey = hasKey ? `<section class="matching-option-key" aria-labelledby="${h(group.id)}-key-title">
      <h3 id="${h(group.id)}-key-title">${h(keyTitle)}</h3>
      <dl class="choice-key">${options.map((option) => `<div><dt>${h(option.label || option.id)}</dt><dd>${h(option.text)}</dd></div>`).join('')}</dl>
    </section>` : '';
    return `${renderInstructions(group)}
      <div class="matching-grid matching-grid-${h(group.questionType)}" data-matching-grid="${h(group.id)}" data-option-count="${options.length}" style="--matching-grid-option-count:${options.length}">
        <table class="matching-grid-table">
          <caption class="sr-only">Table of options to match</caption>
          <thead><tr><th class="matching-grid-corner" aria-hidden="true"></th>${options.map((option, optionIndex) =>
            `<th scope="col" id="${h(group.id)}-option-${optionIndex}" aria-label="${h([option.label || option.id, option.text].filter(Boolean).join(', '))}">${h(option.label || option.text || option.id)}</th>`
          ).join('')}</tr></thead>
          <tbody>${group.items.map((item) => {
            const selected = answerForQuestion(item.number);
            return `<tr class="${questionClasses(item.number, 'matching-grid-row')}" data-question="${item.number}" ${state.submitted && fullReviewEnabled() ? `data-review-state="${answerStatus(item.number)}"` : ''}>
              <th class="matching-grid-statement" scope="row" id="${h(group.id)}-statement-${item.number}"><span class="matching-grid-number">${item.number}</span><span>${renderItemPrompt(group, item)}</span></th>
              ${options.map((option, optionIndex) => {
                const isSelected = normalizeAnswer(selected) === normalizeAnswer(option.id);
                const isCorrectAnswer = state.submitted && reviewAnswerAnalysisEnabled() && acceptedValuesForQuestion(item.number).some((answer) => normalizeAnswer(answer) === normalizeAnswer(option.id));
                const reviewClass = !state.submitted || !reviewAnswerAnalysisEnabled() ? '' : isCorrectAnswer ? ' is-correct-answer' : isSelected ? ' is-selected-incorrect' : '';
                return `<td><label class="matching-grid-cell ${isSelected ? 'is-selected' : ''}${reviewClass}">
                  <input class="matching-grid-radio" type="radio" name="matching-grid-${h(group.id)}-${item.number}" value="${h(option.id)}" data-grid-group="${h(group.id)}" data-grid-question="${item.number}" data-grid-option="${h(option.id)}" aria-labelledby="${h(group.id)}-statement-${item.number} ${h(group.id)}-option-${optionIndex}" ${isSelected ? 'checked' : ''} ${state.submitted ? 'disabled' : ''}>
                </label></td>`;
              }).join('')}
            </tr>`;
          }).join('')}</tbody>
        </table>
        ${optionKey}
        ${state.submitted && fullReviewEnabled() ? `<div class="matching-review-list">${group.items.map((item) => matchingReviewMarkup(item, group)).join('')}</div>` : ''}
      </div>`;
  }

  function renderEndingToken(option, sourceQuestion, placeholder) {
    return renderHeadingToken(option, sourceQuestion, placeholder)
      .replace('class="heading-token', 'class="heading-token ending-token');
  }

  function renderMatchingSentenceEndings(group) {
    const options = matchingOptions(group);
    const assigned = new Set(group.items.map((item) => answerForQuestion(item.number)).filter(Boolean));
    return `${renderInstructions(group)}
      <div class="matching-endings" data-heading-group="${h(group.id)}">
        <div class="ending-item-list">${group.items.map((item) => {
          const selectedId = answerForQuestion(item.number);
          const selectedOption = matchingOption(group, selectedId);
          return `<article class="${questionClasses(item.number, 'ending-item')}" data-question="${item.number}" ${state.submitted && fullReviewEnabled() ? `data-review-state="${answerStatus(item.number)}"` : ''} tabindex="-1">
            <div class="ending-prompt"><span id="${h(group.id)}-prompt-${item.number}">${renderItemPrompt(group, item)}</span><br>
              <div class="ending-drop-zone drop-zone ${selectedOption ? 'has-answer' : ''}" data-drop-question="${item.number}" data-heading-group="${h(group.id)}" tabindex="${state.submitted ? '-1' : '0'}" role="button" aria-labelledby="${h(group.id)}-prompt-${item.number}" aria-label="Answer area for question ${item.number}${selectedOption ? `. ${h(selectedOption.text)}` : '. Empty'}">
                ${selectedOption ? renderEndingToken(selectedOption, item.number, false) : `<span class="gap-order-number">${item.number}</span>`}
              </div>
            </div>
            ${matchingReviewMarkup(item, group)}
          </article>`;
        }).join('')}</div>
        <section class="ending-bank-wrap">
          <div class="heading-token-list heading-bank ending-bank" data-heading-bank="${h(group.id)}" data-heading-group="${h(group.id)}" tabindex="${state.submitted ? '-1' : '0'}" role="button" aria-label="Sentence endings. Drop a placed ending here to clear it.">
            ${options.map((option) => renderEndingToken(option, 0, assigned.has(option.id))).join('')}
          </div>
        </section>
      </div>`;
  }

  function renderSummaryOptionToken(option, sourceQuestion, placeholder) {
    return renderHeadingToken(option, sourceQuestion, placeholder)
      .replace('class="heading-token', 'class="heading-token summary-option-token');
  }

  function renderSummaryOptionGap(group, responseSlotId) {
    const number = model.responseNumberById.get(String(responseSlotId || ''));
    if (!number) return '';
    const selectedId = answerForQuestion(number);
    const selectedOption = matchingOption(group, selectedId);
    const currentClass = Number(number) === Number(state.currentQuestion) ? ' is-current' : '';
    const answeredClass = selectedOption
      ? ` is-answered${state.submitted && fullReviewEnabled() ? ` is-${answerStatus(number)}` : ''}`
      : '';
    return `<span class="summary-option-gap drop-zone${selectedOption ? ' has-answer' : ''}${currentClass}${answeredClass}"
      data-question="${number}" data-drop-question="${number}" data-heading-group="${h(group.id)}"
      ${state.submitted && fullReviewEnabled() ? `data-review-state="${answerStatus(number)}"` : ''}
      tabindex="${state.submitted ? '-1' : '0'}" role="button"
      aria-label="Answer area for question ${number}${selectedOption ? `. ${h(selectedOption.text)}` : '. Empty'}">
      ${selectedOption ? renderSummaryOptionToken(selectedOption, number, false) : `<span class="gap-order-number">${number}</span>`}
    </span>`;
  }

  function renderSummaryOptionInlines(group, inlines, fallbackText) {
    if (!Array.isArray(inlines) || !inlines.length) return h(fallbackText || '');
    let output = '';
    for (let index = 0; index < inlines.length; index += 1) {
      const inline = inlines[index];
      if (inline?.type === 'text') {
        output += h(inline.text || '');
        continue;
      }
      if (inline?.type === 'response') {
        const gap = renderSummaryOptionGap(group, inline.responseSlotId);
        const following = inlines[index + 1];
        if (following?.type === 'text') {
          const { tail, remainder } = splitLeadingCompletionTail(following.text || '');
          if (tail) {
            output += `<span class="completion-answer-tail">${gap}${h(tail)}</span>${h(remainder)}`;
            index += 1;
            continue;
          }
        }
        output += gap;
      }
    }
    return output;
  }

  function renderCompletionMainTitle(group) {
    return group.completionTitle ? `<h2 class="completion-main-title">${h(group.completionTitle)}</h2>` : '';
  }

  function renderSummaryOptionBank(group) {
    const options = matchingOptions(group);
    const assigned = new Set(group.items.map((item) => answerForQuestion(item.number)).filter(Boolean));
    const proseItems = group.contentItems && group.contentItems.length ? group.contentItems : group.sections.flatMap((section) => section.items || []);
    const summarySection = `<section class="summary-option-section">
      <div class="summary-option-prose">${proseItems.map((item) => `<section class="summary-option-prose-item" data-questions="${item.questionNumbers.join(' ')}">
        ${item.extensions?.summarySectionTitle ? `<h3 class="summary-option-prose-title">${h(item.extensions.summarySectionTitle)}</h3>` : ''}
        <p>${renderSummaryOptionInlines(group, item.inlines, item.text)}</p>
      </section>`).join('')}</div>
    </section>`;
    const optionBank = `<div class="summary-option-bank heading-bank" data-heading-bank="${h(group.id)}" data-heading-group="${h(group.id)}"
      tabindex="${state.submitted ? '-1' : '0'}" role="button" aria-label="Options. Drop a placed option here to clear it.">
      ${options.map((option) => renderSummaryOptionToken(option, 0, assigned.has(option.id))).join('')}
    </div>`;
    const reviewList = state.submitted && fullReviewEnabled() ? `<div class="summary-option-review-list">${group.items.map((item) => reviewMarkup(item.number)).join('')}</div>` : '';
    return `${renderInstructions(group)}
      ${renderCompletionMainTitle(group)}
      <div class="summary-option-completion" data-heading-group="${h(group.id)}">
        ${summarySection}
        ${optionBank}
        ${reviewList}
      </div>`;
  }

  function renderChoiceSet(group) {
    const evaluation = choiceSetEvaluation(group);
    const selected = evaluation.selected;
    const answeredCount = selected.length;
    const groupStatus = choiceSetGroupStatus(group);
    const explanations = choiceSetReviewMarkup(group);
    const numbers = group.questionNumbers || group.items.map((item) => item.number);
    const selectionLimit = Math.max(2, Number(group.rules?.maxSelections) || numbers.length || 2);
    const rangeLabel = numbers.length > 1 ? `${numbers[0]}–${numbers[numbers.length - 1]}` : String(numbers[0] || '');
    const contextParagraphs = (group.contextParagraphs || []).map((paragraph) => {
      const runs = Array.isArray(paragraph.inlines) && paragraph.inlines.length
        ? paragraph.inlines
        : [{ style: 'text', text: paragraph.text || '' }];
      return `<p class="choice-set-context">${renderInlineRuns(runs)}</p>`;
    }).join('');
    return `${renderInstructions(group)}
      <article class="question multi-question ${groupStatus ? `is-${groupStatus}` : ''} ${numbers.includes(state.currentQuestion) ? 'is-current' : ''}" data-questions="${numbers.join(' ')}" tabindex="-1">
        ${contextParagraphs ? `<div class="choice-set-contexts">${contextParagraphs}</div>` : ''}
        <div class="question-prompt">
          <span class="question-number">${h(rangeLabel)}</span>
          <p class="question-text">${renderInlineRuns(group.stemInlines || [{ style: 'text', text: group.stem }])}</p>
        </div>
        <fieldset class="choice-list multiple-choice-list"><legend class="sr-only">Choose ${selectionLimit} answers for questions ${h(rangeLabel)}</legend>
          ${group.choices.map((choice) => {
            const isSelected = selected.includes(choice.id);
            const isCorrectChoice = evaluation.correctAnswers.some((answer) => normalizeAnswer(answer) === normalizeAnswer(choice.id));
            const reviewClass = !state.submitted || !reviewAnswerAnalysisEnabled() ? '' : isSelected && isCorrectChoice ? ' is-selected-correct' :
              isSelected ? ' is-selected-incorrect' : isCorrectChoice ? ' is-correct-answer' : '';
            return `<label class="choice ${isSelected ? 'is-selected' : ''}${reviewClass}">
            <input type="checkbox" value="${h(choice.id)}" data-multiple-group="${h(group.id)}" ${selected.includes(choice.id) ? 'checked' : ''} ${state.submitted || (answeredCount >= selectionLimit && !selected.includes(choice.id)) ? 'disabled' : ''}>
            <span class="choice-text">${h(choice.text)}</span>
          </label>`;
          }).join('')}
        </fieldset>
        ${explanations}
      </article>`;
  }

  function blankMarkup(number) {
    const value = answerValueAttribute(number);
    return `<label class="${questionClasses(number, 'inline-question inline-answer-label')}" data-question="${number}"><input class="text-answer completion-input inline-answer" type="text" aria-label="Question ${number}, insert answer" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="500" size="15" data-answer-question="${number}" placeholder="${number}" value="${value}" ${state.submitted ? 'disabled' : ''}></label>`;
  }

  /*
   * A completion field and the punctuation which immediately closes it are one
   * typographic unit.  Keeping only that short tail in a no-wrap wrapper lets
   * the rest of a sentence reflow normally while preventing a full stop,
   * comma, closing quote, or possessive ’s from starting the next line alone.
   */
  function splitLeadingCompletionTail(value) {
    const source = String(value || '');
    const match = source.match(/^[ \u00a0]*(?:(?:['\u2019][sS])|[.,;:!?\u2026)\]}\u2019\u201d'"%])+/);
    const tail = match ? match[0] : '';
    return { tail, remainder: source.slice(tail.length) };
  }

  function completionAnswerMarkup(number, followingText) {
    const { tail, remainder } = splitLeadingCompletionTail(followingText);
    return {
      markup: tail
        ? `<span class="completion-answer-tail">${blankMarkup(number)}${h(tail)}</span>`
        : blankMarkup(number),
      remainder,
    };
  }

  function renderSourceFormattedText(text, sourceFormatting) {
    const source = String(text || '');
    const renderSegment = (value) => {
      const escaped = h(value);
      if (sourceFormatting?.paragraphBreaks !== 'preserve') return escaped;
      return escaped
        .replace(/\r?\n(?:[ \t]*\r?\n)+/g, '<span class="source-paragraph-break" aria-hidden="true"></span>')
        .replace(/\r?\n/g, '<br class="source-line-break">');
    };
    const formattingRuns = [
      ['italicText', 'em'],
      ['boldText', 'strong'],
    ].flatMap(([key, tag]) => Array.isArray(sourceFormatting?.[key])
      ? sourceFormatting[key].filter((value) => typeof value === 'string' && value).map((value) => ({ value, tag }))
      : []);
    if (!formattingRuns.length) return renderSegment(source);
    const ranges = [];
    formattingRuns.forEach(({ value: needle, tag }) => {
      let start = 0;
      while (start < source.length) {
        const index = source.indexOf(needle, start);
        if (index < 0) break;
        ranges.push({ start: index, end: index + needle.length, tag });
        start = index + needle.length;
      }
    });
    ranges.sort((a, b) => a.start - b.start || b.end - a.end);
    const accepted = [];
    ranges.forEach((range) => {
      if (!accepted.length || range.start >= accepted[accepted.length - 1].end) accepted.push(range);
    });
    if (!accepted.length) return renderSegment(source);

    let cursor = 0;
    let output = '';
    accepted.forEach((range) => {
      output += renderSegment(source.slice(cursor, range.start));
      output += `<${range.tag}>${renderSegment(source.slice(range.start, range.end))}</${range.tag}>`;
      cursor = range.end;
    });
    return `${output}${renderSegment(source.slice(cursor))}`;
  }

  function renderPassageDialogue(text, sourceFormatting) {
    const dialogue = sourceFormatting?.dialogue;
    if (!dialogue || typeof dialogue !== 'object' || typeof dialogue.introduction !== 'string' || !Array.isArray(dialogue.lines) || !dialogue.lines.length) return null;
    const lines = dialogue.lines.map((line) => ({
      speaker: typeof line?.speaker === 'string' ? line.speaker : '',
      utteranceLines: Array.isArray(line?.utteranceLines) ? line.utteranceLines.filter((value) => typeof value === 'string' && value) : [],
    }));
    if (lines.some(({ speaker, utteranceLines }) => !speaker || !utteranceLines.length)) return null;
    const reconstructed = [
      dialogue.introduction,
      ...lines.flatMap(({ speaker, utteranceLines }) => [`${speaker} ${utteranceLines[0]}`, ...utteranceLines.slice(1)]),
    ].join('\n');
    if (reconstructed !== String(text || '')) return null;
    const label = typeof dialogue.label === 'string' && dialogue.label.trim() ? dialogue.label.trim() : 'Dialogue';
    const renderedLines = lines.map(({ speaker, utteranceLines }) => `<span class="passage-dialogue-line">
      <strong class="passage-dialogue-speaker">${h(speaker)}</strong>
      <em class="passage-dialogue-utterances">${utteranceLines.map((utterance) => `<span class="passage-dialogue-utterance-line">${h(utterance)}</span>`).join('')}</em>
    </span>`).join('');
    return `<span class="passage-dialogue-introduction">${renderSourceFormattedText(dialogue.introduction, sourceFormatting)}</span>
      <span class="passage-dialogue" role="group" aria-label="${h(label)}">${renderedLines}</span>`;
  }

  function renderPassageBlockText(text, sourceFormatting) {
    return renderPassageDialogue(text, sourceFormatting) ?? renderSourceFormattedText(text, sourceFormatting);
  }

  function renderTextWithBlanks(text, permittedNumbers, sourceFormatting) {
    const source = String(text || '');
    const allowed = new Set((permittedNumbers || []).map(Number));
    const pattern = /\[?(\d{1,2})\]?\s*_{3,}/g;
    let cursor = 0;
    let output = '';
    let match;
    let found = 0;
    while ((match = pattern.exec(source))) {
      const number = Number(match[1]);
      if (!allowed.has(number) && !model.questions.has(number)) continue;
      output += renderSourceFormattedText(source.slice(cursor, match.index), sourceFormatting);
      const afterBlank = match.index + match[0].length;
      const answer = completionAnswerMarkup(number, source.slice(afterBlank));
      output += answer.markup;
      cursor = source.length - answer.remainder.length;
      found += 1;
    }
    output += renderSourceFormattedText(source.slice(cursor), sourceFormatting);
    if (!found && allowed.size === 1) {
      output += ` ${blankMarkup([...allowed][0])}`;
    }
    return output;
  }

  function renderCompletionInlines(inlines, fallbackText, permittedNumbers, sourceFormatting) {
    if (!Array.isArray(inlines) || !inlines.length) return renderTextWithBlanks(fallbackText, permittedNumbers, sourceFormatting);
    let output = '';
    for (let index = 0; index < inlines.length; index += 1) {
      const inline = inlines[index];
      if (inline?.type === 'text') {
        output += renderSourceFormattedText(inline.text || '', sourceFormatting);
        continue;
      }
      if (inline?.type === 'response') {
        const number = model.responseNumberById.get(String(inline.responseSlotId || ''));
        if (!number) continue;
        const following = inlines[index + 1];
        if (following?.type === 'text') {
          const answer = completionAnswerMarkup(number, following.text || '');
          output += answer.markup;
          if (answer.remainder !== String(following.text || '')) {
            output += renderSourceFormattedText(answer.remainder, sourceFormatting);
            index += 1;
          }
        } else {
          output += blankMarkup(number);
        }
      }
    }
    return output;
  }

  function reviewBlocksForNumbers(numbers) {
    if (!state.submitted || !fullReviewEnabled()) return '';
    const seenScores = new Set();
    return numbers.map((number) => {
      const scoreSlot = scoreSlotForQuestion(number);
      if (!scoreSlot || seenScores.has(scoreSlot.scoreSlotId)) return '';
      seenScores.add(scoreSlot.scoreSlotId);
      return scoreSlot.evaluation === 'atomic-unordered-text-set' && scoreSlot.responseSlotIds.length > 1
        ? atomicTextSetReviewMarkup(scoreSlot)
        : reviewMarkup(number);
    }).join('');
  }

  function renderCompletion(group) {
    const sections = group.sections && group.sections.length ? group.sections : [{
      label: '',
      items: group.items.map((item) => ({ text: item.prompt, questionNumbers: [item.number] })),
    }];
    const renderLine = (line, elementName) => {
      const inferred = group.items.filter((item) => String(line.text).includes(String(item.number)) && String(line.text).includes('_')).map((item) => item.number);
      const numbers = line.questionNumbers && line.questionNumbers.length ? line.questionNumbers : inferred;
      const tag = elementName || 'li';
      const notePresentation = line.extensions?.notePresentation || {};
      const noteLevel = [0, 1, 2].includes(Number(notePresentation.level)) ? Number(notePresentation.level) : null;
      const noteMarker = ['none', 'bullet', 'dash'].includes(notePresentation.marker) ? notePresentation.marker : '';
      const noteEmphasis = notePresentation.emphasis === 'strong' ? ' note-emphasis-strong' : '';
      const noteClasses = noteLevel === null ? '' : ` note-level-${noteLevel} note-marker-${noteMarker || 'none'}${noteEmphasis}`;
      const noteAria = noteLevel === null || tag === 'p' ? '' : ` aria-level="${Math.max(1, noteLevel)}"`;
      if (tag === 'p') {
        return `<div class="completion-line ${line.role === 'supporting-note' ? 'supporting-note' : ''}${noteClasses}" data-questions="${numbers.join(' ')}"${noteAria}>
          <p><span>${renderCompletionInlines(line.inlines, line.text, numbers, line.extensions?.sourceFormatting)}</span></p>
          ${reviewBlocksForNumbers(numbers)}
        </div>`;
      }
      return `<${tag} class="completion-line ${line.role === 'supporting-note' ? 'supporting-note' : ''}${noteClasses}" data-questions="${numbers.join(' ')}"${noteAria}>
        <span>${renderCompletionInlines(line.inlines, line.text, numbers, line.extensions?.sourceFormatting)}</span>
        ${reviewBlocksForNumbers(numbers)}
      </${tag}>`;
    };

    if (group.layoutVariant === 'prose') {
      return `${renderInstructions(group)}
        ${renderCompletionMainTitle(group)}
        <div class="completion-prose">${sections.map((section) => `
        <section class="completion-section completion-prose-section">
          ${section.label ? `<h3 class="completion-prose-title">${h(section.label)}</h3>` : ''}
          ${section.items.map((line) => renderLine(line, 'p')).join('')}
        </section>`).join('')}</div>`;
    }

    return `${renderInstructions(group)}
      ${renderCompletionMainTitle(group)}
      <div class="completion-notes">${sections.map((section) => `<section class="completion-section">
        ${section.label ? `<h3>${h(section.label)}</h3>` : ''}
        <ul class="completion-list">${section.items.map((line) => renderLine(line, 'li')).join('')}</ul>
      </section>`).join('')}</div>`;
  }

  function renderSentenceCompletion(group) {
    const items = group.contentItems || [];
    return `${renderInstructions(group)}
      <ol class="sentence-completion-list" aria-label="Sentence completion questions">
        ${items.map((item) => {
          const numbers = item.questionNumbers || [];
          return `<li class="sentence-completion-item" data-questions="${numbers.join(' ')}">
            <span class="sentence-completion-text">${renderCompletionInlines(item.inlines, item.text, numbers, item.extensions?.sourceFormatting)}</span>
            ${reviewBlocksForNumbers(numbers)}
          </li>`;
        }).join('')}
      </ol>`;
  }

  /*
   * Short Answer is intentionally stricter than the generic completion
   * renderer.  Its v2 contract is a one-question/one-field closure and the
   * response must be the final typed inline.  Returning null here makes any
   * malformed or partially-adapted source fail closed in renderShortAnswer.
   */
  function shortAnswerRenderItems(group) {
    const responseIds = group.responseSlotIds || [];
    const sourceItems = group.contentItems || [];
    const runtimeItems = group.items || [];
    if (!responseIds.length || sourceItems.length !== responseIds.length || runtimeItems.length !== responseIds.length) return null;
    const seenItems = new Set();
    const seenTargets = new Set();
    const seenFields = new Set();
    const rendered = [];
    for (let index = 0; index < responseIds.length; index += 1) {
      const responseSlotId = String(responseIds[index] || '');
      const sourceItem = sourceItems[index];
      const runtimeItem = runtimeItems[index];
      const itemResponseIds = sourceItem?.responseSlotIds || [];
      const inlines = sourceItem?.inlines || [];
      const questionInline = inlines[0];
      const responseInline = inlines[1];
      const question = String(questionInline?.text || '').trim();
      const itemId = String(sourceItem?.itemId || '');
      const targetId = String(runtimeItem?.targetId || '');
      const fieldId = String(runtimeItem?.fieldId || '');
      const complete = Boolean(responseSlotId && itemId && targetId && fieldId) &&
        itemResponseIds.length === 1 && String(itemResponseIds[0]) === responseSlotId &&
        inlines.length === 2 && questionInline?.type === 'text' && responseInline?.type === 'response' &&
        String(responseInline.responseSlotId || '') === responseSlotId && question.endsWith('?') && !/[\r\n]/.test(questionInline.text || '') &&
        String(sourceItem?.text || '') === `${String(questionInline.text || '')}________` &&
        String(runtimeItem?.responseSlotId || '') === responseSlotId && String(runtimeItem?.itemId || '') === itemId &&
        runtimeItem?.targetType === 'question' && String(runtimeItem?.targetItemId || '') === itemId &&
        fieldId === String(runtimeItem?.responseFieldId || '') && Number.isFinite(runtimeItem?.number) &&
        !seenItems.has(itemId) && !seenTargets.has(targetId) && !seenFields.has(fieldId);
      if (!complete) return null;
      seenItems.add(itemId);
      seenTargets.add(targetId);
      seenFields.add(fieldId);
      const sourceRuns = Array.isArray(sourceItem.textInlines) ? sourceItem.textInlines : [];
      const sourceRunText = sourceRuns.map(({ text }) => String(text || '')).join('');
      let questionInlines = [{ style: 'text', text: question }];
      if (sourceRunText.startsWith(question)) {
        questionInlines = [];
        let remaining = question.length;
        for (const run of sourceRuns) {
          if (remaining <= 0) break;
          const runText = String(run?.text || '');
          const slice = runText.slice(0, remaining);
          if (slice) questionInlines.push({ ...run, text: slice });
          remaining -= slice.length;
        }
      }
      rendered.push({
        itemId,
        number: runtimeItem.number,
        responseSlotId,
        question,
        questionInlines,
      });
    }
    return rendered;
  }

  /* Bind the closing question mark to the final word, but leave the rest of a
   * long question free to wrap across the complete width of the pane. */
  function inlineRunsText(runs) {
    return (runs || []).map(({ text }) => String(text || '')).join('');
  }

  function clipInlineRuns(runs, start, end) {
    const clipped = [];
    let cursor = 0;
    for (const run of runs || []) {
      const text = String(run?.text || '');
      const runStart = cursor;
      const runEnd = cursor + text.length;
      cursor = runEnd;
      if (runEnd <= start || runStart >= end) continue;
      const slice = text.slice(Math.max(0, start - runStart), Math.min(text.length, end - runStart));
      if (slice) clipped.push({ ...run, text: slice });
    }
    return clipped;
  }

  function renderShortAnswerQuestion(question, questionInlines) {
    const source = String(question || '');
    const runs = inlineRunsText(questionInlines) === source
      ? questionInlines
      : [{ style: 'text', text: source }];
    const match = source.match(/^(.*\s)(\S+\?)$/u);
    return match
      ? `${renderInlineRuns(clipInlineRuns(runs, 0, match[1].length))}<span class="short-answer-question-tail">${renderInlineRuns(clipInlineRuns(runs, match[1].length, source.length))}</span>`
      : `<span class="short-answer-question-tail">${renderInlineRuns(runs)}</span>`;
  }

  function renderShortAnswer(group) {
    const items = shortAnswerRenderItems(group);
    if (!items) return renderUnknown(group);
    return `${renderInstructions(group)}
      <ol class="short-answer-list" aria-label="Short-answer questions">
        ${items.map((item) => {
          const number = item.number;
          const value = answerValueAttribute(number);
          return `<li class="${questionClasses(number, 'short-answer-item')}" data-question="${number}" tabindex="-1">
            <p class="short-answer-question-text"><span class="sr-only">Question ${number}. </span>${renderShortAnswerQuestion(item.question, item.questionInlines)}</p>
            <div class="short-answer-response-line">
              <label class="short-answer-response-label">
                <span class="sr-only">Answer for question ${number}</span>
                <input class="text-answer completion-input short-answer-input" type="text"
                  aria-label="Question ${number}, insert answer" autocomplete="off" autocapitalize="off" spellcheck="false"
                  maxlength="500" size="15" data-answer-question="${number}" data-response-slot-id="${h(item.responseSlotId)}"
                  placeholder="${number}" value="${value}" ${state.submitted ? 'disabled' : ''}>
              </label>
            </div>
            ${reviewMarkup(number)}
          </li>`;
        }).join('')}
      </ol>`;
  }

  function tableCellAttributes(cell) {
    const attributes = [
      `data-table-cell-id="${h(cell.cellId)}"`,
      cell.colSpan > 1 ? `colspan="${cell.colSpan}"` : '',
      cell.rowSpan > 1 ? `rowspan="${cell.rowSpan}"` : '',
      cell.kind === 'header' && cell.scope && cell.scope !== 'none' ? `scope="${h(cell.scope)}"` : '',
    ];
    return attributes.filter(Boolean).join(' ');
  }

  function renderTableCompletion(group) {
    const table = group.table;
    if (!table) return renderUnknown(group);
    const itemsById = new Map((group.contentItems || []).map((item) => [item.itemId, item]));
    const captionId = `${group.id}-table-caption`;
    const caption = table.caption || `Questions ${group.range}`;
    const visibleCaptionClass = table.caption ? 'table-completion-caption' : 'sr-only';
    const rowIndexById = new Map(table.rows.map((row, index) => [row.rowId, index]));
    const renderRow = (row) => {
      const rowIndex = rowIndexById.get(row.rowId);
      const joinsPrevious = row.extensions?.tablePresentation?.topBorder === 'none';
      const joinsNext = table.rows[rowIndex + 1]?.extensions?.tablePresentation?.topBorder === 'none';
      const rowClasses = [joinsPrevious ? 'table-row-joined-previous' : '', joinsNext ? 'table-row-joined-next' : ''].filter(Boolean).join(' ');
      return `<tr class="${rowClasses}" data-table-row-id="${h(row.rowId)}">
      ${row.cells.map((cell) => {
        const tag = cell.kind === 'header' ? 'th' : 'td';
        const item = cell.itemId ? itemsById.get(cell.itemId) : null;
        const numbers = item?.questionNumbers || [];
        const content = item
          ? renderCompletionInlines(item.inlines, item.text, numbers, item.extensions?.sourceFormatting)
          : h(cell.text || '');
        return `<${tag} ${tableCellAttributes(cell)} data-questions="${numbers.join(' ')}">${content}</${tag}>`;
      }).join('')}
    </tr>`;
    };
    const headerRows = [];
    const bodyRows = [];
    let inLeadingColumnHeaders = true;
    table.rows.forEach((row) => {
      const isColumnHeaderRow = inLeadingColumnHeaders && row.cells.every((cell) =>
        cell.kind === 'header' && (cell.scope === 'column' || cell.scope === 'colgroup'));
      if (isColumnHeaderRow) headerRows.push(row);
      else {
        inLeadingColumnHeaders = false;
        bodyRows.push(row);
      }
    });
    const widthSum = table.columnWidths.reduce((sum, width) => sum + width, 0);
    const colgroup = table.columnWidths.length === table.columnCount && widthSum > 0
      ? `<colgroup>${table.columnWidths.map((width) => `<col style="width:${(width / widthSum) * 100}%">`).join('')}</colgroup>`
      : '';
    return `${renderInstructions(group)}
      <div class="table-completion-scroll" role="region" aria-labelledby="${h(captionId)}" tabindex="0">
        <table class="table-completion-table" data-column-count="${table.columnCount}">
          <caption id="${h(captionId)}" class="${visibleCaptionClass}">${h(caption)}</caption>
          ${colgroup}
          ${headerRows.length ? `<thead>${headerRows.map(renderRow).join('')}</thead>` : ''}
          <tbody>${bodyRows.map(renderRow).join('')}</tbody>
        </table>
      </div>
      <div class="table-completion-reviews">${reviewBlocksForNumbers(group.questionNumbers || [])}</div>`;
  }

  function renderFlowChartCompletion(group) {
    const chart = group.flowChart;
    if (!chart || chart.orientation !== 'vertical' || !['linear', 'branched'].includes(chart.topology)) return renderUnknown(group);
    const nodesById = new Map((chart.nodes || []).map((node) => [node.nodeId, node]));
    const itemsById = new Map((group.contentItems || []).map((item) => [item.itemId, item]));
    const edgesByTransition = new Map((chart.edges || []).map((edge) => [
      `${edge.fromNodeId}\u0000${edge.toNodeId}`,
      edge,
    ]));
    const orderedNodes = (chart.readingOrder || []).map((nodeId) => nodesById.get(nodeId)).filter(Boolean);
    if (orderedNodes.length !== (chart.nodes || []).length) return renderUnknown(group);
    const titleId = `${group.id}-flow-chart-title`;
    const nodeState = (numbers) => {
      if (!numbers.length) return '';
      if (!state.submitted) return numbers.some(isAnswered) ? 'is-answered' : '';
      const statuses = numbers.map(answerStatus);
      if (statuses.every((status) => status === 'correct')) return 'is-correct';
      if (statuses.every((status) => status === 'unanswered')) return 'is-unanswered';
      return 'is-incorrect';
    };
    const renderNode = (node, accessiblePrefix) => {
      const item = node.itemId ? itemsById.get(node.itemId) : null;
      const numbers = item?.questionNumbers || [];
      const stateClasses = [nodeState(numbers), numbers.includes(Number(state.currentQuestion)) ? 'is-current' : ''].filter(Boolean).join(' ');
      const content = item
        ? renderCompletionInlines(item.inlines, item.text, numbers)
        : h(node.text || '');
      const accessibleText = [accessiblePrefix, item?.text || node.text].filter(Boolean).join('. ');
      return `<div class="flow-chart-node flow-chart-node-${h(node.kind)} ${stateClasses}" data-flow-node-id="${h(node.nodeId)}" data-questions="${numbers.join(' ')}"
        ${accessibleText ? `aria-label="${h(accessibleText)}"` : ''}
        ${numbers.length && state.submitted && fullReviewEnabled() ? `data-review-state="${numbers.every((number) => answerStatus(number) === 'correct') ? 'correct' : numbers.every((number) => answerStatus(number) === 'unanswered') ? 'unanswered' : 'incorrect'}"` : ''}>${content}</div>`;
    };
    const renderLinear = () => {
      const isCompleteChain = orderedNodes.every((node, index) => {
        const nextNode = orderedNodes[index + 1];
        return !nextNode || edgesByTransition.has(`${node.nodeId}\u0000${nextNode.nodeId}`);
      });
      if (!isCompleteChain) return '';
      return `<ol class="flow-chart-list flow-chart-linear-list" aria-label="${h(chart.title || 'Flow chart')}">
        ${orderedNodes.map((node, index) => {
          const nextNode = orderedNodes[index + 1];
          const edge = nextNode ? edgesByTransition.get(`${node.nodeId}\u0000${nextNode.nodeId}`) : null;
          return `<li class="flow-chart-step">${renderNode(node)}
            ${nextNode ? `<div class="flow-chart-connector" data-flow-edge-id="${h(edge?.edgeId || '')}" aria-hidden="true">⬇︎</div>` : ''}
          </li>`;
        }).join('')}
      </ol>`;
    };
    const renderBranched = () => {
      const outgoing = new Map((chart.nodes || []).map((node) => [node.nodeId, []]));
      (chart.edges || []).forEach((edge) => outgoing.get(edge.fromNodeId)?.push(edge));
      const origin = orderedNodes.find((node) => (outgoing.get(node.nodeId) || []).filter((edge) => edge.kind === 'branch').length === 2);
      if (!origin) return '';
      const originIndex = orderedNodes.indexOf(origin);
      const trunk = orderedNodes.slice(0, originIndex + 1);
      const branchEdges = (outgoing.get(origin.nodeId) || []).filter((edge) => edge.kind === 'branch');
      const terminalIds = new Set(branchEdges.map((edge) => edge.toNodeId));
      const terminals = orderedNodes.filter((node) => terminalIds.has(node.nodeId));
      const branchEdgeByTerminal = new Map(branchEdges.map((edge) => [edge.toNodeId, edge]));
      const validTrunk = trunk.every((node, index) => {
        const nextNode = trunk[index + 1];
        return !nextNode || edgesByTransition.has(`${node.nodeId}\u0000${nextNode.nodeId}`);
      });
      if (!validTrunk || terminals.length !== 2) return '';
      return `<div class="flow-chart-branched" aria-label="${h(chart.title || 'Branched flow chart')}">
        <ol class="flow-chart-list flow-chart-trunk">
          ${trunk.map((node, index) => {
            const nextNode = trunk[index + 1];
            const edge = nextNode ? edgesByTransition.get(`${node.nodeId}\u0000${nextNode.nodeId}`) : null;
            return `<li class="flow-chart-step">${renderNode(node)}
              ${nextNode ? `<div class="flow-chart-connector" data-flow-edge-id="${h(edge?.edgeId || '')}" aria-hidden="true">⬇︎</div>` : ''}
            </li>`;
          }).join('')}
        </ol>
        <div class="flow-chart-branch-connector" aria-hidden="true">
          <span class="flow-chart-branch-stem"></span>
          <span class="flow-chart-branch-bar"></span>
          ${terminals.map((node, index) => `<span class="flow-chart-branch-arm flow-chart-branch-arm-${index === 0 ? 'left' : 'right'}" data-flow-edge-id="${h(branchEdgeByTerminal.get(node.nodeId)?.edgeId || '')}"><span class="flow-chart-branch-arrowhead"></span></span>`).join('')}
        </div>
        <div class="flow-chart-branch-terminals" role="group" aria-label="Two outcomes from ${h(origin.text || 'the preceding step')}">
          ${terminals.map((node) => `<div class="flow-chart-branch-terminal">${renderNode(node, origin.text || '')}</div>`).join('')}
        </div>
      </div>`;
    };
    const chartMarkup = chart.topology === 'linear' ? renderLinear() : renderBranched();
    if (!chartMarkup) return renderUnknown(group);
    return `${renderInstructions(group)}
      <section class="flow-chart-completion" role="group" aria-labelledby="${h(titleId)}">
        <h3 class="flow-chart-title" id="${h(titleId)}">${h(chart.title || `Questions ${group.range}`)}</h3>
        ${chartMarkup}
      </section>
      <div class="flow-chart-reviews">${reviewBlocksForNumbers(group.questionNumbers || [])}</div>`;
  }

  function safePngDataUri(asset) {
    const data = String(asset?.data || '').replace(/\s+/g, '');
    if (asset?.mediaType !== 'image/png' || asset?.encoding !== 'base64' ||
        !data.startsWith('iVBORw0KGgo') || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return '';
    return `data:image/png;base64,${data}`;
  }

  function diagramCoordinate(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
  }

  function diagramBoxStyle(box) {
    const x = diagramCoordinate(box?.x);
    const y = diagramCoordinate(box?.y);
    const width = diagramCoordinate(box?.width);
    const height = diagramCoordinate(box?.height);
    if ([x, y, width, height].includes(null) || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) return '';
    const percent = (value) => `${(value * 100).toFixed(5)}%`;
    return `left:${percent(x)};top:${percent(y)};width:${percent(width)};height:${percent(height)}`;
  }

  function diagramLeaderMarkup(line) {
    if (line?.presentation === 'asset-baked') return '';
    if (line?.presentation !== 'overlay') return null;
    const points = (line.points || []).map((point) => ({
      x: diagramCoordinate(point?.x),
      y: diagramCoordinate(point?.y),
    }));
    if (points.length < 2 || points.some((point) => point.x === null || point.y === null)) return null;
    const value = points.map((point) => `${point.x},${point.y}`).join(' ');
    return `<polyline data-diagram-leader-id="${h(line.lineId)}" points="${h(value)}" />`;
  }

  function diagramBlankMarkup(number, anchor, callout) {
    const value = answerValueAttribute(number);
    return `<label class="${questionClasses(number, 'inline-question diagram-inline-answer-label')}"
      data-question="${number}" data-diagram-anchor-id="${h(anchor.anchorId)}">
      <input class="text-answer completion-input diagram-answer" type="text"
        aria-label="Question ${number}, ${h(callout.spatialDescription)}. Insert answer"
        autocomplete="off" autocapitalize="off" spellcheck="false"
        maxlength="500" data-answer-question="${number}" placeholder="${number}" value="${value}"
        ${state.submitted ? 'disabled' : ''}>
    </label>`;
  }

  function renderDiagramCalloutInlines(callout, anchorByResponse, numberByResponse) {
    let output = '';
    for (let index = 0; index < callout.inlines.length; index += 1) {
      const inline = callout.inlines[index];
      if (inline?.type === 'text') {
        output += `<span class="diagram-callout-text" aria-hidden="true">${h(inline.text || '')}</span>`;
        continue;
      }
      if (inline?.type !== 'response') return null;
      const anchor = anchorByResponse.get(inline.responseSlotId);
      const number = numberByResponse.get(inline.responseSlotId);
      if (!anchor || !Number.isFinite(number)) return null;
      const blank = diagramBlankMarkup(number, anchor, callout);
      const following = callout.inlines[index + 1];
      if (following?.type === 'text') {
        const { tail, remainder } = splitLeadingCompletionTail(following.text || '');
        if (tail) {
          output += `<span class="completion-answer-tail">${blank}<span aria-hidden="true">${h(tail)}</span></span>` +
            `<span class="diagram-callout-text" aria-hidden="true">${h(remainder)}</span>`;
          index += 1;
          continue;
        }
      }
      output += blank;
    }
    return output;
  }

  function renderDiagramLabelling(group) {
    const diagram = group.diagram;
    const asset = (group.assets || []).find((candidate) => candidate.assetId === diagram?.assetId);
    const imageUri = safePngDataUri(asset);
    const readingOrder = diagram?.readingOrder || [];
    const expectedResponseIds = new Set(group.responseSlotIds || []);
    const calloutById = new Map((diagram?.callouts || []).map((callout) => [callout.calloutId, callout]));
    const anchorById = new Map((diagram?.anchors || []).map((anchor) => [anchor.anchorId, anchor]));
    const orderedAnchors = readingOrder.map((anchorId) => anchorById.get(anchorId));
    const anchorByResponse = new Map((diagram?.anchors || []).map((anchor) => [anchor.responseSlotId, anchor]));
    const orderedCalloutIds = [...new Set(orderedAnchors.filter(Boolean).map((anchor) => anchor.calloutId))];
    const orderedCallouts = orderedCalloutIds.map((calloutId) => calloutById.get(calloutId));
    const responseOrderFromCallouts = orderedCallouts.flatMap((callout) => (callout?.inlines || [])
      .filter((inline) => inline?.type === 'response').map((inline) => inline.responseSlotId));
    const responseOrderFromAnchors = orderedAnchors.filter(Boolean).map((anchor) => anchor.responseSlotId);
    const anchorsMatchCallouts = orderedAnchors.filter(Boolean).every((anchor) => {
      const callout = calloutById.get(anchor.calloutId);
      return Boolean(callout) && (callout.inlines || []).some((inline) =>
        inline?.type === 'response' && inline.responseSlotId === anchor.responseSlotId);
    });
    const runtimeItemByResponse = new Map(group.items.map((item) => [item.responseSlotId, item]));
    const anchorsMatchTargets = orderedAnchors.filter(Boolean).every((anchor) => {
      const item = runtimeItemByResponse.get(anchor.responseSlotId);
      return item?.anchorId === anchor.anchorId && item?.assetId === diagram.assetId;
    });
    const pointsAreValid = (diagram?.anchors || []).every((anchor) =>
      diagramCoordinate(anchor.featurePoint?.x) !== null && diagramCoordinate(anchor.featurePoint?.y) !== null);
    const boxesAreValid = (diagram?.callouts || []).every((callout) => Boolean(diagramBoxStyle(callout.box))) &&
      (diagram?.fixedLabels || []).every((label) => Boolean(diagramBoxStyle(label.box)));
    const leaderMarkup = (diagram?.callouts || []).flatMap((callout) => callout.leaderLines || []).map(diagramLeaderMarkup);
    const presentationsAreValid = !leaderMarkup.includes(null) && (diagram?.fixedLabels || [])
      .every((label) => ['asset-baked', 'overlay'].includes(label.presentation));
    const isComplete = diagram?.coordinateSpace === 'normalized' && imageUri && asset?.alt && asset?.longDescription &&
      Number.isInteger(asset?.width) && asset.width > 0 && Number.isInteger(asset?.height) && asset.height > 0 &&
      readingOrder.length === expectedResponseIds.size && new Set(readingOrder).size === readingOrder.length &&
      orderedAnchors.every(Boolean) && anchorById.size === expectedResponseIds.size && anchorByResponse.size === expectedResponseIds.size &&
      responseOrderFromAnchors.every((responseSlotId) => expectedResponseIds.has(responseSlotId)) &&
      responseOrderFromAnchors.join('\u0000') === responseOrderFromCallouts.join('\u0000') &&
      orderedCallouts.every(Boolean) && orderedCalloutIds.length === calloutById.size && anchorsMatchCallouts && anchorsMatchTargets &&
      pointsAreValid && boxesAreValid && presentationsAreValid;
    if (!isComplete) return renderUnknown(group);

    const numberByResponse = new Map(group.items.map((item) => [item.responseSlotId, item.number]));
    const titleId = `${group.id}-diagram-title`;
    const figureTitleId = `${group.id}-diagram-figure-title`;
    const descriptionId = `${group.id}-diagram-description`;
    const fixedLabels = (diagram.fixedLabels || []).map((label) => {
      if (label.presentation === 'asset-baked') return '';
      return `<span class="diagram-fixed-label" style="${diagramBoxStyle(label.box)}">${h(label.text)}</span>`;
    }).join('');
    const renderedCallouts = orderedCallouts.map((callout) => {
      const responseIds = callout.inlines.filter((inline) => inline?.type === 'response').map((inline) => inline.responseSlotId);
      const numbers = responseIds.map((responseSlotId) => numberByResponse.get(responseSlotId)).filter(Number.isFinite);
      const inlines = renderDiagramCalloutInlines(callout, anchorByResponse, numberByResponse);
      if (inlines === null || numbers.length !== responseIds.length || !callout.spatialDescription) return null;
      return `<div class="diagram-callout" data-diagram-callout-id="${h(callout.calloutId)}"
        data-questions="${numbers.join(' ')}" style="${diagramBoxStyle(callout.box)}">${inlines}</div>`;
    });
    if (renderedCallouts.includes(null)) return renderUnknown(group);
    const callouts = renderedCallouts.join('');

    return `${renderInstructions(group)}
      <section class="diagram-labelling" role="group" aria-labelledby="${h(titleId)}">
        <h3 class="sr-only" id="${h(titleId)}">Diagram labelling questions ${h(group.range)}</h3>
        <div class="diagram-viewport" data-annotation-exclude="true" role="region"
          aria-label="Scrollable diagram for questions ${h(group.range)}" tabindex="0">
          <figure class="diagram-scene" data-annotation-exclude="true"
            role="group" aria-labelledby="${h(figureTitleId)}" aria-describedby="${h(descriptionId)}"
            style="--diagram-aspect:${asset.width} / ${asset.height}">
            <figcaption class="sr-only" id="${h(figureTitleId)}">${h(asset.alt)}</figcaption>
            <p class="sr-only" id="${h(descriptionId)}">${h(asset.longDescription)}</p>
            <img class="diagram-base-image" src="${h(imageUri)}" alt="" aria-hidden="true" draggable="false">
            <svg class="diagram-leader-overlay" viewBox="0 0 1 1"
              preserveAspectRatio="none" aria-hidden="true" focusable="false">${leaderMarkup.join('')}</svg>
            ${fixedLabels}${callouts}
          </figure>
        </div>
      </section>
      <div class="diagram-labelling-reviews">${reviewBlocksForNumbers(group.questionNumbers || [])}</div>`;
  }

  function renderUnknown(group) {
    return `${renderInstructions(group)}<p class="source-warning">This source question type could not be rendered.</p>`;
  }

  const QUESTION_RENDERERS = Object.freeze({
    tfng: renderTfng,
    'single-choice': renderSingleChoice,
    'matching-headings': renderMatchingHeadings,
    'matching-grid': renderMatchingGrid,
    'matching-endings': renderMatchingSentenceEndings,
    'summary-option-bank': renderSummaryOptionBank,
    'choice-set': renderChoiceSet,
    'sentence-completion': renderSentenceCompletion,
    'short-answer': renderShortAnswer,
    'table-completion': renderTableCompletion,
    'flow-chart-completion': renderFlowChartCompletion,
    'diagram-labelling': renderDiagramLabelling,
    completion: renderCompletion,
  });

  function renderQuestionGroup(group) {
    const definition = typeDefinition(group);
    const renderer = definition && QUESTION_RENDERERS[definition.rendererId];
    const content = renderer ? renderer(group) : renderUnknown(group);
    const rendererClass = definition?.rendererId || 'unknown';
    return `<section class="question-group question-group-${h(rendererClass)}" id="${h(group.id)}" data-group-id="${h(group.id)}" data-question-type="${h(group.questionType)}" data-question-range="${h(group.range)}">
      <h2 class="question-group-title">${h(group.heading || `Questions ${group.range}`)}</h2>${content}
    </section>`;
  }

  function renderPassageMatchingTarget(part, paragraph, paragraphIndex) {
    if (!part) return '';
    const group = part.groups.find((candidate) => typeDefinition(candidate)?.passageTargets);
    const hasExplicitBlockTargets = Boolean(group?.items.some((candidate) => candidate.blockId));
    const item = group && (hasExplicitBlockTargets
      ? group.items.find((candidate) => candidate.blockId === paragraph.blockId)
      : group.items[paragraphIndex]);
    if (!group || !item) return '';
    const selectedId = answerForQuestion(item.number);
    const selectedHeading = matchingOption(group, selectedId);
    return `<div class="${questionClasses(item.number, 'passage-matching-target')}" data-question="${item.number}" data-heading-group="${h(group.id)}" tabindex="-1">
      <div class="drop-zone ${selectedHeading ? 'has-answer' : ''}" data-drop-question="${item.number}" data-heading-group="${h(group.id)}" tabindex="${state.submitted ? '-1' : '0'}" role="button" aria-label="Answer area for ${h(item.prompt)}${selectedHeading ? `. ${h(selectedHeading.text)}` : '. Empty'}">
        ${selectedHeading ? renderHeadingToken(selectedHeading, item.number) : `<span class="gap-order-number">${item.number}</span>`}
      </div>
    </div>`;
  }

  function passageLabelKind(paragraph) {
    if (paragraph?.role === 'section' || paragraph?.role === 'section-continuation') return 'section';
    if (paragraph?.role === 'paragraph' || paragraph?.role === 'paragraph-continuation') return 'paragraph';
    return /^sections?\b/i.test(String(paragraph?.label || '').trim()) ? 'section' : 'paragraph';
  }

  function passageLabelAccessibleName(label, kind) {
    const trimmed = String(label || '').trim();
    if (!trimmed) return '';
    if (/^(?:section|paragraph)\b/i.test(trimmed)) return trimmed;
    return `${kind === 'section' ? 'Section' : 'Paragraph'} ${trimmed}`;
  }

  function renderPassage(options) {
    const part = partModel(state.part);
    if (!part || !els.passageContent) return;
    const restorePersistentEvidence = t36PersistentEvidenceShouldRender();
    t36EvidenceRenderEpoch += 1;
    t36ClearActiveEvidenceCue();
    t36ClearPersistentEvidenceOverview({ preserveLayout: restorePersistentEvidence });
    const preserveScroll = options && options.preserveScroll;
    const previousScroll = preserveScroll && els.passagePane ? els.passagePane.scrollTop : 0;
    const translationBinding = reviewTranslationBinding(part);
    els.passageContent.classList.toggle('is-matching-part', part.groups.some((group) => typeDefinition(group)?.passageTargets));
    const passageTitle = part.titleVisible === false ? '' : `<h2 data-review-translation-source-unit="title">${h(part.title)}</h2>${renderReviewTranslationUnit(translationBinding, 'title')}`;
    const passageLead = part.lead ? `<p class="passage-lead" data-review-translation-source-unit="lead">${h(part.lead)}</p>${renderReviewTranslationUnit(translationBinding, 'lead')}` : '';
    const passageHeader = passageTitle || passageLead
      ? `<header class="passage-header">${passageTitle}${passageLead}</header>`
      : '';
    els.passageContent.innerHTML = `
      ${passageHeader}
      <div class="passage-body">${part.paragraphs.map((paragraph, index) => {
        const unitId = `block:${paragraph.blockId}`;
        if (paragraph.role === 'source-title') {
          return `<h3 class="passage-source-title" data-passage-paragraph="${index + 1}"
            data-review-translation-source-unit="${h(unitId)}" data-review-translation-block-id="${h(paragraph.blockId)}">${renderSourceFormattedText(paragraph.text, paragraph.extensions?.sourceFormatting)}</h3>
            ${renderReviewTranslationUnit(translationBinding, unitId)}`;
        }
        const label = String(paragraph.label || '').trim();
        const labelKind = passageLabelKind(paragraph);
        const labelContinuation = paragraph.role === 'section-continuation' || paragraph.role === 'paragraph-continuation';
        const hasLabelColumn = Boolean(label) || labelContinuation;
        const labelMarkup = label
          ? `<strong class="paragraph-label paragraph-label-${labelKind}" aria-label="${h(passageLabelAccessibleName(label, labelKind))}">${h(label)}</strong>`
          : '';
        return `
          ${renderPassageMatchingTarget(part, paragraph, index)}
          <p class="passage-paragraph ${hasLabelColumn ? 'has-passage-label' : ''} ${labelContinuation ? 'passage-label-continuation' : ''} ${paragraph.role === 'standfirst' ? 'passage-standfirst' : ''}" data-passage-paragraph="${index + 1}"
            data-review-translation-source-unit="${h(unitId)}" data-review-translation-block-id="${h(paragraph.blockId)}"${hasLabelColumn ? ` data-label-kind="${labelKind}"` : ''}>
            ${labelMarkup}<span class="passage-paragraph-text">${renderPassageBlockText(paragraph.text, paragraph.extensions?.sourceFormatting)}</span>
          </p>${renderReviewTranslationUnit(translationBinding, unitId)}`;
      }).join('')}
      </div>
      ${(part.footnotes || []).length ? `<div class="passage-footnotes">${part.footnotes.map((footnote) => {
        const unitId = `block:${footnote.blockId}`;
        return `<p data-review-translation-source-unit="${h(unitId)}" data-review-translation-block-id="${h(footnote.blockId)}">${renderSourceFormattedText(footnote.text || footnote, footnote.extensions?.sourceFormatting)}</p>${renderReviewTranslationUnit(translationBinding, unitId)}`;
      }).join('')}</div>` : ''}`;
    mountQuestionFlags(els.passageContent, 'passage');
    applyAnnotations('passage');
    if (preserveScroll && els.passagePane) els.passagePane.scrollTop = previousScroll;
    if (restorePersistentEvidence) t36SchedulePersistentEvidenceRefresh('passage-render');
  }

  function renderQuestions(options) {
    const part = partModel(state.part);
    if (!part || !els.questionsContent) return;
    const preserveScroll = options && options.preserveScroll;
    const previousScroll = preserveScroll && els.questionsPane ? els.questionsPane.scrollTop : 0;
    els.questionsContent.innerHTML = part.groups.map(renderQuestionGroup).join('');
    mountQuestionFlags(els.questionsContent, 'questions');
    applyAnnotations('questions');
    if (preserveScroll && els.questionsPane) els.questionsPane.scrollTop = previousScroll;
    updateCurrentQuestionStyles();
    scheduleSentenceEndingGeometry();
  }

  function syncSentenceEndingGeometry() {
    endingGeometryFrame = 0;
    if (!els.questionsContent) return;
    els.questionsContent.querySelectorAll('.question-group-matching-endings').forEach((group) => {
      group.style.removeProperty('--ending-choice-height');
      const tokens = [...group.querySelectorAll('.ending-bank .ending-token')];
      const maxTokenHeight = tokens.reduce((height, token) => Math.max(height, token.offsetHeight), 0);
      if (maxTokenHeight) group.style.setProperty('--ending-choice-height', `${maxTokenHeight}px`);
    });
  }

  function scheduleSentenceEndingGeometry() {
    window.cancelAnimationFrame(endingGeometryFrame);
    endingGeometryFrame = window.requestAnimationFrame(syncSentenceEndingGeometry);
  }

  function renderPartIntro() {
    const part = partModel(state.part);
    if (!part) return;
    if (els.partTitle) els.partTitle.textContent = `Part ${part.number}`;
    if (els.partInstruction) els.partInstruction.textContent = part.instruction;
    if (els.reviewCompactPart) els.reviewCompactPart.textContent = `Part ${part.number}`;
  }

  function fullscreenAvailable() {
    return typeof document.documentElement?.requestFullscreen === 'function' &&
      typeof document.exitFullscreen === 'function' && document.fullscreenEnabled !== false;
  }

  function syncFullscreenButton() {
    const available = fullscreenAvailable();
    const active = Boolean(document.fullscreenElement);
    if (els.partFullscreenHost) els.partFullscreenHost.hidden = !available;
    if (els.reviewCompactFullscreenHost) els.reviewCompactFullscreenHost.hidden = !available;
    if (!els.fullscreenButton) return;
    els.fullscreenButton.hidden = !available;
    els.fullscreenButton.disabled = Boolean(fullscreenBusy);
    const label = active ? '退出全屏' : '进入全屏';
    els.fullscreenButton.setAttribute('aria-label', label);
    els.fullscreenButton.title = label;
    if (els.fullscreenIcon) {
      els.fullscreenIcon.classList.toggle('fa-expand', !active);
      els.fullscreenIcon.classList.toggle('fa-compress', active);
    }
  }

  function syncFullscreenPlacement() {
    if (!els.fullscreenButton) return;
    const target = state.submitted && reviewOverviewCollapsed
      ? els.reviewCompactFullscreenHost
      : els.partFullscreenHost;
    if (target && els.fullscreenButton.parentElement !== target) {
      const restoreFocus = document.activeElement === els.fullscreenButton;
      target.appendChild(els.fullscreenButton);
      if (restoreFocus) window.requestAnimationFrame(() => els.fullscreenButton?.focus({ preventScroll: true }));
    }
    syncFullscreenButton();
    t35SyncReviewUtilityPlacement();
  }

  async function toggleFullscreen() {
    if (fullscreenBusy || !fullscreenAvailable()) return;
    fullscreenBusy = true;
    syncFullscreenButton();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (_error) {
      announceStatus(document.fullscreenElement
        ? '暂时无法退出全屏，请按 Esc 重试。'
        : '暂时无法进入全屏，请继续使用当前界面。');
    } finally {
      fullscreenBusy = false;
      syncFullscreenButton();
    }
  }

  function handleFullscreenChange() {
    syncFullscreenPlacement();
    window.requestAnimationFrame(() => {
      syncAppPanRange();
      positionSelectionMenu();
      positionNoteEditor();
      scheduleSentenceEndingGeometry();
    });
  }

  function syncReviewOverviewLayout() {
    const collapsed = Boolean(state.submitted && reviewOverviewCollapsed);
    els.app?.classList.toggle('is-review-overview-collapsed', collapsed);
    if (els.reviewCompactBar) els.reviewCompactBar.hidden = !collapsed;
    [els.partIntro, els.reviewBanner].filter(Boolean).forEach((element) => {
      element.inert = collapsed;
      if (collapsed) element.setAttribute('aria-hidden', 'true');
      else element.removeAttribute('aria-hidden');
    });
    if (els.reviewCollapseButton) els.reviewCollapseButton.setAttribute('aria-expanded', String(!collapsed));
    if (els.reviewExpandButton) els.reviewExpandButton.setAttribute('aria-expanded', String(!collapsed));
    syncFullscreenPlacement();
    window.requestAnimationFrame(syncAppPanRange);
  }

  function setReviewOverviewCollapsed(collapsed) {
    if (!state.submitted) return;
    const nextCollapsed = Boolean(collapsed);
    if (reviewOverviewCollapsed === nextCollapsed) return;
    const passageScrollTop = els.passagePane?.scrollTop || 0;
    const questionsScrollTop = els.questionsPane?.scrollTop || 0;
    reviewOverviewCollapsed = nextCollapsed;
    syncReviewOverviewLayout();
    window.requestAnimationFrame(() => {
      if (els.passagePane) els.passagePane.scrollTop = passageScrollTop;
      if (els.questionsPane) els.questionsPane.scrollTop = questionsScrollTop;
      positionSelectionMenu();
      positionNoteEditor();
      scheduleSentenceEndingGeometry();
      const focusTarget = reviewOverviewCollapsed ? els.reviewExpandButton : els.reviewCollapseButton;
      focusTarget?.focus({ preventScroll: true });
    });
    announceStatus(reviewOverviewCollapsed
      ? '顶部 Part 信息与复盘概览已收起。'
      : '顶部 Part 信息与复盘概览已展开。');
  }

  function renderPartNavigationShell() {
    if (!els.partNav) return;
    els.partNav.innerHTML = model.parts.map((part) => {
      const partNumber = Number(part.number);
      const isCurrent = partNumber === state.part;
      const total = questionsForPart(partNumber).length;
      return `<section class="part-block ${isCurrent ? 'is-current' : ''}" data-part="${partNumber}" aria-label="Part ${partNumber}">
        <span class="question-flag-nav part-flag-summary" data-part-flag-summary="${partNumber}" data-annotation-exclude="true" aria-hidden="true" hidden>${questionFlagIcon()}</span>
        <button class="part-tab" type="button" data-part="${partNumber}" ${isCurrent ? 'aria-current="step"' : ''}>
          <span class="part-tab-label">Part ${partNumber}</span>
          <span class="part-progress" data-progress-for="${partNumber}" ${isCurrent ? 'hidden' : ''}>0 of ${total}</span>
        </button>
        <ol id="part-${partNumber}-question-nav" class="question-nav" aria-label="Part ${partNumber} questions" ${isCurrent ? '' : 'hidden'}></ol>
      </section>`;
    }).join('');
  }

  function renderFooter() {
    model.parts.forEach((part) => {
      const partNumber = Number(part.number);
      const partQuestions = questionsForPart(partNumber);
      const nav = byId(`part-${partNumber}-question-nav`);
      const block = document.querySelector(`.part-block[data-part="${partNumber}"]`);
      const tab = document.querySelector(`.part-tab[data-part="${partNumber}"]`);
      const progress = document.querySelector(`[data-progress-for="${partNumber}"]`);
      const isCurrent = partNumber === state.part;
      if (block) block.classList.toggle('is-current', isCurrent);
      if (tab) {
        if (isCurrent) tab.setAttribute('aria-current', 'step');
        else tab.removeAttribute('aria-current');
      }
      if (nav) {
        nav.hidden = !isCurrent;
        const seenGroups = new Set();
        const navItems = partQuestions.flatMap((number) => {
          const question = model.questions.get(number);
          const group = question && model.groups.get(question.groupId);
          if (group && typeDefinition(group)?.footerUnit === 'task') {
            if (seenGroups.has(group.id)) return [];
            seenGroups.add(group.id);
            const numbers = group.questionNumbers.slice();
            return [{ numbers, label: numbers.length > 1 ? `${numbers[0]}–${numbers[numbers.length - 1]}` : String(numbers[0]) }];
          }
          return [{ numbers: [number], label: String(number) }];
        });
        nav.innerHTML = navItems.map((item) => {
          const answered = item.numbers.filter(isAnswered);
          let status = answered.length ? 'answered' : 'unanswered';
          let ariaStatus = status;
          if (state.submitted && fullReviewEnabled() && answered.length) {
            const groupedQuestion = model.questions.get(item.numbers[0]);
            const group = groupedQuestion && model.groups.get(groupedQuestion.groupId);
            if (group && typeDefinition(group)?.footerUnit === 'task') {
              const evaluation = choiceSetEvaluation(group);
              status = choiceSetGroupStatus(group);
              ariaStatus = status === 'partial' ? `partially correct, ${evaluation.correct} of ${evaluation.total} marks` :
                `${status}, ${evaluation.correct} of ${evaluation.total} marks`;
            } else {
              status = answered.length === item.numbers.length && item.numbers.every(isCorrect) ? 'correct' : 'incorrect';
              ariaStatus = status;
            }
          }
          const current = item.numbers.includes(state.currentQuestion);
          const number = item.numbers[0];
          return `<li><button type="button" class="question-nav-button is-${status} ${current ? 'is-current' : ''}" data-nav-question="${number}" data-nav-questions="${item.numbers.join(' ')}" aria-label="${item.numbers.length > 1 ? 'Questions' : 'Question'} ${item.label}, ${ariaStatus}" ${current ? 'aria-current="true"' : ''}>${item.label}<span class="question-flag-nav" data-question-flag-nav="${number}" data-annotation-exclude="true" aria-hidden="true" ${isQuestionFlagged(number) ? '' : 'hidden'}>${questionFlagIcon()}</span></button></li>`;
        }).join('');
      }
      if (progress) {
        progress.textContent = `${countProgress(partNumber)} of ${partQuestions.length}`;
        progress.hidden = isCurrent;
      }
    });
    syncQuestionFlags();
    const partQuestions = questionsForPart(state.part);
    const partStart = partQuestions[0];
    const partEnd = partQuestions[partQuestions.length - 1];
    if (els.prevButton) {
      els.prevButton.disabled = state.currentQuestion === firstQuestion();
      els.prevButton.setAttribute('aria-label', state.currentQuestion === partStart && state.part !== model.parts[0]?.number ? 'Previous part' : 'Previous question');
    }
    if (els.nextButton) {
      els.nextButton.disabled = state.currentQuestion === lastQuestion();
      els.nextButton.setAttribute('aria-label', state.currentQuestion === partEnd && state.part !== model.parts[model.parts.length - 1]?.number ? 'Next part' : 'Next question');
    }
    if (els.submitButton) {
      const isReturn = Boolean(state.submitted);
      const icon = els.submitButton.querySelector('[data-submit-button-icon]');
      const label = els.submitButton.querySelector('[data-submit-button-label]');
      els.submitButton.classList.toggle('is-return', isReturn);
      els.submitButton.setAttribute('aria-label', isReturn ? '返回练习包' : 'Review your answers');
      els.submitButton.title = isReturn ? '返回练习包' : 'Review your answers';
      if (icon) {
        icon.classList.toggle('fa-check', !isReturn);
        icon.classList.toggle('fa-arrow-left', isReturn);
      }
      if (label) {
        label.hidden = !isReturn;
        label.textContent = isReturn ? '返回' : '';
      }
      if (isReturn) {
        els.submitButton.removeAttribute('aria-controls');
        els.submitButton.removeAttribute('aria-haspopup');
      } else {
        els.submitButton.setAttribute('aria-controls', 'submit-dialog');
        els.submitButton.setAttribute('aria-haspopup', 'dialog');
      }
    }
  }

  function updateCurrentQuestionStyles() {
    scheduleQuestionFlagPosition();
    [els.questionsContent, els.passageContent].filter(Boolean).forEach((container) => {
      container.querySelectorAll('[data-question]').forEach((element) => {
        const number = Number(element.dataset.question);
        element.classList.toggle('is-current', number === state.currentQuestion);
        element.classList.remove('is-answered', 'is-unanswered', 'is-correct', 'is-incorrect', 'is-partial');
        if (isAnswered(number)) element.classList.add('is-answered');
        if (state.submitted && fullReviewEnabled()) element.classList.add(`is-${answerStatus(number)}`);
      });
    });
    if (!els.questionsContent) return;
    els.questionsContent.querySelectorAll('[data-questions]').forEach((element) => {
      const numbers = String(element.dataset.questions || '').split(/\s+/).map(Number);
      element.classList.toggle('is-current', numbers.includes(state.currentQuestion));
    });
  }

  function applyPreferences() {
    scheduleQuestionFlagPosition();
    document.documentElement.style.setProperty('--practice-font-scale', String(state.fontScale));
    document.documentElement.dataset.practiceFontScale = String(state.fontScale);
    document.documentElement.style.setProperty('--passage-percent', `${state.split}%`);
    document.body.classList.toggle('is-high-contrast', state.contrastMode !== 'black-white');
    document.body.classList.toggle('contrast-white-black', state.contrastMode === 'white-black');
    document.body.classList.toggle('contrast-yellow-black', state.contrastMode === 'yellow-black');
    document.body.classList.toggle('is-reviewing', Boolean(state.submitted));
    document.body.dataset.reviewMode = reviewMode();
    document.body.dataset.t35ReviewView = state.submitted ? t35ReviewView : 'practice';
    document.body.classList.toggle('show-notes', Boolean(state.showNotes));
    document.body.classList.toggle('notes-hidden', !state.showNotes);
    if (els.app) els.app.dataset.mode = state.submitted ? 'review' : 'practice';
    if (els.passagePane) {
      els.passagePane.style.flexBasis = `calc(${state.split}% - 1px)`;
      els.passagePane.style.width = `calc(${state.split}% - 1px)`;
    }
    if (els.questionsPane) {
      els.questionsPane.style.flexBasis = `calc(${100 - state.split}% - 1px)`;
      els.questionsPane.style.width = `calc(${100 - state.split}% - 1px)`;
    }
    if (els.splitter) els.splitter.setAttribute('aria-valuenow', String(Math.round(state.split)));
    if (els.showNotesButton) {
      els.showNotesButton.setAttribute('aria-pressed', String(Boolean(state.showNotes)));
      els.showNotesButton.setAttribute('aria-label', state.showNotes ? 'Hide notes' : 'Show notes');
      els.showNotesButton.removeAttribute('title');
    }
    window.requestAnimationFrame(syncAppPanRange);
    scheduleSentenceEndingGeometry();
  }

  function reviewAccuracyBand(part) {
    if (Number(part?.completion?.answered) === 0) return 'unanswered';
    const accuracy = Number(part?.score?.accuracyPercent);
    if (!Number.isFinite(accuracy)) return 'unanswered';
    if (accuracy < 50) return 'low';
    if (accuracy < 70) return 'mid';
    if (accuracy < 85) return 'good';
    return 'high';
  }

  function renderReviewBanner() {
    if (!els.reviewBanner) return;
    els.reviewBanner.hidden = !state.submitted;
    if (!state.submitted) {
      currentReviewReport = null;
      byId('review-branding')?.remove();
      syncReviewOverviewLayout();
      return;
    }
    const result = state.result || calculateResult();
    const snapshot = runtimeIndex?.manifest?.extensions?.homeworkSnapshot || {};
    const assignmentTitle = snapshot.title || runtimeIndex?.manifest?.title || runtimeIndex?.candidate?.title || 'ZYZ 阅读练习';
    const passageTitles = model.parts.map((part, index) => String(part.title || `Passage ${index + 1}`));
    const fullPassageSelection = snapshot.schemaVersion === 'ielts-reading-homework-snapshot.v0'
      ? Array.isArray(snapshot.passages) && snapshot.passages.length === model.parts.length
      : snapshot.compositionMode === 'full-passage' && Array.isArray(snapshot.selections) &&
        snapshot.selections.length === model.parts.length && snapshot.selections.every((selection) => selection.scope === 'full');
    const ledgerRead = readAttemptLedger();
    const report = homeworkReportRuntime().createReportModel({
      assignmentTitle,
      passageTitles,
      passages: (result.partScores || []).map((part) => ({
        part: part.part,
        label: part.label,
        title: part.title,
        difficultyTier: fullPassageSelection ? part.difficultyTier : null,
        score: { earnedMarks: part.earnedMarks, availableMarks: part.availableMarks },
        completion: { answered: part.answered, total: part.total },
      })),
      score: { earnedMarks: result.earnedMarks, availableMarks: result.availableMarks },
      completion: { answered: result.answered, total: result.total },
      statusCounts: { correct: result.correct, incorrect: result.incorrect, unanswered: result.unanswered },
      startedAt: state.attemptStartedAt,
      submittedAt: state.submittedAt,
      elapsedSeconds: state.elapsedSeconds,
      partElapsedMilliseconds: state.partElapsedMilliseconds,
      partTimingComplete: state.partTimingComplete,
      shortFingerprint: String(snapshot.snapshotHash || '').slice(0, 10),
      attempt: {
        assignmentCode: attemptLedgerRuntime().assignmentCodeFromIdentity(snapshot.snapshotHash),
        attemptNumber: state.attemptNumber,
        attemptMarker: state.attemptMarker,
      },
      attemptHistory: ledgerRead.ok ? ledgerRead.ledger.history : [],
      bandContext: {
        testType: 'academic-reading',
        compositionMode: snapshot.compositionMode || 'full-passage',
        fullPassageSelection,
      },
      locale: 'zh-CN',
      timeZone: 'Asia/Shanghai',
    });
    const timer = currentTimerReport();
    currentReviewReport = Object.freeze({ ...report, timer });
    els.reviewBanner.dataset.reportSchema = report.schemaVersion;
    if (els.reviewAssignmentTitle) {
      els.reviewAssignmentTitle.textContent = report.display.assignmentTitle;
      els.reviewAssignmentTitle.title = report.display.assignmentTitle;
    }
    if (els.reviewAssignmentCode && els.reviewAssignmentCodeValue) {
      const code = report.attempt.recorded ? report.display.attemptMarker : report.display.assignmentCode;
      const knownCode = code && code !== '未记录';
      els.reviewAssignmentCode.hidden = !knownCode;
      els.reviewAssignmentCodeValue.textContent = knownCode ? code : '';
      els.reviewAssignmentCode.removeAttribute('title');
    }
    if (els.reviewScore) els.reviewScore.textContent = report.display.score;
    if (els.reviewBandMetric && els.reviewBand) {
      els.reviewBandMetric.hidden = !report.referenceBand.eligible;
      els.reviewBand.textContent = report.referenceBand.eligible ? report.display.referenceBand : '';
      els.reviewBandMetric.title = report.referenceBand.note || '';
      els.reviewBandMetric.closest('.review-metrics')?.classList.toggle('has-reference-band', report.referenceBand.eligible);
    }
    if (els.reviewAccuracy) els.reviewAccuracy.textContent = report.display.accuracy;
    if (els.reviewCompletion) els.reviewCompletion.textContent = report.display.completion;
    if (els.reviewElapsed) {
      els.reviewElapsed.textContent = report.display.elapsed;
      els.reviewElapsed.removeAttribute('title');
    }
    if (els.reviewCompactScore) els.reviewCompactScore.textContent = report.display.score;
    if (els.reviewCompactElapsed) els.reviewCompactElapsed.textContent = report.display.elapsed;
    if (els.reviewPassages) {
      els.reviewPassages.textContent = report.display.passageScope;
      els.reviewPassages.removeAttribute('title');
    }
    if (els.reviewSubmittedAt) {
      els.reviewSubmittedAt.textContent = report.display.submittedAt;
      const submittedAt = homeworkReportRuntime().sanitizeTimestamp(state.submittedAt);
      if (submittedAt === null) els.reviewSubmittedAt.removeAttribute('datetime');
      else els.reviewSubmittedAt.dateTime = new Date(submittedAt).toISOString();
    }
    if (els.reviewTimerMeta) {
      els.reviewTimerMeta.hidden = !timer;
      els.reviewTimerMeta.textContent = timer ? timer.display.summary : '';
    }
    if (els.reviewPartScores) {
      els.reviewPartScores.innerHTML = report.passages.map((part) => {
        const rawAccuracy = Number(part.score?.accuracyPercent);
        const accuracy = Number.isFinite(rawAccuracy) ? Math.min(100, Math.max(0, rawAccuracy)) : 0;
        const accuracyBand = reviewAccuracyBand(part);
        const progress = String(Math.round(accuracy * 1000) / 1000);
        const accessibleSummary = `${part.label}，得分 ${part.display.score}，正确率 ${part.display.accuracy}，用时 ${part.display.elapsed}`;
        return `<span
          class="review-part-score"
          data-difficulty="${h(part.difficultyTier || '')}"
          data-accuracy-band="${h(accuracyBand)}"
          data-accuracy="${h(progress)}"
          style="--review-progress: ${h(progress)}%;"
          title="${h(`${part.label} · ${part.title} · 得分 ${part.display.score} · 正确率 ${part.display.accuracy} · 用时 ${part.display.elapsed}`)}"
          aria-label="${h(accessibleSummary)}"
        >
          <strong class="review-part-label" aria-hidden="true">${h(part.label)}</strong>
          <strong class="review-part-score-value" aria-hidden="true">${h(part.display.score)}</strong>
          <span class="review-part-result" aria-hidden="true">
            <span class="review-part-accuracy">正确率 ${h(part.display.accuracy)}</span>
            <span class="review-part-time">${h(part.display.elapsed)}</span>
          </span>
        </span>`;
      }).join('');
    }
    renderDistributionWatermark();
    syncReviewOverviewLayout();
  }

  function homeworkReceiptCode(report) {
    if (!report) return '未记录';
    return report.attempt.recorded ? report.display.attemptMarker : report.display.assignmentCode;
  }

  function receiptDifficultyColor(tier) {
    return tier === 'easy' ? '#2f8f87' : tier === 'standard' ? '#5d8f61' : tier === 'hard' ? '#c56f2a' : '#aab4ba';
  }

  function renderHomeworkReceipt() {
    const report = currentReviewReport;
    if (!els.homeworkReceiptContent || !report) return;
    const code = homeworkReceiptCode(report);
    const comparison = report.attemptHistory.comparison;
    const bandMarkup = report.referenceBand.eligible
      ? `<div class="receipt-summary-cell"><dt>参考 Band</dt><dd>${h(report.display.referenceBand)}</dd></div>`
      : '';
    const timerMarkup = report.timer ? `<p class="receipt-band-note receipt-timer-note">${h(report.timer.display.summary)}${report.timer.clockAnomaly ? ' · 设备时间异常' : ''}</p>` : '';
    const comparisonMarkup = comparison ? `<section class="receipt-section">
      <h3>提交变化（A${comparison.baselineAttemptNumber} → A${comparison.currentAttemptNumber}）</h3>
      <div class="receipt-comparison">
        <p>得分变化<strong>${h(comparison.display.scoreDelta)}</strong></p>
        <p>正确率变化<strong>${h(comparison.display.accuracyDelta)}</strong></p>
        <p>已作答变化<strong>${h(comparison.display.answeredDelta)}</strong></p>
        <p>用时变化<strong>${h(comparison.display.elapsedDelta)}</strong></p>
      </div>
    </section>` : '';
    const historyMarkup = report.attemptHistory.rows.length ? `<section class="receipt-section">
      <h3>提交记录</h3>
      <table class="receipt-history-table">
        <thead><tr><th>记录</th><th>提交时间</th><th>得分</th><th>正确率</th><th>已作答</th><th>用时</th></tr></thead>
        <tbody>${report.attemptHistory.rows.map((row) => `<tr>
          <td>${h(row.display.record)}</td><td>${h(row.display.submittedAt)}</td><td>${h(row.display.score)}</td>
          <td>${h(row.display.accuracy)}</td><td>${h(row.display.completion)}</td><td>${h(row.display.elapsed)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </section>` : '';
    const watermark = distributionWatermarkText('review');
    const classWatermark = distributionClassWatermarkText('review');

    els.homeworkReceiptContent.innerHTML = `<dl class="receipt-summary ${report.referenceBand.eligible ? 'has-reference-band' : 'without-reference-band'}">
      <div class="receipt-summary-cell is-identity"><dt>练习</dt><dd>${h(report.display.assignmentTitle)}</dd><small>个人练习记录</small></div>
      <div class="receipt-summary-cell"><dt>得分</dt><dd>${h(report.display.score)}</dd></div>
      ${bandMarkup}
      <div class="receipt-summary-cell"><dt>正确率</dt><dd>${h(report.display.accuracy)}</dd></div>
      <div class="receipt-summary-cell"><dt>已作答</dt><dd>${h(report.display.completion)}</dd></div>
      <div class="receipt-summary-cell"><dt>总用时</dt><dd>${h(report.display.elapsed)}</dd></div>
    </dl>
    <section class="receipt-section">
      <h3>分篇结果</h3>
      <ul class="receipt-passage-list">${report.passages.map((part) => `<li class="receipt-passage-row" data-difficulty="${h(part.difficultyTier || '')}">
        <strong>${h(part.label)}</strong><span class="receipt-passage-title">${h(part.title)}</span>
        <span class="receipt-passage-stat">得分 ${h(part.display.score)}</span>
        <span class="receipt-passage-stat">正确率 ${h(part.display.accuracy)}</span>
        <span class="receipt-passage-stat">已作答 ${h(part.display.completion)}</span>
        <span class="receipt-passage-stat">用时 ${h(part.display.elapsed)}</span>
      </li>`).join('')}</ul>
    </section>
    ${comparisonMarkup}
    ${historyMarkup}
    <p class="receipt-band-note">提交：${h(report.display.submittedAt)} · ${h(report.display.status)}${report.referenceBand.eligible ? `。${h(report.referenceBand.note)}` : ''}</p>
    ${timerMarkup}
    ${watermark ? `<p class="receipt-band-note receipt-copyright">${h(watermark)}</p>` : ''}
    ${classWatermark ? `<p class="receipt-band-note receipt-class-watermark">${h(classWatermark)}</p>` : ''}`;
  }

  function openHomeworkReceipt() {
    if (!state.submitted || !currentReviewReport || !els.homeworkReceiptDialog) return;
    closeOptions();
    closeMessages();
    closeSelectionMenu();
    renderHomeworkReceipt();
    lastFocusedBeforeOverlay = document.activeElement;
    setBackgroundInert(true);
    els.homeworkReceiptDialog.hidden = false;
    els.homeworkReceiptDialog.classList.add('is-open');
    document.body.classList.add('has-dialog');
    els.closeHomeworkReceiptButton?.focus();
  }

  function closeHomeworkReceipt() {
    if (!els.homeworkReceiptDialog || els.homeworkReceiptDialog.hidden) return false;
    els.homeworkReceiptDialog.hidden = true;
    els.homeworkReceiptDialog.classList.remove('is-open');
    document.body.classList.remove('has-dialog');
    setBackgroundInert(false);
    if (lastFocusedBeforeOverlay instanceof HTMLElement) lastFocusedBeforeOverlay.focus();
    return true;
  }

  function homeworkReceiptText() {
    const report = currentReviewReport;
    if (!report) return '';
    const lines = [
      '练习小结',
      `练习：${report.display.assignmentTitle}`,
      `提交：${report.display.submittedAt}`,
      `得分：${report.display.score}`,
      ...(report.referenceBand.eligible ? [`参考 Band：${report.display.referenceBand}`] : []),
      `正确率：${report.display.accuracy}`,
      `已作答：${report.display.completion}`,
      `总用时：${report.display.elapsed}`,
      `题目状态：${report.display.status}`,
      '',
      '分篇结果',
      ...report.passages.map((part) => `${part.label} · ${part.title} · 得分 ${part.display.score} · 正确率 ${part.display.accuracy} · 已作答 ${part.display.completion} · 用时 ${part.display.elapsed}`),
    ];
    if (report.timer) {
      lines.push(`限时记录：${report.timer.display.summary}${report.timer.clockAnomaly ? ' · 设备时间异常' : ''}`);
    }
    const comparison = report.attemptHistory.comparison;
    if (comparison) {
      lines.push('', `提交变化 A${comparison.baselineAttemptNumber} → A${comparison.currentAttemptNumber}`,
        `得分 ${comparison.display.scoreDelta} · 正确率 ${comparison.display.accuracyDelta} · 已作答 ${comparison.display.answeredDelta} · 用时 ${comparison.display.elapsedDelta}`);
    }
    if (report.attemptHistory.rows.length) {
      lines.push('', '提交记录', ...report.attemptHistory.rows.map((row) =>
        `${row.display.record} · ${row.display.submittedAt} · ${row.display.score} · ${row.display.accuracy} · 已作答 ${row.display.completion} · ${row.display.elapsed}`));
    }
    if (report.referenceBand.eligible) lines.push('', report.referenceBand.note);
    const watermark = distributionWatermarkText('review');
    const classWatermark = distributionClassWatermarkText('review');
    if (watermark) lines.push('', watermark);
    if (classWatermark) lines.push(classWatermark);
    return lines.join('\n');
  }

  async function copyHomeworkReceipt() {
    const text = homeworkReceiptText();
    if (!text) return;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch (_error) {
      copied = false;
    }
    if (!copied) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        copied = document.execCommand('copy');
      } catch (_error) {
        copied = false;
      }
      textarea.remove();
    }
    announceStatus(copied ? '练习小结文字已复制。' : '无法自动复制，请手动选取凭证内容。');
  }

  function wrapCanvasLines(context, text, maxWidth) {
    const source = String(text || '');
    if (!source) return [''];
    const lines = [];
    let line = '';
    for (const character of [...source]) {
      const candidate = line + character;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = character;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawCanvasText(context, text, x, y, maxWidth, lineHeight, maxLines) {
    const lines = wrapCanvasLines(context, text, maxWidth);
    const visible = Number.isInteger(maxLines) && maxLines > 0 ? lines.slice(0, maxLines) : lines;
    visible.forEach((line, index) => context.fillText(line, x, y + (index * lineHeight)));
    return visible.length;
  }

  function homeworkReceiptCanvas() {
    const report = currentReviewReport;
    if (!report) return null;
    const historyRows = report.attemptHistory.rows.slice(-6);
    const hasComparison = Boolean(report.attemptHistory.comparison);
    const width = 1400;
    const classWatermark = distributionClassWatermarkText('review');
    const classWatermarkLines = classWatermark ? Math.min(3, Math.max(1, Math.ceil(classWatermark.length / 76))) : 0;
    const height = 500 + (report.passages.length * 92) + (hasComparison ? 132 : 0) +
      (historyRows.length ? 96 + (historyRows.length * 46) : 0) + (report.referenceBand.eligible ? 36 : 0) +
      (classWatermarkLines * 20);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const font = 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#183f54';
    context.font = `700 28px ${font}`;
    context.fillText('练习小结', 64, 68);
    context.fillStyle = '#4e5d65';
    context.font = `16px ${font}`;
    context.textAlign = 'right';
    context.fillText(`提交 ${report.display.submittedAt}`, width - 64, 66);
    context.textAlign = 'left';

    context.fillStyle = '#f2f6f8';
    context.beginPath();
    context.roundRect(64, 96, width - 128, 142, 14);
    context.fill();
    context.fillStyle = '#233943';
    context.font = `700 17px ${font}`;
    drawCanvasText(context, report.display.assignmentTitle, 88, 128, 430, 24, 2);
    context.fillStyle = '#65727a';
    context.font = `14px ${font}`;
    context.fillText('个人练习记录', 88, 196);

    const metrics = [
      ['得分', report.display.score],
      ...(report.referenceBand.eligible ? [['参考 Band', report.display.referenceBand]] : []),
      ['正确率', report.display.accuracy],
      ['已作答', report.display.completion],
      ['总用时', report.display.elapsed],
    ];
    const metricStart = 570;
    const metricWidth = (width - 64 - metricStart) / metrics.length;
    metrics.forEach(([label, value], index) => {
      const x = metricStart + (index * metricWidth);
      context.fillStyle = '#65727a';
      context.font = `13px ${font}`;
      context.fillText(label, x, 138);
      context.fillStyle = '#163e54';
      context.font = `700 23px ${font}`;
      context.fillText(value, x, 176);
    });

    let y = 286;
    context.fillStyle = '#183f54';
    context.font = `700 18px ${font}`;
    context.fillText('分篇结果', 64, y);
    y += 24;
    report.passages.forEach((part) => {
      context.fillStyle = '#f8fafb';
      context.beginPath();
      context.roundRect(64, y, width - 128, 76, 10);
      context.fill();
      context.fillStyle = receiptDifficultyColor(part.difficultyTier);
      context.fillRect(64, y, 7, 76);
      context.fillStyle = '#223741';
      context.font = `700 16px ${font}`;
      context.fillText(part.label, 88, y + 29);
      context.font = `16px ${font}`;
      drawCanvasText(context, part.title, 210, y + 29, 485, 21, 2);
      context.fillStyle = '#3f4d54';
      context.font = `14px ${font}`;
      context.fillText(`得分 ${part.display.score}`, 735, y + 31);
      context.fillText(`正确率 ${part.display.accuracy}`, 865, y + 31);
      context.fillText(`已作答 ${part.display.completion}`, 1035, y + 31);
      context.fillText(`用时 ${part.display.elapsed}`, 1190, y + 31);
      y += 90;
    });

    const comparison = report.attemptHistory.comparison;
    if (comparison) {
      context.fillStyle = '#183f54';
      context.font = `700 18px ${font}`;
      context.fillText(`提交变化（A${comparison.baselineAttemptNumber} → A${comparison.currentAttemptNumber}）`, 64, y + 18);
      y += 34;
      const comparisonItems = [
        ['得分', comparison.display.scoreDelta],
        ['正确率', comparison.display.accuracyDelta],
        ['已作答', comparison.display.answeredDelta],
        ['用时', comparison.display.elapsedDelta],
      ];
      const boxWidth = (width - 128 - 30) / 4;
      comparisonItems.forEach(([label, value], index) => {
        const x = 64 + (index * (boxWidth + 10));
        context.fillStyle = '#edf4f7';
        context.beginPath();
        context.roundRect(x, y, boxWidth, 72, 9);
        context.fill();
        context.fillStyle = '#59676e';
        context.font = `13px ${font}`;
        context.fillText(`${label}变化`, x + 15, y + 25);
        context.fillStyle = '#173f54';
        context.font = `700 20px ${font}`;
        context.fillText(value, x + 15, y + 53);
      });
      y += 98;
    }

    if (historyRows.length) {
      context.fillStyle = '#183f54';
      context.font = `700 18px ${font}`;
      context.fillText('提交记录', 64, y + 18);
      y += 34;
      context.fillStyle = '#eef3f5';
      context.fillRect(64, y, width - 128, 36);
      const columns = [64, 150, 420, 650, 800, 980];
      ['记录', '提交时间', '得分', '正确率', '已作答', '用时'].forEach((label, index) => {
        context.fillStyle = '#47565e';
        context.font = `700 13px ${font}`;
        context.fillText(label, columns[index] + 10, y + 23);
      });
      y += 36;
      historyRows.forEach((row) => {
        context.strokeStyle = '#dbe3e7';
        context.beginPath();
        context.moveTo(64, y + 45);
        context.lineTo(width - 64, y + 45);
        context.stroke();
        [row.display.record, row.display.submittedAt, row.display.score, row.display.accuracy, row.display.completion, row.display.elapsed]
          .forEach((value, index) => {
            context.fillStyle = '#33454e';
            context.font = `14px ${font}`;
            context.fillText(value, columns[index] + 10, y + 29);
          });
        y += 46;
      });
    }

    context.fillStyle = '#606d73';
    context.font = `13px ${font}`;
    const footer = report.referenceBand.eligible ? report.referenceBand.note : report.display.status;
    drawCanvasText(context, footer, 64, height - 62 - (classWatermarkLines * 20), width - 128, 20, 2);
    const watermark = distributionWatermarkText('review');
    if (watermark) {
      context.textAlign = 'right';
      context.fillText(watermark, width - 64, height - 28);
      context.textAlign = 'left';
    }
    if (classWatermark) {
      context.fillStyle = '#606d73';
      context.font = `13px ${font}`;
      drawCanvasText(context, classWatermark, 64, height - 28 - (classWatermarkLines * 20), width - 128, 20, classWatermarkLines);
    }
    return canvas;
  }

  function downloadHomeworkReceipt() {
    const report = currentReviewReport;
    const canvas = homeworkReceiptCanvas();
    if (!report || !canvas) return;
    const safeTitle = report.display.assignmentTitle.replace(/[\\/:*?"<>|]+/gu, '-').slice(0, 50) || 'IELTS-Reading';
    const filename = `${safeTitle}-练习小结.png`;
    canvas.toBlob((blob) => {
      if (!blob) {
        announceStatus('凭证图片生成失败。');
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      announceStatus('练习小结图片已保存。');
    }, 'image/png');
  }

  function renderDistributionWatermark() {
    const reviewText = distributionWatermarkText('review');
    const printText = distributionWatermarkText('print');
    const text = reviewText || printText;
    const classReviewText = distributionClassWatermarkText('review');
    const classPrintText = distributionClassWatermarkText('print');
    const classText = classReviewText || classPrintText;
    let wrapper = byId('review-branding');
    if (!text) {
      els.reviewBanner?.classList.remove('has-review-branding');
      wrapper?.remove();
      return;
    }
    els.reviewBanner?.classList.add('has-review-branding');
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.id = 'review-branding';
      wrapper.className = 'review-branding';
      wrapper.setAttribute('role', 'note');
      wrapper.innerHTML = '<p id="distribution-watermark" class="distribution-watermark"></p><p id="class-watermark" class="class-watermark"></p>';
      els.reviewBanner.appendChild(wrapper);
    }
    const element = byId('distribution-watermark');
    const classElement = byId('class-watermark');
    element.classList.toggle('is-review-surface-enabled', Boolean(reviewText));
    element.classList.toggle('is-print-surface-enabled', Boolean(printText));
    element.dataset.distributionSurfaces = [reviewText && 'review', printText && 'print'].filter(Boolean).join(' ');
    element.textContent = text;
    classElement.classList.toggle('is-review-surface-enabled', Boolean(classReviewText));
    classElement.classList.toggle('is-print-surface-enabled', Boolean(classPrintText));
    classElement.dataset.distributionSurfaces = [classReviewText && 'review', classPrintText && 'print'].filter(Boolean).join(' ');
    classElement.hidden = !classText;
    classElement.textContent = classText;
  }

  function renderMessages() {
    if (!els.messagesContent) return;
    els.messagesContent.innerHTML = '<p class="sr-only">No messages.</p>';
  }

  function syncOptionsChoiceState(attributeName, selectedValue) {
    if (!els.optionsContent) return;
    const selectedString = String(selectedValue);
    els.optionsContent.querySelectorAll(`[${attributeName}]`).forEach((button) => {
      const isSelected = button.getAttribute(attributeName) === selectedString;
      button.setAttribute('aria-pressed', String(isSelected));
      button.querySelector('.option-checkmark')?.classList.toggle('fa-check', isSelected);
    });
  }

  function renderOptions() {
    if (!els.optionsContent) return;
    if (els.optionsMenu) els.optionsMenu.dataset.panel = optionsPanel;
    if (els.optionsTitle) els.optionsTitle.textContent = optionsPanel === 'contrast' ? 'Contrast' :
      optionsPanel === 'text' ? 'Text size' : optionsPanel === 'submission' ? 'Table of contents' : 'Options';
    if (els.optionsBackButton) els.optionsBackButton.hidden = optionsPanel === 'root';
    if (optionsPanel === 'submission') {
      els.optionsContent.innerHTML = `<section class="submission-overview" aria-labelledby="submission-overview-title">
        <h3 id="submission-overview-title">Click next to continue</h3>
        <ol class="submission-part-list">
          ${model.parts.map((partModelItem) => {
            const part = Number(partModelItem.number);
            return `<li><strong>Part ${part}</strong><span>${countProgress(part)} of ${questionsForPart(part).length} answered</span></li>`;
          }).join('')}
        </ol>
        <button type="button" class="submission-next-button" data-submission-next>Next <span class="fa-icon fa-chevron-right" aria-hidden="true"></span></button>
      </section>`;
      return;
    }
    if (optionsPanel === 'contrast') {
      const choices = [
        ['black-white', 'Black on white', 'black-white'],
        ['white-black', 'White on black', 'white-black'],
        ['yellow-black', 'Yellow on black', 'yellow-black'],
      ];
      els.optionsContent.innerHTML = `<div class="options-choice-list" role="list">${choices.map(([value, label, preview]) =>
        `<button type="button" data-contrast-mode="${value}" aria-pressed="${state.contrastMode === value}"><span class="option-checkmark fa-icon ${state.contrastMode === value ? 'fa-check' : ''}" aria-hidden="true"></span><span>${label}</span><span class="contrast-option-preview contrast-option-preview-${preview}" aria-hidden="true"></span></button>`
      ).join('')}</div>`;
      return;
    }
    if (optionsPanel === 'text') {
      const choices = [[1, 'Regular'], [1.1875, 'Large'], [1.375, 'Extra large']];
      els.optionsContent.innerHTML = `<div class="options-choice-list" role="list">${choices.map(([value, label]) =>
        `<button type="button" data-font-scale="${value}" aria-pressed="${state.fontScale === value}"><span class="option-checkmark fa-icon ${state.fontScale === value ? 'fa-check' : ''}" aria-hidden="true"></span><span class="text-size-preview">${label}</span></button>`
      ).join('')}</div>`;
      return;
    }
    els.optionsContent.innerHTML = `<div class="options-root-list">
      <button type="button" class="options-submit-entry" data-options-submit><span class="fa-icon fa-paper-plane-o" aria-hidden="true"></span><span>Go to submission page</span><span class="fa-icon fa-chevron-right" aria-hidden="true"></span></button>
      <div class="options-secondary-list">
        <button type="button" data-options-panel="contrast"><span class="options-row-icon fa-icon fa-adjust" aria-hidden="true"></span><span>Contrast</span><span class="fa-icon fa-chevron-right" aria-hidden="true"></span></button>
        <button type="button" data-options-panel="text"><span class="options-row-icon fa-icon fa-search-plus" aria-hidden="true"></span><span>Text size</span><span class="fa-icon fa-chevron-right" aria-hidden="true"></span></button>
      </div>
    </div>`;
  }

  function updateTimer() {
    if (!els.timer) return;
    const policy = timerPolicy();
    const active = policy.enabled && state.timerStartedAt !== null && !state.submitted;
    els.timer.hidden = !active;
    if (!active) {
      els.appHeader?.classList.remove('timer-critical', 'timer-warning-flash');
      return;
    }
    const remaining = Math.max(0, Number(state.remainingSeconds) || 0);
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    if (remaining <= 0) {
      els.timer.textContent = 'Time limit reached';
      els.timer.setAttribute('aria-label', 'Time limit reached');
    } else if (remaining <= 300) {
      els.timer.textContent = `${minutes}:${String(seconds).padStart(2, '0')} remaining`;
      els.timer.setAttribute('aria-label', `${minutes} minutes ${seconds} seconds remaining`);
    } else {
      const wholeMinutes = Math.ceil(remaining / 60);
      els.timer.textContent = `${wholeMinutes} ${wholeMinutes === 1 ? 'minute' : 'minutes'} remaining`;
      els.timer.setAttribute('aria-label', `${wholeMinutes} minutes remaining`);
    }
    els.timer.classList.toggle('is-low', remaining <= 300);
    els.appHeader?.classList.toggle('timer-critical', remaining <= 300);
  }

  function currentTimerReport() {
    const policy = timerPolicy();
    if (!policy.enabled) return null;
    const submittedAt = homeworkReportRuntime().sanitizeTimestamp(state.submittedAt);
    const observedAt = submittedAt ?? Date.now();
    const elapsed = homeworkReportRuntime().elapsedSeconds({
      startedAt: state.timerStartedAt,
      submittedAt: observedAt,
      elapsedSeconds: state.elapsedSeconds,
    });
    const overtimeSeconds = state.timerDeadlineAt === null
      ? 0
      : Math.max(0, Math.floor((observedAt - state.timerDeadlineAt) / 1000));
    const reason = ['manual', 'timeout', 'manual-after-timeout'].includes(state.submissionReason)
      ? state.submissionReason
      : state.timerExpired ? 'manual-after-timeout' : 'manual';
    const reasonLabel = reason === 'timeout' ? '到时自动提交' : reason === 'manual-after-timeout' ? '超时后手动提交' : '手动提交';
    const limit = homeworkReportRuntime().formatElapsed(policy.durationSeconds);
    const actual = homeworkReportRuntime().formatElapsed(elapsed);
    const overtime = homeworkReportRuntime().formatElapsed(overtimeSeconds);
    return Object.freeze({
      enabled: true,
      limitSeconds: policy.durationSeconds,
      expiryAction: policy.expiryAction,
      startedAt: state.timerStartedAt,
      deadlineAt: state.timerDeadlineAt,
      elapsedSeconds: elapsed,
      overtimeSeconds,
      submissionReason: reason,
      attemptNumber: state.attemptNumber,
      clockAnomaly: state.clockAnomaly === true,
      display: Object.freeze({
        limit,
        actual,
        overtime,
        reason: reasonLabel,
        summary: `限时 ${limit} · 实际 ${actual}${overtimeSeconds > 0 ? ` · 超时 ${overtime}` : ''} · ${reasonLabel}${state.attemptNumber ? ` · 第 ${state.attemptNumber} 次提交` : ''}`,
      }),
    });
  }

  function flashTimerWarning() {
    if (!els.appHeader) return;
    window.clearTimeout(timerFlashHandle);
    els.appHeader.classList.remove('timer-warning-flash');
    void els.appHeader.offsetWidth;
    els.appHeader.classList.add('timer-warning-flash');
    timerFlashHandle = window.setTimeout(() => {
      els.appHeader?.classList.remove('timer-warning-flash');
    }, 2800);
  }

  function announceTimerMark(mark) {
    if (state.timerAnnouncementMarks.includes(mark)) return;
    state.timerAnnouncementMarks.push(mark);
    if (mark === 0) announceStatus('Time limit reached.');
    else if (mark < 60) announceStatus(`${mark} seconds remaining.`);
    else announceStatus(`${Math.floor(mark / 60)} ${mark === 60 ? 'minute' : 'minutes'} remaining.`);
  }

  function tickTimer() {
    const policy = timerPolicy();
    if (!policy.enabled || state.submitted || state.timerStartedAt === null || state.timerDeadlineAt === null) {
      window.clearInterval(timerHandle);
      timerHandle = 0;
      updateTimer();
      return;
    }
    const now = Date.now();
    if (state.timerLastObservedAt !== null && now + 5000 < state.timerLastObservedAt) state.clockAnomaly = true;
    state.timerLastObservedAt = now;
    const previousRemaining = Number(state.remainingSeconds);
    state.remainingSeconds = Math.max(0, Math.ceil((state.timerDeadlineAt - now) / 1000));
    state.overtimeSeconds = Math.max(0, Math.floor((now - state.timerDeadlineAt) / 1000));

    if (!state.timerWarning10Shown && policy.durationSeconds >= 600 && state.remainingSeconds <= 600) {
      state.timerWarning10Shown = true;
      flashTimerWarning();
    }
    if (!state.timerWarning5Shown && policy.durationSeconds >= 300 && state.remainingSeconds <= 300) {
      state.timerWarning5Shown = true;
      flashTimerWarning();
    }
    [600, 300, 60, 30, 10].forEach((mark) => {
      if (policy.durationSeconds >= mark && state.remainingSeconds <= mark &&
          (!Number.isFinite(previousRemaining) || previousRemaining > mark)) announceTimerMark(mark);
    });

    if (state.remainingSeconds <= 0 && !state.timerExpired) {
      state.timerExpired = true;
      state.timerExpiredAt = state.timerDeadlineAt;
      announceTimerMark(0);
    }
    if (lastTimerRenderedSecond !== state.remainingSeconds) {
      lastTimerRenderedSecond = state.remainingSeconds;
      updateTimer();
      saveState();
    }
    if (state.timerExpired && policy.expiryAction === 'submit' && !state.submitted) {
      state.timerRunning = false;
      saveState();
      submitPractice(true);
    }
  }

  function renderTimerStartGate() {
    if (!els.timerStartGate) return;
    const policy = timerPolicy();
    const shouldShow = policy.enabled && !state.submitted && state.timerStartedAt === null;
    els.timerStartGate.hidden = !shouldShow;
    document.body.classList.toggle('has-timer-start-gate', shouldShow);
    setBackgroundInert(shouldShow);
    if (!shouldShow) return;
    const minutes = Math.round(policy.durationSeconds / 60);
    if (els.timerStartLimit) {
      els.timerStartLimit.textContent = `${minutes}-minute limit · ${policy.expiryAction === 'submit' ? 'answers submit automatically at zero' : 'you may continue after time is reached'}`;
    }
    window.setTimeout(() => els.timerStartCard?.focus(), 0);
  }

  function beginTimedPractice() {
    const policy = timerPolicy();
    if (!policy.enabled || state.submitted || state.timerStartedAt !== null) return;
    const now = Date.now();
    state.timerStartedAt = now;
    state.timerDeadlineAt = now + (policy.durationSeconds * 1000);
    state.timerLastObservedAt = now;
    state.remainingSeconds = policy.durationSeconds;
    state.timerRunning = true;
    state.timerExpired = false;
    state.timerExpiredAt = null;
    state.overtimeSeconds = 0;
    state.attemptStartedAt = now;
    state.partElapsedMilliseconds = {};
    state.partActiveStartedAt = document.visibilityState === 'hidden' ? null : now;
    state.partTimingComplete = true;
    state.timerAnnouncementMarks = [];
    state.timerWarning10Shown = false;
    state.timerWarning5Shown = false;
    state.clockAnomaly = false;
    state.submissionReason = null;
    saveState();
    renderTimerStartGate();
    startTimer();
    announceStatus('Timed practice started.');
    els.examShell?.focus?.();
  }

  function startTimer() {
    window.clearInterval(timerHandle);
    timerHandle = 0;
    lastTimerRenderedSecond = null;
    renderTimerStartGate();
    updateTimer();
    if (!timerPolicy().enabled || state.submitted || state.timerStartedAt === null) return;
    state.timerRunning = true;
    tickTimer();
    if (!state.submitted) timerHandle = window.setInterval(tickTimer, 250);
  }

  function renderAll(options) {
    closeSelectionMenu();
    renderPartIntro();
    renderPassage(options);
    renderQuestions(options);
    renderFooter();
    renderReviewBanner();
    renderMessages();
    renderOptions();
    applyPreferences();
    renderNotesSidebar();
    updateTimer();
  }

  function refreshAnswerState() {
    updateCurrentQuestionStyles();
    renderFooter();
    if (!els.questionsContent) return;
    els.questionsContent.querySelectorAll('[data-clear-question]').forEach((button) => {
      button.disabled = !isAnswered(Number(button.dataset.clearQuestion));
    });
    els.questionsContent.querySelectorAll('.inline-clear[data-clear-question]').forEach((button) => {
      button.disabled = !isAnswered(Number(button.dataset.clearQuestion));
    });
  }

  function announceStatus(message) {
    if (!els.liveStatus) return;
    window.clearTimeout(statusHandle);
    els.liveStatus.textContent = '';
    statusHandle = window.setTimeout(() => {
      els.liveStatus.textContent = String(message || '');
    }, 20);
  }

  function showHighlightPrompt(message) {
    const text = String(message || '');
    announceStatus(text);
    if (!els.highlightStatus) return;
    window.clearTimeout(highlightPromptHandle);
    els.highlightStatus.textContent = text;
    els.highlightStatus.hidden = false;
    highlightPromptHandle = window.setTimeout(() => {
      els.highlightStatus.hidden = true;
      els.highlightStatus.textContent = '';
    }, 5000);
  }

  function clearQuestion(number) {
    if (state.submitted) return;
    const question = model.questions.get(Number(number));
    clearAnswerForQuestion(number);
    saveState();
    if (question && isDragMatchingGroup(model.groups.get(question.groupId))) rerenderMatchingInteraction(Number(number));
    else {
      renderQuestions({ preserveScroll: true });
      renderFooter();
    }
    announceStatus(`Answer ${number} cleared.`);
  }

  function clearMultiple(groupId) {
    if (state.submitted) return;
    const group = model.groups.get(groupId);
    (group?.responseSlotIds || []).forEach((responseSlotId) => setResponseAction({ type: 'clear', responseSlotId }));
    saveState();
    renderQuestions({ preserveScroll: true });
    renderFooter();
    const count = Math.max(2, Number(group?.rules?.maxSelections) || (group?.questionNumbers || []).length || 2);
    announceStatus(`${count} answer selections cleared.`);
  }

  function syncChoiceSetRows(group, selected) {
    if (!els.questionsContent || !group) return;
    const selectedSet = new Set(selected.map(String));
    const limit = Math.max(1, Number(group.rules?.maxSelections) || (group.questionNumbers || []).length || 2);
    const atLimit = selected.length >= limit;
    const selector = `[data-multiple-group="${CSS.escape(group.id)}"]`;
    const inputs = Array.from(els.questionsContent.querySelectorAll(selector));
    inputs.forEach((input) => {
      const checked = selectedSet.has(input.value);
      input.checked = checked;
      input.disabled = state.submitted || (atLimit && !checked);
      input.closest('.choice')?.classList.toggle('is-selected', checked);
    });
    const question = inputs[0]?.closest('.multi-question');
    if (question) question.classList.toggle('is-answered', selected.length > 0);
  }

  function singleRadioQuestionNumber(input) {
    if (!(input instanceof HTMLInputElement) || input.type !== 'radio') return 0;
    return Number(input.dataset.gridQuestion || input.dataset.answerQuestion) || 0;
  }

  function singleRadioFromClick(event) {
    const selector = 'input[type="radio"][data-answer-question], input[type="radio"][data-grid-question]';
    const direct = event.target?.closest?.(selector);
    if (direct instanceof HTMLInputElement) return direct;
    const label = event.target?.closest?.('label');
    const labelled = label?.querySelector(selector);
    return labelled instanceof HTMLInputElement ? labelled : null;
  }

  function syncSingleRadioQuestion(number) {
    if (!els.questionsContent) return;
    const selected = normalizeAnswer(answerForQuestion(number));
    const selector = [
      `input[type="radio"][data-answer-question="${number}"]`,
      `input[type="radio"][data-grid-question="${number}"]`,
    ].join(',');
    els.questionsContent.querySelectorAll(selector).forEach((input) => {
      const checked = Boolean(selected) && normalizeAnswer(input.value) === selected;
      input.checked = checked;
      input.closest('label')?.classList.toggle('is-selected', checked);
    });
  }

  function clearSelectedSingleRadio(input, event) {
    if (state.submitted || input?.disabled) return false;
    const number = singleRadioQuestionNumber(input);
    if (!number || normalizeAnswer(answerForQuestion(number)) !== normalizeAnswer(input.value)) return false;
    event?.preventDefault();
    clearAnswerForQuestion(number);
    state.currentQuestion = number;
    setActivePart(partForQuestion(number));
    state.lastQuestionByPart[state.part] = number;
    saveState();
    syncSingleRadioQuestion(number);
    refreshAnswerState();
    // A cancelled native radio click may restore its pre-click checked state
    // after bubbling. Reconcile once more after activation finishes and keep
    // keyboard/screen-reader focus on the control that was just cleared.
    window.requestAnimationFrame(() => {
      syncSingleRadioQuestion(number);
      input.focus({ preventScroll: true });
    });
    announceStatus(`Answer ${number} cleared.`);
    return true;
  }

  function assignGridOption(groupId, questionNumber, optionId) {
    if (state.submitted) return false;
    const group = model.groups.get(groupId);
    const target = Number(questionNumber);
    const option = matchingOption(group, optionId);
    if (!group || !isGridMatchingGroup(group) || !group.questionNumbers.includes(target) || !option) return false;
    let displaced = 0;
    if (!allowsOptionReuse(group)) {
      group.questionNumbers.forEach((number) => {
        if (number !== target && normalizeAnswer(answerForQuestion(number)) === normalizeAnswer(option.id)) displaced = number;
      });
    }
    setAnswerForQuestion(target, option.id, 'set-option');
    state.currentQuestion = target;
    setActivePart(partForQuestion(target));
    state.lastQuestionByPart[state.part] = target;
    saveState();
    const selector = `input[data-grid-group="${CSS.escape(group.id)}"]`;
    els.questionsContent?.querySelectorAll(selector).forEach((input) => {
      const question = Number(input.dataset.gridQuestion);
      const checked = normalizeAnswer(answerForQuestion(question)) === normalizeAnswer(input.dataset.gridOption);
      input.checked = checked;
      input.closest('.matching-grid-cell')?.classList.toggle('is-selected', checked);
    });
    updateCurrentQuestionStyles();
    renderFooter();
    window.requestAnimationFrame(() => {
      els.questionsContent?.querySelector(`[data-grid-question="${target}"][data-grid-option="${CSS.escape(String(option.id))}"]`)?.focus({ preventScroll: true });
    });
    announceStatus(displaced
      ? `Option ${option.id} moved to question ${target}. Question ${displaced} is now unanswered.`
      : `Option ${option.id} selected for question ${target}.`);
    return true;
  }

  function onQuestionInput(event) {
    const target = event.target;
    if (state.submitted || !(target instanceof HTMLInputElement)) return;
    if (target.matches('[data-grid-group][data-grid-question]')) {
      assignGridOption(target.dataset.gridGroup, Number(target.dataset.gridQuestion), target.value);
      return;
    }
    if (target.matches('[data-answer-question][data-response-slot-id]')) {
      const number = Number(target.dataset.answerQuestion);
      const responseSlotId = String(target.dataset.responseSlotId || '');
      const question = model.questions.get(number);
      const responseSlot = runtimeIndex?.responseSlots?.get(responseSlotId);
      if (!question || question.responseSlotId !== responseSlotId || responseSlot?.responseKind !== 'text') return;
      setResponseAction({ type: 'set-text', responseSlotId, value: target.value });
      state.currentQuestion = number;
      setActivePart(partForQuestion(number));
      state.lastQuestionByPart[state.part] = number;
      saveState();
      refreshAnswerState();
      return;
    }
    if (target.matches('[data-answer-question]')) {
      const number = Number(target.dataset.answerQuestion);
      setAnswerForQuestion(number, target.value);
      state.currentQuestion = number;
      setActivePart(partForQuestion(number));
      state.lastQuestionByPart[state.part] = number;
      saveState();
      refreshAnswerState();
      return;
    }
    if (target.matches('[data-multiple-group]')) {
      const group = model.groups.get(target.dataset.multipleGroup);
      if (!group) return;
      setResponseAction({ type: 'toggle-choice', responseSlotId: group.responseSlotIds[0], optionId: target.value });
      const selected = multipleAnswers(group);
      const numbers = group.questionNumbers || [];
      state.currentQuestion = numbers[Math.min(Math.max(0, selected.length - 1), Math.max(0, numbers.length - 1))] || numbers[0] || state.currentQuestion;
      setActivePart(Number(group.part) || partForQuestion(state.currentQuestion));
      state.lastQuestionByPart[state.part] = state.currentQuestion;
      saveState();
      syncChoiceSetRows(group, selected);
      refreshAnswerState();
    }
  }

  function onQuestionFocusIn(event) {
    if (state.submitted) return;
    const input = event.target?.closest?.('[data-answer-question][data-response-slot-id]');
    if (!input) return;
    const number = Number(input.dataset.answerQuestion);
    const responseSlotId = String(input.dataset.responseSlotId || '');
    if (!model.questions.has(number) || responseIdForQuestion(number) !== responseSlotId) return;
    if (state.currentQuestion !== number) setCurrentQuestion(number, false);
  }

  function onQuestionsClick(event) {
    if (handleQuestionFlagClick(event)) return;
    const t36Navigation = event.target.closest('[data-t36-score-slot]');
    const t36LocateButton = event.target.closest('[data-t36-evidence-locate]');
    const t36ShiftButton = event.target.closest('[data-t36-evidence-shift]');
    if (t36Navigation && (t36LocateButton || t36ShiftButton)) {
      event.preventDefault();
      const scoreSlotId = t36Navigation.dataset.t36ScoreSlot;
      const questionNumber = Number(t36Navigation.dataset.t36Question);
      if (t36ShiftButton) t36ShiftEvidence(scoreSlotId, questionNumber, Number(t36ShiftButton.dataset.t36EvidenceShift));
      else t36LocateReviewEvidence(scoreSlotId, questionNumber);
      return;
    }
    const locatorButton = event.target.closest('[data-t35-review-locate-score-slot]');
    if (locatorButton) {
      event.preventDefault();
      t35LocateReviewEvidence(locatorButton.dataset.t35ReviewLocateScoreSlot, Number(locatorButton.dataset.t35ReviewLocateQuestion));
      return;
    }
    const choiceLabel = event.target.closest('.choice, .choice-label, .radio-choice, .checkbox-choice');
    if (suppressNextQuestionLabelClick && choiceLabel) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextQuestionLabelClick = false;
      window.clearTimeout(suppressQuestionLabelClickHandle);
      return;
    }
    suppressNextQuestionLabelClick = false;
    if (handleAnnotationClick(event, 'questions')) return;
    const singleRadio = singleRadioFromClick(event);
    if (singleRadio && clearSelectedSingleRadio(singleRadio, event)) return;
    const clear = event.target.closest('[data-clear-question]');
    if (clear) {
      event.preventDefault();
      clearQuestion(Number(clear.dataset.clearQuestion));
      return;
    }
    const clearGroup = event.target.closest('[data-clear-group]');
    if (clearGroup) {
      event.preventDefault();
      clearMultiple(clearGroup.dataset.clearGroup);
      return;
    }
    const question = event.target.closest('[data-question]');
    const multipleQuestion = event.target.closest('[data-questions]');
    if (question) setCurrentQuestion(Number(question.dataset.question), false);
    else if (multipleQuestion) {
      const numbers = String(multipleQuestion.dataset.questions || '').split(/\s+/).map(Number).filter(Boolean);
      if (numbers.length) setCurrentQuestion(numbers[0], false);
    }
  }

  function targetForQuestion(number) {
    const target = els.passageContent?.querySelector(`[data-question="${number}"]`) ||
      els.questionsContent?.querySelector(`[data-question="${number}"]`) ||
      els.questionsContent?.querySelector(`[data-questions~="${number}"]`) || null;
    return target?.matches('.inline-question, .short-answer-item') ? target.querySelector('input') || target : target;
  }

  function setCurrentQuestion(number, shouldScroll) {
    const requested = Number(number);
    const targetNumber = model.questions.has(requested) ? requested : model.questionNumbers.reduce((closest, candidate) =>
      Math.abs(candidate - requested) < Math.abs(closest - requested) ? candidate : closest, firstQuestion());
    const nextPart = partForQuestion(targetNumber);
    const changedPart = nextPart !== state.part;
    setActivePart(nextPart);
    state.currentQuestion = targetNumber;
    state.lastQuestionByPart[nextPart] = targetNumber;
    saveState();
    if (changedPart) {
      renderAll();
      if (els.passagePane) els.passagePane.scrollTop = 0;
      if (els.questionsPane) els.questionsPane.scrollTop = 0;
    } else {
      updateCurrentQuestionStyles();
      renderFooter();
    }
    const question = model.questions.get(targetNumber);
    const group = question && model.groups.get(question.groupId);
    const matchingReview = state.submitted && typeDefinition(group)?.passageTargets
      ? els.questionsContent?.querySelector(`[data-review-for="${targetNumber}"]`)
      : null;
    if (shouldScroll || matchingReview) {
      window.requestAnimationFrame(() => {
        const target = targetForQuestion(targetNumber);
        if (shouldScroll && target) {
          target.scrollIntoView({ block: 'center', behavior: 'smooth' });
          target.focus({ preventScroll: true });
        }
        if (matchingReview?.isConnected) {
          matchingReview.scrollIntoView({ block: 'center', behavior: shouldScroll ? 'smooth' : 'auto' });
        }
      });
    }
  }

  function switchPart(partNumber) {
    const number = Number(partNumber);
    if (!partModel(number)) return;
    const questions = questionsForPart(number);
    const remembered = Number(state.lastQuestionByPart[number]);
    setCurrentQuestion(questions.includes(remembered) ? remembered : questions[0], false);
  }

  function adjacentQuestion(direction) {
    const index = Math.max(0, model.questionNumbers.indexOf(Number(state.currentQuestion)));
    const next = Math.max(0, Math.min(model.questionNumbers.length - 1, index + (direction < 0 ? -1 : 1)));
    return model.questionNumbers[next] || state.currentQuestion;
  }

  function positionFloating(element, anchorRect, placement) {
    if (!element || !anchorRect) return;
    const margin = 8;
    const width = element.offsetWidth || 240;
    const height = element.offsetHeight || 80;
    let left = anchorRect.left + (anchorRect.width / 2) - (width / 2);
    let top = placement === 'below' ? anchorRect.bottom + 8 : anchorRect.top - height - 8;
    if (top < margin) top = Math.min(window.innerHeight - height - margin, anchorRect.bottom + 8);
    if (top + height > window.innerHeight - margin) top = Math.max(margin, anchorRect.top - height - 8);
    top = Math.max(margin, Math.min(Math.max(margin, window.innerHeight - height - margin), top));
    left = Math.max(margin, Math.min(window.innerWidth - width - margin, left));
    element.style.left = `${Math.round(left)}px`;
    element.style.top = `${Math.round(top)}px`;
  }

  function setBackgroundInert(inert) {
    if (els.app) els.app.inert = Boolean(inert);
    if (els.notesHost) els.notesHost.inert = Boolean(inert);
  }

  function openMessages() {
    if (!els.messagesView) return;
    closeOptions();
    closeSelectionMenu();
    lastFocusedBeforeOverlay = document.activeElement;
    setBackgroundInert(true);
    els.messagesView.hidden = false;
    els.messagesView.classList.add('is-open');
    if (els.messagesButton) els.messagesButton.setAttribute('aria-expanded', 'true');
    (els.messagesCloseButton || els.messagesView.querySelector('button'))?.focus();
  }

  function closeMessages() {
    if (!els.messagesView || els.messagesView.hidden) return false;
    els.messagesView.hidden = true;
    els.messagesView.classList.remove('is-open');
    setBackgroundInert(false);
    if (els.messagesButton) els.messagesButton.setAttribute('aria-expanded', 'false');
    if (lastFocusedBeforeOverlay instanceof HTMLElement) lastFocusedBeforeOverlay.focus();
    return true;
  }

  function openOptions() {
    if (!els.optionsMenu) return;
    closeMessages();
    closeSelectionMenu();
    lastFocusedBeforeOverlay = document.activeElement;
    optionsPanel = 'root';
    renderOptions();
    setBackgroundInert(true);
    els.optionsMenu.hidden = false;
    els.optionsMenu.classList.add('is-open');
    if (els.optionsButton) {
      els.optionsButton.setAttribute('aria-expanded', 'true');
    }
    (els.optionsCloseButton || els.optionsMenu.querySelector('button'))?.focus();
  }

  function closeOptions() {
    if (!els.optionsMenu || els.optionsMenu.hidden) return false;
    els.optionsMenu.hidden = true;
    els.optionsMenu.classList.remove('is-open');
    setBackgroundInert(false);
    if (els.optionsButton) els.optionsButton.setAttribute('aria-expanded', 'false');
    if (lastFocusedBeforeOverlay instanceof HTMLElement) lastFocusedBeforeOverlay.focus();
    return true;
  }

  function toggleOptions() {
    if (!els.optionsMenu) return;
    if (els.optionsMenu.hidden) openOptions();
    else closeOptions();
  }

  function openSubmitDialog() {
    if (state.submitted) {
      els.reviewBanner?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    if (!els.submitDialog) return;
    const total = totalQuestionCount();
    const answered = model.questionNumbers.filter(isAnswered).length;
    const unanswered = total - answered;
    if (els.submitDescription) {
      const destination = fullReviewEnabled() ? 'review mode opens' : 'your score report opens';
      els.submitDescription.innerHTML = unanswered
        ? `You have answered <strong>${answered} of ${total}</strong> questions. <strong>${unanswered} ${unanswered === 1 ? 'question is' : 'questions are'} unanswered.</strong> After submitting, answers are locked and ${destination}.`
        : `You have answered all ${total} questions. After submitting, answers are locked and ${destination}.`;
    }
    closeOptions();
    closeMessages();
    closeSelectionMenu();
    lastFocusedBeforeOverlay = document.activeElement;
    setBackgroundInert(true);
    els.submitDialog.hidden = false;
    els.submitDialog.classList.add('is-open');
    document.body.classList.add('has-dialog');
    const dialog = els.submitDialog.querySelector('[role="dialog"]');
    dialog?.focus();
  }

  function closeSubmitDialog() {
    if (!els.submitDialog || els.submitDialog.hidden) return false;
    els.submitDialog.hidden = true;
    els.submitDialog.classList.remove('is-open');
    document.body.classList.remove('has-dialog');
    setBackgroundInert(false);
    if (lastFocusedBeforeOverlay instanceof HTMLElement) lastFocusedBeforeOverlay.focus();
    return true;
  }

  function submitPractice(timedOut) {
    if (state.submitted) return;
    window.clearInterval(timerHandle);
    timerHandle = 0;
    const submittedAt = Date.now();
    settleCurrentPartTiming(submittedAt);
    state.submittedAt = submittedAt;
    state.elapsedSeconds = homeworkReportRuntime().elapsedSeconds({
      startedAt: state.attemptStartedAt,
      submittedAt,
    });
    state.submitted = true;
    reviewOverviewCollapsed = false;
    t35ReviewView = 'answer-analysis';
    t36EvidenceDisplayMode = 'always';
    t35ClearReviewLocator();
    reviewTranslationVisible = true;
    reviewTranslationLastAnchor = null;
    state.timerRunning = false;
    if (timerPolicy().enabled) {
      state.timerExpired = state.timerDeadlineAt !== null && submittedAt >= state.timerDeadlineAt;
      state.timerExpiredAt = state.timerExpired ? (state.timerExpiredAt || state.timerDeadlineAt) : null;
      state.overtimeSeconds = state.timerDeadlineAt === null ? 0 : Math.max(0, Math.floor((submittedAt - state.timerDeadlineAt) / 1000));
      state.submissionReason = timedOut ? 'timeout' : state.timerExpired ? 'manual-after-timeout' : 'manual';
    } else {
      state.submissionReason = 'manual';
    }
    state.result = calculateResult();
    recordCurrentSubmission(state.result, submittedAt);
    saveState();
    closeSubmitDialog();
    renderAll({ preserveScroll: true });
    if (els.reviewBanner) els.reviewBanner.scrollIntoView({ block: 'start', behavior: 'smooth' });
    const destination = fullReviewEnabled() ? '答案与解析' : '成绩报告';
    announceStatus(timedOut ? `答题时间结束，已进入${destination}。` : `答案已提交，已进入${destination}。`);
  }

  function resetPractice() {
    const preferences = { split: state.split, fontScale: state.fontScale, contrast: state.contrast, contrastMode: state.contrastMode };
    state = { ...defaultState(), ...preferences };
    reviewOverviewCollapsed = false;
    t35ReviewView = 'answer-analysis';
    t36EvidenceDisplayMode = 'always';
    t35ClearReviewLocator();
    reviewTranslationVisible = true;
    reviewTranslationLastAnchor = null;
    activeNoteId = null;
    pendingDeleteNoteId = null;
    try {
      localStorage.removeItem(stateStorageKey());
    } catch (error) {
      console.warn('Could not clear saved state.', error);
    }
    closeOptions();
    closeSubmitDialog();
    closeHomeworkReceipt();
    closeNoteEditor();
    renderAll();
    startTimer();
    if (els.passagePane) els.passagePane.scrollTop = 0;
    if (els.questionsPane) els.questionsPane.scrollTop = 0;
    saveState();
    announceStatus('Practice reset.');
  }

  function renderReviewDetail(number) {
    if (!els.reviewDetail) return;
    if (!state.submitted || !reviewAnswerAnalysisEnabled()) {
      els.reviewDetail.hidden = true;
      els.reviewDetail.innerHTML = '';
      return;
    }
    const question = model.questions.get(Number(number));
    if (!question) return;
    const status = answerStatus(number);
    const group = model.groups.get(question.groupId);
    const definition = typeDefinition(group);
    const review = reviewForQuestion(number);
    const scoreSlot = scoreSlotForQuestion(number);
    if (scoreSlot?.evaluation === 'atomic-unordered-text-set' && scoreSlot.responseSlotIds.length > 1) {
      const result = runtimeScore().byId.get(scoreSlot.scoreSlotId);
      const numbers = scoreSlot.responseSlotIds.map((responseSlotId) => model.responseNumberById.get(responseSlotId)).filter(Number.isFinite);
      const supplied = scoreSlot.responseSlotIds.map((responseSlotId) => reviewValue(String(state.answers[responseSlotId] || 'No answer')));
      const canonicalByMember = new Map();
      (scoreSlot.accepted || []).forEach((entry, index) => {
        const memberId = String(entry.setMemberId || `member-${index + 1}`);
        if (entry.verification === 'canonical' || !canonicalByMember.has(memberId)) canonicalByMember.set(memberId, String(entry.value));
      });
      const correct = [...canonicalByMember.values()];
      const sourceExplanation = chinesePrimaryExplanation(review, {
        includeDistractors: false,
        prefix: ['两个空构成一组不分顺序的答案；只有两个答案都正确，才获得该组全部分数。'],
      });
      els.reviewDetail.hidden = false;
      els.reviewDetail.innerHTML = `<button type="button" class="review-detail-close" aria-label="关闭答案详情">×</button>
        <h2>第 ${h(numbers.join('–'))} 题：${reviewStatusLabel(status)} · ${Number(result?.earnedMarks || 0)}/${Number(result?.availableMarks || scoreSlot.marks || 0)} 分</h2>
        <p><strong>你的答案：</strong> ${h(supplied.join(' · '))}</p>
        <p><strong>正确答案：</strong> ${h(`${correct.join(' · ')}（顺序不限）`)}</p>
        <div><strong>解析与原文依据</strong><p>${nl(sourceExplanation)}</p></div>`;
      return;
    }
    const accepted = acceptedValuesForQuestion(number)[0] || '';
    const isHeading = group.questionType === 'matching_headings';
    const sourceExplanation = chinesePrimaryExplanation(review, {
      includeDistractors: false,
      includeQuestionTranslation: !isHeading,
    });
    const headingTranslation = isHeading ? reviewHeadingTranslation(review) : '';
    const answerNoun = isHeading ? 'heading' :
      group.questionType === 'matching_sentence_endings' ? 'ending' : 'option';
    const answerNounLabel = answerNoun === 'heading' ? '标题' : answerNoun === 'ending' ? '句尾' : '选项';
    const explanation = definition?.matchingMode && !isHeading
      ? `正确${answerNounLabel}：${displayAnswer(number, accepted)}\n\n${sourceExplanation}`
      : sourceExplanation;
    els.reviewDetail.hidden = false;
    els.reviewDetail.innerHTML = `<button type="button" class="review-detail-close" aria-label="关闭答案详情">×</button>
      <h2>第 ${number} 题：${reviewStatusLabel(status)}</h2>
      <p><strong>你的答案：</strong> ${h(reviewValue(displayAnswer(number, userAnswer(number))))}</p>
      ${isHeading
        ? `<p data-review-field="correct-heading"><strong>正确标题</strong>：${h(displayAnswer(number, accepted))}</p>
           <div class="heading-translation" data-review-field="heading-translation"><strong>标题翻译</strong><p>${h(headingTranslation)}</p></div>`
        : `<p><strong>正确答案：</strong> ${h(review?.answerDisplay || displayAnswer(number, accepted))}</p>`}
      <div ${isHeading ? 'data-review-field="explanation-evidence"' : ''}><strong>解析与原文依据</strong><p>${nl(explanation)}</p></div>`;
  }

  function closeTopLayer() {
    if (dragState) {
      finishPointerDrag(null, true);
      return true;
    }
    if (keyboardDrag) {
      cancelKeyboardDrag();
      return true;
    }
    if (closeHomeworkReceipt()) return true;
    if (closeSubmitDialog()) return true;
    if (closeMessages()) return true;
    if (closeOptions()) return true;
    if (els.selectionMenu && !els.selectionMenu.hidden) {
      closeSelectionMenu();
      return true;
    }
    if (state.showNotes) {
      closeNoteEditor();
      return true;
    }
    return false;
  }

  function trapModalFocus(event, container) {
    if (!container || event.key !== 'Tab') return false;
    const focusable = [...container.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )].filter((element) => !element.hidden && element.getClientRects().length > 0);
    if (!focusable.length) {
      event.preventDefault();
      container.focus?.();
      return true;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (!container.contains(active) || active === container) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return true;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return true;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }

  function normalizeAnnotationSurface(surface) {
    return surface === 'questions' ? 'questions' : 'passage';
  }

  function annotationRoot(surface) {
    return normalizeAnnotationSurface(surface) === 'questions' ? els.questionsContent : els.passageContent;
  }

  function annotationPane(surface) {
    return normalizeAnnotationSurface(surface) === 'questions' ? els.questionsPane : els.passagePane;
  }

  function highlightStore(surface) {
    return normalizeAnnotationSurface(surface) === 'questions' ? state.questionHighlights : state.highlights;
  }

  /* Notes retain their established offset flow. Highlight v2 uses the separate
     canonical map below so a safer Highlight migration cannot move Notes. */
  function annotationTextNodes(surface) {
    const normalizedSurface = normalizeAnnotationSurface(surface);
    const root = annotationRoot(normalizedSurface);
    if (!root) return [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.length) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (normalizedSurface === 'passage') {
          if (parent && parent.closest('.passage-matching-target, [data-annotation-exclude="true"], .review-translation-unit')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
        if (!node.nodeValue.trim() && !highlightSplitWhitespaceNodes.has(node)) return NodeFilter.FILTER_REJECT;
        if (parent && parent.closest(
          '.question-number, .sr-only, [hidden], [aria-hidden="true"], button, input, textarea, select, option, ' +
          '.heading-token, [data-heading-bank], .drop-zone, .matching-review-list, .answer-review, .review-feedback, ' +
          '[data-annotation-exclude="true"]'
        )) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function annotationLength(surface) {
    return annotationTextNodes(surface).reduce((sum, node) => sum + node.nodeValue.length, 0);
  }

  function boundaryOffset(surface, container, offset) {
    const root = annotationRoot(surface);
    if (!root || !container) return 0;
    const nodes = annotationTextNodes(surface);
    if (container.nodeType === Node.TEXT_NODE) {
      let total = 0;
      for (const node of nodes) {
        if (node === container) return total + Math.max(0, Math.min(Number(offset) || 0, node.nodeValue.length));
        total += node.nodeValue.length;
      }
    }
    const boundary = document.createRange();
    try {
      boundary.setStart(container, Number(offset) || 0);
      boundary.collapse(true);
    } catch (error) {
      return 0;
    }
    let total = 0;
    for (const node of nodes) {
      try {
        const nodeEnd = boundary.comparePoint(node, node.nodeValue.length);
        if (nodeEnd <= 0) {
          total += node.nodeValue.length;
          continue;
        }
        const nodeStart = boundary.comparePoint(node, 0);
        if (nodeStart >= 0) break;
      } catch (error) {
        return total;
      }
    }
    return total;
  }

  function selectionToOffsets(surface, range) {
    const root = annotationRoot(surface);
    if (!root || !range) return null;
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    if (normalizeAnnotationSurface(surface) === 'passage') {
      const excluded = [...root.querySelectorAll('[data-annotation-exclude="true"], .review-translation-unit')];
      if (excluded.some((element) => {
        try { return range.intersectsNode(element); } catch (_error) { return true; }
      })) return null;
    }
    const start = boundaryOffset(surface, range.startContainer, range.startOffset);
    const end = boundaryOffset(surface, range.endContainer, range.endOffset);
    if (end <= start) return null;
    return { surface: normalizeAnnotationSurface(surface), start, end };
  }

  function textPositionAt(surface, offset) {
    const nodes = annotationTextNodes(surface);
    if (!nodes.length) return null;
    let traversed = 0;
    for (const node of nodes) {
      const next = traversed + node.nodeValue.length;
      if (offset <= next) return { node, offset: Math.max(0, offset - traversed) };
      traversed = next;
    }
    const last = nodes[nodes.length - 1];
    return { node: last, offset: last.nodeValue.length };
  }

  function rangeFromOffsets(surface, start, end) {
    const startPosition = textPositionAt(surface, start);
    const endPosition = textPositionAt(surface, end);
    if (!startPosition || !endPosition) return null;
    const range = document.createRange();
    try {
      range.setStart(startPosition.node, Math.min(startPosition.offset, startPosition.node.nodeValue.length));
      range.setEnd(endPosition.node, Math.min(endPosition.offset, endPosition.node.nodeValue.length));
      return range;
    } catch (error) {
      return null;
    }
  }

  function annotationPieces(surface, start, end) {
    const nodes = annotationTextNodes(surface);
    let traversed = 0;
    const pieces = [];
    nodes.forEach((node) => {
      const nodeStart = traversed;
      const nodeEnd = traversed + node.nodeValue.length;
      const localStart = Math.max(0, start - nodeStart);
      const localEnd = Math.min(node.nodeValue.length, end - nodeStart);
      if (localStart < localEnd && start < nodeEnd && end > nodeStart) {
        pieces.push({ node, start: localStart, end: localEnd });
      }
      traversed = nodeEnd;
    });
    return pieces;
  }

  function annotationTextFromOffsets(surface, start, end) {
    let text = '';
    annotationPieces(surface, start, end).forEach((piece) => {
      const fragment = piece.node.nodeValue.slice(piece.start, piece.end);
      if (text && !/\s$/.test(text) && !/^[\s.,;:!?…)}\]]/.test(fragment)) text += ' ';
      text += fragment;
    });
    return text.trim().replace(/\s+/g, ' ');
  }

  function annotationRawText(surface) {
    return annotationTextNodes(surface).map((node) => node.nodeValue).join('');
  }

  function annotationRawTextFromOffsets(surface, start, end) {
    return annotationPieces(surface, start, end)
      .map((piece) => piece.node.nodeValue.slice(piece.start, piece.end)).join('');
  }

  const HIGHLIGHT_EXCLUDE_SELECTOR = [
    '.sr-only', '[hidden]', '[aria-hidden="true"]', '[data-annotation-exclude="true"]',
    '.review-translation-unit', '[data-review-translation-node="true"]',
    '.question-number', 'button', 'input', 'textarea', 'select', 'option',
    '.heading-token', '[data-heading-bank]', '.drop-zone', '.matching-review-list',
    '.answer-review', '.review-feedback', '.passage-matching-target',
  ].join(', ');

  function highlightNodeIsVisible(node, root) {
    let element = node.parentElement;
    while (element && root.contains(element)) {
      if (element.matches(HIGHLIGHT_EXCLUDE_SELECTOR)) return false;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (element === root) break;
      element = element.parentElement;
    }
    return true;
  }

  function highlightBlockId(surface, node) {
    const element = node.parentElement;
    if (!element) return '';
    if (normalizeAnnotationSurface(surface) === 'passage') {
      return String(element.closest('[data-review-translation-source-unit]')?.dataset.reviewTranslationSourceUnit || '');
    }
    const question = element.closest('[data-question]')?.dataset.question;
    if (question) return `question:${question}`;
    const questions = element.closest('[data-questions]')?.dataset.questions;
    if (questions) return `questions:${questions}`;
    const group = element.closest('[data-group-id]')?.dataset.groupId;
    return group ? `group:${group}` : '';
  }

  const highlightSplitWhitespaceNodes = new WeakSet();

  function captureHighlightTextFlowSplit(node) {
    // Preserve only text fragments made by this annotation operation.
    // Original structural whitespace keeps the established canonical filter.
    const include = Boolean(node.nodeValue.trim()) || highlightSplitWhitespaceNodes.has(node);
    const previous = node.previousSibling;
    const next = node.nextSibling;
    return (marker) => {
      if (!include) return;
      for (const fragment of [node, marker.previousSibling, marker.nextSibling, ...marker.childNodes]) {
        if (fragment && fragment !== previous && fragment !== next &&
            fragment.nodeType === Node.TEXT_NODE && !fragment.nodeValue.trim()) {
          highlightSplitWhitespaceNodes.add(fragment);
        }
      }
    };
  }

  function highlightCanonicalMap(surface) {
    const normalizedSurface = normalizeAnnotationSurface(surface);
    const root = annotationRoot(normalizedSurface);
    const blocks = new Map();
    const entries = [];
    if (!root) return { surface: normalizedSurface, root, blocks, entries, text: '' };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.length) return NodeFilter.FILTER_REJECT;
        if (!highlightNodeIsVisible(node, root)) return NodeFilter.FILTER_REJECT;
        const blockId = highlightBlockId(normalizedSurface, node);
        if (!blockId) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue.trim() && normalizedSurface !== 'passage' && !highlightSplitWhitespaceNodes.has(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let globalStart = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const blockId = highlightBlockId(normalizedSurface, node);
      let block = blocks.get(blockId);
      if (!block) {
        block = { blockId, text: '', entries: [] };
        blocks.set(blockId, block);
      }
      const entry = {
        node,
        blockId,
        globalStart,
        globalEnd: globalStart + node.nodeValue.length,
        blockStart: block.text.length,
        blockEnd: block.text.length + node.nodeValue.length,
      };
      entries.push(entry);
      block.entries.push(entry);
      block.text += node.nodeValue;
      globalStart = entry.globalEnd;
    }
    return { surface: normalizedSurface, root, blocks, entries, text: entries.map((entry) => entry.node.nodeValue).join('') };
  }

  function highlightRangeIntersectsExcluded(map, range) {
    if (!map.root) return true;
    return [...map.root.querySelectorAll(HIGHLIGHT_EXCLUDE_SELECTOR)].some((element) => {
      try { return range.intersectsNode(element); } catch (_error) { return true; }
    });
  }

  function highlightId() {
    return `highlight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function highlightLevel(value) {
    return Math.max(1, Math.min(HIGHLIGHT_LEVELS, Number(value) || 1));
  }

  function highlightRecordFromLocal(map, blockId, localStart, localEnd, level, preferredId) {
    const block = map.blocks.get(String(blockId));
    const start = Math.max(0, Number(localStart) || 0);
    const end = Math.max(0, Number(localEnd) || 0);
    if (!block || end <= start || end > block.text.length || !block.entries.length) return null;
    const quote = block.text.slice(start, end);
    if (!quote) return null;
    const first = block.entries.find((entry) => start >= entry.blockStart && start < entry.blockEnd);
    const last = block.entries.find((entry) => end > entry.blockStart && end <= entry.blockEnd);
    if (!first || !last) return null;
    const globalStart = first.globalStart + start - first.blockStart;
    const globalEnd = last.globalStart + end - last.blockStart;
    // A group may resume after a numbered question. A local range must not
    // silently bridge text owned by that different block.
    if (globalEnd - globalStart !== end - start) return null;
    return {
      schemaVersion: HIGHLIGHT_SCHEMA_VERSION,
      id: String(preferredId || highlightId()),
      surface: map.surface,
      part: Number(state.part),
      blockId: String(blockId),
      localStart: start,
      localEnd: end,
      quote,
      prefix: block.text.slice(Math.max(0, start - HIGHLIGHT_CONTEXT_CHARS), start),
      suffix: block.text.slice(end, Math.min(block.text.length, end + HIGHLIGHT_CONTEXT_CHARS)),
      level: highlightLevel(level),
      start: globalStart,
      end: globalStart + (end - start),
      resolutionStatus: 'resolved',
      resolutionMethod: 'captured-exact',
    };
  }

  function highlightRecordFromOffsets(surface, start, end, level, preferredId) {
    const map = highlightCanonicalMap(surface);
    const first = map.entries.find((entry) => start >= entry.globalStart && start < entry.globalEnd);
    const last = map.entries.find((entry) => end > entry.globalStart && end <= entry.globalEnd);
    if (!first || !last || first.blockId !== last.blockId) return null;
    const localStart = first.blockStart + (start - first.globalStart);
    const localEnd = last.blockStart + (end - last.globalStart);
    return highlightRecordFromLocal(map, first.blockId, localStart, localEnd, level, preferredId);
  }

  function highlightRecordFromRange(surface, range, level) {
    const map = highlightCanonicalMap(surface);
    if (!map.root || !range || !map.root.contains(range.startContainer) || !map.root.contains(range.endContainer)) return null;
    const first = map.entries.find((entry) => entry.node === range.startContainer);
    const last = map.entries.find((entry) => entry.node === range.endContainer);
    if (!first || !last || first.blockId !== last.blockId || highlightRangeIntersectsExcluded(map, range)) return null;
    const localStart = first.blockStart + Math.max(0, Math.min(range.startOffset, first.node.nodeValue.length));
    const localEnd = last.blockStart + Math.max(0, Math.min(range.endOffset, last.node.nodeValue.length));
    return highlightRecordFromLocal(map, first.blockId, localStart, localEnd, level);
  }

  function highlightContextMatches(blockText, record, start) {
    const quote = String(record.quote || '');
    const prefix = String(record.prefix || '');
    const suffix = String(record.suffix || '');
    return blockText.slice(start, start + quote.length) === quote &&
      blockText.slice(Math.max(0, start - prefix.length), start) === prefix &&
      blockText.slice(start + quote.length, start + quote.length + suffix.length) === suffix;
  }

  function unresolvedHighlight(record, surface, part, diagnostic, additions = {}) {
    return {
      ...record,
      ...additions,
      surface: normalizeAnnotationSurface(surface),
      part: Number(part),
      level: highlightLevel(record?.level),
      resolutionStatus: 'unresolved',
      diagnostic,
    };
  }

  function resolveHighlightRecord(surface, record) {
    const normalizedSurface = normalizeAnnotationSurface(surface);
    const part = Number(state.part);
    const map = highlightCanonicalMap(normalizedSurface);
    if (!record || typeof record !== 'object') return unresolvedHighlight({}, normalizedSurface, part, 'invalid-record');
    if (record.schemaVersion !== HIGHLIGHT_SCHEMA_VERSION) {
      const legacyStart = Math.max(0, Number(record.start) || 0);
      const legacyEnd = Math.max(0, Number(record.end) || 0);
      const legacyText = annotationRawText(normalizedSurface);
      const legacyQuote = legacyEnd > legacyStart ? annotationRawTextFromOffsets(normalizedSurface, legacyStart, legacyEnd) : '';
      if (legacyEnd > legacyStart && legacyText === map.text) {
        const upgraded = highlightRecordFromOffsets(normalizedSurface, legacyStart, legacyEnd, record.level, record.id);
        if (upgraded && upgraded.quote === legacyQuote) {
          upgraded.resolutionMethod = 'v1-same-text-flow-proof';
          upgraded.legacySchemaVersion = String(record.schemaVersion || 'offset-v1');
          return upgraded;
        }
      }
      return unresolvedHighlight(record, normalizedSurface, part, 'v1-same-text-flow-proof-failed', {
        legacySchemaVersion: String(record.schemaVersion || 'offset-v1'),
        quote: String(record.quote || legacyQuote),
      });
    }
    if (normalizeAnnotationSurface(record.surface) !== normalizedSurface || Number(record.part) !== part) {
      return unresolvedHighlight(record, normalizedSurface, part, 'surface-or-part-mismatch');
    }
    const block = map.blocks.get(String(record.blockId || ''));
    const quote = String(record.quote || '');
    if (!block || !quote) return unresolvedHighlight(record, normalizedSurface, part, block ? 'empty-quote' : 'stable-block-missing');
    const localStart = Number(record.localStart);
    if (Number.isInteger(localStart) && localStart >= 0 && localStart + quote.length <= block.text.length &&
        highlightContextMatches(block.text, record, localStart)) {
      const exact = highlightRecordFromLocal(map, record.blockId, localStart, localStart + quote.length, record.level, record.id);
      if (!exact) return unresolvedHighlight(record, normalizedSurface, part, 'noncontiguous-block-range');
      exact.resolutionMethod = 'exact-local-and-context';
      return exact;
    }
    const matches = [];
    let cursor = 0;
    while (cursor <= block.text.length - quote.length) {
      const found = block.text.indexOf(quote, cursor);
      if (found < 0) break;
      if (highlightContextMatches(block.text, record, found)) matches.push(found);
      cursor = found + Math.max(1, quote.length);
    }
    if (matches.length === 1) {
      const relocated = highlightRecordFromLocal(map, record.blockId, matches[0], matches[0] + quote.length, record.level, record.id);
      if (!relocated) return unresolvedHighlight(record, normalizedSurface, part, 'noncontiguous-block-range');
      relocated.resolutionMethod = 'unique-same-block-quote-and-context';
      return relocated;
    }
    return unresolvedHighlight(record, normalizedSurface, part, matches.length ? 'ambiguous-same-block-quote-and-context' : 'quote-or-context-not-found');
  }

  function highlightPiecesForRecord(surface, record) {
    const map = highlightCanonicalMap(surface);
    const block = map.blocks.get(String(record.blockId || ''));
    if (!block || record.resolutionStatus !== 'resolved') return [];
    const start = Number(record.localStart);
    const end = Number(record.localEnd);
    const pieces = [];
    block.entries.forEach((entry) => {
      const localStart = Math.max(0, start - entry.blockStart);
      const localEnd = Math.min(entry.node.nodeValue.length, end - entry.blockStart);
      if (localStart < localEnd && start < entry.blockEnd && end > entry.blockStart) {
        pieces.push({ node: entry.node, start: localStart, end: localEnd });
      }
    });
    return pieces;
  }

  function highlightRangeFromRecord(surface, record) {
    const resolved = resolveHighlightRecord(surface, record);
    const pieces = highlightPiecesForRecord(surface, resolved);
    if (!pieces.length) return null;
    const range = document.createRange();
    try {
      range.setStart(pieces[0].node, pieces[0].start);
      range.setEnd(pieces[pieces.length - 1].node, pieces[pieces.length - 1].end);
      return range;
    } catch (_error) {
      return null;
    }
  }

  function wrapHighlightRecord(surface, record) {
    const normalizedSurface = normalizeAnnotationSurface(surface);
    const pieces = highlightPiecesForRecord(normalizedSurface, record);
    pieces.reverse().forEach((piece) => {
      const preserveTextFlow = captureHighlightTextFlowSplit(piece.node);
      const range = document.createRange();
      range.setStart(piece.node, piece.start);
      range.setEnd(piece.node, piece.end);
      const mark = document.createElement('mark');
      const surfaceClass = normalizedSurface === 'questions' ? 'question-highlight' : 'passage-highlight';
      mark.className = `annotation-highlight ${surfaceClass} highlight highlight-${record.level} highlight-level-${record.level}`;
      mark.dataset.annotationSurface = normalizedSurface;
      mark.dataset.highlightId = record.id;
      mark.dataset.highlightStart = String(record.start);
      mark.dataset.highlightEnd = String(record.end);
      mark.dataset.highlightLevel = String(record.level);
      mark.tabIndex = 0;
      mark.setAttribute('role', 'button');
      mark.setAttribute('aria-label', `Highlighted text: ${String(record.quote || '').slice(0, 80)}. Open delete highlight actions.`);
      try {
        range.surroundContents(mark);
      } catch (_error) {
        const fragment = range.extractContents();
        mark.append(fragment);
        range.insertNode(mark);
      }
      preserveTextFlow(mark);
    });
  }

  const noteDisplayAnchors = new Map();
  const unresolvedNoteAnchorIds = new Set();

  function noteQuoteFromPieces(pieces) {
    let text = '';
    pieces.forEach((piece) => {
      const fragment = piece.text;
      if (text && !/\s$/.test(text) && !/^[\s.,;:!?…)}\]]/.test(fragment)) text += ' ';
      text += fragment;
    });
    return text.trim().replace(/\s+/g, ' ').slice(0, 500);
  }

  function originalNoteTextFlow(surface) {
    let start = 0;
    return annotationTextNodes(surface).map((node) => {
      const piece = { text: node.nodeValue, start, end: start + node.nodeValue.length };
      start = piece.end;
      return piece;
    });
  }

  function noteLegacyFlowCandidate(flow, start, end) {
    const pieces = [];
    let offset = 0;
    for (const piece of flow) {
      if (!piece.text.trim()) continue;
      const from = Math.max(0, start - offset);
      const to = Math.min(piece.text.length, end - offset);
      if (from < to) pieces.push({ text: piece.text.slice(from, to), start: piece.start + from, end: piece.start + to });
      offset += piece.text.length;
    }
    if (!pieces.length || end > offset) return null;
    return { start: pieces[0].start, end: pieces[pieces.length - 1].end, capturedQuote: noteQuoteFromPieces(pieces) };
  }

  function splitLegacyNoteFlow(flow, start, end) {
    return flow.flatMap((piece) => {
      const cuts = [...new Set([piece.start, Math.max(piece.start, Math.min(piece.end, start)),
        Math.max(piece.start, Math.min(piece.end, end)), piece.end])].sort((a, b) => a - b);
      return cuts.slice(0, -1).map((from, index) => ({
        text: piece.text.slice(from - piece.start, cuts[index + 1] - piece.start), start: from, end: cuts[index + 1],
      }));
    });
  }

  function resolveNoteDisplay(note, legacyFlow) {
    const surface = normalizeAnnotationSurface(note.surface);
    const quote = String(note.quote || '');
    const fingerprint = JSON.stringify([surface, Number(note.part), Number(note.start), Number(note.end), quote]);
    const key = String(note.id);
    const matches = (candidate) => {
      if (!candidate || !quote || candidate.end <= candidate.start || candidate.start < 0 || candidate.end > annotationLength(surface)) return false;
      const pieces = annotationPieces(surface, candidate.start, candidate.end)
        .map((piece) => ({ text: piece.node.nodeValue.slice(piece.start, piece.end) }));
      const rawQuote = pieces.map((piece) => piece.text).join('').trim().replace(/\s+/g, ' ').slice(0, 500);
      return noteQuoteFromPieces(pieces) === quote || rawQuote === quote || candidate.capturedQuote === quote;
    };
    const cached = noteDisplayAnchors.get(key);
    if (cached && cached.fingerprint === fingerprint) {
      const raw = annotationRawTextFromOffsets(surface, cached.start, cached.end);
      return raw === cached.sourceText ? cached : null;
    }
    const candidates = [
      { start: Number(note.start), end: Number(note.end) },
      surface === 'questions' ? noteLegacyFlowCandidate(legacyFlow, Number(note.start), Number(note.end)) : null,
    ].filter(matches);
    const unique = candidates.filter((candidate, index) => !candidates.slice(0, index)
      .some((earlier) => earlier.start === candidate.start && earlier.end === candidate.end));
    if (unique.length !== 1) return null;
    const resolved = { start: unique[0].start, end: unique[0].end, fingerprint,
      sourceText: annotationRawTextFromOffsets(surface, unique[0].start, unique[0].end) };
    noteDisplayAnchors.set(key, resolved);
    return resolved;
  }

  function wrapNoteOffsets(note) {
    const surface = normalizeAnnotationSurface(note.surface);
    const start = Number(note.start);
    const end = Number(note.end);
    const pieces = annotationPieces(surface, start, end);
    pieces.reverse().forEach((piece) => {
      const preserveTextFlow = captureHighlightTextFlowSplit(piece.node);
      const range = document.createRange();
      range.setStart(piece.node, piece.start);
      range.setEnd(piece.node, piece.end);
      const anchor = document.createElement('mark');
      anchor.className = 'note-anchor';
      anchor.dataset.annotationSurface = surface;
      anchor.dataset.noteId = note.id;
      anchor.tabIndex = 0;
      anchor.setAttribute('role', 'button');
      anchor.setAttribute('aria-label', `Open note for: ${String(note.quote || '').slice(0, 80)}`);
      try {
        range.surroundContents(anchor);
      } catch (error) {
        const fragment = range.extractContents();
        anchor.append(fragment);
        range.insertNode(anchor);
      }
      preserveTextFlow(anchor);
    });
  }

  function applyAnnotations(surface) {
    const normalizedSurface = normalizeAnnotationSurface(surface);
    const root = annotationRoot(normalizedSurface);
    if (!root) return;
    const store = highlightStore(normalizedSurface);
    const original = Array.isArray(store[state.part]) ? store[state.part] : [];
    let legacyNoteFlow = originalNoteTextFlow(normalizedSurface);
    const resolved = original.map((record) => resolveHighlightRecord(normalizedSurface, record));
    store[state.part] = resolved;
    resolved
      .filter((record) => record.resolutionStatus === 'resolved')
      .sort((a, b) => Number(a.start) - Number(b.start))
      .forEach((record) => wrapHighlightRecord(normalizedSurface, record));
    state.notes
      .filter((note) => normalizeAnnotationSurface(note.surface) === normalizedSurface && Number(note.part) === state.part)
      .sort((a, b) => Number(a.start) - Number(b.start))
      .forEach((note) => {
        const display = resolveNoteDisplay(note, legacyNoteFlow);
        if (!display) {
          unresolvedNoteAnchorIds.add(String(note.id));
          return;
        }
        unresolvedNoteAnchorIds.delete(String(note.id));
        legacyNoteFlow = splitLegacyNoteFlow(legacyNoteFlow, display.start, display.end);
        wrapNoteOffsets({ ...note, start: display.start, end: display.end });
      });
    if (JSON.stringify(original) !== JSON.stringify(resolved)) saveState();
  }

  function resolvedHighlightRecords(surface) {
    const store = highlightStore(surface);
    const records = Array.isArray(store[state.part]) ? store[state.part] : [];
    return records.map((record) => resolveHighlightRecord(surface, record));
  }

  function mergedHighlightSegments(surface, segments) {
    const sorted = segments
      .filter((segment) => segment.level > 0 && segment.end > segment.start)
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    sorted.forEach((segment) => {
      const previous = merged[merged.length - 1];
      const previousRecord = previous && highlightRecordFromOffsets(surface, previous.start, previous.end, previous.level);
      const currentRecord = highlightRecordFromOffsets(surface, segment.start, segment.end, segment.level);
      if (previous && previous.end === segment.start && previous.level === segment.level &&
          previousRecord && currentRecord && previousRecord.blockId === currentRecord.blockId) previous.end = segment.end;
      else merged.push({ start: segment.start, end: segment.end, level: segment.level });
    });
    return merged;
  }

  function verifyRenderedHighlight(surface, record) {
    if (forceHighlightSelfCheckFailure) {
      forceHighlightSelfCheckFailure = false;
      return false;
    }
    const root = annotationRoot(surface);
    if (!root || record.resolutionStatus !== 'resolved') return false;
    const marks = [...root.querySelectorAll('.annotation-highlight[data-highlight-id]')]
      .filter((mark) => mark.dataset.highlightId === record.id);
    if (!marks.length || marks.map((mark) => mark.textContent).join('') !== record.quote) return false;
    const resolved = resolveHighlightRecord(surface, record);
    return resolved.resolutionStatus === 'resolved' && resolved.quote === record.quote &&
      resolved.blockId === record.blockId && resolved.localStart === record.localStart && resolved.localEnd === record.localEnd;
  }

  function cycleHighlight(surface, selectionRecord) {
    const normalizedSurface = normalizeAnnotationSurface(surface);
    if (!selectionRecord || selectionRecord.surface !== normalizedSurface || Number(selectionRecord.part) !== state.part) {
      showHighlightPrompt('请选择同一段落或同一道题内的文字后再使用 Highlight。');
      return false;
    }
    const selected = resolveHighlightRecord(normalizedSurface, selectionRecord);
    const selectedFromOffsets = selected.resolutionStatus === 'resolved'
      ? highlightRecordFromOffsets(normalizedSurface, selected.start, selected.end, selected.level)
      : null;
    if (!selectedFromOffsets || selectedFromOffsets.quote !== selectionRecord.quote ||
        selectedFromOffsets.blockId !== selectionRecord.blockId ||
        selectedFromOffsets.localStart !== selected.localStart || selectedFromOffsets.localEnd !== selected.localEnd) {
      showHighlightPrompt('Highlight 未能准确固定到所选文字，已撤销；请缩小选择范围后重试。');
      return false;
    }
    selectionRecord = selected;
    const store = highlightStore(normalizedSurface);
    const snapshot = JSON.parse(JSON.stringify(Array.isArray(store[state.part]) ? store[state.part] : []));
    const resolved = resolvedHighlightRecords(normalizedSurface);
    const unresolved = resolved.filter((record) => record.resolutionStatus !== 'resolved');
    const existing = resolved.filter((record) => record.resolutionStatus === 'resolved')
      .map((record) => ({ start: Number(record.start), end: Number(record.end), level: highlightLevel(record.level) }))
      .sort((a, b) => a.start - b.start);
    const start = Number(selectionRecord.start);
    const end = Number(selectionRecord.end);
    const result = [];
    let cursor = start;
    existing.forEach((interval) => {
      if (interval.end <= start || interval.start >= end) {
        result.push(interval);
        return;
      }
      const overlapStart = Math.max(start, interval.start);
      const overlapEnd = Math.min(end, interval.end);
      if (interval.start < overlapStart) result.push({ start: interval.start, end: overlapStart, level: interval.level });
      if (cursor < overlapStart) result.push({ start: cursor, end: overlapStart, level: 1 });
      result.push({ start: overlapStart, end: overlapEnd, level: Math.min(HIGHLIGHT_LEVELS, interval.level + 1) });
      cursor = Math.max(cursor, overlapEnd);
      if (interval.end > overlapEnd) result.push({ start: overlapEnd, end: interval.end, level: interval.level });
    });
    if (cursor < end) result.push({ start: cursor, end, level: 1 });
    const rebuilt = mergedHighlightSegments(normalizedSurface, result)
      .map((segment) => highlightRecordFromOffsets(normalizedSurface, segment.start, segment.end, segment.level))
      .filter(Boolean);
    store[state.part] = [...unresolved, ...rebuilt];
    if (normalizedSurface === 'questions') renderQuestions({ preserveScroll: true });
    else renderPassage({ preserveScroll: true });
    const selectedAfterRender = resolveHighlightRecord(normalizedSurface, selectionRecord);
    const selectedPieces = highlightPiecesForRecord(normalizedSurface, selectedAfterRender);
    const selectedDrawnQuote = selectedPieces.map((piece) => piece.node.nodeValue.slice(piece.start, piece.end)).join('');
    const selectedIsCovered = selectedPieces.length > 0 && selectedPieces.every((piece) =>
      piece.node.parentElement?.closest('.annotation-highlight[data-highlight-id]'));
    const verified = rebuilt.length > 0 && rebuilt.every((record) => verifyRenderedHighlight(normalizedSurface, record)) &&
      selectedAfterRender.resolutionStatus === 'resolved' && selectedDrawnQuote === selectionRecord.quote && selectedIsCovered;
    if (!verified) {
      store[state.part] = snapshot;
      saveState();
      if (normalizedSurface === 'questions') renderQuestions({ preserveScroll: true });
      else renderPassage({ preserveScroll: true });
      showHighlightPrompt('Highlight 未能准确固定到所选文字，已撤销；请缩小选择范围后重试。');
      return false;
    }
    saveState();
    notifyAnnotationMutation('highlight', true);
    return true;
  }

  function deleteHighlightRange(surface, start, end, recordId) {
    const normalizedSurface = normalizeAnnotationSurface(surface);
    const store = highlightStore(normalizedSurface);
    const snapshot = JSON.parse(JSON.stringify(Array.isArray(store[state.part]) ? store[state.part] : []));
    const resolved = resolvedHighlightRecords(normalizedSurface);
    const result = [];
    resolved.forEach((record) => {
      if (record.resolutionStatus !== 'resolved') {
        result.push(record);
        return;
      }
      if (recordId && record.id === recordId) return;
      if (recordId || record.end <= start || record.start >= end) {
        result.push(record);
        return;
      }
      if (record.start < start) {
        const left = highlightRecordFromOffsets(normalizedSurface, record.start, start, record.level);
        if (left) result.push(left);
      }
      if (record.end > end) {
        const right = highlightRecordFromOffsets(normalizedSurface, end, record.end, record.level);
        if (right) result.push(right);
      }
    });
    store[state.part] = result;
    if (normalizedSurface === 'questions') renderQuestions({ preserveScroll: true });
    else renderPassage({ preserveScroll: true });
    const root = annotationRoot(normalizedSurface);
    const selectedGone = !recordId || ![...(root?.querySelectorAll('.annotation-highlight[data-highlight-id]') || [])]
      .some((mark) => mark.dataset.highlightId === recordId);
    const remainingVerified = result
      .filter((record) => record.resolutionStatus !== 'unresolved')
      .every((record) => verifyRenderedHighlight(normalizedSurface, resolveHighlightRecord(normalizedSurface, record)));
    if (!selectedGone || !remainingVerified) {
      store[state.part] = snapshot;
      if (normalizedSurface === 'questions') renderQuestions({ preserveScroll: true });
      else renderPassage({ preserveScroll: true });
      saveState();
      showHighlightPrompt('Highlight 删除后的定位自检未通过，已恢复原标注；请重试。');
      return false;
    }
    saveState();
    notifyAnnotationMutation('highlight', true);
    return true;
  }

  function highlightRecordById(surface, id) {
    const store = highlightStore(surface);
    return (store[state.part] || []).find((record) => record.id === id) || null;
  }

  function selectionRect(selection) {
    if (!selection || selection.part !== state.part) return null;
    const storedRecord = selection.highlightRecord || (selection.highlightId ? highlightRecordById(selection.surface, selection.highlightId) : null);
    const range = storedRecord
      ? highlightRangeFromRecord(selection.surface, storedRecord)
      : rangeFromOffsets(selection.surface, selection.start, selection.end);
    if (!range) return null;
    const rect = range.getBoundingClientRect();
    if (rect.width || rect.height) return rect;
    const rects = range.getClientRects();
    return rects.length ? rects[0] : null;
  }

  function positionSelectionMenu() {
    if (!els.selectionMenu || els.selectionMenu.hidden || !currentSelection) return;
    const rect = selectionRect(currentSelection);
    if (!rect) {
      closeSelectionMenu();
      return;
    }
    positionFloating(els.selectionMenu, rect, 'below');
  }

  function setSelectionActionLabel(button, label) {
    if (!button) return;
    const labelElement = button.querySelector(
      '[data-selection-label], .selection-action-label, .action-label, .button-label'
    );
    if (labelElement) {
      labelElement.textContent = label;
      return;
    }
    const textNode = [...button.childNodes].find((node) =>
      node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()
    );
    if (textNode) {
      const leadingSpace = /^\s/.test(textNode.nodeValue) ? ' ' : '';
      const trailingSpace = /\s$/.test(textNode.nodeValue) ? ' ' : '';
      textNode.nodeValue = `${leadingSpace}${label}${trailingSpace}`;
      return;
    }
    const fallbackLabel = document.createElement('span');
    fallbackLabel.className = 'selection-action-label';
    fallbackLabel.dataset.selectionLabel = '';
    fallbackLabel.textContent = label;
    button.append(fallbackLabel);
  }

  function updateSelectionActionState(deleting) {
    els.selectionMenu?.classList.toggle('is-delete-mode', deleting);
    if (els.noteAction) {
      els.noteAction.hidden = deleting;
      els.noteAction.classList.remove('is-delete-action');
      els.noteAction.setAttribute('aria-label', 'Create note');
      els.noteAction.title = 'Note (a)';
      setSelectionActionLabel(els.noteAction, 'Note');
    }
    if (els.highlightAction) {
      els.highlightAction.classList.toggle('is-delete-action', deleting);
      els.highlightAction.setAttribute('aria-label', deleting ? 'Delete highlight' : 'Create highlight');
      els.highlightAction.title = deleting ? 'Delete Highlight (d)' : 'Highlight (h)';
      setSelectionActionLabel(els.highlightAction, deleting ? 'Delete Highlight' : 'Highlight');
    }
  }

  function openSelectionMenu(selection, rect, mode, focusFirstAction) {
    if (!els.selectionMenu) return;
    currentSelection = { ...selection, surface: normalizeAnnotationSurface(selection.surface), part: state.part };
    selectionMenuMode = mode || 'selection';
    selectionReturnFocus = focusFirstAction && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    updateSelectionActionState(selectionMenuMode === 'delete-highlight');
    els.selectionMenu.hidden = false;
    els.selectionMenu.classList.add('is-open');
    positionFloating(els.selectionMenu, rect || selectionRect(currentSelection), 'below');
    if (focusFirstAction) {
      window.requestAnimationFrame(() => {
        const firstAction = [...els.selectionMenu.querySelectorAll('button:not([disabled])')]
          .find((button) => !button.hidden && button.getClientRects().length > 0);
        firstAction?.focus();
      });
    }
  }

  function closeSelectionMenu(clearBrowserSelection) {
    const returnFocus = els.selectionMenu?.contains(document.activeElement) ? selectionReturnFocus : null;
    if (els.selectionMenu) {
      els.selectionMenu.hidden = true;
      els.selectionMenu.classList.remove('is-open');
    }
    currentSelection = null;
    selectionMenuMode = 'selection';
    selectionReturnFocus = null;
    updateSelectionActionState(false);
    if (clearBrowserSelection !== false) window.getSelection()?.removeAllRanges();
    if (returnFocus instanceof HTMLElement) {
      window.requestAnimationFrame(() => {
        if (returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
      });
    }
  }

  function captureAnnotationSelection(surface, focusFirstAction) {
    const normalizedSurface = normalizeAnnotationSurface(surface);
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    const offsets = selectionToOffsets(normalizedSurface, range);
    if (!offsets || !annotationTextFromOffsets(normalizedSurface, offsets.start, offsets.end)) return false;
    const highlightRecord = highlightRecordFromRange(normalizedSurface, range, 1);
    const rect = range.getBoundingClientRect();
    openSelectionMenu({ ...offsets, highlightRecord }, rect, 'selection', Boolean(focusFirstAction));
    return true;
  }

  function onHighlightAction() {
    if (!currentSelection) return;
    const { surface, start, end, highlightRecord, highlightId: selectedHighlightId } = currentSelection;
    const deleting = selectionMenuMode === 'delete-highlight';
    const restoreSurfaceFocus = deleting && Boolean(els.selectionMenu?.contains(document.activeElement));
    closeSelectionMenu();
    if (deleting) {
      const deleted = deleteHighlightRange(surface, start, end, selectedHighlightId);
      if (deleted) announceStatus('Highlight deleted.');
      if (deleted && restoreSurfaceFocus) {
        window.requestAnimationFrame(() => annotationPane(surface)?.focus({ preventScroll: true }));
      }
    } else if (cycleHighlight(surface, highlightRecord)) {
      announceStatus('Highlight applied.');
    }
  }

  function createNoteFromSelection() {
    if (!currentSelection) return;
    const { surface, start, end } = currentSelection;
    const quote = annotationRawTextFromOffsets(surface, start, end).trim().replace(/\s+/g, ' ');
    if (!quote) return;
    const note = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      part: state.part,
      surface: normalizeAnnotationSurface(surface),
      start,
      end,
      quote: quote.slice(0, 500),
      text: '',
    };
    state.notes.push(note);
    saveState();
    notifyAnnotationMutation('note-structure', true);
    closeSelectionMenu();
    if (surface === 'questions') renderQuestions({ preserveScroll: true });
    else renderPassage({ preserveScroll: true });
    openNoteEditor(note.id);
  }

  function noteById(id) {
    return state.notes.find((note) => note.id === id);
  }

  function positionNoteEditor() {
    // The verified official editor is a fixed right sidebar, so it does not
    // need anchor-coordinate updates while the passage scrolls or reflows.
  }

  function renderNotesSidebar() {
    if (!els.notesHost) return;
    els.notesHost.hidden = !state.showNotes;
    if (!state.showNotes) {
      els.notesHost.innerHTML = '';
      return;
    }
    const notes = state.notes;
    const content = notes.length ? `<div class="notes-list">${notes.map((note) => {
      const deleting = pendingDeleteNoteId === note.id;
      return `<article class="note-card ${activeNoteId === note.id ? 'is-active' : ''}" data-note-card="${h(note.id)}">
        <button class="note-card-heading" type="button" data-note-select="${h(note.id)}"><strong>Part ${note.part}</strong><em>${h(note.quote)}</em>${unresolvedNoteAnchorIds.has(String(note.id)) ? '<small>原文位置待确认；笔记已保留</small>' : ''}</button>
        <label><span class="sr-only">Note text</span><textarea data-note-text data-note-id="${h(note.id)}" aria-label="You are currently on text input field. The text will save automatically." placeholder="Start typing your note">${h(note.text || '')}</textarea></label>
        ${deleting ? `<div class="note-delete-confirm" role="alert"><p>You are about to delete a note from Part ${note.part}</p><div><button type="button" data-note-delete-cancel>Cancel</button><button type="button" data-note-delete-confirm="${h(note.id)}">Confirm deleting</button></div></div>` : `<button class="note-delete-button" type="button" data-note-delete="${h(note.id)}" aria-label="Delete note for question Part ${note.part}">Delete</button>`}
      </article>`;
    }).join('')}</div>` : '<div class="notes-empty"><strong>Your private notes will show here</strong><p>Select text to highlight or create a note.</p></div>';
    els.notesHost.innerHTML = `<header class="notes-sidebar-header"><strong>Notes</strong><button type="button" data-note-close aria-label="Hide notes"><span class="fa-icon fa-times" aria-hidden="true"></span></button></header>${content}`;
  }

  function openNoteEditor(id) {
    const note = noteById(id);
    if (!note || !els.notesHost) return;
    if (Number(note.part) !== state.part) {
      setActivePart(Number(note.part));
      state.currentQuestion = questionsForPart(state.part)[0] || firstQuestion();
      renderAll();
    }
    activeNoteId = id;
    pendingDeleteNoteId = null;
    state.showNotes = true;
    saveState();
    applyPreferences();
    renderNotesSidebar();
    window.requestAnimationFrame(() => {
      els.notesHost.querySelector(`[data-note-id="${CSS.escape(id)}"]`)?.focus();
    });
  }

  function closeNoteEditor() {
    if (!state.showNotes) return false;
    notifyAnnotationMutation('notes-close', true);
    state.showNotes = false;
    pendingDeleteNoteId = null;
    saveState();
    notifyAnnotationMutation('note-structure', true);
    applyPreferences();
    renderNotesSidebar();
    window.requestAnimationFrame(() => els.showNotesButton?.focus({ preventScroll: true }));
    return true;
  }

  function deleteNote(id) {
    if (!id) return;
    const note = noteById(id);
    const surface = normalizeAnnotationSurface(note && note.surface);
    state.notes = state.notes.filter((note) => note.id !== id);
    if (activeNoteId === id) activeNoteId = null;
    pendingDeleteNoteId = null;
    saveState();
    notifyAnnotationMutation('note-structure', true);
    if (surface === 'questions') renderQuestions({ preserveScroll: true });
    else renderPassage({ preserveScroll: true });
    renderNotesSidebar();
    announceStatus('Note deleted.');
    window.requestAnimationFrame(() => els.notesHost?.querySelector('[data-note-close]')?.focus({ preventScroll: true }));
  }

  function toggleNotes() {
    if (state.showNotes) notifyAnnotationMutation('notes-close', true);
    state.showNotes = !state.showNotes;
    saveState();
    applyPreferences();
    if (!state.showNotes) pendingDeleteNoteId = null;
    renderNotesSidebar();
    if (!state.showNotes) {
      window.requestAnimationFrame(() => els.showNotesButton?.focus({ preventScroll: true }));
    }
    announceStatus(state.showNotes ? 'Notes are shown.' : 'Notes are hidden.');
  }

  function headingGroupForElement(element) {
    const host = element && element.closest('[data-heading-group]');
    return host ? model.groups.get(host.dataset.headingGroup) : null;
  }

  function beginPointerDrag(event) {
    if (state.submitted || event.button !== 0 || dragState) return;
    const token = event.target.closest('.heading-token[data-heading-id]');
    if (!token || (!els.questionsContent?.contains(token) && !els.passageContent?.contains(token))) return;
    const group = headingGroupForElement(token);
    if (!group) return;
    event.preventDefault();
    token.focus({ preventScroll: true });
    const tokenRect = token.getBoundingClientRect();
    dragState = {
      id: token.dataset.headingId,
      groupId: group.id,
      sourceQuestion: Number(token.dataset.sourceQuestion) || 0,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      grabOffsetX: Math.max(0, Math.min(tokenRect.width, event.clientX - tokenRect.left)),
      grabOffsetY: Math.max(0, Math.min(tokenRect.height, event.clientY - tokenRect.top)),
      sourceWidth: tokenRect.width,
      sourceHeight: tokenRect.height,
      token,
      started: false,
      ghost: null,
      targetZone: null,
      scrollFrame: 0,
    };
    try {
      token.setPointerCapture(event.pointerId);
    } catch (error) {
      // Pointer capture is an enhancement; window-level listeners remain active.
    }
  }

  function createDragGhost() {
    if (!dragState || dragState.started) return;
    dragState.started = true;
    dragState.token.classList.add('is-dragging');
    dragState.token.setAttribute('aria-grabbed', 'true');
    document.body.classList.add('is-heading-dragging');
    document.body.classList.add('is-dragging');
    const ghost = dragState.token.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.removeAttribute('data-source-question');
    ghost.removeAttribute('disabled');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.tabIndex = -1;
    ghost.classList.remove('is-dragging');
    ghost.classList.add('drag-ghost');
    ghost.style.width = `${Math.min(dragState.sourceWidth, window.innerWidth - 16)}px`;
    ghost.style.minHeight = `${dragState.sourceHeight}px`;
    document.body.appendChild(ghost);
    dragState.ghost = ghost;
    const ghostRect = ghost.getBoundingClientRect();
    dragState.ghostWidth = ghostRect.width;
    dragState.ghostHeight = ghostRect.height;
    positionDragGhost();
    dragState.scrollFrame = window.requestAnimationFrame(autoScrollDuringDrag);
  }

  function positionDragGhost() {
    if (!dragState || !dragState.ghost) return;
    const offsetX = Math.min(dragState.grabOffsetX, Math.max(0, dragState.ghostWidth - 1));
    const offsetY = Math.min(dragState.grabOffsetY, Math.max(0, dragState.ghostHeight - 1));
    dragState.ghost.style.left = `${Math.round(dragState.x - offsetX)}px`;
    dragState.ghost.style.top = `${Math.round(dragState.y - offsetY)}px`;
  }

  function updateDragTarget() {
    if (!dragState || !dragState.started) return;
    const underPointer = document.elementFromPoint(dragState.x, dragState.y);
    let zone = underPointer && underPointer.closest('.drop-zone[data-drop-question], [data-heading-bank]');
    const inKnownPane = zone && (els.questionsContent?.contains(zone) || els.passageContent?.contains(zone));
    if (zone && (!inKnownPane || headingGroupForElement(zone)?.id !== dragState.groupId)) zone = null;
    if (dragState.targetZone !== zone) {
      dragState.targetZone?.classList.remove('is-drag-over', 'drag-over', 'is-active');
      dragState.targetZone = zone;
      dragState.targetZone?.classList.add('is-drag-over', 'drag-over', 'is-active');
    }
  }

  function autoScrollDuringDrag() {
    if (!dragState || !dragState.started) return;
    [els.passagePane, els.questionsPane].filter(Boolean).forEach((pane) => {
      const rect = pane.getBoundingClientRect();
      if (dragState.x < rect.left || dragState.x > rect.right) return;
      const threshold = Math.min(72, rect.height * 0.12);
      let delta = 0;
      if (dragState.y < rect.top + threshold) delta = -Math.ceil((rect.top + threshold - dragState.y) / 7);
      else if (dragState.y > rect.bottom - threshold) delta = Math.ceil((dragState.y - (rect.bottom - threshold)) / 7);
      if (delta) {
        pane.scrollTop += Math.max(-18, Math.min(18, delta));
        updateDragTarget();
      }
    });
    dragState.scrollFrame = window.requestAnimationFrame(autoScrollDuringDrag);
  }

  function movePointerDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    dragState.x = event.clientX;
    dragState.y = event.clientY;
    if (!dragState.started && Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) >= 5) createDragGhost();
    if (!dragState.started) return;
    event.preventDefault();
    positionDragGhost();
    updateDragTarget();
  }

  function rerenderMatchingInteraction(focusQuestion) {
    const passageScroll = els.passagePane ? els.passagePane.scrollTop : 0;
    const questionScroll = els.questionsPane ? els.questionsPane.scrollTop : 0;
    renderPassage({ preserveScroll: true });
    renderQuestions({ preserveScroll: true });
    if (els.passagePane) els.passagePane.scrollTop = passageScroll;
    if (els.questionsPane) els.questionsPane.scrollTop = questionScroll;
    renderFooter();
    window.requestAnimationFrame(() => {
      if (focusQuestion) {
        const target = els.passageContent?.querySelector(`[data-drop-question="${focusQuestion}"]`) ||
          els.questionsContent?.querySelector(`[data-drop-question="${focusQuestion}"]`);
        target?.focus({ preventScroll: true });
      }
    });
  }

  function assignHeading(groupId, headingId, targetQuestion, sourceQuestion) {
    const group = model.groups.get(groupId);
    const target = Number(targetQuestion);
    if (!group || !isDragMatchingGroup(group) || !group.questionNumbers.includes(target) || !matchingOption(group, headingId)) return false;
    setAnswerForQuestion(target, headingId, 'set-option');
    state.currentQuestion = target;
    setActivePart(partForQuestion(target));
    state.lastQuestionByPart[state.part] = target;
    saveState();
    rerenderMatchingInteraction(target);
    return true;
  }

  function returnHeadingToBank(groupId, headingId, sourceQuestion) {
    const group = model.groups.get(groupId);
    const source = Number(sourceQuestion);
    if (!group || !source || answerForQuestion(source) !== headingId) return false;
    clearAnswerForQuestion(source);
    state.currentQuestion = source;
    setActivePart(partForQuestion(source));
    state.lastQuestionByPart[state.part] = source;
    saveState();
    rerenderMatchingInteraction(0);
    window.requestAnimationFrame(() => els.questionsContent?.querySelector(`[data-heading-bank="${CSS.escape(groupId)}"]`)?.focus({ preventScroll: true }));
    return true;
  }

  function finishPointerDrag(event, cancelled) {
    if (!dragState) return;
    if (event && event.pointerId !== dragState.pointerId) return;
    const completed = dragState.started && dragState.targetZone && !cancelled;
    const details = completed ? {
      groupId: dragState.groupId,
      headingId: dragState.id,
      targetQuestion: Number(dragState.targetZone.dataset.dropQuestion) || 0,
      returnToBank: Boolean(dragState.targetZone.dataset.headingBank),
      sourceQuestion: dragState.sourceQuestion,
    } : null;
    window.cancelAnimationFrame(dragState.scrollFrame);
    dragState.targetZone?.classList.remove('is-drag-over', 'drag-over', 'is-active');
    dragState.token?.classList.remove('is-dragging');
    dragState.token?.setAttribute('aria-grabbed', 'false');
    dragState.ghost?.remove();
    document.body.classList.remove('is-heading-dragging');
    document.body.classList.remove('is-dragging');
    try {
      dragState.token?.releasePointerCapture(dragState.pointerId);
    } catch (error) {
      // The pointer may already have been released by the browser.
    }
    dragState = null;
    if (details) {
      const visibleHeading = headingTextForGroup(details.groupId, details.headingId) || 'Selected option';
      if (details.returnToBank) {
        if (returnHeadingToBank(details.groupId, details.headingId, details.sourceQuestion)) announceStatus(`“${visibleHeading}” returned to the list.`);
      } else {
        assignHeading(details.groupId, details.headingId, details.targetQuestion, details.sourceQuestion);
        announceStatus(`“${visibleHeading}” placed in answer ${details.targetQuestion}.`);
      }
    }
  }

  function beginKeyboardDrag(token) {
    if (state.submitted) return;
    const group = headingGroupForElement(token);
    if (!group) return;
    cancelKeyboardDrag(false);
    keyboardDrag = {
      id: token.dataset.headingId,
      groupId: group.id,
      sourceQuestion: Number(token.dataset.sourceQuestion) || 0,
      token,
    };
    token.setAttribute('aria-grabbed', 'true');
    document.body.classList.add('is-heading-keyboard-dragging');
    const visibleHeading = headingTextForGroup(keyboardDrag.groupId, keyboardDrag.id) || 'Selected option';
    announceStatus(`“${visibleHeading}” picked up. Move to an answer area and press Space to drop.`);
  }

  function moveHeadingWithArrow(token, direction) {
    if (state.submitted) return false;
    const group = headingGroupForElement(token);
    if (!group) return false;
    const sourceQuestion = Number(token.dataset.sourceQuestion) || 0;
    const openQuestions = group.questionNumbers.filter((number) => !isAnswered(number));
    let target = 0;
    if (!sourceQuestion) {
      target = direction > 0 ? openQuestions[0] : openQuestions[openQuestions.length - 1];
    } else if (direction > 0) {
      target = openQuestions.find((number) => number > sourceQuestion) || 0;
    } else {
      target = [...openQuestions].reverse().find((number) => number < sourceQuestion) || 0;
    }
    if (!target) return false;
    const moved = assignHeading(group.id, token.dataset.headingId, target, sourceQuestion);
    if (moved) {
      window.requestAnimationFrame(() => {
        const placed = els.passageContent?.querySelector(`[data-source-question="${target}"]`) ||
          els.questionsContent?.querySelector(`[data-source-question="${target}"]`);
        placed?.focus({ preventScroll: true });
      });
      const visibleHeading = headingText(group, token.dataset.headingId) || 'Selected option';
      announceStatus(`“${visibleHeading}” moved to answer ${target}.`);
    }
    return moved;
  }

  function cancelKeyboardDrag(announce) {
    if (!keyboardDrag) return false;
    keyboardDrag.token?.setAttribute('aria-grabbed', 'false');
    keyboardDrag = null;
    document.body.classList.remove('is-heading-keyboard-dragging');
    if (announce !== false) announceStatus('Move cancelled.');
    return true;
  }

  function dropKeyboardHeading(zone) {
    if (!keyboardDrag || !zone) return;
    const group = headingGroupForElement(zone);
    if (!group || group.id !== keyboardDrag.groupId) return;
    const details = keyboardDrag;
    keyboardDrag = null;
    document.body.classList.remove('is-heading-keyboard-dragging');
    if (zone.dataset.headingBank) {
      const visibleHeading = headingTextForGroup(details.groupId, details.id) || 'Selected option';
      if (returnHeadingToBank(details.groupId, details.id, details.sourceQuestion)) announceStatus(`“${visibleHeading}” returned to the list.`);
      return;
    }
    const target = Number(zone.dataset.dropQuestion);
    assignHeading(details.groupId, details.id, target, details.sourceQuestion);
    const visibleHeading = headingTextForGroup(details.groupId, details.id) || 'Selected option';
    announceStatus(`“${visibleHeading}” placed in answer ${target}.`);
  }

  function headingInteractionZones() {
    const selector = '.drop-zone[data-drop-question], [data-heading-bank]';
    return [
      ...Array.from(els.passageContent?.querySelectorAll(selector) || []),
      ...Array.from(els.questionsContent?.querySelectorAll(selector) || []),
    ];
  }

  function onQuestionsKeydown(event) {
    if (event.target.closest('[data-question-flag]')) return;
    if (handleAnnotationKeydown(event, 'questions')) return;
    const singleRadioInput = event.target.closest(
      'input[type="radio"][data-answer-question], input[type="radio"][data-grid-question]',
    );
    if (singleRadioInput && event.key === ' ' && clearSelectedSingleRadio(singleRadioInput, event)) return;
    const gridInput = event.target.closest('input[data-grid-group][data-grid-question][data-grid-option]');
    if (gridInput && event.key === 'Enter') {
      event.preventDefault();
      if (!clearSelectedSingleRadio(gridInput)) {
        assignGridOption(gridInput.dataset.gridGroup, Number(gridInput.dataset.gridQuestion), gridInput.dataset.gridOption);
      }
      return;
    }
    if (gridInput && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const group = model.groups.get(gridInput.dataset.gridGroup);
      if (!group) return;
      const options = matchingOptions(group);
      const rowIndex = group.questionNumbers.indexOf(Number(gridInput.dataset.gridQuestion));
      const columnIndex = options.findIndex((option) => normalizeAnswer(option.id) === normalizeAnswer(gridInput.dataset.gridOption));
      const nextRow = event.key === 'ArrowUp' ? Math.max(0, rowIndex - 1) :
        event.key === 'ArrowDown' ? Math.min(group.questionNumbers.length - 1, rowIndex + 1) : rowIndex;
      const nextColumn = event.key === 'ArrowLeft' ? Math.max(0, columnIndex - 1) :
        event.key === 'ArrowRight' ? Math.min(options.length - 1, columnIndex + 1) : columnIndex;
      const question = group.questionNumbers[nextRow];
      const option = options[nextColumn];
      els.questionsContent?.querySelector(`[data-grid-question="${question}"][data-grid-option="${CSS.escape(String(option.id))}"]`)?.focus();
      return;
    }
    const token = event.target.closest('.heading-token[data-heading-id]');
    const zone = event.target.closest('.drop-zone[data-drop-question], [data-heading-bank]');
    if (token && !keyboardDrag && ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) {
      event.preventDefault();
      moveHeadingWithArrow(token, ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1);
      return;
    }
    if (token && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault();
      if (keyboardDrag && keyboardDrag.token === token) cancelKeyboardDrag();
      else beginKeyboardDrag(token);
      return;
    }
    if (event.key === 'Escape' && keyboardDrag) {
      event.preventDefault();
      cancelKeyboardDrag();
      return;
    }
    if (token && keyboardDrag && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const zones = headingInteractionZones();
      const sourceIndex = zones.findIndex((item) => Number(item.dataset.dropQuestion) === keyboardDrag.sourceQuestion);
      const index = keyboardDrag.sourceQuestion === 0
        ? (event.key === 'ArrowDown' ? 0 : Math.max(0, zones.length - 2))
        : (event.key === 'ArrowDown' ? Math.max(0, sourceIndex + 1) : Math.max(0, sourceIndex - 1));
      zones[Math.min(zones.length - 1, index)]?.focus();
      return;
    }
    if (zone && keyboardDrag && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault();
      dropKeyboardHeading(zone);
      return;
    }
    if (zone && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const zones = headingInteractionZones();
      const index = zones.indexOf(zone);
      const next = event.key === 'ArrowDown' ? Math.min(zones.length - 1, index + 1) : Math.max(0, index - 1);
      zones[next]?.focus();
      return;
    }
    if (zone && zone.dataset.dropQuestion && !state.submitted && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      clearQuestion(Number(zone.dataset.dropQuestion));
    }
  }

  function setSplit(value, persist) {
    state.split = Math.max(30, Math.min(70, Number(value) || 50));
    applyPreferences();
    positionSelectionMenu();
    positionNoteEditor();
    if (persist) saveState();
  }

  function beginSplitterDrag(event) {
    if (!els.splitter || event.button !== 0) return;
    event.preventDefault();
    splitterDrag = { pointerId: event.pointerId };
    document.body.classList.add('is-resizing-panes');
    try {
      els.splitter.setPointerCapture(event.pointerId);
    } catch (error) {
      // Window listeners still provide the resize interaction.
    }
  }

  function moveSplitter(event) {
    if (!splitterDrag || event.pointerId !== splitterDrag.pointerId) return;
    const shell = byId('exam-shell');
    if (!shell) return;
    const rect = shell.getBoundingClientRect();
    if (!rect.width) return;
    event.preventDefault();
    setSplit(((event.clientX - rect.left) / rect.width) * 100, false);
  }

  function finishSplitter(event) {
    if (!splitterDrag || (event && event.pointerId !== splitterDrag.pointerId)) return;
    try {
      els.splitter?.releasePointerCapture(splitterDrag.pointerId);
    } catch (error) {
      // Pointer capture can already be gone on pointercancel.
    }
    splitterDrag = null;
    document.body.classList.remove('is-resizing-panes');
    saveState();
  }

  function handleFooterClick(event) {
    const question = event.target.closest('[data-nav-question]');
    if (question) {
      setCurrentQuestion(Number(question.dataset.navQuestion), true);
      return;
    }
    const block = event.target.closest('.part-block[data-part]');
    if (block && els.partNav?.contains(block)) switchPart(Number(block.dataset.part));
  }

  function handleFooterKeydown(event) {
    const questionButton = event.target.closest('[data-nav-question]');
    if (questionButton && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const buttons = [...questionButton.closest('.question-nav').querySelectorAll('[data-nav-question]')];
      const currentIndex = buttons.indexOf(questionButton);
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
        Math.max(0, Math.min(buttons.length - 1, currentIndex + (event.key === 'ArrowRight' ? 1 : -1)));
      const next = Number(buttons[nextIndex].dataset.navQuestion);
      setCurrentQuestion(next, true);
      window.requestAnimationFrame(() => document.querySelector(`[data-nav-question="${next}"]`)?.focus());
      return;
    }
    const partTab = event.target.closest('.part-tab[data-part]');
    if (partTab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const current = Number(partTab.dataset.part);
      const parts = model.parts.map((part) => Number(part.number));
      const currentIndex = Math.max(0, parts.indexOf(current));
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? parts.length - 1 :
        Math.max(0, Math.min(parts.length - 1, currentIndex + (event.key === 'ArrowRight' ? 1 : -1)));
      const next = parts[nextIndex];
      switchPart(next);
      window.requestAnimationFrame(() => document.querySelector(`.part-tab[data-part="${next}"]`)?.focus());
    }
  }

  function annotationSurfaceForElement(element, fallbackSurface) {
    return normalizeAnnotationSurface(element?.dataset.annotationSurface || fallbackSurface);
  }

  function handleAnnotationClick(event, fallbackSurface) {
    const marker = event.target.closest('.note-anchor[data-note-id]');
    if (marker) {
      event.preventDefault();
      event.stopPropagation();
      closeSelectionMenu();
      openNoteEditor(marker.dataset.noteId);
      return true;
    }
    const mark = event.target.closest('.annotation-highlight[data-highlight-start]');
    if (mark && (!window.getSelection() || window.getSelection().isCollapsed)) {
      event.preventDefault();
      event.stopPropagation();
      const surface = annotationSurfaceForElement(mark, fallbackSurface);
      const start = Number(mark.dataset.highlightStart);
      const end = Number(mark.dataset.highlightEnd);
      const selectedHighlightId = String(mark.dataset.highlightId || '');
      const highlightRecord = highlightRecordById(surface, selectedHighlightId);
      openSelectionMenu({ surface, start, end, highlightId: selectedHighlightId, highlightRecord }, mark.getBoundingClientRect(), 'delete-highlight');
      return true;
    }
    return false;
  }

  function handleAnnotationKeydown(event, fallbackSurface) {
    const noteAnchor = event.target.closest('.note-anchor[data-note-id]');
    if (noteAnchor && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openNoteEditor(noteAnchor.dataset.noteId);
      return true;
    }
    const highlight = event.target.closest('.annotation-highlight[data-highlight-start]');
    const surface = annotationSurfaceForElement(highlight, fallbackSurface);
    if (highlight && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      const start = Number(highlight.dataset.highlightStart);
      const end = Number(highlight.dataset.highlightEnd);
      const selectedHighlightId = String(highlight.dataset.highlightId || '');
      const highlightRecord = highlightRecordById(surface, selectedHighlightId);
      openSelectionMenu({ surface, start, end, highlightId: selectedHighlightId, highlightRecord }, highlight.getBoundingClientRect(), 'delete-highlight', true);
      return true;
    }
    if (highlight && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      const start = Number(highlight.dataset.highlightStart);
      const end = Number(highlight.dataset.highlightEnd);
      const deleted = deleteHighlightRange(surface, start, end, String(highlight.dataset.highlightId || ''));
      if (deleted) {
        announceStatus('Highlight deleted.');
        window.requestAnimationFrame(() => annotationPane(surface)?.focus({ preventScroll: true }));
      }
      return true;
    }
    return false;
  }

  function captureQuestionPointerSelection(event) {
    const choiceLabel = event.target.closest('.choice, .choice-label, .radio-choice, .checkbox-choice');
    const pointer = questionChoicePointer;
    questionChoicePointer = null;
    const isPrimaryChoiceActivation = Boolean(choiceLabel && pointer &&
      pointer.pointerId === event.pointerId && pointer.choiceLabel === choiceLabel &&
      pointer.button === 0 &&
      Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) < 5 &&
      performance.now() - pointer.startedAt < 600);
    if (isPrimaryChoiceActivation) {
      // A rapid second click on option text can make Chromium select the word
      // before pointerup. Treat a stationary primary gesture as choice
      // activation, not annotation, so the following native label click can
      // select or clear the control. Real drag-selection and long-press paths
      // continue below and still suppress the label click.
      suppressNextQuestionLabelClick = false;
      window.clearTimeout(suppressQuestionLabelClickHandle);
      closeSelectionMenu();
      return;
    }
    const captured = captureAnnotationSelection('questions', false);
    if (!captured || !choiceLabel) return;
    suppressNextQuestionLabelClick = true;
    window.clearTimeout(suppressQuestionLabelClickHandle);
    suppressQuestionLabelClickHandle = window.setTimeout(() => {
      suppressNextQuestionLabelClick = false;
    }, 0);
  }

  function beginQuestionPointerSelection(event) {
    const choiceLabel = event.target.closest('.choice, .choice-label, .radio-choice, .checkbox-choice');
    questionChoicePointer = choiceLabel ? {
      pointerId: event.pointerId,
      button: event.button,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      choiceLabel,
    } : null;
  }

  function cancelQuestionPointerSelection(event) {
    if (!questionChoicePointer || questionChoicePointer.pointerId === event.pointerId) questionChoicePointer = null;
  }

  function handlePassageClick(event) {
    if (handleQuestionFlagClick(event)) return;
    if (handleAnnotationClick(event, 'passage')) return;
    const answerTarget = event.target.closest('[data-question]');
    if (answerTarget) setCurrentQuestion(Number(answerTarget.dataset.question), false);
  }

  function handlePassageKeydown(event) {
    if (event.target.closest('[data-question-flag]')) return;
    if (handleAnnotationKeydown(event, 'passage')) return;
    onQuestionsKeydown(event);
  }

  function handleOptionsClick(event) {
    if (event.target.closest('#options-close-button')) {
      closeOptions();
      return;
    }
    if (event.target.closest('#options-back-button')) {
      optionsPanel = 'root';
      renderOptions();
      window.requestAnimationFrame(() => els.optionsContent?.querySelector('[data-options-submit]')?.focus());
      return;
    }
    const panel = event.target.closest('[data-options-panel]');
    if (panel) {
      optionsPanel = panel.dataset.optionsPanel;
      renderOptions();
      window.requestAnimationFrame(() => els.optionsContent?.querySelector('button')?.focus());
      return;
    }
    if (event.target.closest('[data-options-submit]')) {
      optionsPanel = 'submission';
      renderOptions();
      window.requestAnimationFrame(() => els.optionsContent?.querySelector('[data-submission-next]')?.focus());
      return;
    }
    if (event.target.closest('[data-submission-next]')) {
      closeOptions();
      openSubmitDialog();
      return;
    }
    const contrast = event.target.closest('[data-contrast-mode]');
    if (contrast) {
      state.contrastMode = contrast.dataset.contrastMode;
      state.contrast = state.contrastMode !== 'black-white';
      saveState();
      applyPreferences();
      syncOptionsChoiceState('data-contrast-mode', state.contrastMode);
      return;
    }
    const scale = event.target.closest('[data-font-scale]');
    if (scale) {
      state.fontScale = Number(scale.dataset.fontScale);
      saveState();
      applyPreferences();
      syncOptionsChoiceState('data-font-scale', state.fontScale);
      return;
    }
  }

  function handleNotesHostInput(event) {
    if (!event.target.matches('[data-note-text][data-note-id]')) return;
    const note = noteById(event.target.dataset.noteId);
    if (!note) return;
    activeNoteId = note.id;
    note.text = event.target.value;
    saveState();
    notifyAnnotationMutation('note-input', false);
  }

  function handleNotesHostClick(event) {
    const select = event.target.closest('[data-note-select]');
    if (select) {
      openNoteEditor(select.dataset.noteSelect);
      return;
    }
    const remove = event.target.closest('[data-note-delete]');
    if (remove) {
      const deletingNoteId = remove.dataset.noteDelete;
      pendingDeleteNoteId = deletingNoteId;
      renderNotesSidebar();
      window.requestAnimationFrame(() => {
        const card = els.notesHost?.querySelector(`[data-note-card="${CSS.escape(deletingNoteId)}"]`);
        card?.querySelector('[data-note-delete-cancel]')?.focus({ preventScroll: true });
      });
      return;
    }
    if (event.target.closest('[data-note-delete-cancel]')) {
      const cancelledNoteId = pendingDeleteNoteId;
      pendingDeleteNoteId = null;
      renderNotesSidebar();
      window.requestAnimationFrame(() => {
        if (!cancelledNoteId) return;
        els.notesHost?.querySelector(`[data-note-delete="${CSS.escape(cancelledNoteId)}"]`)?.focus({ preventScroll: true });
      });
      return;
    }
    const confirm = event.target.closest('[data-note-delete-confirm]');
    if (confirm) {
      deleteNote(confirm.dataset.noteDeleteConfirm);
      return;
    }
    if (event.target.closest('[data-note-close]')) closeNoteEditor();
  }

  function handleGlobalKeydown(event) {
    const timerGateOpen = !els.timerStartGate?.hidden;
    const modalOpen = timerGateOpen || !els.homeworkReceiptDialog?.hidden || !els.submitDialog?.hidden || !els.messagesView?.hidden || !els.optionsMenu?.hidden ||
      Boolean(els.notesHost?.querySelector('.note-delete-confirm'));
    if (event.key === 'Tab') {
      const modal = timerGateOpen ? els.timerStartCard :
        !els.homeworkReceiptDialog?.hidden ? els.homeworkReceiptDialog.querySelector('[role="dialog"]') :
        !els.submitDialog?.hidden ? els.submitDialog.querySelector('[role="dialog"]') :
        !els.messagesView?.hidden ? els.messagesView : !els.optionsMenu?.hidden ? els.optionsMenu : null;
      if (modal && trapModalFocus(event, modal)) return;
    }
    if (event.defaultPrevented) return;
    if (timerGateOpen) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape' && closeTopLayer()) {
      event.preventDefault();
      return;
    }
    if (modalOpen) {
      const blockedSubmitShortcut = (event.ctrlKey || event.metaKey) && event.key === 'Enter';
      const blockedNavigationShortcut = event.altKey && !event.ctrlKey && !event.metaKey &&
        ['ArrowLeft', 'ArrowRight'].includes(event.key);
      if (blockedSubmitShortcut || blockedNavigationShortcut) event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !state.submitted && !event.target.matches('textarea')) {
      event.preventDefault();
      openSubmitDialog();
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      setCurrentQuestion(adjacentQuestion(event.key === 'ArrowRight' ? 1 : -1), true);
    }
  }

  function handleDocumentPointerDown(event) {
    if (els.optionsMenu && !els.optionsMenu.hidden && !els.optionsMenu.contains(event.target) && !els.optionsButton?.contains(event.target)) closeOptions();
    if (els.selectionMenu && !els.selectionMenu.hidden && !els.selectionMenu.contains(event.target)) closeSelectionMenu();
  }

  function bindEvents() {
    bindQuestionFlagEvents();
    [els.questionsContent, els.passageContent].filter(Boolean).forEach((container) => {
      container.addEventListener('pointerdown', handleQuestionFlagPointer, { capture: true });
    });
    window.addEventListener('message', handleParentZoomState);
    els.appPanViewport?.addEventListener('wheel', handleAppPanWheel, { capture: true, passive: false });
    window.visualViewport?.addEventListener('resize', syncAppPanRange, { passive: true });
    window.visualViewport?.addEventListener('scroll', syncAppPanRange, { passive: true });
    if (els.appPanViewport && typeof ResizeObserver === 'function') {
      panViewportResizeObserver = new ResizeObserver(syncAppPanRange);
      panViewportResizeObserver.observe(els.appPanViewport);
    }
    syncAppPanRange();

    els.questionsContent?.addEventListener('input', onQuestionInput);
    els.questionsContent?.addEventListener('focusin', onQuestionFocusIn);
    els.questionsContent?.addEventListener('click', onQuestionsClick);
    els.questionsContent?.addEventListener('keydown', onQuestionsKeydown);
    els.questionsContent?.addEventListener('pointerdown', beginQuestionPointerSelection);
    els.questionsContent?.addEventListener('pointerup', captureQuestionPointerSelection);
    els.questionsContent?.addEventListener('pointercancel', cancelQuestionPointerSelection);
    els.questionsPane?.addEventListener('keyup', () => window.setTimeout(() => captureAnnotationSelection('questions', true), 0));
    els.questionsContent?.addEventListener('pointerdown', beginPointerDrag);
    els.questionsContent?.addEventListener('dragstart', (event) => event.preventDefault());

    els.footerContent?.addEventListener('click', handleFooterClick);
    els.footerContent?.addEventListener('keydown', handleFooterKeydown);
    els.prevButton?.addEventListener('click', () => setCurrentQuestion(adjacentQuestion(-1), true));
    els.nextButton?.addEventListener('click', () => setCurrentQuestion(adjacentQuestion(1), true));

    els.passageContent?.addEventListener('pointerup', () => window.setTimeout(() => captureAnnotationSelection('passage', false), 0));
    els.passagePane?.addEventListener('keyup', () => window.setTimeout(() => captureAnnotationSelection('passage', true), 0));
    els.passageContent?.addEventListener('click', handlePassageClick);
    els.passageContent?.addEventListener('keydown', handlePassageKeydown);
    els.passageContent?.addEventListener('pointerdown', beginPointerDrag);
    els.passageContent?.addEventListener('dragstart', (event) => event.preventDefault());
    els.selectionMenu?.addEventListener('pointerdown', (event) => event.preventDefault());
    els.highlightAction?.addEventListener('click', onHighlightAction);
    els.noteAction?.addEventListener('click', createNoteFromSelection);

    els.notesHost?.addEventListener('input', handleNotesHostInput);
    els.notesHost?.addEventListener('focusout', (event) => {
      if (event.target.matches('[data-note-text][data-note-id]')) notifyAnnotationMutation('note-blur', true);
    });
    els.notesHost?.addEventListener('click', handleNotesHostClick);
    els.showNotesButton?.addEventListener('click', toggleNotes);

    els.messagesButton?.addEventListener('click', openMessages);
    els.messagesCloseButton?.addEventListener('click', closeMessages);
    els.optionsButton?.addEventListener('click', toggleOptions);
    els.optionsMenu?.addEventListener('click', handleOptionsClick);

    els.submitButton?.addEventListener('click', openSubmitDialog);
    els.cancelSubmitButton?.addEventListener('click', closeSubmitDialog);
    els.confirmSubmitButton?.addEventListener('click', () => submitPractice(false));
    els.timerStartButton?.addEventListener('click', beginTimedPractice);
    els.submitDialog?.addEventListener('pointerdown', (event) => {
      if (event.target === els.submitDialog) closeSubmitDialog();
    });
    els.resetButton?.addEventListener('click', resetPractice);
    els.reviewCollapseButton?.addEventListener('click', () => setReviewOverviewCollapsed(true));
    els.reviewExpandButton?.addEventListener('click', () => setReviewOverviewCollapsed(false));
    els.fullscreenButton?.addEventListener('click', toggleFullscreen);
    els.t35ReviewViewControl?.addEventListener('change', t35HandleReviewViewChange);
    els.openHomeworkReceiptButton?.addEventListener('click', openHomeworkReceipt);
    els.closeHomeworkReceiptButton?.addEventListener('click', closeHomeworkReceipt);
    els.copyHomeworkReceiptButton?.addEventListener('click', copyHomeworkReceipt);
    els.downloadHomeworkReceiptButton?.addEventListener('click', downloadHomeworkReceipt);
    els.homeworkReceiptDialog?.addEventListener('pointerdown', (event) => {
      if (event.target === els.homeworkReceiptDialog) closeHomeworkReceipt();
    });
    els.reviewDetail?.addEventListener('click', (event) => {
      if (event.target.closest('.review-detail-close')) els.reviewDetail.hidden = true;
    });

    els.splitter?.addEventListener('pointerdown', beginSplitterDrag);
    els.splitter?.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const value = event.key === 'Home' ? 30 : event.key === 'End' ? 70 :
        state.split + (event.key === 'ArrowRight' ? 2 : -2);
      setSplit(value, true);
    });

    window.addEventListener('pointermove', (event) => {
      movePointerDrag(event);
      moveSplitter(event);
    }, { passive: false });
    window.addEventListener('pointerup', (event) => {
      finishPointerDrag(event, false);
      finishSplitter(event);
    });
    window.addEventListener('pointercancel', (event) => {
      finishPointerDrag(event, true);
      finishSplitter(event);
    });
    window.addEventListener('resize', () => {
      syncAppPanRange();
      positionSelectionMenu();
      positionNoteEditor();
      scheduleSentenceEndingGeometry();
      if (dragState) updateDragTarget();
    });
    els.passagePane?.addEventListener('scroll', () => {
      positionSelectionMenu();
      positionNoteEditor();
    }, { passive: true });
    els.questionsPane?.addEventListener('scroll', () => {
      positionSelectionMenu();
      positionNoteEditor();
      if (dragState) updateDragTarget();
    }, { passive: true });
    document.addEventListener('keydown', handleGlobalKeydown);
    document.addEventListener('pointerdown', handleDocumentPointerDown);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('fullscreenerror', syncFullscreenButton);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', persistCurrentPartTiming);
    window.addEventListener('beforeunload', persistCurrentPartTiming);
  }

  function reconcileState() {
    state.answers = window.IELTSV2Core.createResponseState(runtimeIndex, state.answers);
    model.groups.forEach((group) => {
      if (isGridMatchingGroup(group) || isDragMatchingGroup(group)) {
        const valid = new Set(matchingOptions(group).map((option) => normalizeAnswer(option.id)));
        const used = new Set();
        group.items.forEach((item) => {
          const key = item.responseSlotId;
          const normalized = normalizeAnswer(state.answers[key]);
          const disallowDuplicate = !allowsOptionReuse(group);
          if (!normalized || !valid.has(normalized) || (disallowDuplicate && used.has(normalized))) state.answers[key] = '';
          else if (normalized) {
            state.answers[key] = matchingOption(group, state.answers[key]).id;
            used.add(normalized);
          }
        });
      }
      if (typeDefinition(group)?.responseMode === 'choice-set') {
        const selected = multipleAnswers(group);
        group.responseSlotIds.forEach((responseSlotId, index) => { state.answers[responseSlotId] = selected[index] || ''; });
      }
    });
    const validParts = model.parts.map((part) => Number(part.number));
    validParts.forEach((part) => {
      [[state.highlights, 'passage'], [state.questionHighlights, 'questions']].forEach(([store, surface]) => {
        const records = Array.isArray(store[part]) ? store[part] : [];
        store[part] = records
          .filter((record) => record && typeof record === 'object')
          .map((record) => ({
            ...record,
            surface: record.schemaVersion === HIGHLIGHT_SCHEMA_VERSION ? normalizeAnnotationSurface(record.surface || surface) : surface,
            part: Number(part),
            start: Math.max(0, Number(record.start) || 0),
            end: Math.max(0, Number(record.end) || 0),
            level: highlightLevel(record.level),
          }));
      });
    });
    state.notes = state.notes
      .filter((note) => note && note.id && validParts.includes(Number(note.part)) && Number(note.end) > Number(note.start))
      .map((note) => ({ ...note, surface: normalizeAnnotationSurface(note.surface) }));
    if (state.submitted) state.result = calculateResult();
  }

  function renderLoadError(error) {
    const details = h(error && error.message ? error.message : String(error));
    const content = `<section class="load-error" role="alert"><h2>The practice data could not be loaded</h2>
      <p>${details}</p><p>Run this folder through a local web server rather than opening index.html as a file.</p>
      <code>python3 -m http.server 4173</code></section>`;
    if (els.passageContent) els.passageContent.innerHTML = content;
    if (els.questionsContent) els.questionsContent.innerHTML = content;
  }

  function installTestHooks() {
    const selectAnnotationRange = (surface, start, end) => {
      const normalizedSurface = normalizeAnnotationSurface(surface);
      const range = rangeFromOffsets(normalizedSurface, Number(start), Number(end));
      if (!range) return false;
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const offsets = selectionToOffsets(normalizedSurface, range);
      if (!offsets) return false;
      const highlightRecord = highlightRecordFromRange(normalizedSurface, range, 1);
      openSelectionMenu({ ...offsets, highlightRecord }, range.getBoundingClientRect());
      return true;
    };
    window.IELTSPractice = Object.freeze({
      getState() {
        return JSON.parse(JSON.stringify(state));
      },
      getDistributionWatermark(surface) {
        return distributionWatermarkText(String(surface || 'export'));
      },
      getHomeworkReport() {
        return currentReviewReport ? JSON.parse(JSON.stringify(currentReviewReport)) : null;
      },
      getQuestionOutcomes() {
        if (!state.submitted) return [];
        return model.parts.map((part, index) => {
          const buckets = { correct: [], incorrect: [], partial: [], unanswered: [] };
          questionsForPart(Number(part.number)).forEach((number) => {
            const status = answerStatus(number);
            const bucket = Object.prototype.hasOwnProperty.call(buckets, status) ? status : 'unanswered';
            buckets[bucket].push(String(number));
          });
          return { part: Number(part.number) || index + 1, ...buckets };
        });
      },
      getReviewMode() {
        return reviewMode();
      },
      getReviewTranslationState() {
        const part = partModel(state.part);
        const binding = reviewTranslationBinding(part);
        return {
          passageId: part?.passageId || null,
          available: Boolean(binding),
          visible: Boolean(binding && reviewTranslationVisible),
          expectedUnits: binding?.expected.length || 0,
          renderedUnits: els.passageContent?.querySelectorAll('[data-review-translation-node="true"]').length || 0,
          separateTranslationTogglePresent: false,
          lastAnchor: reviewTranslationLastAnchor ? { ...reviewTranslationLastAnchor } : null,
        };
      },
      getAnnotationAudit(surface) {
        const normalizedSurface = normalizeAnnotationSurface(surface);
        const map = highlightCanonicalMap(normalizedSurface);
        const part = Number(state.part);
        const highlights = normalizedSurface === 'questions'
          ? (state.questionHighlights[part] || [])
          : (state.highlights[part] || []);
        const root = annotationRoot(normalizedSurface);
        const notes = state.notes.filter((note) => Number(note.part) === part && normalizeAnnotationSurface(note.surface) === normalizedSurface);
        return {
          surface: normalizedSurface,
          annotationLength: annotationLength(normalizedSurface),
          highlightCanonicalLength: map.text.length,
          blocks: [...map.blocks.values()].map((item) => ({ blockId: item.blockId, text: item.text })),
          highlights: highlights.map((record) => ({
            ...JSON.parse(JSON.stringify(record)),
            drawnQuote: [...(root?.querySelectorAll('.annotation-highlight[data-highlight-id]') || [])]
              .filter((mark) => mark.dataset.highlightId === record.id).map((mark) => mark.textContent).join(''),
          })),
          diagnostics: highlights.filter((record) => record.resolutionStatus === 'unresolved')
            .map((record) => ({ id: record.id || null, blockId: record.blockId || null, diagnostic: record.diagnostic || 'unresolved' })),
          notes: notes.map((note) => ({
            id: note.id,
            start: Number(note.start),
            end: Number(note.end),
            text: String(note.text || ''),
            quote: annotationTextFromOffsets(normalizedSurface, Number(note.start), Number(note.end)),
          })),
        };
      },
      getTimerPolicy() {
        return { ...timerPolicy() };
      },
      getTimerReport() {
        const timer = currentTimerReport();
        return timer ? JSON.parse(JSON.stringify(timer)) : null;
      },
      startTimedPractice: beginTimedPractice,
      tickTimer,
      getHomeworkReceiptText() {
        return homeworkReceiptText();
      },
      openHomeworkReceipt,
      goToQuestion(number) {
        setCurrentQuestion(Number(number), true);
      },
      openSubmit: openSubmitDialog,
      placeHeading(headingId, questionNumber) {
        const group = [...model.groups.values()].find((item) => typeDefinition(item)?.passageTargets);
        if (!group) return false;
        return assignHeading(group.id, String(headingId), Number(questionNumber), 0);
      },
      selectMatchingOption(groupId, optionId, questionNumber) {
        return assignGridOption(String(groupId), Number(questionNumber), String(optionId));
      },
      placeEnding(groupId, optionId, questionNumber) {
        return assignHeading(String(groupId), String(optionId), Number(questionNumber), 0);
      },
      placeSummaryOption(groupId, optionId, questionNumber) {
        return assignHeading(String(groupId), String(optionId), Number(questionNumber), 0);
      },
      selectAnnotationRange,
      selectPassageRange(start, end) {
        return selectAnnotationRange('passage', start, end);
      },
      selectQuestionRange(start, end) {
        return selectAnnotationRange('questions', start, end);
      },
      selectHighlightBlockRange(surface, blockId, localStart, localEnd) {
        const normalizedSurface = normalizeAnnotationSurface(surface);
        const map = highlightCanonicalMap(normalizedSurface);
        const record = highlightRecordFromLocal(map, String(blockId), Number(localStart), Number(localEnd), 1);
        const range = record && highlightRangeFromRecord(normalizedSurface, record);
        if (!record || !range) return false;
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const offsets = selectionToOffsets(normalizedSurface, range);
        if (!offsets) return false;
        openSelectionMenu({ ...offsets, highlightRecord: record }, range.getBoundingClientRect());
        return true;
      },
      setHighlightRecordsForTest(surface, records) {
        const normalizedSurface = normalizeAnnotationSurface(surface);
        const store = highlightStore(normalizedSurface);
        store[state.part] = Array.isArray(records) ? JSON.parse(JSON.stringify(records)) : [];
        if (normalizedSurface === 'questions') renderQuestions({ preserveScroll: true });
        else renderPassage({ preserveScroll: true });
        saveState();
        return this.getAnnotationAudit(normalizedSurface);
      },
      forceNextHighlightSelfCheckFailure() {
        forceHighlightSelfCheckFailure = true;
      },
    });
  }

  async function init() {
    cacheElements();
    bindEvents();
    try {
      registerBuiltInQuestionTypes();
      await loadData();
      state = loadState();
      reconcileState();
      // Untimed work preserves the existing first-open timing contract. Timed
      // work persists only its waiting gate here; its attempt clock starts
      // when the learner explicitly starts the limited practice.
      saveState();
      renderPartNavigationShell();
      renderAll();
      startTimer();
      installTestHooks();
      document.documentElement.classList.add('practice-ready');
    } catch (error) {
      console.error(error);
      renderLoadError(error);
      document.documentElement.classList.add('practice-load-failed');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

    