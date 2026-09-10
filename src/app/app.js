(function studentPracticeApp() {
  'use strict';

  const library = window.__STUDENT_LIBRARY__;
  const manifest = window.__STUDENT_MANIFEST__;
  const runtimeTemplate = window.__IELTS_STUDENT_RUNTIME_TEMPLATE__;
  const core = window.IELTSTeacherComposerCore;
  const records = window.ZYZStudentRecordStore;
  const edition = window.__STUDENT_EDITION__ || {};
  const manifestById = new Map((manifest?.passages || []).map((item) => [item.passageId, item]));
  const passages = (library?.passages || []).filter((passage) => manifestById.get(passage.passageId)?.enabled !== false);
  const passageById = new Map(passages.map((passage) => [passage.passageId, passage]));
  const sourceById = new Map((library?.sources || []).map((source) => [source.passageId, source]));
  const PREFERRED_TYPE_FILTERS = [
    'Summary Completion（有选项）',
    'Summary Completion（无选项）',
    'Multiple Choice（单选）',
    'Multiple Choice（多选）',
  ];
  const HOME_PROGRESS_SCOPES = Object.freeze([
    Object.freeze({ key: 'high', label: '高频', spoken: '高频', frequencies: Object.freeze(['high']) }),
    Object.freeze({ key: 'high-medium', label: '高频 + 中频', spoken: '高频加中频', frequencies: Object.freeze(['high', 'medium']) }),
    Object.freeze({ key: 'all', label: '全部频次', spoken: '全部频次', frequencies: null }),
  ]);
  const MAX_PRACTICE_PASSAGES = 3;
  const SOURCE_RUNTIME_STATE_STORAGE_PREFIX = 'ielts-reading-unified-runtime.v2';
  const RUNTIME_STATE_STORAGE_PREFIX = 'zyz-reading-t48r1-sticky-answer-boundary-20260905.runtime.v1';
  const DELETED_SUBMISSIONS_STORAGE_KEY = `${RUNTIME_STATE_STORAGE_PREFIX}.deleted-submissions.v1`;
  const DELETED_SUBMISSIONS_SCHEMA_VERSION = 'zyz-reading-deleted-submissions.v1';
  const MAX_DELETED_SUBMISSION_IDS = 20000;
  const MAX_DELETED_SUBMISSIONS_BYTES = 2500000;
  const RESUMABLE_SESSIONS_STORAGE_KEY = `${RUNTIME_STATE_STORAGE_PREFIX}.resumable-sessions.v1`;
  const RESUMABLE_SESSIONS_SCHEMA_VERSION = 'passage-by-zyz-resumable-sessions.v1';
  const MAX_RESUMABLE_SESSIONS_BYTES = 2500000;
  const DISCARDED_RESUMABLE_ATTEMPTS_STORAGE_KEY = `${RUNTIME_STATE_STORAGE_PREFIX}.discarded-resumable-attempts.v1`;
  const DISCARDED_RESUMABLE_ATTEMPTS_SCHEMA_VERSION = 'passage-by-zyz-discarded-resumable-attempts.v1';
  const MAX_DISCARDED_RESUMABLE_ATTEMPTS = 20000;
  const MAX_DISCARDED_RESUMABLE_ATTEMPTS_BYTES = 2500000;
  const RESUMABLE_MUTATION_LOCK_NAME = 'passage-by-zyz-resumable-sessions.v1:mutation';
  const PAUSE_REQUEST_TIMEOUT_MS = 5000;
  const ANNOTATION_OVERLAY_SCHEMA_VERSION = 'zyz-reading-attempt-annotation-overlay.v1';
  const ANNOTATION_AUTOSAVE_DEBOUNCE_MS = 220;
  const RUNNER_CANVAS_MIN_WIDTH = 1024;
  const RUNNER_CANVAS_MIN_HEIGHT = 560;
  const runnerBaselineDevicePixelRatio = Math.max(0.01, Number(window.devicePixelRatio) || 1);
  let resumableMutationTail = Promise.resolve();
  let runnerViewportResizeObserver = null;

  const state = {
    route: 'home',
    practiceMode: 'full',
    viewMode: 'card',
    sort: 'default',
    selections: [],
    practiceTimer: {
      enabled: false,
      preset: 'recommended',
      customMinutes: 20,
      expiryAction: 'continue',
    },
    filters: { search: '', positions: new Set(), frequencies: new Set(), difficulties: new Set(), questionType: '', unseenOnly: false },
    recordRows: [],
    recordGuideStatus: 'loading',
    recordGuideDismissed: false,
    recordFilter: 'all',
    submittedPassageIds: new Set(),
    submittedTaskIds: new Set(),
    visitedPassageIds: new Set(),
    homeProgressScopeIndex: 1,
    mockMode: 'auto',
    mockDifficulties: new Set(),
    mockSurprise: false,
    mockSelection: [],
    mockSelectionMessage: '',
    manualMockIds: { 1: '', 2: '', 3: '' },
    manualMockActivePosition: 1,
    manualMockFilters: { search: '', frequencies: new Set(), difficulties: new Set() },
    currentSession: null,
    runnerChildState: null,
    runnerReadyTimeout: 0,
    runnerOpener: null,
    runnerZoomFingerprint: '',
    lastRecordedSubmissionId: null,
    resumableSessions: { practice: null, mock: null },
    pauseRequest: null,
    restartRequest: null,
    submissionSave: null,
    submissionRetryKinds: new Set(),
    actionDialog: {
      kind: '',
      recordId: '',
      attemptSessionId: '',
      submissionId: '',
      runtimeStateKey: '',
      pendingSubmission: false,
      expectedPhrase: '',
      alternateKind: '',
      opener: null,
      busy: false,
    },
    achievement: {
      hero: 'time',
      extras: new Set(['questions', 'parts', 'mock', 'perfect']),
      name: '',
      nameValid: true,
    },
  };

  const byId = (id) => document.getElementById(id);
  const htmlEscape = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function runnerZoomSnapshot() {
    const viewport = byId('runner-pan-viewport');
    const visualScale = Math.max(1, Number(window.visualViewport?.scale) || 1);
    const densityScale = Math.max(0.01, (Number(window.devicePixelRatio) || runnerBaselineDevicePixelRatio) / runnerBaselineDevicePixelRatio);
    const layoutWidth = viewport?.clientWidth || window.innerWidth || 0;
    const layoutHeight = viewport?.clientHeight || window.innerHeight || 0;
    const visualZoomed = visualScale > 1.001;
    const pageZoomed = densityScale > 1.001;
    const narrowViewport = layoutWidth + 0.5 < RUNNER_CANVAS_MIN_WIDTH || layoutHeight + 0.5 < RUNNER_CANVAS_MIN_HEIGHT;
    return { zoomActive: visualZoomed || pageZoomed || narrowViewport, visualZoomed, pageZoomed, narrowViewport, visualScale, densityScale, layoutWidth, layoutHeight };
  }

  function resetRunnerZoomState() {
    const runner = byId('runner');
    const viewport = byId('runner-pan-viewport');
    runner?.classList.remove('runner-zoom-active');
    viewport?.classList.remove('runner-zoom-active');
    if (viewport) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    }
    state.runnerZoomFingerprint = '';
  }

  function syncRunnerZoomState(options = {}) {
    const runner = byId('runner');
    const viewport = byId('runner-pan-viewport');
    if (!runner || !viewport || runner.hidden) {
      resetRunnerZoomState();
      return;
    }
    const snapshot = runnerZoomSnapshot();
    runner.classList.toggle('runner-zoom-active', snapshot.zoomActive);
    viewport.classList.toggle('runner-zoom-active', snapshot.zoomActive);
    if (!snapshot.zoomActive) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    }
    const fingerprint = JSON.stringify([
      snapshot.zoomActive,
      snapshot.visualZoomed,
      snapshot.pageZoomed,
      snapshot.narrowViewport,
      snapshot.visualScale.toFixed(4),
      snapshot.densityScale.toFixed(4),
      Math.round(snapshot.layoutWidth),
      Math.round(snapshot.layoutHeight),
    ]);
    if (!options.force && fingerprint === state.runnerZoomFingerprint) return;
    state.runnerZoomFingerprint = fingerprint;
    const frame = byId('practice-frame');
    if (!state.currentSession || !frame?.contentWindow) return;
    frame.contentWindow.postMessage({
      type: 'zyz-student-runner-zoom-state.v1',
      sessionId: state.currentSession.sessionId,
      ...snapshot,
    }, '*');
  }

  function editionMeta(value) {
    const match = /^(\d{4})-(\d{2})$/u.exec(String(value || ''));
    if (!match) return { label: '—', accessible: '当前版本，可离线使用' };
    const monthNumber = Number(match[2]);
    return {
      label: `${match[1]}.${match[2]}`,
      accessible: `${match[1]} 年 ${monthNumber} 月版，可离线使用`,
    };
  }

  function renderEditionBadge() {
    const badge = byId('edition-badge');
    if (!badge) return;
    const meta = editionMeta(edition.month);
    const displayLabel = String(edition.displayVersion || '').trim();
    const accessibleLabel = displayLabel ? `${displayLabel} 版，可离线使用` : meta.accessible;
    badge.textContent = displayLabel || meta.label;
    badge.setAttribute('aria-label', accessibleLabel);
    badge.title = accessibleLabel;
  }

  function attemptDisplayTitle(kind, value = Date.now()) {
    return `${kind === 'mock' ? '模考' : '练习'} · ${recordTimestampLabel(value)}`;
  }

  function frequencyLabel(value) {
    return ({ high: '高频', medium: '中频', low: '低频' })[value] || '待补';
  }

  function frequencyFor(passage) {
    return manifestById.get(passage.passageId)?.frequency || ({ 高频: 'high', 中频: 'medium', 低频: 'low' })[passage.monthlyFrequency?.frequency_tier] || 'low';
  }

  function difficultyMeta(passage) {
    const rawDifficulty = passage?.difficulty_current;
    const numericDifficulty = rawDifficulty === null || rawDifficulty === undefined || rawDifficulty === ''
      ? Number.NaN
      : Number(rawDifficulty);
    if (!Number.isFinite(numericDifficulty)) return { tier: '待补', key: 'pending', value: '—' };
    const tier = core.relativeDifficultyTier(passage);
    const key = ({ 偏易: 'easy', 标准: 'standard', 偏难: 'hard' })[tier] || 'pending';
    const value = numericDifficulty.toFixed(1);
    return { tier, key, value };
  }

  function taskQuestionTypeLabel(task) {
    return String(task?.questionTypeLabel || task?.questionType || '题型待标注');
  }

  function taskGroupsForPassage(passageId) {
    return passageById.get(passageId)?.composition?.taskGroups || [];
  }

  function orderedTaskIds(passageId, taskIds) {
    const selected = new Set((Array.isArray(taskIds) ? taskIds : []).filter(Boolean));
    return taskGroupsForPassage(passageId).map((task) => task.taskId).filter((taskId) => selected.has(taskId));
  }

  function normalizedSelection(selection) {
    if (!selection || typeof selection.passageId !== 'string') return null;
    if (selection.scope !== 'task') return { passageId: selection.passageId, scope: 'full' };
    const taskIds = orderedTaskIds(selection.passageId,
      Array.isArray(selection.taskIds) ? selection.taskIds : selection.taskId ? [selection.taskId] : []);
    return taskIds.length ? { passageId: selection.passageId, scope: 'task', taskIds } : null;
  }

  function normalizedSelections(selections = state.selections) {
    return selections.map(normalizedSelection).filter(Boolean);
  }

  function selectedTaskIds(selections = state.selections) {
    return normalizedSelections(selections).flatMap((selection) => selection.taskIds || []);
  }

  function selectionQuestionCount(selection) {
    const passage = passageById.get(selection.passageId);
    if (selection.scope !== 'task') return Number(passage?.questionCount || 0);
    const selected = new Set(selection.taskIds || []);
    return taskGroupsForPassage(selection.passageId)
      .filter((task) => selected.has(task.taskId))
      .reduce((sum, task) => sum + Number(task.responseCount || 0), 0);
  }

  function practiceSelectionStats(selections = state.selections) {
    const normalized = normalizedSelections(selections);
    return {
      selections: normalized,
      passageCount: normalized.length,
      taskCount: selectedTaskIds(normalized).length,
      questionCount: normalized.reduce((sum, selection) => sum + selectionQuestionCount(selection), 0),
    };
  }

  function practicePassageLimitState(passageId, selections = state.selections) {
    const normalized = normalizedSelections(selections);
    const selected = normalized.some((selection) => selection.passageId === passageId);
    return { selected, blocked: !selected && normalized.length >= MAX_PRACTICE_PASSAGES };
  }

  function recommendedPracticeMinutes(selections = state.selections) {
    const normalized = normalizedSelections(selections);
    if (!normalized.length) return 20;
    if (normalized.every((selection) => selection.scope === 'full')) return Math.min(60, normalized.length * 20);
    const questions = normalized.reduce((sum, selection) => sum + selectionQuestionCount(selection), 0);
    return Math.min(60, Math.max(5, Math.ceil((questions * 1.5) / 5) * 5));
  }

  function selectedPracticeMinutes() {
    const recommended = recommendedPracticeMinutes();
    const preset = state.practiceTimer.preset;
    if (preset === 'custom') return Math.min(180, Math.max(1, Math.round(Number(state.practiceTimer.customMinutes) || recommended)));
    if (['20', '40', '60'].includes(preset)) return Number(preset);
    return recommended;
  }

  function practiceTimerPolicy() {
    if (!state.practiceTimer.enabled) return { enabled: false, durationSeconds: 0, expiryAction: 'continue' };
    return {
      enabled: true,
      durationSeconds: selectedPracticeMinutes() * 60,
      expiryAction: state.practiceTimer.expiryAction === 'submit' ? 'submit' : 'continue',
    };
  }

  function practiceTimingSummary() {
    if (!state.practiceTimer.enabled) return '不限时';
    const ending = state.practiceTimer.expiryAction === 'submit' ? '自动提交' : '提醒并继续';
    return `计时 ${selectedPracticeMinutes()} 分钟 · ${ending}`;
  }

  function practiceSelectionPresentation(selections = state.selections) {
    const stats = practiceSelectionStats(selections);
    const taskMode = state.practiceMode === 'task';
    const base = !stats.passageCount
      ? (taskMode ? '尚未选择题型' : '尚未选择文章')
      : taskMode
        ? `已选 ${stats.passageCount} / ${MAX_PRACTICE_PASSAGES} 篇 · ${stats.taskCount} 个题型`
        : `已选 ${stats.passageCount} / ${MAX_PRACTICE_PASSAGES} 篇`;
    return {
      ...stats,
      counter: `${stats.passageCount} / ${MAX_PRACTICE_PASSAGES} 篇`,
      empty: taskMode ? '选择题型；最多可来自 3 篇文章' : '从左侧选择 1–3 篇文章',
      summary: `${base} · ${stats.questionCount} 题 · ${practiceTimingSummary()}`,
      startLabel: !stats.passageCount
        ? (taskMode ? '选择题型后开始' : '选择文章后开始')
        : state.practiceTimer.enabled
          ? `开始计时练习 · ${selectedPracticeMinutes()} 分钟`
          : '开始练习',
    };
  }

  function renderPracticeTimer() {
    const enabled = byId('practice-timer-enabled');
    const panel = byId('practice-timer-panel');
    if (!enabled || !panel) return;
    enabled.checked = state.practiceTimer.enabled;
    panel.classList.toggle('is-enabled', state.practiceTimer.enabled);
    const options = panel.querySelector('[data-practice-timer-options]');
    if (options) options.hidden = !state.practiceTimer.enabled;
    const recommended = recommendedPracticeMinutes();
    const effectivePreset = state.practiceTimer.preset === 'recommended'
      ? (['20', '40', '60'].includes(String(recommended)) ? String(recommended) : 'custom')
      : state.practiceTimer.preset;
    panel.querySelectorAll('[data-minutes]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.minutes === effectivePreset));
    });
    const customInput = byId('practice-duration-custom');
    if (customInput) {
      const customActive = effectivePreset === 'custom';
      const customRow = customInput.closest('.custom-duration');
      if (customRow) customRow.hidden = !customActive;
      if (document.activeElement !== customInput) {
        customInput.value = String(state.practiceTimer.preset === 'recommended' ? recommended : state.practiceTimer.customMinutes);
      }
    }
    const recommendation = panel.querySelector('[data-practice-timer-recommendation]');
    if (recommendation) recommendation.textContent = `按当前选择建议 ${recommended} 分钟。`;
    panel.querySelectorAll('input[name="practice-timer-mode"]').forEach((input) => {
      input.checked = input.value === state.practiceTimer.expiryAction;
    });
  }

  function choosePracticeTimerPreset(value) {
    if (!['20', '40', '60', 'custom'].includes(value)) return;
    state.practiceTimer.preset = value;
    if (value === 'custom') state.practiceTimer.customMinutes = recommendedPracticeMinutes();
    renderPracticeTimer();
    renderPracticeSelectionFooter();
  }

  function matchesDifficulty(passage, selected) {
    return !selected.size || selected.has(difficultyMeta(passage).key);
  }

  function toast(message, duration = 3000) {
    const element = byId('toast');
    element.textContent = message;
    element.hidden = false;
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => { element.hidden = true; }, duration);
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function resumableKind(value) {
    return value === 'practice' || value === 'mock' ? value : '';
  }

  function withResumableMutationLock(callback) {
    if (typeof callback !== 'function') return Promise.reject(new Error('未完成内容的写入任务无效。'));
    const run = () => {
      const locks = window.navigator && window.navigator.locks;
      if (locks && typeof locks.request === 'function') {
        return locks.request(RESUMABLE_MUTATION_LOCK_NAME, { mode: 'exclusive' }, callback);
      }
      return callback();
    };
    const operation = resumableMutationTail.then(run, run);
    resumableMutationTail = operation.catch(() => undefined);
    return operation;
  }

  function normalizedResumableAttemptId(value) {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.length > 180) throw new Error('未完成内容的会话编号无效。');
    return normalized;
  }

  function runtimeStoragePrefixForAttempt(attemptSessionId) {
    const normalizedId = normalizedResumableAttemptId(attemptSessionId);
    if (!/^[a-z0-9.:-]+$/iu.test(normalizedId)) {
      throw new Error('未完成内容的会话编号不能安全用于本机存储。');
    }
    return `${RUNTIME_STATE_STORAGE_PREFIX}.attempt.${normalizedId}`;
  }

  function readDiscardedResumableAttemptIds(storage = window.localStorage) {
    const raw = storage.getItem(DISCARDED_RESUMABLE_ATTEMPTS_STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== DISCARDED_RESUMABLE_ATTEMPTS_SCHEMA_VERSION || !Array.isArray(parsed.attemptSessionIds)) {
      throw new Error('已放弃未完成内容的保护数据无法校验。');
    }
    if (parsed.attemptSessionIds.length > MAX_DISCARDED_RESUMABLE_ATTEMPTS) {
      throw new Error('已放弃未完成内容的保护数据超过安全上限。');
    }
    const attemptSessionIds = parsed.attemptSessionIds.map(normalizedResumableAttemptId);
    if (new Set(attemptSessionIds).size !== attemptSessionIds.length) {
      throw new Error('已放弃未完成内容的保护数据存在重复会话。');
    }
    return new Set(attemptSessionIds);
  }

  function resumableAttemptIsDiscarded(attemptSessionId, storage = window.localStorage) {
    return readDiscardedResumableAttemptIds(storage).has(normalizedResumableAttemptId(attemptSessionId));
  }

  function protectDiscardedResumableAttempt(attemptSessionId, storage = window.localStorage) {
    const normalizedId = normalizedResumableAttemptId(attemptSessionId);
    const previousRaw = storage.getItem(DISCARDED_RESUMABLE_ATTEMPTS_STORAGE_KEY);
    const attemptSessionIds = readDiscardedResumableAttemptIds(storage);
    attemptSessionIds.add(normalizedId);
    if (attemptSessionIds.size > MAX_DISCARDED_RESUMABLE_ATTEMPTS) {
      throw new Error('已放弃未完成内容的保护数据已达到安全上限。');
    }
    const encoded = JSON.stringify({
      schemaVersion: DISCARDED_RESUMABLE_ATTEMPTS_SCHEMA_VERSION,
      attemptSessionIds: [...attemptSessionIds],
    });
    if (encoded.length > MAX_DISCARDED_RESUMABLE_ATTEMPTS_BYTES) {
      throw new Error('已放弃未完成内容的保护数据空间不足。');
    }
    try {
      storage.setItem(DISCARDED_RESUMABLE_ATTEMPTS_STORAGE_KEY, encoded);
      if (storage.getItem(DISCARDED_RESUMABLE_ATTEMPTS_STORAGE_KEY) !== encoded) {
        throw new Error('浏览器未能验证已放弃未完成内容的保护数据。');
      }
    } catch (error) {
      let rollbackError = null;
      try {
        if (storage.getItem(DISCARDED_RESUMABLE_ATTEMPTS_STORAGE_KEY) === encoded) {
          if (previousRaw === null) storage.removeItem(DISCARDED_RESUMABLE_ATTEMPTS_STORAGE_KEY);
          else storage.setItem(DISCARDED_RESUMABLE_ATTEMPTS_STORAGE_KEY, previousRaw);
          if (storage.getItem(DISCARDED_RESUMABLE_ATTEMPTS_STORAGE_KEY) !== previousRaw) {
            throw new Error('已放弃未完成内容的保护数据未恢复到原状态。');
          }
        }
      } catch (restoreError) { rollbackError = restoreError; }
      throw new Error(`${error.message || error}${rollbackError ? `；回滚失败：${rollbackError.message || rollbackError}` : ''}`);
    }
    return { previousRaw, encoded, attemptSessionId: normalizedId };
  }

  function rollbackDiscardedResumableAttemptProtection(token, storage = window.localStorage) {
    if (!token?.encoded) return { rolledBack: false, reason: 'not-started' };
    if (storage.getItem(DISCARDED_RESUMABLE_ATTEMPTS_STORAGE_KEY) !== token.encoded) {
      throw new Error('已放弃未完成内容的保护数据已被更新，为避免覆盖较新状态，未执行回滚。');
    }
    if (token.previousRaw === null) storage.removeItem(DISCARDED_RESUMABLE_ATTEMPTS_STORAGE_KEY);
    else storage.setItem(DISCARDED_RESUMABLE_ATTEMPTS_STORAGE_KEY, token.previousRaw);
    if (storage.getItem(DISCARDED_RESUMABLE_ATTEMPTS_STORAGE_KEY) !== token.previousRaw) {
      throw new Error('已放弃未完成内容的保护数据回滚后未通过校验。');
    }
    return { rolledBack: true };
  }

  function runtimePlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function runtimeInteger(value, minimum = 0) {
    return typeof value === 'number' && Number.isInteger(value) && value >= minimum;
  }

  function runtimeNullableTimestamp(value) {
    return value === null || runtimeInteger(value);
  }

  function validateRuntimePartMap(value, partCount, validateValue) {
    if (!runtimePlainObject(value)) return false;
    const keys = Object.keys(value);
    if (!keys.length || (partCount && keys.length !== partCount)) return false;
    return keys.every((key) => {
      const part = Number(key);
      return /^(?:[1-9]\d*)$/u.test(key) && (!partCount || part <= partCount) && validateValue(value[key], part);
    });
  }

  function validateRuntimeHighlights(value, partCount) {
    return validateRuntimePartMap(value, partCount, (ranges) => Array.isArray(ranges) && ranges.every((range) =>
      runtimePlainObject(range) && runtimeInteger(range.start) && runtimeInteger(range.end) && range.end > range.start &&
      runtimeInteger(range.level, 1) && range.level <= 3));
  }

  function validateRuntimeNotes(value, partCount) {
    if (!Array.isArray(value)) return false;
    const ids = new Set();
    return value.every((note) => {
      if (!runtimePlainObject(note) || typeof note.id !== 'string' || !note.id || note.id.length > 240 || ids.has(note.id) ||
          !runtimeInteger(note.part, 1) || (partCount && note.part > partCount) ||
          !runtimeInteger(note.start) || !runtimeInteger(note.end) || note.end <= note.start ||
          (note.surface !== undefined && note.surface !== 'passage' && note.surface !== 'questions') ||
          (note.quote !== undefined && typeof note.quote !== 'string') ||
          (note.text !== undefined && typeof note.text !== 'string')) return false;
      ids.add(note.id);
      return true;
    });
  }

  function validateRuntimeResult(value, partCount) {
    if (!runtimePlainObject(value) || !Array.isArray(value.partScores)) return false;
    const finiteNonnegative = (number) => typeof number === 'number' && Number.isFinite(number) && number >= 0;
    const counts = ['answered', 'total', 'correct', 'incorrect', 'unanswered'];
    if (!finiteNonnegative(value.earnedMarks) || !finiteNonnegative(value.availableMarks) || value.earnedMarks > value.availableMarks ||
        counts.some((key) => !runtimeInteger(value[key])) ||
        (value.partial !== undefined && !runtimeInteger(value.partial))) return false;
    const partial = value.partial || 0;
    if (value.answered !== value.correct + partial + value.incorrect || value.total !== value.answered + value.unanswered) return false;
    const seenParts = new Set();
    return value.partScores.every((score) => {
      if (!runtimePlainObject(score) || !runtimeInteger(score.part, 1) || (partCount && score.part > partCount) || seenParts.has(score.part) ||
          !finiteNonnegative(score.earnedMarks) || !finiteNonnegative(score.availableMarks) || score.earnedMarks > score.availableMarks ||
          !runtimeInteger(score.answered) || !runtimeInteger(score.total) || score.answered > score.total) return false;
      seenParts.add(score.part);
      return true;
    });
  }

  function validatedRuntimeState(value, options = {}) {
    if (!runtimePlainObject(value)) {
      throw new Error('未完成内容的答题现场缺失。');
    }
    const runtimeState = cloneJson(value);
    const partCount = runtimeInteger(options.partCount, 1) ? options.partCount : 0;
    const lastQuestionByPartIsValid = validateRuntimePartMap(runtimeState.lastQuestionByPart, partCount, (question) => runtimeInteger(question, 1));
    const partElapsedIsValid = runtimePlainObject(runtimeState.partElapsedMilliseconds) && Object.keys(runtimeState.partElapsedMilliseconds).every((key) =>
      /^(?:[1-9]\d*)$/u.test(key) && (!partCount || Number(key) <= partCount) && runtimeInteger(runtimeState.partElapsedMilliseconds[key]));
    if (!runtimeInteger(runtimeState.version, 1) || !runtimeInteger(runtimeState.part, 1) ||
        (partCount && runtimeState.part > partCount) || !runtimeInteger(runtimeState.currentQuestion, 1) ||
        !lastQuestionByPartIsValid || !runtimeInteger(runtimeState.lastQuestionByPart?.[runtimeState.part], 1) ||
        !runtimePlainObject(runtimeState.answers) || !validateRuntimeHighlights(runtimeState.highlights, partCount) ||
        !validateRuntimeHighlights(runtimeState.questionHighlights, partCount) || !validateRuntimeNotes(runtimeState.notes, partCount) ||
        typeof runtimeState.showNotes !== 'boolean' || !partElapsedIsValid ||
        !runtimeNullableTimestamp(runtimeState.partActiveStartedAt) || typeof runtimeState.partTimingComplete !== 'boolean' ||
        typeof runtimeState.submitted !== 'boolean' ||
        !runtimeInteger(runtimeState.remainingSeconds) || typeof runtimeState.timerRunning !== 'boolean' ||
        !runtimeNullableTimestamp(runtimeState.timerStartedAt) || !runtimeNullableTimestamp(runtimeState.timerDeadlineAt) ||
        !runtimeNullableTimestamp(runtimeState.timerExpiredAt) || typeof runtimeState.timerExpired !== 'boolean' ||
        typeof runtimeState.timerWarning10Shown !== 'boolean' || typeof runtimeState.timerWarning5Shown !== 'boolean' ||
        !Array.isArray(runtimeState.timerAnnouncementMarks) || !runtimeNullableTimestamp(runtimeState.timerLastObservedAt) ||
        !runtimeInteger(runtimeState.overtimeSeconds) ||
        (runtimeState.submissionReason !== null && !['manual', 'timeout', 'manual-after-timeout'].includes(runtimeState.submissionReason)) ||
        typeof runtimeState.clockAnomaly !== 'boolean' || !runtimeNullableTimestamp(runtimeState.attemptStartedAt) ||
        !runtimeNullableTimestamp(runtimeState.submittedAt) ||
        (runtimeState.elapsedSeconds !== null && !runtimeInteger(runtimeState.elapsedSeconds)) ||
        !runtimeInteger(runtimeState.updatedAt)) {
      throw new Error('未完成内容的答题现场字段无法校验。');
    }
    if (options.expectSubmitted === true && !runtimeState.submitted) {
      throw new Error('待保存记录缺少已提交现场。');
    }
    if (options.expectSubmitted === false && runtimeState.submitted) {
      throw new Error('未完成内容不能使用已提交现场。');
    }
    if (runtimeState.submitted) {
      if (!validateRuntimeResult(runtimeState.result, partCount) || !runtimeInteger(runtimeState.submittedAt) ||
          !runtimeInteger(runtimeState.elapsedSeconds) || !runtimeInteger(runtimeState.attemptNumber, 1) ||
          typeof runtimeState.attemptMarker !== 'string' || !runtimeState.attemptMarker || runtimeState.attemptMarker.length > 180 ||
          typeof runtimeState.submissionId !== 'string' || !runtimeState.submissionId || runtimeState.submissionId.length > 240 ||
          !runtimeState.submissionReason || runtimeState.timerRunning || runtimeState.partActiveStartedAt !== null ||
          runtimeState.updatedAt < runtimeState.submittedAt) {
        throw new Error('待保存记录的提交身份或结果无法校验。');
      }
    } else if (runtimeState.result !== null || runtimeState.submittedAt !== null || runtimeState.elapsedSeconds !== null ||
        runtimeState.attemptNumber !== null || runtimeState.attemptMarker !== null || runtimeState.submissionId !== null ||
        runtimeState.submissionReason !== null) {
      throw new Error('未完成内容混入了提交身份或结果。');
    }
    const timerPolicy = options.timerPolicy;
    if (timerPolicy) {
      const marks = runtimeState.timerAnnouncementMarks;
      const allowedMarks = new Set([600, 300, 60, 30, 10, 0].filter((mark) => mark === 0 || timerPolicy.durationSeconds >= mark));
      if (new Set(marks).size !== marks.length || marks.some((mark) => !runtimeInteger(mark) || !allowedMarks.has(mark)) ||
          (runtimeState.timerWarning10Shown && timerPolicy.durationSeconds < 600) ||
          (runtimeState.timerWarning5Shown && timerPolicy.durationSeconds < 300)) {
        throw new Error('未完成内容的计时提示状态无效。');
      }
      if (!timerPolicy.enabled) {
        if (runtimeState.timerRunning || runtimeState.timerStartedAt !== null || runtimeState.timerDeadlineAt !== null ||
            runtimeState.timerExpiredAt !== null || runtimeState.timerExpired || runtimeState.timerLastObservedAt !== null ||
            runtimeState.overtimeSeconds !== 0 || runtimeState.timerWarning10Shown || runtimeState.timerWarning5Shown || marks.length) {
          throw new Error('未完成内容的计时现场与计时设置不一致。');
        }
      } else {
        const notStarted = runtimeState.timerStartedAt === null;
        if (runtimeState.remainingSeconds > timerPolicy.durationSeconds ||
            (notStarted !== (runtimeState.timerDeadlineAt === null)) ||
            (notStarted && (runtimeState.timerRunning || runtimeState.remainingSeconds !== timerPolicy.durationSeconds ||
              runtimeState.timerLastObservedAt !== null || runtimeState.timerExpiredAt !== null || runtimeState.timerExpired ||
              runtimeState.overtimeSeconds !== 0 || runtimeState.timerWarning10Shown || runtimeState.timerWarning5Shown || marks.length ||
              runtimeState.attemptStartedAt !== null)) ||
            (!notStarted && (runtimeState.timerDeadlineAt !== runtimeState.timerStartedAt + (timerPolicy.durationSeconds * 1000) ||
              runtimeState.timerLastObservedAt === null ||
              runtimeState.attemptStartedAt !== runtimeState.timerStartedAt)) ||
            (runtimeState.timerExpired && (runtimeState.remainingSeconds !== 0 || runtimeState.timerExpiredAt !== runtimeState.timerDeadlineAt)) ||
            (!runtimeState.timerExpired && runtimeState.timerExpiredAt !== null)) {
          throw new Error('未完成内容的计时现场与计时设置不一致。');
        }
      }
    }
    if ((options.status === 'paused' || options.status === 'submitted-pending') &&
        (runtimeState.timerRunning || runtimeState.partActiveStartedAt !== null)) {
      throw new Error('暂停或待保存现场仍包含运行中的计时状态。');
    }
    return runtimeState;
  }

  function validatedResumableEntry(value, expectedKind) {
    if (value === null || value === undefined) return null;
    if (!value || typeof value !== 'object') throw new Error('未完成内容的数据格式无效。');
    const kind = resumableKind(value.kind);
    if (!kind || kind !== expectedKind) throw new Error('未完成内容的模式无法校验。');
    if (!['active', 'paused', 'submitted-pending'].includes(value.status)) throw new Error('未完成内容的状态无法校验。');
    const attemptSessionId = normalizedResumableAttemptId(value.attemptSessionId);
    const snapshotHash = String(value.snapshotHash || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/u.test(snapshotHash)) throw new Error('未完成内容的题目快照无效。');
    const runtimeStateKey = String(value.runtimeStateKey || '');
    if (!runtimeStateKey.startsWith(`${RUNTIME_STATE_STORAGE_PREFIX}.`) || runtimeStateKey.length > 420) {
      throw new Error('未完成内容的本机存储位置无效。');
    }
    const expectedContentVersion = `1.0.0-homework.${snapshotHash.slice(0, 12)}`;
    const runtimeSuffix = `.package.homework.snapshot.${snapshotHash.slice(0, 24)}.${expectedContentVersion}`;
    const expectedLegacyRuntimeStateKey = `${RUNTIME_STATE_STORAGE_PREFIX}${runtimeSuffix}`;
    const expectedScopedRuntimeStateKey = `${runtimeStoragePrefixForAttempt(attemptSessionId)}${runtimeSuffix}`;
    if (String(value.packageContentVersion || '') !== expectedContentVersion ||
        ![expectedLegacyRuntimeStateKey, expectedScopedRuntimeStateKey].includes(runtimeStateKey)) {
      throw new Error('未完成内容的题目版本或存储位置不匹配。');
    }
    const compositionMode = value.compositionMode;
    if (!['full-passage', 'task-drill'].includes(compositionMode)) {
      throw new Error('未完成内容的练习方式无法校验。');
    }
    const rawSelections = Array.isArray(value.selections) ? value.selections : [];
    if (rawSelections.some((selection) => !selection || typeof selection !== 'object' ||
        (compositionMode === 'full-passage'
          ? selection.scope !== 'full'
          : selection.scope !== 'task' || !Array.isArray(selection.taskIds) || !selection.taskIds.length))) {
      throw new Error('未完成内容的篇章或题型范围无效。');
    }
    const selections = normalizedSelections(rawSelections);
    if (!selections.length || selections.length > MAX_PRACTICE_PASSAGES || selections.length !== value.selections.length) {
      throw new Error('未完成内容的篇章选择无效。');
    }
    if (!value.timerPolicy || typeof value.timerPolicy !== 'object' ||
        typeof value.timerPolicy.enabled !== 'boolean' ||
        !runtimeInteger(value.timerPolicy.durationSeconds) ||
        !['continue', 'submit'].includes(value.timerPolicy.expiryAction)) {
      throw new Error('未完成内容的计时设置无效。');
    }
    const timerPolicy = {
      enabled: value.timerPolicy.enabled,
      durationSeconds: Number(value.timerPolicy.durationSeconds),
      expiryAction: value.timerPolicy.expiryAction,
    };
    if ((timerPolicy.enabled && (timerPolicy.durationSeconds < 60 || timerPolicy.durationSeconds > 10800)) ||
        (!timerPolicy.enabled && timerPolicy.durationSeconds !== 0) ||
        (kind === 'mock' && (!timerPolicy.enabled || timerPolicy.durationSeconds !== 3600 || timerPolicy.expiryAction !== 'submit'))) {
      throw new Error('未完成内容的计时设置无效。');
    }
    const runtimeState = validatedRuntimeState(value.runtimeState, {
      expectSubmitted: value.status === 'submitted-pending',
      timerPolicy,
      status: value.status,
      partCount: selections.length,
    });
    return {
      schemaVersion: 'passage-by-zyz-resumable-attempt.v1',
      status: value.status,
      kind,
      attemptSessionId,
      title: String(value.title || (kind === 'mock' ? '模考' : '练习')),
      compositionMode,
      selections,
      timerPolicy,
      releaseId: String(value.releaseId || ''),
      snapshotHash,
      packageContentVersion: expectedContentVersion,
      runtimeStateKey,
      runtimeState,
      submissionReport: value.status === 'submitted-pending' && value.submissionReport && typeof value.submissionReport === 'object'
        ? cloneJson(value.submissionReport)
        : null,
      attemptLedger: value.status === 'submitted-pending' && typeof value.attemptLedger === 'string' && value.attemptLedger.length <= 65536
        ? value.attemptLedger
        : null,
      startedAt: Number.isFinite(Number(value.startedAt)) ? Number(value.startedAt) : Date.now(),
      savedAt: Number.isFinite(Number(value.savedAt)) ? Number(value.savedAt) : Date.now(),
      pausedAt: Number.isFinite(Number(value.pausedAt)) ? Number(value.pausedAt) : null,
    };
  }

  function readResumableSessions(storage = window.localStorage) {
    const raw = storage.getItem(RESUMABLE_SESSIONS_STORAGE_KEY);
    if (raw === null) return { practice: null, mock: null };
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== RESUMABLE_SESSIONS_SCHEMA_VERSION || !parsed.sessions || typeof parsed.sessions !== 'object') {
      throw new Error('未完成内容的索引无法校验。');
    }
    const sessions = {
      practice: validatedResumableEntry(parsed.sessions.practice, 'practice'),
      mock: validatedResumableEntry(parsed.sessions.mock, 'mock'),
    };
    const discardedAttemptIds = readDiscardedResumableAttemptIds(storage);
    ['practice', 'mock'].forEach((kind) => {
      if (sessions[kind] && discardedAttemptIds.has(sessions[kind].attemptSessionId)) sessions[kind] = null;
    });
    return sessions;
  }

  function writeResumableSessions(sessions, storage = window.localStorage) {
    const normalized = {
      practice: validatedResumableEntry(sessions?.practice, 'practice'),
      mock: validatedResumableEntry(sessions?.mock, 'mock'),
    };
    const discardedAttemptIds = readDiscardedResumableAttemptIds(storage);
    ['practice', 'mock'].forEach((kind) => {
      if (normalized[kind] && discardedAttemptIds.has(normalized[kind].attemptSessionId)) {
        throw new Error(`这次${kind === 'mock' ? '模考' : '练习'}已被明确放弃，旧页面不能重新写入。`);
      }
    });
    const encoded = JSON.stringify({
      schemaVersion: RESUMABLE_SESSIONS_SCHEMA_VERSION,
      updatedAt: Date.now(),
      sessions: normalized,
    });
    if (encoded.length > MAX_RESUMABLE_SESSIONS_BYTES) throw new Error('未完成内容超过本机安全保存上限。');
    storage.setItem(RESUMABLE_SESSIONS_STORAGE_KEY, encoded);
    if (storage.getItem(RESUMABLE_SESSIONS_STORAGE_KEY) !== encoded) {
      throw new Error('浏览器未能验证未完成内容。');
    }
    state.resumableSessions = normalized;
    renderResumableSessions();
    return normalized;
  }

  function reconcileResumableSessionsWithRuntime(storage = window.localStorage) {
    const sessions = readResumableSessions(storage);
    let changed = false;
    ['practice', 'mock'].forEach((kind) => {
      const entry = sessions[kind];
      if (!entry || entry.status !== 'active') return;
      const raw = storage.getItem(entry.runtimeStateKey);
      if (raw === null) return;
      try {
        const rawRuntimeState = JSON.parse(raw);
        const nextStatus = rawRuntimeState?.submitted === true ? 'submitted-pending' : 'active';
        const runtimeState = validatedRuntimeState(rawRuntimeState, {
          expectSubmitted: nextStatus === 'submitted-pending',
          timerPolicy: entry.timerPolicy,
          status: nextStatus,
          partCount: entry.selections.length,
        });
        if (Number(runtimeState.updatedAt || 0) <= Number(entry.runtimeState.updatedAt || 0)) return;
        const runtimeSuffix = `.package.homework.snapshot.${entry.snapshotHash.slice(0, 24)}.${entry.packageContentVersion}`;
        const runtimeStoragePrefix = entry.runtimeStateKey.slice(0, -runtimeSuffix.length);
        const attemptLedgerKey = `${runtimeStoragePrefix}.attempt-ledger.v1.${entry.snapshotHash}`;
        const rawLedger = runtimeState.submitted ? storage.getItem(attemptLedgerKey) : null;
        sessions[kind] = validatedResumableEntry({
          ...entry,
          status: nextStatus,
          runtimeState,
          submissionReport: null,
          attemptLedger: typeof rawLedger === 'string' && rawLedger.length <= 65536 ? rawLedger : null,
          savedAt: Date.now(),
          pausedAt: null,
        }, kind);
        changed = true;
      } catch (_error) { /* keep the last verified outer checkpoint */ }
    });
    return changed ? writeResumableSessions(sessions, storage) : sessions;
  }

  function replaceResumableSession(kind, entry, storage = window.localStorage) {
    const normalizedKind = resumableKind(kind);
    if (!normalizedKind) throw new Error('未完成内容的模式无效。');
    const normalizedEntry = validatedResumableEntry(entry, normalizedKind);
    if (resumableAttemptIsDiscarded(normalizedEntry.attemptSessionId, storage)) {
      throw new Error('这次未完成内容已被明确放弃，旧页面不能重新写入。');
    }
    const previousRaw = storage.getItem(RESUMABLE_SESSIONS_STORAGE_KEY);
    const sessions = readResumableSessions(storage);
    const current = sessions[normalizedKind];
    if (current && current.attemptSessionId !== normalizedEntry.attemptSessionId) {
      throw new Error(`另一项${normalizedKind === 'mock' ? '模考' : '练习'}已成为当前未完成内容，旧页面不能覆盖。`);
    }
    if (current?.status === 'submitted-pending' && normalizedEntry.status !== 'submitted-pending') {
      throw new Error('这次作答已经提交并等待保存，旧页面不能把它改回未提交状态。');
    }
    sessions[normalizedKind] = normalizedEntry;
    try {
      return writeResumableSessions(sessions, storage)[normalizedKind];
    } catch (error) {
      try {
        if (previousRaw === null) storage.removeItem(RESUMABLE_SESSIONS_STORAGE_KEY);
        else storage.setItem(RESUMABLE_SESSIONS_STORAGE_KEY, previousRaw);
        if (storage.getItem(RESUMABLE_SESSIONS_STORAGE_KEY) !== previousRaw) throw new Error('原暂停点未能恢复。');
        state.resumableSessions = readResumableSessions(storage);
        renderResumableSessions();
      } catch (rollbackError) {
        throw new Error(`${error.message || error}；回滚失败：${rollbackError.message || rollbackError}`);
      }
      throw error;
    }
  }

  function checkpointEntry(session, runtimeState, status, details = {}) {
    if (!session || session.isReplay || !runtimeState || typeof runtimeState !== 'object') {
      throw new Error('当前答题现场无法生成暂停点。');
    }
    const savedAt = Date.now();
    return validatedResumableEntry({
      status,
      kind: session.kind,
      attemptSessionId: session.attemptSessionId,
      title: session.title,
      compositionMode: session.compositionMode,
      selections: session.selections,
      timerPolicy: session.timerPolicy,
      releaseId: manifest.releaseId,
      snapshotHash: session.snapshotHash,
      packageContentVersion: session.packageContentVersion,
      runtimeStateKey: session.runtimeStateKey,
      runtimeState,
      submissionReport: details.submissionReport || null,
      attemptLedger: details.attemptLedger || null,
      startedAt: session.startedAt,
      savedAt,
      pausedAt: status === 'paused' ? savedAt : null,
    }, session.kind);
  }

  async function persistSessionCheckpoint(session, runtimeState, status = 'active', details = {}) {
    const entry = checkpointEntry(session, runtimeState, status, details);
    return withResumableMutationLock(() => replaceResumableSession(session.kind, entry));
  }

  function clearUnreferencedFreshRuntimeState(runtimeStateKey, storage = window.localStorage) {
    const normalizedKey = String(runtimeStateKey || '');
    if (!normalizedKey.startsWith(`${RUNTIME_STATE_STORAGE_PREFIX}.`)) {
      throw new Error('新作答的本机存储位置无效。');
    }
    const sessions = readResumableSessions(storage);
    const owner = ['practice', 'mock'].find((kind) => sessions[kind]?.runtimeStateKey === normalizedKey);
    if (owner) {
      throw new Error(`这份答题现场正由一项未完成的${owner === 'mock' ? '模考' : '练习'}使用，请先继续或明确放弃它。`);
    }
    if (storage.getItem(normalizedKey) === null) return { cleared: false };
    storage.removeItem(normalizedKey);
    if (storage.getItem(normalizedKey) !== null) {
      throw new Error('浏览器未能清除上一份孤立答题现场。');
    }
    return { cleared: true };
  }

  function visibleResumableEntries() {
    return ['practice', 'mock']
      .map((kind) => state.resumableSessions[kind])
      .filter(Boolean)
      .sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0));
  }

  function checkpointRemainingLabel(entry) {
    if (entry.status === 'submitted-pending') return '提交已完成 · 学习记录待保存';
    if (!entry.timerPolicy?.enabled) return '进度已保存在本机';
    if (entry.runtimeState?.timerStartedAt === null) return '计时尚未开始';
    const seconds = Math.max(0, Math.floor(Number(entry.runtimeState?.remainingSeconds) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    const timer = hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
      : `${minutes}:${String(remainder).padStart(2, '0')}`;
    return `剩余 ${timer}`;
  }

  function renderResumableSessions() {
    const strip = byId('resume-strip');
    const list = byId('resume-session-list');
    if (!strip || !list) return;
    const entries = visibleResumableEntries();
    strip.hidden = entries.length === 0;
    list.classList.toggle('is-single', entries.length === 1);
    const pendingCount = entries.filter((entry) => entry.status === 'submitted-pending').length;
    byId('resume-strip-title').textContent = entries.length > 1
      ? (pendingCount === entries.length
        ? `有 ${pendingCount} 条学习记录待保存`
        : pendingCount ? `有 ${pendingCount} 条记录待保存，另有 ${entries.length - pendingCount} 项未完成内容` : `有 ${entries.length} 项未完成内容`)
      : pendingCount ? '有一条学习记录待保存' : entries[0]?.kind === 'mock' ? '有未完成的模考' : '有未完成的练习';
    list.innerHTML = entries.map((entry) => {
      const modeLabel = entry.kind === 'mock' ? '模考' : '练习';
      const pendingSubmission = entry.status === 'submitted-pending';
      const retrying = pendingSubmission && state.submissionRetryKinds.has(entry.kind);
      const primaryAction = pendingSubmission
        ? `<button class="resume-session-continue" type="button" data-retry-submission="${entry.kind}"${retrying ? ' disabled' : ''}>${retrying ? '正在保存…' : '重试保存'}</button>`
        : `<button class="resume-session-continue" type="button" data-resume-session="${entry.kind}">继续${modeLabel}</button>`;
      return `<article class="resume-session-card${pendingSubmission ? ' is-submission-pending' : ''}">
        <div class="resume-session-copy"><strong>${pendingSubmission ? `${modeLabel}已完成 · 记录待保存` : `${modeLabel}已暂停 · ${htmlEscape(attemptDisplayTitle(entry.kind, entry.startedAt || entry.savedAt))}`}</strong><span>${entry.selections.length} 篇 · ${htmlEscape(checkpointRemainingLabel(entry))}</span></div>
        <div class="resume-session-actions">
          ${primaryAction}
          <button class="resume-session-discard" type="button" data-discard-session="${entry.kind}" aria-label="${pendingSubmission ? '放弃这条待保存记录' : `放弃这次未完成的${modeLabel}`}">放弃</button>
        </div>
      </article>`;
    }).join('');
  }

  function activeElapsedMilliseconds(runtimeState) {
    return Object.values(runtimeState?.partElapsedMilliseconds || {}).reduce((sum, value) => {
      const milliseconds = Number(value);
      return sum + (Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : 0);
    }, 0);
  }

  function rebasedRuntimeState(entry, resumedAt = Date.now()) {
    const runtimeState = cloneJson(entry.runtimeState);
    if (!runtimeState || runtimeState.submitted) throw new Error('这项内容已经提交，不能作为未完成内容恢复。');
    const now = Math.max(0, Math.floor(Number(resumedAt) || Date.now()));
    runtimeState.partActiveStartedAt = null;
    runtimeState.updatedAt = now;
    if (entry.timerPolicy.enabled) {
      if (runtimeState.timerStartedAt === null || runtimeState.timerStartedAt === undefined) {
        runtimeState.timerStartedAt = null;
        runtimeState.timerDeadlineAt = null;
        runtimeState.timerLastObservedAt = null;
        runtimeState.timerRunning = false;
        runtimeState.attemptStartedAt = null;
      } else {
        const durationSeconds = Math.max(1, Math.floor(Number(entry.timerPolicy.durationSeconds) || 0));
        const remainingSeconds = Math.max(0, Math.min(durationSeconds, Math.floor(Number(runtimeState.remainingSeconds) || 0)));
        const overtimeSeconds = Math.max(0, Math.floor(Number(runtimeState.overtimeSeconds) || 0));
        const activeSeconds = Math.max(0, durationSeconds - remainingSeconds + overtimeSeconds);
        runtimeState.timerStartedAt = now - (activeSeconds * 1000);
        runtimeState.timerDeadlineAt = runtimeState.timerStartedAt + (durationSeconds * 1000);
        runtimeState.timerLastObservedAt = now;
        runtimeState.timerRunning = true;
        runtimeState.remainingSeconds = remainingSeconds;
        runtimeState.overtimeSeconds = overtimeSeconds;
        runtimeState.timerExpiredAt = runtimeState.timerExpired || overtimeSeconds > 0
          ? runtimeState.timerDeadlineAt
          : null;
        runtimeState.attemptStartedAt = runtimeState.timerStartedAt;
      }
    } else {
      runtimeState.timerRunning = false;
      runtimeState.timerStartedAt = null;
      runtimeState.timerDeadlineAt = null;
      runtimeState.timerLastObservedAt = null;
      runtimeState.attemptStartedAt = now - activeElapsedMilliseconds(runtimeState);
    }
    return runtimeState;
  }

  function prepareResumeStorage(entry, runtimeStateKey, storage = window.localStorage) {
    if (runtimeStateKey !== entry.runtimeStateKey) throw new Error('重建后的答题现场与暂停点不一致。');
    if (resumableAttemptIsDiscarded(entry.attemptSessionId, storage)) {
      throw new Error('这次未完成内容已经被明确放弃，不能从旧页面恢复。');
    }
    const previousRaw = storage.getItem(runtimeStateKey);
    let resumeEntry = entry;
    if (entry.status === 'active' && previousRaw !== null) {
      try {
        const ordinaryState = validatedRuntimeState(JSON.parse(previousRaw), {
          expectSubmitted: false,
          timerPolicy: entry.timerPolicy,
          status: 'active',
          partCount: entry.selections.length,
        });
        if (Number(ordinaryState.updatedAt || 0) > Number(entry.runtimeState?.updatedAt || 0)) {
          resumeEntry = { ...entry, runtimeState: ordinaryState };
        }
      } catch (_error) { /* the verified checkpoint remains authoritative */ }
    }
    const runtimeState = rebasedRuntimeState(resumeEntry);
    const encoded = JSON.stringify(runtimeState);
    try {
      storage.setItem(runtimeStateKey, encoded);
      if (storage.getItem(runtimeStateKey) !== encoded) throw new Error('浏览器未能验证恢复现场。');
    } catch (error) {
      let rollbackError = null;
      try {
        if (previousRaw === null) storage.removeItem(runtimeStateKey);
        else storage.setItem(runtimeStateKey, previousRaw);
        if (storage.getItem(runtimeStateKey) !== previousRaw) throw new Error('原答题现场未能恢复。');
      } catch (restoreError) { rollbackError = restoreError; }
      throw new Error(`${error.message || error}${rollbackError ? `；回滚失败：${rollbackError.message || rollbackError}` : ''}`);
    }
    return {
      storageWrites: [{ key: runtimeStateKey, value: encoded }],
      cleanupKeys: [],
      hideReset: false,
    };
  }

  function discardResumableSession(kind, storage = window.localStorage) {
    const normalizedKind = resumableKind(kind);
    const sessions = readResumableSessions(storage);
    const entry = sessions[normalizedKind];
    if (!normalizedKind || !entry) return { discarded: false };
    const previousIndexRaw = storage.getItem(RESUMABLE_SESSIONS_STORAGE_KEY);
    const previousRuntimeRaw = storage.getItem(entry.runtimeStateKey);
    const otherKind = normalizedKind === 'practice' ? 'mock' : 'practice';
    const runtimeShared = sessions[otherKind]?.runtimeStateKey === entry.runtimeStateKey;
    let attemptProtection = null;
    try {
      attemptProtection = protectDiscardedResumableAttempt(entry.attemptSessionId, storage);
      sessions[normalizedKind] = null;
      writeResumableSessions(sessions, storage);
      if (!runtimeShared) {
        storage.removeItem(entry.runtimeStateKey);
        if (storage.getItem(entry.runtimeStateKey) !== null) throw new Error('浏览器未能移除对应答题现场。');
      }
      return { discarded: true, entry, attemptProtected: true };
    } catch (error) {
      let rollbackError = null;
      try {
        if (previousIndexRaw === null) storage.removeItem(RESUMABLE_SESSIONS_STORAGE_KEY);
        else storage.setItem(RESUMABLE_SESSIONS_STORAGE_KEY, previousIndexRaw);
        if (!runtimeShared) {
          if (previousRuntimeRaw === null) storage.removeItem(entry.runtimeStateKey);
          else storage.setItem(entry.runtimeStateKey, previousRuntimeRaw);
        }
        if (storage.getItem(RESUMABLE_SESSIONS_STORAGE_KEY) !== previousIndexRaw ||
            (!runtimeShared && storage.getItem(entry.runtimeStateKey) !== previousRuntimeRaw)) {
          throw new Error('原暂停点未能恢复。');
        }
        state.resumableSessions = readResumableSessions(storage);
        renderResumableSessions();
      } catch (restoreError) { rollbackError = restoreError; }
      if (attemptProtection) {
        try { rollbackDiscardedResumableAttemptProtection(attemptProtection, storage); }
        catch (protectionRollbackError) { rollbackError ||= protectionRollbackError; }
      }
      try {
        state.resumableSessions = readResumableSessions(storage);
        renderResumableSessions();
      } catch (refreshError) { rollbackError ||= refreshError; }
      throw new Error(`${error.message || error}${rollbackError ? `；回滚失败：${rollbackError.message || rollbackError}` : ''}`);
    }
  }

  async function discardResumableSessionAndPendingRecord(kind, expectedTarget = {}) {
    const normalizedKind = resumableKind(kind);
    if (!normalizedKind) throw new Error('未完成内容的模式无效。');
    const capturedEntry = readResumableSessions()[normalizedKind];
    const target = {
      attemptSessionId: normalizedResumableAttemptId(
        expectedTarget.attemptSessionId || capturedEntry?.attemptSessionId,
      ),
      submissionId: String(expectedTarget.submissionId || capturedEntry?.runtimeState?.submissionId || '').trim(),
      runtimeStateKey: String(expectedTarget.runtimeStateKey || capturedEntry?.runtimeStateKey || '').trim(),
      pendingSubmission: expectedTarget.pendingSubmission === true || capturedEntry?.status === 'submitted-pending',
      entry: capturedEntry,
    };
    if (target.pendingSubmission) target.submissionId = normalizedDeletedSubmissionId(target.submissionId);
    return withResumableMutationLock(async () => {
      state.resumableSessions = readResumableSessions();
      const currentEntry = state.resumableSessions[normalizedKind];
      const currentMatches = currentEntry?.attemptSessionId === target.attemptSessionId;
      const entry = currentMatches ? currentEntry : target.entry;
      const pendingSubmission = target.pendingSubmission || entry?.status === 'submitted-pending';
      const submissionId = pendingSubmission
        ? normalizedDeletedSubmissionId(target.submissionId || entry?.runtimeState?.submissionId)
        : '';
      let deletionProtection = null;
      let deletionTerminal = false;
      try {
        if (pendingSubmission) {
          deletionProtection = protectDeletedSubmissions([submissionId]);
          const result = await records.deleteSubmission(submissionId);
          deletionTerminal = Boolean(result?.verified && (result.deleted || result.reason === 'not-found'));
          if (!deletionTerminal) {
            throw new Error('这条待保存记录未能通过安全删除验证。');
          }
        }
        if (currentMatches) {
          const discarded = discardResumableSession(normalizedKind);
          if (!discarded.discarded) throw new Error('这项未完成内容已经不存在。');
          return { ...discarded, pendingSubmission };
        }

        const attemptProtection = protectDiscardedResumableAttempt(target.attemptSessionId);
        try {
          const runtimeReferenced = ['practice', 'mock'].some((candidateKind) => (
            state.resumableSessions[candidateKind]?.runtimeStateKey === target.runtimeStateKey
          ));
          if (target.runtimeStateKey && !runtimeReferenced) {
            window.localStorage.removeItem(target.runtimeStateKey);
            if (window.localStorage.getItem(target.runtimeStateKey) !== null) {
              throw new Error('浏览器未能移除对应答题现场。');
            }
          }
        } catch (error) {
          if (!deletionTerminal) rollbackDiscardedResumableAttemptProtection(attemptProtection);
          throw error;
        }
        state.resumableSessions = readResumableSessions();
        renderResumableSessions();
        return { discarded: true, entry, pendingSubmission, attemptProtected: true, superseded: Boolean(currentEntry) };
      } catch (error) {
        const mutationRollbackUnverified = error?.deleteRollbackVerified === false;
        if (deletionProtection && !deletionTerminal && !mutationRollbackUnverified) {
          try { rollbackDeletedSubmissionProtection(deletionProtection); }
          catch (rollbackError) { throw new Error(`${error.message || error}；${rollbackError.message || rollbackError}`); }
        }
        if (deletionProtection && !deletionTerminal && mutationRollbackUnverified) {
          throw new Error(`${error.message || error}；原数据回滚未能确认，已保留删除保护以防旧记录重新出现`);
        }
        throw error;
      }
    });
  }

  function actionDialogIsOpen() {
    const backdrop = byId('action-dialog-backdrop');
    return Boolean(backdrop && !backdrop.hidden);
  }

  function setActionDialogBackgroundInert(active) {
    [byId('app-shell'), byId('runner')].forEach((element) => {
      if (element) element.inert = Boolean(active);
    });
    document.body.classList.toggle('action-dialog-open', Boolean(active));
  }

  function actionDialogFocusableElements() {
    const dialog = byId('action-dialog');
    if (!dialog) return [];
    return [...dialog.querySelectorAll('button, input, [href], [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.disabled && !element.hidden && !element.closest('[hidden]'));
  }

  function setActionDialogStatus(message = '', isError = false) {
    const status = byId('action-dialog-status');
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle('is-error', Boolean(message && isError));
  }

  function syncActionDialogPhrase() {
    const expected = state.actionDialog.expectedPhrase;
    const input = byId('action-dialog-phrase');
    const confirm = byId('action-dialog-confirm');
    if (!input || !confirm) return;
    confirm.disabled = Boolean(expected) && input.value !== expected;
  }

  function setActionDialogBusy(busy) {
    state.actionDialog.busy = Boolean(busy);
    const dialog = byId('action-dialog');
    if (dialog) dialog.setAttribute('aria-busy', String(Boolean(busy)));
    [byId('action-dialog-backup'), byId('action-dialog-alternate'), byId('action-dialog-cancel'), byId('action-dialog-phrase')].forEach((element) => {
      if (element) element.disabled = Boolean(busy)
        || (['action-dialog-backup', 'action-dialog-alternate'].includes(element.id) && element.hidden);
    });
    const confirm = byId('action-dialog-confirm');
    if (confirm) confirm.disabled = Boolean(busy);
    if (!busy) syncActionDialogPhrase();
  }

  /* BEGIN T50 RESTART DIALOG TOP LAYER */
  let restartDialogLayer = null;

  function releaseRestartDialogLayer() {
    const layer = restartDialogLayer;
    if (!layer) return;
    restartDialogLayer = null;
    document.removeEventListener('fullscreenchange', layer.onFullscreenChange);
    layer.host.removeEventListener('cancel', layer.onCancel);
    if (layer.host.open) layer.host.close();
    layer.anchor.replaceWith(layer.backdrop);
    layer.host.remove();
  }

  function showRestartDialogLayer() {
    if (state.actionDialog.kind !== 'restart-runner') return;
    const backdrop = byId('action-dialog-backdrop');
    const host = document.createElement('dialog');
    // Keep the existing Chinese alertdialog and handlers in their own document.
    // A modal dialog participates in the browser top layer above the fullscreen iframe.
    if (!backdrop || typeof host.showModal !== 'function') return;
    host.id = 'restart-dialog-top-layer';
    host.setAttribute('aria-labelledby', 'action-dialog-title');
    host.style.cssText = 'position:fixed;inset:0;margin:0;padding:0;border:0;width:100vw;height:100vh;max-width:none;max-height:none;background:transparent;color:inherit;overflow:visible;';
    const anchor = document.createComment('restart-dialog-backdrop-home');
    backdrop.before(anchor);
    document.body.appendChild(host);
    host.appendChild(backdrop);
    const onCancel = (event) => {
      event.preventDefault();
      handleActionDialogCancel();
    };
    const onFullscreenChange = () => {
      if (restartDialogLayer?.host !== host || !actionDialogIsOpen()) return;
      const focused = document.activeElement;
      // Entering fullscreen can append the iframe after an already-open modal.
      // Reinsert only this transient host; do not exit fullscreen or rebuild content.
      if (host.open) host.close();
      host.showModal();
      if (focused && backdrop.contains(focused)) focused.focus();
      else byId('action-dialog-cancel')?.focus();
    };
    restartDialogLayer = { host, anchor, backdrop, onCancel, onFullscreenChange };
    host.addEventListener('cancel', onCancel);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    host.showModal();
  }
  /* END T50 RESTART DIALOG TOP LAYER */

  function openActionDialog(config) {
    const backdrop = byId('action-dialog-backdrop');
    if (!backdrop) return;
    releaseRestartDialogLayer();
    closeRecordMenus();
    state.actionDialog = {
      kind: String(config.kind || ''),
      recordId: String(config.recordId || ''),
      attemptSessionId: String(config.attemptSessionId || ''),
      submissionId: String(config.submissionId || ''),
      runtimeStateKey: String(config.runtimeStateKey || ''),
      pendingSubmission: config.pendingSubmission === true,
      expectedPhrase: String(config.expectedPhrase || ''),
      alternateKind: String(config.alternateKind || ''),
      opener: config.opener || document.activeElement,
      busy: false,
    };
    byId('action-dialog-eyebrow').textContent = config.eyebrow || '请确认';
    byId('action-dialog-title').textContent = config.title || '确认操作';
    byId('action-dialog-description').textContent = config.description || '';
    byId('action-dialog-cancel').hidden = false;
    byId('action-dialog-cancel').textContent = config.cancelLabel || '取消';
    const confirmButton = byId('action-dialog-confirm');
    confirmButton.textContent = config.confirmLabel || '确认';
    confirmButton.classList.toggle('danger-button', config.danger !== false);
    confirmButton.classList.toggle('primary-button', config.danger === false);
    const phraseGroup = byId('action-dialog-phrase-group');
    const phraseInput = byId('action-dialog-phrase');
    const phraseLabel = byId('action-dialog-phrase-label');
    phraseGroup.hidden = !state.actionDialog.expectedPhrase;
    phraseLabel.textContent = state.actionDialog.expectedPhrase;
    phraseInput.value = '';
    phraseInput.setAttribute('aria-label', state.actionDialog.expectedPhrase
      ? `请输入${state.actionDialog.expectedPhrase}以确认`
      : '确认文字');
    const backup = byId('action-dialog-backup');
    const showBackup = config.showBackup === true;
    backup.hidden = !showBackup;
    backup.disabled = !showBackup;
    backup.setAttribute('aria-hidden', String(!showBackup));
    const alternate = byId('action-dialog-alternate');
    const showAlternate = Boolean(state.actionDialog.alternateKind && config.alternateLabel);
    alternate.hidden = !showAlternate;
    alternate.disabled = !showAlternate;
    alternate.setAttribute('aria-hidden', String(!showAlternate));
    alternate.textContent = showAlternate ? String(config.alternateLabel) : '';
    byId('action-dialog').classList.toggle('has-backup-action', showBackup);
    byId('action-dialog').classList.toggle('has-alternate-action', showAlternate);
    setActionDialogStatus();
    backdrop.hidden = false;
    setActionDialogBackgroundInert(true);
    setActionDialogBusy(false);
    showRestartDialogLayer();
    const initialFocus = config.initialFocus === 'alternate' && showAlternate
      ? alternate
      : byId('action-dialog-cancel');
    window.requestAnimationFrame(() => initialFocus?.focus());
  }

  function closeActionDialog(options = {}) {
    if (!actionDialogIsOpen()) return;
    if (state.actionDialog.busy && !options.force) return;
    const opener = state.actionDialog.opener;
    const exitCancelled = state.actionDialog.kind === 'exit-mock' ||
      state.actionDialog.kind === 'exit-practice' ||
      state.actionDialog.kind === 'exit-review-annotations';
    byId('action-dialog-backdrop').hidden = true;
    releaseRestartDialogLayer();
    setActionDialogBackgroundInert(false);
    state.actionDialog = {
      kind: '',
      recordId: '',
      attemptSessionId: '',
      submissionId: '',
      runtimeStateKey: '',
      pendingSubmission: false,
      expectedPhrase: '',
      alternateKind: '',
      opener: null,
      busy: false,
    };
    if (options.restoreFocus === false) return;
    if (exitCancelled && state.currentSession) {
      const frame = byId('practice-frame');
      try {
        frame.contentWindow.postMessage({
          type: 'zyz-student-runner-exit-cancelled.v1',
          sessionId: state.currentSession.sessionId,
        }, '*');
      } catch (_error) { /* the frame itself remains the safe focus fallback */ }
      window.requestAnimationFrame(() => frame?.focus?.());
      return;
    }
    window.requestAnimationFrame(() => opener?.focus?.());
  }

  function handleActionDialogKeydown(event) {
    if (!actionDialogIsOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      handleActionDialogCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = actionDialogFocusableElements();
    if (!focusable.length) {
      event.preventDefault();
      byId('action-dialog')?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function closeRecordMenus(options = {}) {
    let focusTarget = null;
    document.querySelectorAll('.record-more-trigger[aria-expanded="true"]').forEach((button) => {
      if (options.except && button === options.except) return;
      button.setAttribute('aria-expanded', 'false');
      const menu = button.parentElement?.querySelector('.record-more-menu');
      if (menu) menu.hidden = true;
      focusTarget ||= button;
    });
    if (options.restoreFocus) focusTarget?.focus?.();
  }

  function normalizedDeletedSubmissionId(value) {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.length > 220) throw new Error('记录编号无效。');
    return normalized;
  }

  function readDeletedSubmissionIds(storage = window.localStorage) {
    const raw = storage.getItem(DELETED_SUBMISSIONS_STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== DELETED_SUBMISSIONS_SCHEMA_VERSION || !Array.isArray(parsed.recordIds)) {
      throw new Error('删除保护数据无法校验。');
    }
    if (parsed.recordIds.length > MAX_DELETED_SUBMISSION_IDS) throw new Error('删除保护数据超过安全上限。');
    const recordIds = parsed.recordIds.map(normalizedDeletedSubmissionId);
    if (new Set(recordIds).size !== recordIds.length) throw new Error('删除保护数据存在重复编号。');
    return new Set(recordIds);
  }

  function submissionIsDeleted(recordId) {
    return readDeletedSubmissionIds().has(normalizedDeletedSubmissionId(recordId));
  }

  function protectDeletedSubmissions(recordIds) {
    const normalizedIds = [...new Set(recordIds.map(normalizedDeletedSubmissionId))];
    if (!normalizedIds.length) return { protectedCount: 0 };
    const storage = window.localStorage;
    const previousRaw = storage.getItem(DELETED_SUBMISSIONS_STORAGE_KEY);
    const protectedIds = readDeletedSubmissionIds(storage);
    normalizedIds.forEach((recordId) => protectedIds.add(recordId));
    if (protectedIds.size > MAX_DELETED_SUBMISSION_IDS) throw new Error('删除保护数据已达到安全上限，未执行删除。');
    const encoded = JSON.stringify({
      schemaVersion: DELETED_SUBMISSIONS_SCHEMA_VERSION,
      recordIds: [...protectedIds],
    });
    if (encoded.length > MAX_DELETED_SUBMISSIONS_BYTES) throw new Error('删除保护数据空间不足，未执行删除。');
    try {
      storage.setItem(DELETED_SUBMISSIONS_STORAGE_KEY, encoded);
      if (storage.getItem(DELETED_SUBMISSIONS_STORAGE_KEY) !== encoded) {
        throw new Error('浏览器未能验证删除保护数据。');
      }
    } catch (error) {
      let rollbackError = null;
      try {
        if (storage.getItem(DELETED_SUBMISSIONS_STORAGE_KEY) === encoded) {
          if (previousRaw === null) storage.removeItem(DELETED_SUBMISSIONS_STORAGE_KEY);
          else storage.setItem(DELETED_SUBMISSIONS_STORAGE_KEY, previousRaw);
          if (storage.getItem(DELETED_SUBMISSIONS_STORAGE_KEY) !== previousRaw) {
            throw new Error('删除保护数据未恢复到原状态。');
          }
        }
      } catch (restoreError) { rollbackError = restoreError; }
      throw new Error(`浏览器未能安全写入删除保护数据，未执行删除：${error.message || error}`
        + (rollbackError ? `；回滚失败：${rollbackError.message || rollbackError}` : ''));
    }
    return { protectedCount: normalizedIds.length, previousRaw, encoded };
  }

  function rollbackDeletedSubmissionProtection(token) {
    if (!token?.encoded) return { rolledBack: false, reason: 'not-started' };
    const storage = window.localStorage;
    if (storage.getItem(DELETED_SUBMISSIONS_STORAGE_KEY) !== token.encoded) {
      throw new Error('删除保护数据已被更新，为避免覆盖较新状态，未执行回滚。');
    }
    if (token.previousRaw === null) storage.removeItem(DELETED_SUBMISSIONS_STORAGE_KEY);
    else storage.setItem(DELETED_SUBMISSIONS_STORAGE_KEY, token.previousRaw);
    if (storage.getItem(DELETED_SUBMISSIONS_STORAGE_KEY) !== token.previousRaw) {
      throw new Error('删除保护数据回滚后未通过校验。');
    }
    return { rolledBack: true };
  }

  function ordinaryRuntimeStateKeysForRecord(row) {
    const snapshotHash = String(row?.snapshotHash || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/u.test(snapshotHash)) return [];
    const expectedContentVersion = `1.0.0-homework.${snapshotHash.slice(0, 12)}`;
    const recordedContentVersion = String(row?.packageContentVersion || '').trim();
    if (recordedContentVersion && recordedContentVersion !== expectedContentVersion) return [];
    const suffix = `.package.homework.snapshot.${snapshotHash.slice(0, 24)}.${expectedContentVersion}`;
    const keys = [`${RUNTIME_STATE_STORAGE_PREFIX}${suffix}`];
    try {
      if (row?.sessionId) keys.unshift(`${runtimeStoragePrefixForAttempt(row.sessionId)}${suffix}`);
    } catch (_error) { /* legacy or imported records still use the deterministic key */ }
    return [...new Set(keys)];
  }

  function removeDeletedOrdinaryRuntimeStates(rows) {
    const storage = window.localStorage;
    const targetsByKey = new Map();
    rows.forEach((row) => {
      ordinaryRuntimeStateKeysForRecord(row).forEach((stateKey) => {
        if (!targetsByKey.has(stateKey)) targetsByKey.set(stateKey, new Set());
        targetsByKey.get(stateKey).add(normalizedDeletedSubmissionId(row.recordId));
      });
    });
    let removedCount = 0;
    targetsByKey.forEach((recordIds, stateKey) => {
      const raw = storage.getItem(stateKey);
      if (raw === null) return;
      let storedState;
      try { storedState = JSON.parse(raw); } catch (_error) { return; }
      if (!storedState?.submitted || !recordIds.has(String(storedState.submissionId || ''))) return;
      storage.removeItem(stateKey);
      if (storage.getItem(stateKey) !== null) {
        try { storage.setItem(stateKey, raw); } catch (_error) { /* report the failed exact cleanup below */ }
        throw new Error('浏览器未能移除对应的旧答题现场。');
      }
      removedCount += 1;
    });
    return { removedCount };
  }

  function setupPracticeSelectionScroll() {
    const panel = document.querySelector('.selection-panel');
    if (!panel || panel.closest('.selection-column')) return;
    const column = document.createElement('div');
    const sentinel = document.createElement('span');
    column.className = 'selection-column';
    sentinel.className = 'selection-sticky-sentinel';
    sentinel.setAttribute('aria-hidden', 'true');
    panel.parentNode.insertBefore(column, panel);
    column.append(sentinel, panel);

    const compactLayout = window.matchMedia('(max-width: 760px)');
    const reducedTop = window.matchMedia('(max-width: 1050px)');
    let observer = null;
    const observe = () => {
      observer?.disconnect();
      panel.classList.remove('is-stuck');
      if (compactLayout.matches || typeof window.IntersectionObserver !== 'function') return;
      const stickyTop = Number.parseFloat(window.getComputedStyle(panel).top) || 0;
      observer = new window.IntersectionObserver(([entry]) => {
        const stuck = !entry.isIntersecting && entry.boundingClientRect.top < stickyTop;
        panel.classList.toggle('is-stuck', stuck);
      }, { root: null, rootMargin: `-${stickyTop}px 0px 0px 0px`, threshold: 0 });
      observer.observe(sentinel);
    };
    compactLayout.addEventListener?.('change', observe);
    reducedTop.addEventListener?.('change', observe);
    observe();
  }

  function route(next) {
    const normalized = ['home', 'practice', 'mock', 'records'].includes(next) ? next : 'home';
    state.route = normalized;
    document.querySelectorAll('[data-view]').forEach((view) => view.classList.toggle('is-active', view.dataset.view === normalized));
    document.querySelectorAll('.main-nav [data-route]').forEach((button) => {
      if (button.dataset.route === normalized) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (normalized === 'practice') renderPassages();
    if (normalized === 'mock' && !state.mockSelection.length) generateMock();
    if (normalized === 'records') renderRecords();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function selectedSubmissionRecords() {
    return state.recordRows.filter((row) => row.type === 'submitted' || row.kind === 'submission' || row.recordType === 'submission' || row.submittedAt);
  }

  function recordPassageIds(row) {
    return Array.isArray(row?.passageIds) ? row.passageIds : row?.passageId ? [row.passageId] : [];
  }

  function rebuildRecordIndexes() {
    state.submittedPassageIds = new Set();
    state.submittedTaskIds = new Set();
    state.visitedPassageIds = new Set();
    state.recordRows.forEach((row) => {
      const ids = recordPassageIds(row);
      ids.forEach((id) => state.visitedPassageIds.add(id));
      if (row.type === 'submitted' || row.kind === 'submission' || row.recordType === 'submission' || row.submittedAt) {
        if (row.scope === 'task') {
          (Array.isArray(row.taskIds) ? row.taskIds : []).forEach((id) => state.submittedTaskIds.add(id));
        } else {
          ids.forEach((id) => {
            state.submittedPassageIds.add(id);
            taskGroupsForPassage(id).forEach((task) => state.submittedTaskIds.add(task.taskId));
          });
        }
      }
    });
    passages.forEach((passage) => {
      const taskIds = taskGroupsForPassage(passage.passageId).map((task) => task.taskId);
      if (taskIds.length && taskIds.every((taskId) => state.submittedTaskIds.has(taskId))) {
        state.submittedPassageIds.add(passage.passageId);
      }
    });
  }

  async function refreshRecords() {
    state.recordGuideStatus = 'loading';
    renderRecordGuide();
    if (!records) return;
    try {
      const read = await records.listRecordsWithReadHealth();
      state.recordRows = read.rows;
      const health = read.health;
      const storage = records.getStorageStatus();
      const reliable = health.completed && health.success && health.mode === 'indexeddb'
        && storage.storageMode === 'indexeddb' && !storage.storageError && health.rejectedCount === 0;
      state.recordGuideStatus = !reliable ? 'unavailable'
        : health.rawCount === 0 && health.validCount === 0 && state.recordRows.length === 0 ? 'empty' : 'present';
      renderRecordGuide();
      rebuildRecordIndexes();
      renderHomeStats();
      if (state.route === 'records') renderRecords();
      if (state.route === 'practice') renderPassages();
    } catch (error) {
      state.recordGuideStatus = 'unavailable';
      renderRecordGuide();
      console.warn('Could not read student records.', error);
    }
  }

  // T52 guidance observes records; it never persists a dismissal or edits a backup.
  let recordGuideOpener = null;
  function renderRecordGuide() {
    const unavailable = state.recordGuideStatus === 'unavailable';
    const show = !state.recordGuideDismissed && (unavailable || state.recordGuideStatus === 'empty');
    document.querySelectorAll('.record-guide-card').forEach((card) => {
      card.hidden = !show;
      card.querySelector('[data-record-guide-title]').textContent = unavailable ? '暂时无法确认本机记录' : '这里还没有练习记录';
      card.querySelector('[data-record-guide-copy]').textContent = unavailable
        ? '当前记录读取未能完整确认，不能据此判断旧记录已清零。请先保留旧文件和浏览器数据，再查看恢复步骤。'
        : card.id === 'record-guide-home'
          ? '更新、换位置或换浏览器后记录变成 0？先回旧版导出完整备份，再导入这里。'
          : '第一次使用？可以直接开始练习。如果更新文件、更换打开位置或浏览器后记录变成 0，请先回旧版保存完整备份，再导入这里。';
      const firstUsePath = card.querySelector('[data-record-guide-first-use]');
      if (firstUsePath) firstUsePath.hidden = unavailable;
    });
  }
  function openRecordBackupGuide(opener) {
    if (state.currentSession || !byId('runner').hidden) return;
    const dialog = byId('record-backup-guide');
    recordGuideOpener = opener;
    if (!dialog.open) dialog.showModal();
    byId('record-backup-guide-title').focus();
  }
  function bindRecordBackupGuide() {
    document.querySelectorAll('[data-open-record-guide]').forEach((button) => button.addEventListener('click', () => openRecordBackupGuide(button)));
    document.querySelectorAll('[data-dismiss-record-guide]').forEach((button) => button.addEventListener('click', () => {
      state.recordGuideDismissed = true;
      renderRecordGuide();
      const next = state.route === 'records' ? document.querySelector('.record-guide-help-link') : document.querySelector('.hero-actions button');
      next?.focus();
    }));
    const dialog = byId('record-backup-guide');
    dialog.addEventListener('close', () => {
      if (recordGuideOpener?.isConnected && recordGuideOpener.getClientRects().length) recordGuideOpener.focus();
      recordGuideOpener = null;
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const first = byId('record-guide-choose-file');
      const last = byId('record-guide-close');
      if (event.shiftKey && (document.activeElement === first || document.activeElement === byId('record-backup-guide-title'))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    });
    byId('record-guide-close').addEventListener('click', () => dialog.close());
    byId('record-guide-choose-file').addEventListener('click', () => {
      route('records');
      document.querySelector('.records-recovery').open = true;
      recordGuideOpener = document.querySelector('.record-guide-help-link');
      dialog.close();
      byId('import-full-backup').click();
    });
  }
  // END T52 guidance.

  function renderHomeStats() {
    const submissions = selectedSubmissionRecords();
    const summary = aggregateRecordRows(submissions);
    const hasRecords = submissions.length > 0;
    byId('home-stat-time').textContent = hasRecords ? formatDuration(summary.elapsedSeconds) : '—';
    byId('home-stat-questions').textContent = hasRecords ? `${summary.answered} 题` : '—';
    byId('home-stat-accuracy').textContent = percentLabel(summary.accuracy);
    byId('home-stat-mock-average').textContent = summary.mockAverage === null
      ? '—'
      : `${compactDecimal(summary.mockAverage)} / 40`;

    const scopeIndex = Math.max(0, Math.min(HOME_PROGRESS_SCOPES.length - 1, Number(state.homeProgressScopeIndex) || 0));
    state.homeProgressScopeIndex = scopeIndex;
    const scope = HOME_PROGRESS_SCOPES[scopeIndex];
    const scopePassages = scope.frequencies
      ? passages.filter((passage) => scope.frequencies.includes(frequencyFor(passage)))
      : passages;
    const completed = scopePassages.filter((passage) => state.submittedPassageIds.has(passage.passageId)).length;
    const percent = scopePassages.length ? Math.round((completed / scopePassages.length) * 100) : 0;
    const nextScope = HOME_PROGRESS_SCOPES[(scopeIndex + 1) % HOME_PROGRESS_SCOPES.length];
    byId('home-progress-percent').textContent = `${percent}%`;
    byId('home-progress-count').textContent = `${completed} / ${scopePassages.length} 篇`;
    byId('home-progress-scope').textContent = scope.label;
    byId('home-ring-value').style.strokeDashoffset = String(100 - percent);
    byId('home-progress-control').setAttribute('aria-label',
      `当前范围：${scope.spoken}，已完成 ${completed}/${scopePassages.length} 篇。点按切换为${nextScope.spoken}。`);
  }

  function filteredPassages() {
    const search = state.filters.search.trim().toLocaleLowerCase('en');
    const visible = passages.filter((passage) => {
      if (state.filters.positions.size && !state.filters.positions.has(String(passage.passagePosition))) return false;
      if (state.filters.frequencies.size && !state.filters.frequencies.has(frequencyFor(passage))) return false;
      if (!matchesDifficulty(passage, state.filters.difficulties)) return false;
      const matchingTasks = (passage.composition?.taskGroups || []).filter((task) => {
        if (state.filters.questionType && taskQuestionTypeLabel(task) !== state.filters.questionType) return false;
        if (state.practiceMode === 'task' && state.filters.unseenOnly && state.submittedTaskIds.has(task.taskId)) return false;
        return true;
      });
      if ((state.filters.questionType || state.practiceMode === 'task') && !matchingTasks.length) return false;
      if (state.practiceMode === 'full' && state.filters.unseenOnly && state.submittedPassageIds.has(passage.passageId)) return false;
      if (search && !`${passage.title} ${passage.titleZh || ''}`.toLocaleLowerCase('en').includes(search)) return false;
      return true;
    });
    const defaultCompare = (a, b) => Number(a.passagePosition) - Number(b.passagePosition) || a.title.localeCompare(b.title, 'en');
    const frequencyRank = { high: 0, medium: 1, low: 2 };
    const compare = {
      default: defaultCompare,
      frequency: (a, b) => (frequencyRank[frequencyFor(a)] ?? 9) - (frequencyRank[frequencyFor(b)] ?? 9) || defaultCompare(a, b),
      difficulty: (a, b) => Number(difficultyMeta(a).value) - Number(difficultyMeta(b).value) || defaultCompare(a, b),
      title: (a, b) => a.title.localeCompare(b.title, 'en') || defaultCompare(a, b),
    }[state.sort] || defaultCompare;
    return visible.sort(compare);
  }

  function isSelected(passageId, taskId = null) {
    const selection = state.selections.find((item) => item.passageId === passageId);
    if (!selection) return false;
    return taskId === null || (selection.taskIds || []).includes(taskId) || selection.taskId === taskId;
  }

  function latestSubmissionForPassage(passageId) {
    return selectedSubmissionRecords()
      .filter((row) => recordPassageIds(row).includes(passageId))
      .sort((a, b) => Date.parse(b.submittedAt || b.updatedAt || 0) - Date.parse(a.submittedAt || a.updatedAt || 0))[0] || null;
  }

  function metadataMarkup(passage, size = 'regular') {
    const frequency = frequencyFor(passage);
    const difficulty = difficultyMeta(passage);
    const compact = size === 'compact';
    return `<div class="${compact ? 'row-meta ' : 'meta-row '}metadata-pills metadata-pills--${compact ? 'compact' : 'regular'}" data-meta-component="metadata-pills" data-meta-size="${compact ? 'compact' : 'regular'}" data-meta-order="frequency,difficulty,question-count">
      <span class="meta-pill metadata-pill metadata-pill--frequency-${frequency} frequency-${frequency}">${frequencyLabel(frequency)}</span>
      <span class="meta-pill metadata-pill metadata-pill--difficulty-${difficulty.key} difficulty-${difficulty.key}">${htmlEscape(difficulty.tier)} · ${difficulty.value}</span>
      <span class="meta-pill metadata-pill metadata-pill--question-count">${passage.questionCount} 题</span>
    </div>`;
  }

  function taskActionsMarkup(passage) {
    const limitState = practicePassageLimitState(passage.passageId);
    const limitAttributes = limitState.blocked
      ? ' disabled aria-disabled="true" title="已选满 3 篇；请先移除一篇"'
      : '';
    return `<div class="task-list task-chip-list" data-task-info="true" data-task-actions="true" data-task-layout="inline-left-stack">${(passage.composition?.taskGroups || [])
      .filter((task) => !state.filters.questionType || taskQuestionTypeLabel(task) === state.filters.questionType)
      .filter((task) => !state.filters.unseenOnly || !state.submittedTaskIds.has(task.taskId))
      .map((task) => `
      <button class="task-button${isSelected(passage.passageId, task.taskId) ? ' is-selected' : ''}" type="button" data-action="select-task" data-passage-id="${htmlEscape(passage.passageId)}" data-task-id="${htmlEscape(task.taskId)}" aria-pressed="${String(isSelected(passage.passageId, task.taskId))}"${limitAttributes}>
        <span>${htmlEscape(task.label)} · ${htmlEscape(taskQuestionTypeLabel(task))}</span><small><span>${task.responseCount} 题</span>${limitState.blocked ? '<span class="task-limit-label">已满</span>' : ''}</small>
      </button>`).join('')}</div>`;
  }

  function fullActionMarkup(passage, className) {
    const limitState = practicePassageLimitState(passage.passageId);
    const label = limitState.selected ? '移出本次练习' : limitState.blocked ? '已选满 3 篇' : '加入本次练习';
    return `<button class="${className}" type="button" data-action="toggle-full" data-passage-id="${htmlEscape(passage.passageId)}"${limitState.blocked ? ' disabled aria-disabled="true" title="已选满 3 篇；请先移除一篇"' : ''}>${label}</button>`;
  }

  function passageCard(passage) {
    const limitState = practicePassageLimitState(passage.passageId);
    const completed = state.submittedPassageIds.has(passage.passageId);
    const latestRecord = latestSubmissionForPassage(passage.passageId);
    const questionTypeSummary = [...new Set((passage.composition?.taskGroups || []).map(taskQuestionTypeLabel))];
    return `<article class="passage-card${limitState.selected ? ' is-selected' : ''}${limitState.blocked ? ' is-limit-blocked' : ''}" role="listitem" data-result-passage-id="${htmlEscape(passage.passageId)}" data-result-layout="card" data-practice-mode="${state.practiceMode}">
      <div class="passage-card-header"><div class="title-block"><h3>${htmlEscape(passage.title)}</h3><p class="title-zh">${htmlEscape(passage.titleZh || '中文名待补')}</p></div><span class="position-pill position-p${Number(passage.passagePosition)}">P${Number(passage.passagePosition)}</span></div>
      ${metadataMarkup(passage)}
      ${completed ? '<span class="completed-label">已完成</span>' : ''}
      <p class="type-line">${htmlEscape(questionTypeSummary.join(' · '))}</p>
      ${state.practiceMode === 'full'
        ? fullActionMarkup(passage, 'card-action')
        : taskActionsMarkup(passage)}
      ${latestRecord ? `<button class="replay-link" type="button" data-action="reopen-attempt" data-record-id="${htmlEscape(latestRecord.recordId)}">复盘最近一次提交</button>` : ''}
    </article>`;
  }

  function passageRow(passage) {
    const limitState = practicePassageLimitState(passage.passageId);
    const latestRecord = latestSubmissionForPassage(passage.passageId);
    const questionTypeSummary = [...new Set((passage.composition?.taskGroups || []).map(taskQuestionTypeLabel))];
    const replay = latestRecord ? `<button class="replay-link" type="button" data-action="reopen-attempt" data-record-id="${htmlEscape(latestRecord.recordId)}">复盘最近一次提交</button>` : '';
    return `<article class="passage-row${limitState.selected ? ' is-selected' : ''}" role="listitem" data-result-passage-id="${htmlEscape(passage.passageId)}" data-result-layout="list" data-practice-mode="${state.practiceMode}">
      <span class="position-pill position-p${Number(passage.passagePosition)} row-position">P${Number(passage.passagePosition)}</span>
      <div class="row-main"><div class="row-titles"><h3>${htmlEscape(passage.title)}</h3><p class="title-zh">${htmlEscape(passage.titleZh || '中文名待补')}</p></div>
        ${metadataMarkup(passage, 'compact')}
        ${state.practiceMode === 'full' ? `<p class="row-type-line">${htmlEscape(questionTypeSummary.join(' · '))}</p>` : `${taskActionsMarkup(passage)}${replay}`}
      </div>
      ${state.practiceMode === 'full' ? `<div class="row-actions">${fullActionMarkup(passage, 'row-action')}${replay}</div>` : ''}
    </article>`;
  }

  function renderPassages({ announce = false } = {}) {
    const matches = filteredPassages();
    byId('practice-result-count').textContent = `${matches.length} 篇文章`;
    const grid = byId('passage-grid');
    grid.dataset.view = state.viewMode;
    grid.dataset.practiceMode = state.practiceMode;
    grid.innerHTML = matches.length ? matches.map(state.viewMode === 'card' ? passageCard : passageRow).join('') : '<div class="no-results" role="status">没有符合当前筛选条件的文章</div>';
    document.querySelectorAll('button[data-view-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.viewMode === state.viewMode)));
    if (announce) byId('view-announcement').textContent = `已切换到${state.viewMode === 'list' ? '列表' : '卡片'}视图，共 ${matches.length} 篇文章`;
    renderSelection();
  }

  function setViewMode(mode) {
    if (!['card', 'list'].includes(mode) || mode === state.viewMode) return;
    state.viewMode = mode;
    renderPassages({ announce: true });
  }

  function syncUnseenOnlyControl() {
    const checkbox = byId('unseen-only');
    byId('unseen-only-button').setAttribute('aria-pressed', String(checkbox.checked));
    return checkbox.checked;
  }

  function renderSelection() {
    const list = byId('selection-list');
    const presentation = practiceSelectionPresentation();
    const { selections, passageCount } = presentation;
    const empty = byId('selection-empty');
    empty.hidden = passageCount > 0;
    empty.textContent = presentation.empty;
    const panel = document.querySelector('.selection-panel');
    panel?.classList.toggle('is-empty', passageCount === 0);
    panel?.classList.toggle('is-at-limit', passageCount >= MAX_PRACTICE_PASSAGES);
    list.innerHTML = selections.map((selection) => {
      const passage = passageById.get(selection.passageId);
      const selected = new Set(selection.taskIds || []);
      const tasks = taskGroupsForPassage(selection.passageId).filter((task) => selected.has(task.taskId));
      const taskRows = selection.scope === 'task'
        ? `<div class="selection-task-list">${tasks.map((task) => `<span class="selection-task-chip"><span>${htmlEscape(task.label || taskQuestionTypeLabel(task))}</span><button type="button" data-action="remove-selection-task" data-passage-id="${htmlEscape(selection.passageId)}" data-task-id="${htmlEscape(task.taskId)}" aria-label="移除 ${htmlEscape(task.label || taskQuestionTypeLabel(task))}">×</button></span>`).join('')}</div>`
        : '';
      return `<li><div class="selection-copy"><strong>${htmlEscape(passage?.title || '历史练习内容（题库已更新）')}</strong><small>${selection.scope === 'full' ? `P${passage?.passagePosition} · ${passage?.questionCount} 题` : `${tasks.length} 个题型 · ${selectionQuestionCount(selection)} 题`}</small>${taskRows}</div><button class="selection-remove-passage" type="button" data-action="remove-selection" data-passage-id="${htmlEscape(selection.passageId)}" aria-label="移除整篇">×</button></li>`;
    }).join('');
    renderPracticeTimer();
    renderPracticeSelectionFooter(selections);
  }

  function renderPracticeSelectionFooter(selections = state.selections) {
    const presentation = practiceSelectionPresentation(selections);
    const counter = byId('selection-count');
    if (counter) {
      counter.textContent = presentation.counter;
      counter.classList.toggle('is-full', presentation.passageCount >= MAX_PRACTICE_PASSAGES);
    }
    const summary = byId('selection-summary');
    if (summary) summary.textContent = presentation.summary;
    const startButton = byId('start-practice');
    if (startButton) {
      startButton.disabled = presentation.passageCount === 0;
      startButton.textContent = presentation.startLabel;
    }
  }

  function toggleFullPassage(passageId) {
    const index = state.selections.findIndex((item) => item.passageId === passageId);
    if (index >= 0) state.selections.splice(index, 1);
    else if (practicePassageLimitState(passageId).blocked) return toast('本次最多选择 3 篇；请先移除一篇再添加。');
    else state.selections.push({ passageId, scope: 'full' });
    renderPassages();
  }

  function selectTask(passageId, taskId) {
    const samePassageIndex = state.selections.findIndex((item) => item.passageId === passageId);
    if (practicePassageLimitState(passageId).blocked) return toast('题型最多来自 3 篇；同篇仍可继续添加题型。');
    const current = samePassageIndex >= 0
      ? normalizedSelection(state.selections[samePassageIndex])
      : { passageId, scope: 'task', taskIds: [] };
    const selected = new Set(current?.taskIds || []);
    if (selected.has(taskId)) selected.delete(taskId); else selected.add(taskId);
    const taskIds = orderedTaskIds(passageId, [...selected]);
    if (samePassageIndex >= 0) {
      if (taskIds.length) state.selections.splice(samePassageIndex, 1, { passageId, scope: 'task', taskIds });
      else state.selections.splice(samePassageIndex, 1);
    } else if (taskIds.length) state.selections.push({ passageId, scope: 'task', taskIds });
    renderPassages();
  }

  function removeSelectionTask(passageId, taskId) {
    const index = state.selections.findIndex((selection) => selection.passageId === passageId);
    if (index < 0) return;
    const selection = normalizedSelection(state.selections[index]);
    const taskIds = orderedTaskIds(passageId, (selection?.taskIds || []).filter((id) => id !== taskId));
    if (taskIds.length) state.selections.splice(index, 1, { passageId, scope: 'task', taskIds });
    else state.selections.splice(index, 1);
    renderPassages();
  }

  function setPracticeMode(mode) {
    if (!['full', 'task'].includes(mode) || mode === state.practiceMode) return;
    state.practiceMode = mode;
    state.selections = [];
    document.querySelectorAll('[data-practice-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.practiceMode === mode)));
    renderPassages();
  }

  function secureRandomIndex(length) {
    if (length <= 1) return 0;
    try {
      const values = new Uint32Array(1);
      window.crypto.getRandomValues(values);
      return values[0] % length;
    } catch (_error) {
      return Math.floor(Math.random() * length);
    }
  }

  function pickMockPassage(position, frequencies, difficulties, excluded = new Set()) {
    const pool = passages.filter((passage) => Number(passage.passagePosition) === position
      && manifestById.get(passage.passageId)?.mockEligible !== false
      && passage.composition?.fullPassage?.selectable === true
      && frequencies.has(frequencyFor(passage))
      && matchesDifficulty(passage, difficulties)
      && !excluded.has(passage.passageId));
    const tiers = ['high', 'medium', 'low'].filter((frequency) => frequencies.has(frequency));
    const pools = [];
    if (byId('mock-unseen-priority').checked) tiers.forEach((tier) => pools.push(pool.filter((passage) => frequencyFor(passage) === tier && !state.visitedPassageIds.has(passage.passageId))));
    tiers.forEach((tier) => pools.push(pool.filter((passage) => frequencyFor(passage) === tier)));
    const chosenPool = pools.find((items) => items.length) || [];
    return chosenPool[secureRandomIndex(chosenPool.length)] || null;
  }

  function mockPassageMarkup(passage, concealed = false) {
    const position = Number(passage.passagePosition);
    if (concealed) {
      return `<li class="mock-surprise-placeholder"><span class="mock-part position-p${position}">P${position}</span><span><strong>P${position} 已重新选取</strong><small>篇章信息已隐藏</small></span><span class="mock-ready-pill">未剧透</span></li>`;
    }
    const frequency = frequencyFor(passage);
    const difficulty = difficultyMeta(passage);
    return `<li><span class="mock-part position-p${position}">P${position}</span><span><strong>${htmlEscape(passage.title)}</strong><small>${htmlEscape(passage.titleZh || '')}</small></span><span class="mock-meta"><span class="meta-pill metadata-pill metadata-pill--frequency-${frequency} frequency-${frequency}">${frequencyLabel(frequency)}</span><span class="meta-pill metadata-pill metadata-pill--difficulty-${difficulty.key} difficulty-${difficulty.key}">${htmlEscape(difficulty.tier)} · ${difficulty.value}</span></span></li>`;
  }

  function emptyMockSlotMarkup(position) {
    return `<li class="mock-empty-slot"><span class="mock-part position-p${position}">P${position}</span><span><strong>P${position} 待选择</strong><small>请从左侧候选列表中选择一篇文章</small></span></li>`;
  }

  function renderMockSelection(selection, emptyMessage = '') {
    const slots = [0, 1, 2].map((index) => selection[index] || null);
    const selectedCount = slots.filter(Boolean).length;
    const complete = selectedCount === 3;
    const concealed = complete && state.mockMode === 'auto' && state.mockSurprise;
    state.mockSelection = complete ? slots.map((passage) => ({ passageId: passage.passageId, scope: 'full' })) : [];
    state.mockSelectionMessage = String(emptyMessage || '');
    byId('start-mock').disabled = !complete;
    byId('mock-selection').innerHTML = slots
      .map((passage, index) => passage ? mockPassageMarkup(passage, concealed) : emptyMockSlotMarkup(index + 1))
      .join('');
    const message = byId('mock-selection-message');
    message.textContent = state.mockSelectionMessage;
    message.hidden = !state.mockSelectionMessage;
    byId('mock-combination-status').textContent = `${selectedCount} / 3 篇`;
    byId('mock-combination-detail').textContent = complete
      ? concealed ? 'P1 + P2 + P3 已重新选取' : 'P1 + P2 + P3 已就绪'
      : `还需选择 ${3 - selectedCount} 篇`;
  }

  function currentMockPassages() {
    return state.mockSelection.map((selection) => passageById.get(selection.passageId) || null);
  }

  function sameMockSelection(left, right) {
    return left.length === 3
      && right.length === 3
      && left.every((passage, index) => passage?.passageId === right[index]?.passageId);
  }

  function syncMockSurpriseControl() {
    const enabled = state.mockSurprise;
    byId('mock-surprise-title').textContent = enabled ? '惊喜模式已开启' : '惊喜模式';
    byId('mock-surprise-description').textContent = enabled
      ? '已换成一套新的组合，篇章将在开考后揭晓'
      : '开启后会立即换成一套新组合，篇章将在开考后揭晓';
    const input = byId('mock-surprise-enabled');
    input.checked = enabled;
    input.setAttribute('aria-label', enabled ? '关闭惊喜模式' : '开启惊喜模式');
  }

  function setMockSurprise(enabled) {
    const shouldEnable = Boolean(enabled);
    const previous = currentMockPassages();
    if (!shouldEnable) {
      state.mockSurprise = false;
      syncMockSurpriseControl();
      renderMockSelection(previous);
      return;
    }
    state.mockSurprise = true;
    syncMockSurpriseControl();
    const changed = generateMock({ requireDifferentFrom: previous });
    if (changed) return;
    state.mockSurprise = false;
    syncMockSurpriseControl();
    renderMockSelection(previous,
      '当前筛选下没有另一套完整组合，请调整频次或难度后再开启惊喜模式。');
  }

  function generateMock({ requireDifferentFrom = [] } = {}) {
    if (state.mockMode !== 'auto') {
      updateManualMockSelection();
      return false;
    }
    const frequencies = new Set([...document.querySelectorAll('input[name="mock-frequency"]:checked')].map((input) => input.value));
    if (!frequencies.size) {
      frequencies.add('high');
      const input = document.querySelector('input[name="mock-frequency"][value="high"]');
      if (input) input.checked = true;
      toast('至少保留一个频次范围；已恢复为高频。');
    }
    const selection = [1, 2, 3].map((position) => pickMockPassage(position, frequencies, state.mockDifficulties));
    const missing = selection.map((passage, index) => passage ? null : `Passage ${index + 1}`).filter(Boolean);
    if (missing.length) {
      const difficultyText = state.mockDifficulties.size
        ? [...state.mockDifficulties].map((key) => ({ easy: '偏易', standard: '标准', hard: '偏难' })[key]).filter(Boolean).join('、')
        : '全部难度';
      renderMockSelection([], `${missing.join('、')} 暂无符合当前频次与“${difficultyText}”条件的文章，请调整筛选。`);
      return false;
    }
    if (sameMockSelection(selection, requireDifferentFrom)) {
      const firstPosition = secureRandomIndex(3);
      for (let offset = 0; offset < 3; offset += 1) {
        const index = (firstPosition + offset) % 3;
        const alternative = pickMockPassage(
          index + 1,
          frequencies,
          state.mockDifficulties,
          new Set([requireDifferentFrom[index].passageId]),
        );
        if (!alternative) continue;
        selection[index] = alternative;
        break;
      }
      if (sameMockSelection(selection, requireDifferentFrom)) {
        renderMockSelection(requireDifferentFrom,
          '当前筛选下没有另一套完整组合，请调整频次或难度。');
        return false;
      }
    }
    renderMockSelection(selection);
    return true;
  }

  function eligibleManualMockPassage(passage, position) {
    return Number(passage?.passagePosition) === position
      && manifestById.get(passage.passageId)?.mockEligible !== false
      && passage.composition?.fullPassage?.selectable === true;
  }

  function manualMockCandidates(position) {
    const query = state.manualMockFilters.search.trim().toLocaleLowerCase('en');
    return passages
      .filter((passage) => eligibleManualMockPassage(passage, position)
        && (!state.manualMockFilters.frequencies.size || state.manualMockFilters.frequencies.has(frequencyFor(passage)))
        && matchesDifficulty(passage, state.manualMockFilters.difficulties)
        && (!query || `${passage.title || ''} ${passage.titleZh || ''}`.toLocaleLowerCase('en').includes(query)))
      .sort((a, b) => a.title.localeCompare(b.title, 'en'));
  }

  function manualMockOptionMarkup(passage, position) {
    const frequency = frequencyFor(passage);
    const difficulty = difficultyMeta(passage);
    const selected = state.manualMockIds[position] === passage.passageId;
    return `<div role="listitem"><button class="manual-mock-option" type="button" data-manual-passage-id="${htmlEscape(passage.passageId)}" aria-pressed="${selected}"><span class="manual-mock-option-copy"><strong>${htmlEscape(passage.title)}</strong><small>${htmlEscape(passage.titleZh || '')}</small></span><span class="manual-mock-option-meta"><span class="meta-pill metadata-pill metadata-pill--frequency-${frequency} frequency-${frequency}">${frequencyLabel(frequency)}</span><span class="meta-pill metadata-pill metadata-pill--difficulty-${difficulty.key} difficulty-${difficulty.key}">${htmlEscape(difficulty.tier)} · ${difficulty.value}</span></span><span class="manual-mock-option-action">${selected ? '已选择' : '选择'}</span></button></div>`;
  }

  function syncManualMockFilterButtons() {
    [['manual-mock-frequency-filter', state.manualMockFilters.frequencies], ['manual-mock-difficulty-filter', state.manualMockFilters.difficulties]]
      .forEach(([id, values]) => byId(id).querySelectorAll('button[data-value]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.value ? values.has(button.dataset.value) : !values.size));
      }));
  }

  function renderManualMockControls({ resetScroll = false } = {}) {
    const position = state.manualMockActivePosition;
    document.querySelectorAll('[data-manual-mock-position-tab]').forEach((button) => {
      const selected = Number(button.dataset.manualMockPositionTab) === position;
      button.setAttribute('aria-selected', String(selected));
      button.removeAttribute('tabindex');
    });
    const search = byId('manual-mock-search');
    search.value = state.manualMockFilters.search;
    search.placeholder = `搜索 P${position} 英文或中文标题`;
    syncManualMockFilterButtons();
    const candidates = manualMockCandidates(position);
    byId('manual-mock-result-count').textContent = `P${position} · ${candidates.length} 篇符合条件`;
    const selectedPassage = passageById.get(state.manualMockIds[position]);
    byId('manual-mock-current-selection').textContent = selectedPassage
      ? `已选：${selectedPassage.title}`
      : `P${position} 尚未选择`;
    const list = byId('manual-mock-list');
    const previousScrollTop = list.scrollTop;
    list.setAttribute('aria-label', `P${position} 候选文章`);
    list.innerHTML = candidates.length
      ? candidates.map((passage) => manualMockOptionMarkup(passage, position)).join('')
      : '<div class="manual-mock-empty">没有符合当前搜索和筛选条件的文章。已选文章不会因此被清除。</div>';
    list.scrollTop = resetScroll ? 0 : previousScrollTop;
  }

  function setManualMockPosition(position) {
    if (![1, 2, 3].includes(position) || position === state.manualMockActivePosition) return;
    state.manualMockActivePosition = position;
    state.manualMockFilters.search = '';
    renderManualMockControls({ resetScroll: true });
  }

  function toggleManualMockFilter(group, value) {
    const values = group === 'frequency' ? state.manualMockFilters.frequencies : state.manualMockFilters.difficulties;
    if (!value) values.clear();
    else if (values.has(value)) values.delete(value);
    else values.add(value);
    renderManualMockControls({ resetScroll: true });
  }

  function selectManualMockPassage(passageId) {
    const position = state.manualMockActivePosition;
    const passage = passageById.get(passageId);
    if (!eligibleManualMockPassage(passage, position)) return;
    state.manualMockIds[position] = passageId;
    updateManualMockSelection();
    renderManualMockControls();
  }

  function updateManualMockSelection() {
    const selection = [1, 2, 3].map((position) => {
      const passage = passageById.get(state.manualMockIds[position]) || null;
      return eligibleManualMockPassage(passage, position) ? passage : null;
    });
    const missing = selection.map((passage, index) => passage ? null : `P${index + 1}`).filter(Boolean);
    renderMockSelection(selection, missing.length ? `请继续为 ${missing.join('、')} 选择文章。` : '');
  }

  function toggleMockDifficulty(key, button) {
    if (state.mockDifficulties.has(key)) state.mockDifficulties.delete(key);
    else state.mockDifficulties.add(key);
    button.setAttribute('aria-pressed', String(state.mockDifficulties.has(key)));
    generateMock();
  }

  function setMockMode(mode) {
    if (!['auto', 'manual'].includes(mode) || mode === state.mockMode) return;
    state.mockMode = mode;
    document.querySelectorAll('[data-mock-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mockMode === mode)));
    byId('mock-auto-controls').hidden = mode !== 'auto';
    byId('mock-manual-controls').hidden = mode !== 'manual';
    byId('mock-surprise-row').hidden = mode !== 'auto';
    if (mode === 'manual') {
      if (![1, 2, 3].some((position) => state.manualMockIds[position])) {
        state.mockSelection.forEach((selection) => {
          const passage = passageById.get(selection.passageId);
          if (passage) state.manualMockIds[Number(passage.passagePosition)] = passage.passageId;
        });
      }
      renderManualMockControls({ resetScroll: true });
      updateManualMockSelection();
    } else generateMock();
  }

  function packageTitle(kind, selectedPassages, compositionMode) {
    if (kind === 'mock') return `ZYZ 阅读模考 · ${manifest.month}`;
    if (compositionMode === 'task-drill') return `${selectedPassages.map((passage) => passage?.title).filter(Boolean).join(' · ') || 'ZYZ 阅读'} · 题型练习`;
    return selectedPassages.map((passage) => passage?.title).filter(Boolean).join(' · ') || 'ZYZ 阅读练习';
  }

  function replaceRunnerShellOnce(source, needle, replacement, label) {
    const matches = source.split(needle).length - 1;
    if (matches !== 1) throw new Error(`答题页页头结构异常：${label}`);
    return source.replace(needle, replacement);
  }

  function replaceRunnerShellAll(source, needle, replacement, expectedCount, label) {
    const matches = source.split(needle).length - 1;
    if (matches !== expectedCount) throw new Error(`答题页提交界面结构异常：${label}`);
    return source.split(needle).join(replacement);
  }

  function applyRunnerStudentSummary(source, kind) {
    const modeLabel = kind === 'mock' ? '模考' : '练习';
    const summaryLabel = kind === 'mock' ? '模考小结' : '练习小结';
    const summaryEyebrow = kind === 'mock' ? 'MOCK TEST SUMMARY' : 'PRACTICE SUMMARY';
    const resultLabel = kind === 'mock' ? '模考结果' : '练习结果';
    const repeatLabel = kind === 'mock' ? '再次模考' : '再次练习';
    const bandNote = '依据 IELTS Academic Reading 官方公布的答对题数与 Band 对应关系估算；不同试卷可能略有差异。';
    const summaryHelpers = `  const PASSAGE_ATTEMPT_KIND = '${kind}';
  const PASSAGE_ATTEMPT_LABEL = '${modeLabel}';
  const PASSAGE_BAND_NOTE = '${bandNote}';

  function passageFormatTimestamp(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\\d{4})[-./](\\d{2})[-./](\\d{2})[ T]+(\\d{2}):(\\d{2})/u);
    return match ? \`\${match[1]}.\${match[2]}.\${match[3]} · \${match[4]}:\${match[5]}\` : text.replace(/-/gu, '.');
  }

  function passageAttemptTitle(report) {
    return \`\${PASSAGE_ATTEMPT_LABEL} · \${passageFormatTimestamp(report?.display?.submittedAt)}\`;
  }

  function passageAttemptScope(report) {
    const passages = Array.isArray(report?.passages) ? report.passages.length : 0;
    const questions = Math.max(0, Number(report?.score?.availableMarks || report?.completion?.total || 0));
    return \`\${passages} 篇 · \${questions} 题\`;
  }

  function passageFileTimestamp(report) {
    return passageFormatTimestamp(report?.display?.submittedAt).replace(' · ', '-').replace(':', '.');
  }

  function passageBandEligible(report) {
    return PASSAGE_ATTEMPT_KIND === 'mock' && Boolean(report?.referenceBand?.eligible);
  }

`;
    let output = String(source || '');
    output = replaceRunnerShellOnce(
      output,
      '  function homeworkReceiptCode(report) {',
      `${summaryHelpers}  function homeworkReceiptCode(report) {`,
      '提交标题辅助函数',
    );
    output = replaceRunnerShellAll(output, 'report.referenceBand.eligible', 'passageBandEligible(report)', 11, 'Band 显示边界');
    output = replaceRunnerShellAll(output, 'report.referenceBand.note', 'PASSAGE_BAND_NOTE', 4, 'Band 说明');
    output = replaceRunnerShellAll(output, '参考 Band', 'Band 估算', 4, 'Band 标签');
    output = replaceRunnerShellAll(output, 'report.display.assignmentTitle', 'passageAttemptTitle(report)', 6, '提交名称');
    output = replaceRunnerShellAll(output, '练习小结', summaryLabel, 8, '小结名称');
    output = replaceRunnerShellAll(output, '再次练习', repeatLabel, 1, '再次作答按钮');
    output = replaceRunnerShellAll(output, '练习结果', resultLabel, 1, '结果标题');
    output = replaceRunnerShellAll(output, '练习：', `${modeLabel}：`, 1, '复制文字模式');
    output = replaceRunnerShellOnce(
      output,
      "    return unknownToken ? '' : result;",
      "    return unknownToken ? '' : (result === EXPECTED_COPYRIGHT_NOTICE ? EXPECTED_PUBLISHER_NAME : result);",
      '提交结果品牌行',
    );
    output = replaceRunnerShellOnce(
      output,
      '<p class="homework-receipt-eyebrow">提交记录</p>',
      `<p class="homework-receipt-eyebrow">${summaryEyebrow}</p>`,
      '小结英文标题',
    );
    output = replaceRunnerShellOnce(output, '<dt>练习</dt>', '<dt>记录</dt>', '小结身份标签');
    output = replaceRunnerShellOnce(
      output,
      '<small>个人练习记录</small>',
      '<small>${h(passageAttemptScope(report))}</small>',
      '小结范围',
    );
    output = replaceRunnerShellOnce(
      output,
      "    context.fillText('个人练习记录', 88, 196);",
      '    context.fillText(passageAttemptScope(report), 88, 196);',
      '图片小结范围',
    );
    output = replaceRunnerShellOnce(
      output,
      "    const timerMarkup = report.timer ? `<p class=\"receipt-band-note receipt-timer-note\">${h(report.timer.display.summary)}${report.timer.clockAnomaly ? ' · 设备时间异常' : ''}</p>` : '';",
      "    const timerMarkup = '';",
      '隐藏限时审计行',
    );
    output = replaceRunnerShellOnce(
      output,
      "    if (report.timer) {\n      lines.push(`限时记录：${report.timer.display.summary}${report.timer.clockAnomaly ? ' · 设备时间异常' : ''}`);\n    }",
      '',
      '复制文字隐藏限时审计行',
    );
    output = replaceRunnerShellOnce(
      output,
      '    <p class="receipt-band-note">提交：${h(report.display.submittedAt)} · ${h(report.display.status)}${passageBandEligible(report) ? `。${h(PASSAGE_BAND_NOTE)}` : \'\'}</p>',
      '    ${passageBandEligible(report) ? `<p class="receipt-band-note receipt-band-method">${h(PASSAGE_BAND_NOTE)}</p>` : \'\'}',
      '小结底部说明',
    );
    output = replaceRunnerShellAll(output, 'report.attemptHistory.rows.length', 'report.attemptHistory.rows.length > 1', 2, '历次成绩显示边界');
    output = replaceRunnerShellOnce(
      output,
      '    const historyRows = report.attemptHistory.rows.slice(-6);',
      '    const historyRows = report.attemptHistory.rows.length > 1 ? report.attemptHistory.rows.slice(-6) : [];',
      '图片历次成绩显示边界',
    );
    output = replaceRunnerShellOnce(output, '<h3>提交记录</h3>', '<h3>历次成绩</h3>', '小结历次成绩标题');
    output = replaceRunnerShellOnce(output, "lines.push('', '提交记录'", "lines.push('', '历次成绩'", '复制文字历次成绩标题');
    output = replaceRunnerShellOnce(output, "context.fillText('提交记录', 64, y + 18);", "context.fillText('历次成绩', 64, y + 18);", '图片历次成绩标题');
    output = replaceRunnerShellOnce(
      output,
      "    const safeTitle = passageAttemptTitle(report).replace(/[\\\\/:*?\"<>|]+/gu, '-').slice(0, 50) || 'IELTS-Reading';\n"
        + "    const filename = `${safeTitle}-" + summaryLabel + ".png`;",
      `    const filename = \`${modeLabel}-\${passageFileTimestamp(report)}-小结.png\`;`,
      '小结图片文件名',
    );
    output = replaceRunnerShellOnce(
      output,
      '    const footer = passageBandEligible(report) ? PASSAGE_BAND_NOTE : report.display.status;',
      "    const footer = passageBandEligible(report) ? PASSAGE_BAND_NOTE : '';",
      '图片底部说明',
    );
    return output;
  }

  function applyRunnerHeaderShell(html, kind = 'practice') {
    if (!['practice', 'mock'].includes(kind)) throw new Error('答题页会话类型异常');
    const legacyBrand = '<span class="zyz-exam-mark" role="img" aria-label="ZYZ"><span>ZYZ</span></span>';
    const passageBrand = '<button class="passage-runner-home" type="button" data-runner-exit aria-label="返回练习包" title="返回练习包"><span class="passage-runner-word">PASSAGE</span><span class="passage-runner-by">by ZYZ</span></button><span class="passage-runner-divider" aria-hidden="true"></span>';
    const legacyTimerCard = '<section class="timer-start-card" role="dialog" aria-modal="true" aria-labelledby="timer-start-title" aria-describedby="timer-start-description" tabindex="-1">';
    const timerCardDescription = kind === 'mock'
      ? 'timer-start-description timer-start-limit-static'
      : 'timer-start-description';
    const timerCardWithClose = `<section class="timer-start-card" role="dialog" aria-modal="true" aria-labelledby="timer-start-title" aria-describedby="${timerCardDescription}" tabindex="-1"><button class="timer-start-close" type="button" data-runner-exit aria-label="关闭并返回练习包" title="返回练习包"><span class="fa-icon fa-times" aria-hidden="true"></span></button>`;
    const legacyTimerCopy = Object.freeze({
      eyebrow: '<p class="timer-start-eyebrow">TIMED PRACTICE</p>',
      title: '<h2 id="timer-start-title">Start timed practice?</h2>',
      description: '<p id="timer-start-description">The timer starts only when you press the button. Once started, it cannot be paused.</p>',
      limit: '<p id="timer-start-limit" class="timer-start-limit"></p>',
      button: '<button id="timer-start-button" class="primary-button" type="button">Start timed practice</button>',
    });
    const practiceTimerCopy = Object.freeze({
      ...legacyTimerCopy,
      description: '<p id="timer-start-description">The timer starts when you press the button. Leaving with the PASSAGE controls saves your work and pauses the timer.</p>',
    });
    const timerCopy = kind === 'mock'
      ? Object.freeze({
        eyebrow: '<p class="timer-start-eyebrow">MOCK TEST</p>',
        title: '<h2 id="timer-start-title">Start the mock test?</h2>',
        description: '<p id="timer-start-description">The 60-minute timer starts when you press the button. Leaving with the PASSAGE controls saves your work and pauses the timer.</p>',
        limit: '<p id="timer-start-limit-static" class="timer-start-limit">Answers are submitted automatically when time runs out.</p>',
        button: '<button id="timer-start-button" class="primary-button" type="button">Start mock test</button>',
      })
      : practiceTimerCopy;
    const approvedStyles = `<style id="passage-runner-launch-refinement-r15">
      :root{--passage-wordmark-font-family:"Avenir Next","Helvetica Neue",Arial,sans-serif;--passage-wordmark-main-weight:500;--passage-wordmark-main-tracking:.19em;--passage-wordmark-by-weight:400;--passage-wordmark-by-tracking:.12em}
      .header-brand{gap:0}
      .passage-runner-home{box-sizing:border-box;flex:0 0 92.52px;width:92.52px;height:44px;display:grid;align-content:center;justify-items:start;padding:0 6px;border:0;border-radius:6px;color:#67516f;background:transparent;cursor:pointer;font-family:var(--passage-wordmark-font-family);text-align:left}
      .passage-runner-home:hover{background:#f7f2f7}
      .passage-runner-home:focus-visible{outline:2px solid #745d7e;outline-offset:-2px}
      .passage-runner-word{display:block;font-size:14px;font-weight:var(--passage-wordmark-main-weight);line-height:1;letter-spacing:var(--passage-wordmark-main-tracking);white-space:nowrap}
      .passage-runner-by{display:block;margin-top:5px;font-size:9px;font-weight:var(--passage-wordmark-by-weight);line-height:1;letter-spacing:var(--passage-wordmark-by-tracking);white-space:nowrap}
      /* BEGIN T49 RUNNER WORDMARK INK EDGE ALIGNMENT CONTRACT */
      .passage-runner-by{transform:translateX(var(--passage-runner-by-ink-offset,0px));transform-origin:left center}
      /* END T49 RUNNER WORDMARK INK EDGE ALIGNMENT CONTRACT */
      .passage-runner-divider{box-sizing:border-box;flex:0 0 1px;width:1px;height:22px;margin:0 15px 0 16px;background:#ddd6dc}
      .timer-start-card{position:relative;padding-right:70px}
      .timer-start-close{position:absolute;top:16px;right:16px;width:36px;height:36px;display:grid;place-items:center;padding:0;border:0;border-radius:50%;color:#555;background:transparent;font-size:18px;cursor:pointer}
      .timer-start-close:hover{background:#f2f2f2}
      .timer-start-close:focus-visible{outline:3px solid var(--focus,#006fff);outline-offset:2px}
      .review-submission,.review-timer-meta{display:none!important}
      .review-assignment-identity{gap:3px}
      .review-assignment-title{margin-bottom:4px!important}
      .receipt-summary-cell.is-identity small{display:block;margin-top:4px;color:var(--muted-ink);font-size:11px;line-height:1.35}
      .receipt-band-method{margin-top:-2px!important;padding-top:10px;border-top:1px solid #e4eaed}
      body.is-high-contrast .passage-runner-home,body.contrast-white-black .passage-runner-home{color:#fff}
      body.contrast-yellow-black .passage-runner-home{color:#ffeb3b}
      body.is-high-contrast .passage-runner-divider,body.contrast-white-black .passage-runner-divider,body.contrast-yellow-black .passage-runner-divider{background:currentColor}
      body.contrast-white-black .timer-start-close{color:#fff}
      body.contrast-yellow-black .timer-start-close{color:#ffeb3b}
      body.contrast-white-black .timer-start-close:hover,body.contrast-yellow-black .timer-start-close:hover{background:rgba(255,255,255,.14)}
      @media (max-width:1180px){.passage-runner-divider{margin-left:10px;margin-right:9px}}
    </style>`;    const wordmarkAlignmentScript = `<script id="passage-runner-wordmark-ink-alignment-v1">(function(){
      'use strict';
      function measure(element, context) {
        var style = getComputedStyle(element);
        var font = style.font || [style.fontStyle, style.fontVariant, style.fontWeight, style.fontSize + ' / ' + style.lineHeight, style.fontFamily].join(' ');
        context.font = font;
        var glyph = String(element.textContent || '').trim().charAt(0);
        var metrics = glyph ? context.measureText(glyph) : null;
        return metrics && 'actualBoundingBoxLeft' in metrics && Number.isFinite(metrics.actualBoundingBoxLeft) ? metrics.actualBoundingBoxLeft : null;
      }
      function apply() {
        var root = document.querySelector('.passage-runner-home');
        var main = root && root.querySelector('.passage-runner-word');
        var by = root && root.querySelector('.passage-runner-by');
        if (!root || !main || !by) return;
        try {
          var canvas = document.createElement('canvas');
          var context = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
          if (!context || typeof context.measureText !== 'function') throw new Error('canvas metrics unavailable');
          root.style.setProperty('--passage-runner-by-ink-offset', '0px');
          var mainLeft = measure(main, context);
          var byLeft = measure(by, context);
          var mainOrigin = main.getBoundingClientRect().left;
          var byOrigin = by.getBoundingClientRect().left;
          var offset = mainLeft === null || byLeft === null ? null : (mainOrigin - mainLeft) - (byOrigin - byLeft);
          if (!Number.isFinite(offset) || Math.abs(offset) > 4) throw new Error('canvas metrics invalid');
          root.style.setProperty('--passage-runner-by-ink-offset', offset.toFixed(3) + 'px');
          root.dataset.wordmarkInkOffset = offset.toFixed(3);
          root.dataset.wordmarkInkAlignment = 'measured';
        } catch (_error) {
          root.style.removeProperty('--passage-runner-by-ink-offset');
          root.dataset.wordmarkInkAlignment = 'safe-fallback';
        }
      }
      function start() {
        apply();
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
        try {
          if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') document.fonts.ready.then(apply).catch(function(){});
        } catch (_error) {}
        window.addEventListener('load', apply, {once:true,passive:true});
        window.addEventListener('pageshow', apply, {passive:true});
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true}); else start();
    })();<\/script>`;
    let output = String(html || '');
    output = replaceRunnerShellOnce(output, legacyBrand, passageBrand, '品牌入口');
    output = replaceRunnerShellOnce(output, legacyTimerCard, timerCardWithClose, '计时启动卡片');
    output = replaceRunnerShellOnce(output, legacyTimerCopy.eyebrow, timerCopy.eyebrow, '计时启动类型');
    output = replaceRunnerShellOnce(output, legacyTimerCopy.title, timerCopy.title, '计时启动标题');
    output = replaceRunnerShellOnce(output, legacyTimerCopy.description, timerCopy.description, '计时启动说明');
    output = replaceRunnerShellOnce(output, legacyTimerCopy.limit, timerCopy.limit, '计时启动规则');
    output = replaceRunnerShellOnce(output, legacyTimerCopy.button, timerCopy.button, '计时开始入口');
    output = applyRunnerStudentSummary(output, kind);
    output = replaceRunnerShellOnce(output, '</head>', `${approvedStyles}${wordmarkAlignmentScript}</head>`, '样式入口');
    return output;
  }

  function personalizeStudentHtml(html, kind) {
    const stateScoped = String(html || '').split(SOURCE_RUNTIME_STATE_STORAGE_PREFIX).join(RUNTIME_STATE_STORAGE_PREFIX);
    return applyRunnerHeaderShell(stateScoped, kind);
  }

  async function markSessionVisited(session) {
    if (!records) return;
    const now = Date.now();
    await Promise.all(session.passageIds.map((passageId) => records.markVisited({
      passageId,
      passageIds: [passageId],
      taskIds: session.taskIdsByPassage?.[passageId] || [],
      mode: session.kind,
      releaseId: manifest.releaseId,
      contentRevision: manifestById.get(passageId)?.contentRevision || 1,
      visitedAt: now,
    })));
    await records.markStarted({
      sessionId: session.attemptSessionId || session.sessionId,
      passageIds: session.passageIds,
      taskIds: session.taskIds,
      mode: session.kind,
      scope: session.taskIds.length ? 'task' : 'full-passage',
      releaseId: manifest.releaseId,
      startedAt: now,
    });
    await refreshRecords();
  }

  function jsonForInlineScript(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  function withRunnerBridge(html, sessionId, restoreContext = null, bridgeContext = null) {
    const restore = restoreContext ? `<script>(function(){
      'use strict';
      try {
        var writes = ${jsonForInlineScript(restoreContext.storageWrites || [])};
        writes.forEach(function(entry) { localStorage.setItem(entry.key, entry.value); });
      } catch (_error) {}
    })();<\/script>${restoreContext.hideReset ? '<style>#reset-practice-button{display:none!important}</style>' : ''}` : '';
    const bridge = `<script>(function(){
      'use strict';
      var sessionId = ${JSON.stringify(sessionId)};
      var attemptLedgerKey = ${jsonForInlineScript(bridgeContext?.attemptLedgerKey || '')};
      var runtimeStateKey = ${jsonForInlineScript(bridgeContext?.runtimeStateKey || '')};
      var snapshotHash = ${jsonForInlineScript(bridgeContext?.snapshotHash || '')};
      var packageContentVersion = ${jsonForInlineScript(bridgeContext?.packageContentVersion || '')};
      var timerPolicy = ${jsonForInlineScript(bridgeContext?.timerPolicy || { enabled: false, durationSeconds: 0, expiryAction: 'continue' })};
      var lastFingerprint = '';
      var lastAcceptedCheckpointFingerprint = '';
      var lastAnnotationFingerprint = '';
      var annotationTimer = 0;
      var lastExitTarget = null;
      var restartTarget = null;
      var restartBypass = false;
      var restartRequestPending = false;
      var restartRequestId = '';
      function finite(value) { value = Number(value); return Number.isFinite(value) ? value : 0; }
      function text(value) { return value == null ? '' : String(value); }
      function safeResult(result) {
        result = result && typeof result === 'object' ? result : {};
        return {
          earnedMarks: finite(result.earnedMarks), availableMarks: finite(result.availableMarks),
          answered: finite(result.answered), total: finite(result.total), correct: finite(result.correct),
          partial: finite(result.partial), incorrect: finite(result.incorrect), unanswered: finite(result.unanswered),
          partScores: Array.isArray(result.partScores) ? result.partScores.map(function(part) {
            return { part: finite(part.part), earnedMarks: finite(part.earnedMarks), availableMarks: finite(part.availableMarks), answered: finite(part.answered), total: finite(part.total) };
          }) : []
        };
      }
      function safeReport(report) {
        report = report && typeof report === 'object' ? report : {};
        return {
          referenceBand: report.referenceBand && typeof report.referenceBand === 'object'
            ? { eligible: Boolean(report.referenceBand.eligible), value: finite(report.referenceBand.value) }
            : null,
          questionOutcomes: Array.isArray(report.questionOutcomes) ? report.questionOutcomes.map(function(part) {
            return {
              part: finite(part.part),
              correct: Array.isArray(part.correct) ? part.correct.map(text) : [],
              incorrect: Array.isArray(part.incorrect) ? part.incorrect.map(text) : [],
              partial: Array.isArray(part.partial) ? part.partial.map(text) : [],
              unanswered: Array.isArray(part.unanswered) ? part.unanswered.map(text) : [],
              questionType: text(part.questionType)
            };
          }) : []
        };
      }
      function safeRuntimeSnapshot(current) {
        if (!current || typeof current !== 'object') return null;
        var allowed = [
          'version', 'part', 'currentQuestion', 'lastQuestionByPart', 'answers', 'questionFlags', 'highlights',
          'questionHighlights', 'notes', 'showNotes', 'submitted', 'result', 'split', 'fontScale',
          'contrast', 'contrastMode', 'remainingSeconds', 'timerRunning', 'timerStartedAt',
          'timerDeadlineAt', 'timerExpiredAt', 'timerExpired', 'overtimeSeconds', 'submissionReason',
          'clockAnomaly', 'timerLastObservedAt', 'timerAnnouncementMarks',
          'timerWarning10Shown', 'timerWarning5Shown', 'attemptStartedAt',
          'submittedAt', 'elapsedSeconds', 'attemptNumber', 'attemptMarker', 'submissionId',
          'partElapsedMilliseconds', 'partActiveStartedAt', 'partTimingComplete', 'updatedAt'
        ];
        var output = {};
        allowed.forEach(function(key) {
          if (!Object.prototype.hasOwnProperty.call(current, key)) return;
          output[key] = key === 'result' ? (current[key] == null ? null : safeResult(current[key])) : current[key];
        });
        try { return JSON.parse(JSON.stringify(output)); } catch (_error) { return null; }
      }
      function safeAnnotationOverlay(current) {
        if (!current || !current.submitted || !text(current.submissionId) || !snapshotHash || !packageContentVersion) return null;
        try {
          return JSON.parse(JSON.stringify({
            schemaVersion: 'zyz-reading-attempt-annotation-overlay.v1',
            submissionId: text(current.submissionId),
            snapshotHash: snapshotHash,
            packageContentVersion: packageContentVersion,
            highlights: current.highlights && typeof current.highlights === 'object' ? current.highlights : {},
            questionHighlights: current.questionHighlights && typeof current.questionHighlights === 'object' ? current.questionHighlights : {},
            notes: Array.isArray(current.notes) ? current.notes : [],
            questionFlags: current.submitted && Object.prototype.hasOwnProperty.call(current, 'reviewQuestionFlags')
              ? current.reviewQuestionFlags : current.questionFlags || {}
          }));
        } catch (_error) { return null; }
      }
      function annotationFingerprint(overlay) {
        if (!overlay) return '';
        try { return JSON.stringify([overlay.highlights, overlay.questionHighlights, overlay.notes, overlay.questionFlags]); }
        catch (_error) { return ''; }
      }
      function sendAnnotation(reason, force) {
        window.clearTimeout(annotationTimer);
        annotationTimer = 0;
        var hooks = window.IELTSPractice;
        if (!hooks || typeof hooks.getState !== 'function') return;
        var current;
        try { current = hooks.getState(); } catch (_error) { return; }
        var overlay = safeAnnotationOverlay(current);
        var fingerprint = annotationFingerprint(overlay);
        if (!overlay || !fingerprint || (!force && fingerprint === lastAnnotationFingerprint)) return;
        lastAnnotationFingerprint = fingerprint;
        window.parent.postMessage({
          type: 'zyz-student-runner-annotation.v1',
          sessionId: sessionId,
          reason: text(reason || 'annotation'),
          annotationOverlay: overlay
        }, '*');
      }
      function scheduleAnnotation(reason, flush) {
        window.clearTimeout(annotationTimer);
        annotationTimer = 0;
        if (flush) {
          sendAnnotation(reason, true);
          return;
        }
        annotationTimer = window.setTimeout(function() { sendAnnotation(reason, false); }, 180);
      }
      function checkpointSnapshot(current, checkpointAt) {
        var output = safeRuntimeSnapshot(current);
        if (!output) return null;
        var at = Math.max(0, Math.floor(finite(checkpointAt) || Date.now()));
        if (!output.submitted && finite(output.partActiveStartedAt) > 0) {
          var part = Math.max(1, Math.floor(finite(output.part) || 1));
          var elapsed = output.partElapsedMilliseconds && typeof output.partElapsedMilliseconds === 'object'
            ? JSON.parse(JSON.stringify(output.partElapsedMilliseconds)) : {};
          elapsed[part] = Math.max(0, finite(elapsed[part])) + Math.max(0, at - finite(output.partActiveStartedAt));
          output.partElapsedMilliseconds = elapsed;
          output.partActiveStartedAt = null;
        }
        if (!output.submitted && timerPolicy && timerPolicy.enabled && finite(output.timerStartedAt) > 0) {
          var deadline = finite(output.timerDeadlineAt);
          if (!(deadline > 0)) deadline = finite(output.timerStartedAt) + (Math.max(1, finite(timerPolicy.durationSeconds)) * 1000);
          output.remainingSeconds = Math.max(0, Math.ceil((deadline - at) / 1000));
          output.overtimeSeconds = Math.max(0, Math.floor((at - deadline) / 1000));
          output.timerRunning = false;
          output.timerLastObservedAt = at;
        }
        output.updatedAt = at;
        return output;
      }
      function safeAttemptSnapshot(current) {
        return current && current.submitted ? safeRuntimeSnapshot(current) : null;
      }
      function safeAttemptLedger(current) {
        if (!current || !current.submitted || !attemptLedgerKey) return null;
        var raw = null;
        try { raw = localStorage.getItem(attemptLedgerKey); } catch (_error) { return null; }
        if (typeof raw !== 'string' || !raw || raw.length > 65536) return null;
        try {
          var parsed = JSON.parse(raw);
          var attemptNumber = Math.max(1, Math.floor(finite(current.attemptNumber) || 1));
          if (!parsed || parsed.schemaVersion !== 'ielts-reading-attempt-ledger.v1' ||
              !Array.isArray(parsed.seenSubmissionIds) ||
              parsed.seenSubmissionIds[attemptNumber - 1] !== text(current.submissionId)) return null;
          return raw;
        } catch (_error) { return null; }
      }
      function send(force) {
        var hooks = window.IELTSPractice;
        if (!hooks || typeof hooks.getState !== 'function') return;
        var current;
        try { current = hooks.getState(); } catch (_error) { return; }
        var safe = {
          submitted: Boolean(current && current.submitted), submissionId: text(current && current.submissionId),
          submittedAt: finite(current && current.submittedAt), attemptStartedAt: finite(current && current.attemptStartedAt),
          elapsedSeconds: finite(current && current.elapsedSeconds), attemptNumber: finite(current && current.attemptNumber) || 1,
          submissionReason: text(current && current.submissionReason),
          partElapsedMilliseconds: current && current.partElapsedMilliseconds && typeof current.partElapsedMilliseconds === 'object'
            ? JSON.parse(JSON.stringify(current.partElapsedMilliseconds)) : {},
          result: safeResult(current && current.result)
        };
        var fingerprint = [
          safe.submitted, safe.submissionId, safe.submittedAt, safe.attemptNumber,
          finite(current && current.updatedAt), finite(current && current.part), finite(current && current.currentQuestion)
        ].join('|');
        if (safe.submitted) {
          if (!force && fingerprint === lastFingerprint) return;
          lastFingerprint = fingerprint;
        } else if (!force && fingerprint === lastAcceptedCheckpointFingerprint) {
          return;
        }
        var report = null;
        if (safe.submitted && typeof hooks.getHomeworkReport === 'function') {
          try {
            var rawReport = hooks.getHomeworkReport();
            if (rawReport && typeof hooks.getQuestionOutcomes === 'function') {
              rawReport.questionOutcomes = hooks.getQuestionOutcomes();
            }
            report = safeReport(rawReport);
          } catch (_error) { report = null; }
        }
        window.parent.postMessage({ type: 'zyz-student-runner-state.v1', sessionId: sessionId, checkpointFingerprint: fingerprint, state: safe, report: report, resumeSnapshot: current && !current.submitted ? checkpointSnapshot(current, Date.now()) : null, attemptSnapshot: safeAttemptSnapshot(current), attemptLedger: safeAttemptLedger(current), annotationOverlay: safeAnnotationOverlay(current) }, '*');
      }
      function requestExit(target) {
        lastExitTarget = target && typeof target.focus === 'function' ? target : document.activeElement;
        sendAnnotation('exit', true);
        send(true);
        window.parent.postMessage({ type: 'zyz-student-runner-exit-request.v1', sessionId: sessionId }, '*');
      }
      document.addEventListener('click', function(event) {
        var target = event.target && event.target.closest ? event.target.closest('#submit-button') : null;
        if (!target) return;
        var hooks = window.IELTSPractice;
        var current = null;
        try { current = hooks && typeof hooks.getState === 'function' ? hooks.getState() : null; } catch (_error) {}
        if (!current || !current.submitted) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        requestExit(target);
      }, true);
      document.addEventListener('click', function(event) {
        var target = event.target && event.target.closest ? event.target.closest('[data-runner-exit]') : null;
        if (!target) return;
        event.preventDefault();
        requestExit(target);
      });
      document.addEventListener('click', function(event) {
        var target = event.target && event.target.closest ? event.target.closest('#reset-practice-button') : null;
        if (!target || restartBypass) return;
        var hooks = window.IELTSPractice;
        var current = null;
        try { current = hooks && typeof hooks.getState === 'function' ? hooks.getState() : null; } catch (_error) {}
        if (!current || !current.submitted) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (restartRequestPending) return;
        restartTarget = target;
        restartRequestPending = true;
        restartRequestId = sessionId + '.restart.' + Date.now().toString(36) + '.' + Math.random().toString(36).slice(2, 10);
        sendAnnotation('restart', true);
        send(true);
        window.parent.postMessage({ type: 'zyz-student-runner-restart-request.v1', sessionId: sessionId, requestId: restartRequestId }, '*');
      }, true);
      document.addEventListener('keydown', function(event) {
        var gate = document.getElementById('timer-start-gate');
        if (event.key !== 'Escape' || event.repeat || !gate || gate.hidden) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        requestExit(document.activeElement);
      }, true);
      window.addEventListener('zyz-student-annotation-mutation.v1', function(event) {
        var detail = event && event.detail && typeof event.detail === 'object' ? event.detail : {};
        scheduleAnnotation(text(detail.reason || 'annotation'), detail.flush === true);
      });
      window.addEventListener('message', function(event) {
        if (!event || event.source !== window.parent || !event.data || event.data.sessionId !== sessionId) return;
        if (event.data.type === 'zyz-student-runner-request.v1') send(true);
        if (event.data.type === 'zyz-student-runner-checkpoint-accepted.v1') {
          lastAcceptedCheckpointFingerprint = text(event.data.checkpointFingerprint);
        }
        if (event.data.type === 'zyz-student-runner-restart-approved.v1') {
          if (!restartRequestPending || text(event.data.requestId) !== restartRequestId) return;
          restartRequestPending = false;
          restartRequestId = '';
          var resetButton = document.getElementById('reset-practice-button');
          if (!resetButton) return;
          restartBypass = true;
          try { resetButton.click(); } finally { restartBypass = false; }
        }
        if (event.data.type === 'zyz-student-runner-restart-denied.v1') {
          if (!restartRequestPending || text(event.data.requestId) !== restartRequestId) return;
          restartRequestPending = false;
          restartRequestId = '';
          window.setTimeout(function() {
            if (restartTarget && typeof restartTarget.focus === 'function') restartTarget.focus();
          }, 0);
        }
        if (event.data.type === 'zyz-student-runner-pause-request.v1') {
          var requestId = text(event.data.requestId);
          try {
            var hooks = window.IELTSPractice;
            if (!hooks || typeof hooks.getState !== 'function') throw new Error('答题页面尚未准备完成。');
            if (typeof hooks.tickTimer === 'function') hooks.tickTimer();
            var current = hooks.getState();
            send(true);
            var snapshot = checkpointSnapshot(current, Date.now());
            if (!snapshot) throw new Error('无法读取当前答题现场。');
            if (!runtimeStateKey) throw new Error('无法识别当前答题现场。');
            var encodedSnapshot = JSON.stringify(snapshot);
            localStorage.setItem(runtimeStateKey, encodedSnapshot);
            if (localStorage.getItem(runtimeStateKey) !== encodedSnapshot) throw new Error('浏览器未能验证当前答题现场。');
            window.parent.postMessage({ type: 'zyz-student-runner-pause-ready.v1', sessionId: sessionId, requestId: requestId, resumeSnapshot: snapshot }, '*');
          } catch (error) {
            window.parent.postMessage({ type: 'zyz-student-runner-pause-failed.v1', sessionId: sessionId, requestId: requestId, message: text(error && error.message || error) }, '*');
          }
        }
        if (event.data.type === 'zyz-student-runner-exit-cancelled.v1') {
          window.setTimeout(function() {
            if (lastExitTarget && typeof lastExitTarget.focus === 'function') lastExitTarget.focus();
          }, 0);
        }
        if (event.data.type === 'zyz-student-runner-cleanup-replay.v1') {
          var keys = ${jsonForInlineScript(restoreContext?.cleanupKeys || [])};
          keys.forEach(function(key) { try { localStorage.removeItem(key); } catch (_error) {} });
        }
      });
      window.addEventListener('load', function() { window.setTimeout(function() { send(true); }, 0); });
      window.addEventListener('pagehide', function() { sendAnnotation('pagehide', true); });
      window.setInterval(function() { send(false); }, 500);
    })();<\/script>`;
    const marker = '</body>';
    const index = html.toLocaleLowerCase('en').lastIndexOf(marker);
    return index >= 0 ? `${html.slice(0, index)}${restore}${bridge}${html.slice(index)}` : `${html}${restore}${bridge}`;
  }

  function questionCatalogForPackage(packageData) {
    return [...new Map(packageData.candidate.responseSlots.map((slot) => {
      const part = packageData.candidate.parts.find((candidatePart) => (candidatePart.tasks || []).some((task) => task.taskId === slot.taskId));
      const task = (part?.tasks || []).find((candidateTask) => candidateTask.taskId === slot.taskId);
      const question = {
        part: Math.max(1, Number(part?.ordinal || part?.part || 1)),
        passageId: part?.passage?.passageId || '',
        taskId: slot.taskId,
        questionNumber: String(slot.displayNumber),
        questionType: task?.questionType || '',
        taskLabel: taskQuestionTypeLabel(task),
      };
      return [`${question.part}|${question.taskId}|${question.questionNumber}`, question];
    })).values()];
  }

  /* BEGIN T58 TRUSTED LEGACY REPLAY CONTRACT */
  function freezeTrustedReplayData(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freezeTrustedReplayData);
      Object.freeze(value);
    }
    return value;
  }
  const TRUSTED_LEGACY_REPLAY = freezeTrustedReplayData(__ZYZ_JSON__("data/app/freezetrustedreplaydata.json"));
  function assembleTrustedReplayPackage(request, expectedSnapshotHash, expectedContentVersion) {
    const current = core.assembleHomework(request, library);
    const matches = (built) => built.manifest.extensions.homeworkSnapshot.snapshotHash === expectedSnapshotHash &&
      (!expectedContentVersion || built.manifest.contentVersion === expectedContentVersion);
    if (matches(current)) return current;
    const unavailable = () => new Error('原记录已保留；当前练习包没有与这条记录完全匹配的可信历史内容，暂时无法打开完整复盘。');
    if (!/^[a-f0-9]{64}$/.test(String(expectedSnapshotHash || '')) ||
        typeof expectedContentVersion !== 'string' || !expectedContentVersion) throw unavailable();
    const selectedIds = new Set(request.selections.map((selection) => selection.passageId));
    const eligible = TRUSTED_LEGACY_REPLAY.entries.filter((entry) => selectedIds.has(entry.passageId));
    if (!eligible.length || eligible.length > 2) throw unavailable();
    const exactMatches = new Map();
    for (let mask = 1; mask < (1 << eligible.length); mask += 1) {
      const replacements = new Map(eligible.filter((entry, index) => mask & (1 << index)).map((entry) => [entry.passageId, entry]));
      const historicalLibrary = {
        ...library,
        sources: library.sources.map((source) => replacements.get(source.passageId)?.source || source),
        passages: library.passages.map((passage) => replacements.get(passage.passageId)?.passage || passage),
      };
      let built;
      try { built = core.assembleHomework(request, historicalLibrary); } catch (_) { continue; }
      if (matches(built)) exactMatches.set(JSON.stringify(built), built);
    }
    if (exactMatches.size !== 1) throw unavailable();
    return exactMatches.values().next().value;
  }

  /* END T58 TRUSTED LEGACY REPLAY CONTRACT */

  async function startSession(kind, selections, options = {}) {
    try {
      if (!['practice', 'mock'].includes(kind)) throw new Error('练习类型无效。');
      const resumeEntry = options.resumeEntry ? validatedResumableEntry(options.resumeEntry, kind) : null;
      if (resumeEntry?.releaseId && resumeEntry.releaseId !== manifest.releaseId) {
        throw new Error('这项暂停内容来自另一版题库，已保留原暂停点。');
      }
      const currentSessions = readResumableSessions();
      state.resumableSessions = currentSessions;
      const existingDraft = currentSessions[kind];
      if (resumeEntry && (!existingDraft || existingDraft.attemptSessionId !== resumeEntry.attemptSessionId ||
          existingDraft.snapshotHash !== resumeEntry.snapshotHash || existingDraft.status === 'submitted-pending')) {
        throw new Error('这项未完成内容已在另一个页面发生变化，请从页面上方重新选择。');
      }
      if (!resumeEntry && !options.replayRecordId && existingDraft) {
        renderResumableSessions();
        byId('resume-strip')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        window.requestAnimationFrame(() => {
          const selector = existingDraft.status === 'submitted-pending'
            ? `[data-retry-submission="${kind}"]`
            : `[data-resume-session="${kind}"]`;
          document.querySelector(selector)?.focus?.();
        });
        toast(existingDraft.status === 'submitted-pending'
          ? `请先重试保存或明确放弃上一条${kind === 'mock' ? '模考' : '练习'}记录。`
          : `请先继续或明确放弃上一次未完成的${kind === 'mock' ? '模考' : '练习'}。`, 6000);
        return;
      }
      const normalized = normalizedSelections(selections);
      if (!normalized.length || normalized.length > 3) throw new Error('请选择 1–3 篇文章。');
      if (new Set(normalized.map((selection) => selection.passageId)).size !== normalized.length) {
        throw new Error('同一篇文章只能出现一次；请把需要的多个题型合并在该文章下。');
      }
      if (new Set(normalized.map((selection) => selection.scope)).size !== 1) {
        throw new Error('完整篇章与单独题型不能混合在同一次练习中。');
      }
      const selectedPassages = normalized.map((selection) => passageById.get(selection.passageId));
      if (selectedPassages.some((passage) => !passage)) throw new Error('所选文章已不在本月题库中。');
      const compositionMode = options.compositionMode || (normalized[0]?.scope === 'task' ? 'task-drill' : 'full-passage');
      const request = {
        schemaVersion: core.HOMEWORK_REQUEST_V1,
        mode: 'homework',
        title: options.title || packageTitle(kind, selectedPassages, compositionMode),
        compositionMode,
        selections: normalized.map((selection) => ({ ...selection })),
        reviewMode: 'full-review',
        timerPolicy: options.timerPolicy || (kind === 'mock'
          ? { enabled: true, durationSeconds: 3600, expiryAction: 'submit' }
          : practiceTimerPolicy()),
        watermarkText: 'ZYZ READING WALKS',
      };
      const replayRecordId = String(options.replayRecordId || '');
      const packageData = replayRecordId
        ? assembleTrustedReplayPackage(request, options.expectedSnapshotHash, options.expectedPackageContentVersion)
        : core.assembleHomework(request, library);
      const generatedHtml = personalizeStudentHtml(core.renderStudentHtml(packageData, runtimeTemplate), kind);
      const snapshot = packageData.manifest.extensions.homeworkSnapshot;
      const isHistoricalReplay = Boolean(replayRecordId && snapshot.snapshotHash !==
        core.assembleHomework(request, library).manifest.extensions.homeworkSnapshot.snapshotHash);
      const expectedSnapshotHash = resumeEntry?.snapshotHash || options.expectedSnapshotHash;
      if (expectedSnapshotHash && snapshot.snapshotHash !== expectedSnapshotHash) {
        throw new Error('题库内容或生成规则已经更新，无法把这条记录还原成当时版本。');
      }
      const sessionId = `${Date.now().toString(36)}.${snapshot.snapshotHash.slice(0, 12)}`;
      const replayBoot = replayRecordId ? await records.prepareReplayBootContext(replayRecordId, {
        baseStoragePrefix: RUNTIME_STATE_STORAGE_PREFIX,
        packageId: packageData.manifest.packageId,
        contentVersion: packageData.manifest.contentVersion,
        expectedSnapshotHash: snapshot.snapshotHash,
      }) : null;
      const ordinaryRuntimeSuffix = `.${packageData.manifest.packageId}.${packageData.manifest.contentVersion}`;
      const resumeRuntimePrefix = resumeEntry
        ? resumeEntry.runtimeStateKey.slice(0, -ordinaryRuntimeSuffix.length)
        : '';
      if (resumeEntry && !resumeEntry.runtimeStateKey.endsWith(ordinaryRuntimeSuffix)) {
        throw new Error('暂停点的本机存储位置与重建后的答题页面不一致。');
      }
      const runtimeStoragePrefix = replayBoot?.storagePrefix || resumeRuntimePrefix || runtimeStoragePrefixForAttempt(sessionId);
      if (replayRecordId && !generatedHtml.includes(RUNTIME_STATE_STORAGE_PREFIX)) {
        throw new Error('答题页面的复盘存储接口已发生变化。');
      }
      if (!generatedHtml.includes(RUNTIME_STATE_STORAGE_PREFIX)) {
        throw new Error('答题页面的本机存储接口已发生变化。');
      }
      const runnerHtml = generatedHtml.split(RUNTIME_STATE_STORAGE_PREFIX).join(runtimeStoragePrefix);
      const runtimeStateKey = `${runtimeStoragePrefix}.${packageData.manifest.packageId}.${packageData.manifest.contentVersion}`;
      const attemptLedgerKey = `${runtimeStoragePrefix}.attempt-ledger.v1.${snapshot.snapshotHash.toLowerCase()}`;
      if (resumeEntry && resumeEntry.packageContentVersion !== packageData.manifest.contentVersion) {
        throw new Error('答题页面版本与暂停点不一致，已保留原暂停点。');
      }
      if (!resumeEntry && !replayRecordId) {
        await withResumableMutationLock(() => {
          const latestSessions = readResumableSessions();
          if (latestSessions[kind]) {
            throw new Error(`另一页面已经保存了一项未完成的${kind === 'mock' ? '模考' : '练习'}，请先继续或明确放弃它。`);
          }
          return clearUnreferencedFreshRuntimeState(runtimeStateKey);
        });
      }
      const resumeBoot = resumeEntry ? prepareResumeStorage(resumeEntry, runtimeStateKey) : null;
      const attemptSessionId = resumeEntry?.attemptSessionId || sessionId;
      state.currentSession = {
        sessionId,
        attemptSessionId,
        kind,
        scope: compositionMode === 'task-drill' ? 'task' : 'full-passage',
        compositionMode,
        title: request.title,
        selections: normalized.map((selection) => ({ passageId: selection.passageId, scope: selection.scope, ...(selection.taskIds ? { taskIds: [...selection.taskIds] } : {}) })),
        passageIds: normalized.map((selection) => selection.passageId),
        taskIds: normalized.flatMap((selection) => selection.taskIds || []),
        taskIdsByPassage: Object.fromEntries(normalized.map((selection) => [selection.passageId, [...(selection.taskIds || [])]])),
        questionCatalog: questionCatalogForPackage(packageData),
        snapshotHash: snapshot.snapshotHash,
        packageContentVersion: packageData.manifest.contentVersion,
        runtimeStateKey,
        attemptLedgerKey,
        timerPolicy: { ...request.timerPolicy },
        startedAt: resumeEntry?.startedAt || Date.now(),
        isReplay: Boolean(replayRecordId),
        isHistoricalReplay,
        isResume: Boolean(resumeEntry),
        lastCheckpointSavedAt: 0,
        checkpointWritePending: false,
        replayRecordId,
        replayCleanupKeys: replayBoot?.cleanupKeys || [],
        annotationContext: null,
        pendingAnnotationOverlay: null,
      };
      if (replayBoot?.runtimeState) {
        initializeReviewAnnotationContext(
          state.currentSession,
          replayBoot.runtimeState,
          replayBoot.annotationOverlayRevision,
          replayBoot.annotationOverlayPresent,
        );
      }
      state.lastRecordedSubmissionId = replayRecordId || null;
      state.submissionSave = null;
      state.runnerChildState = null;
      state.runnerOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      byId('runner-title').textContent = request.title;
      byId('runner-status').textContent = replayRecordId
        ? '正在恢复本机复盘'
        : resumeEntry ? `正在恢复上次${kind === 'mock' ? '模考' : '练习'}` : (kind === 'mock' ? '模考模式' : '练习模式');
      byId('runner').hidden = false;
      document.body.style.overflow = 'hidden';
      const frame = byId('practice-frame');
      frame.srcdoc = withRunnerBridge(runnerHtml, sessionId, replayBoot || resumeBoot, {
        attemptLedgerKey,
        runtimeStateKey,
        snapshotHash: snapshot.snapshotHash,
        packageContentVersion: packageData.manifest.contentVersion,
        timerPolicy: request.timerPolicy,
      });
      state.runnerZoomFingerprint = '';
      window.requestAnimationFrame(() => syncRunnerZoomState({ force: true }));
      window.clearTimeout(state.runnerReadyTimeout);
      state.runnerReadyTimeout = window.setTimeout(() => {
        if (!state.currentSession || state.currentSession.sessionId !== sessionId || state.runnerChildState) return;
        byId('runner-status').textContent = '载入失败';
        toast('答题页面未能完成载入，请返回后重试。', 5000);
      }, 15000);
      if (!replayRecordId && !resumeEntry) markSessionVisited(state.currentSession).catch((error) => console.warn('Could not mark passages visited.', error));
    } catch (error) {
      console.error(error);
      toast(`无法开始：${error.message || error}`, 5000);
    }
  }

  function resumeSavedSession(kind) {
    const normalizedKind = resumableKind(kind);
    let entry = null;
    try {
      state.resumableSessions = readResumableSessions();
      entry = state.resumableSessions[normalizedKind];
    } catch (error) {
      renderResumableSessions();
      toast(`暂不能继续：${error.message || error}`, 6000);
      return;
    }
    if (!normalizedKind || !entry) {
      toast('这项未完成内容已经不存在。');
      renderResumableSessions();
      return;
    }
    if (entry.status === 'submitted-pending') {
      retryPendingSubmission(normalizedKind);
      return;
    }
    startSession(normalizedKind, entry.selections, {
      title: entry.title,
      compositionMode: entry.compositionMode,
      timerPolicy: entry.timerPolicy,
      expectedSnapshotHash: entry.snapshotHash,
      resumeEntry: entry,
    });
  }

  function normalizeRecoveredSubmissionText(value, rules = {}) {
    let result = String(value == null ? '' : value);
    if (rules.unicode && rules.unicode !== 'none') result = result.normalize(rules.unicode);
    else result = result.normalize('NFKC');
    if (rules.trim !== false) result = result.trim();
    if (rules.caseSensitive !== true) result = result.toLowerCase();
    if (rules.apostrophePolicy === 'equivalent') result = result.replace(/[\u2018\u2019]/g, "'");
    if (rules.hyphenPolicy === 'equivalent') result = result.replace(/[\u2010-\u2015-]/g, ' ');
    else if (rules.hyphenPolicy === 'remove') result = result.replace(/[\u2010-\u2015-]/g, '');
    if (rules.collapseWhitespace !== false) result = result.replace(/\s+/g, ' ');
    return result;
  }

  function normalizeRecoveredVisibleAnswer(value) {
    return normalizeRecoveredSubmissionText(value, {
      apostrophePolicy: 'equivalent',
      hyphenPolicy: 'equivalent',
    });
  }

  function recoveredAtomicMembers(scoreSlot, rules) {
    const groups = new Map();
    (scoreSlot.accepted || []).forEach((entry, index) => {
      const memberId = String(entry.setMemberId || `member-${index + 1}`);
      const values = groups.get(memberId) || [];
      const normalized = normalizeRecoveredSubmissionText(entry.value, rules);
      if (normalized && !values.includes(normalized)) values.push(normalized);
      groups.set(memberId, values);
    });
    return [...groups.values()];
  }

  function recoveredAtomicSetIsCorrect(rawResponses, memberGroups, rules) {
    const supplied = rawResponses.map((value) => normalizeRecoveredSubmissionText(value, rules));
    if (supplied.length !== memberGroups.length || supplied.some((value) => !value)) return false;
    const usedMembers = new Set();
    const matchResponse = (responseIndex) => {
      if (responseIndex >= supplied.length) return true;
      for (let memberIndex = 0; memberIndex < memberGroups.length; memberIndex += 1) {
        if (usedMembers.has(memberIndex) || !memberGroups[memberIndex].includes(supplied[responseIndex])) continue;
        usedMembers.add(memberIndex);
        if (matchResponse(responseIndex + 1)) return true;
        usedMembers.delete(memberIndex);
      }
      return false;
    };
    return matchResponse(0);
  }

  function recoveredSubmissionScore(packageData, runtimeState) {
    const candidate = packageData?.candidate;
    const scoreSlots = packageData?.answerKey?.scoreSlots;
    if (!candidate || !Array.isArray(candidate.parts) || !Array.isArray(candidate.responseSlots) || !Array.isArray(scoreSlots)) {
      throw new Error('题目评分结构无法用于恢复待保存记录。');
    }
    const tasks = new Map();
    candidate.parts.forEach((part) => (part.tasks || []).forEach((task) => tasks.set(task.taskId, task)));
    const responses = runtimeState?.answers && typeof runtimeState.answers === 'object' ? runtimeState.answers : {};
    const byId = new Map();
    const byResponse = new Map();
    const byTask = new Map();
    scoreSlots.forEach((scoreSlot) => {
      const task = tasks.get(scoreSlot.taskId);
      if (!task || !Array.isArray(scoreSlot.responseSlotIds)) throw new Error('题目评分关系无法用于恢复待保存记录。');
      const rawResponses = scoreSlot.responseSlotIds.map((id) => String(responses[id] || ''));
      const supplied = rawResponses.filter(Boolean);
      const accepted = (scoreSlot.accepted || []).map((entry) => String(entry.value));
      let correct = false;
      if (scoreSlot.evaluation === 'unordered-membership') {
        correct = accepted.some((value) => supplied.includes(value));
      } else if (scoreSlot.evaluation === 'exact-option') {
        correct = accepted.includes(supplied[0] || '');
      } else if (scoreSlot.evaluation === 'normalized-text') {
        const rules = scoreSlot.normalization || task.rules?.normalization || {};
        const answer = normalizeRecoveredSubmissionText(supplied[0] || '', rules);
        correct = Boolean(answer) && accepted.some((value) => normalizeRecoveredSubmissionText(value, rules) === answer);
      } else if (scoreSlot.evaluation === 'atomic-unordered-text-set') {
        const rules = scoreSlot.normalization || task.rules?.normalization || {};
        correct = recoveredAtomicSetIsCorrect(rawResponses, recoveredAtomicMembers(scoreSlot, rules), rules);
      } else {
        throw new Error('待保存记录包含当前版本不支持的评分方式。');
      }
      const result = {
        scoreSlotId: scoreSlot.scoreSlotId,
        status: supplied.length === 0 ? 'unanswered' : correct ? 'correct' : 'incorrect',
        earnedMarks: correct ? Number(scoreSlot.marks || 0) : 0,
        availableMarks: Number(scoreSlot.marks || 0),
      };
      byId.set(scoreSlot.scoreSlotId, result);
      scoreSlot.responseSlotIds.forEach((responseSlotId) => {
        const rows = byResponse.get(responseSlotId) || [];
        rows.push({ scoreSlot, result });
        byResponse.set(responseSlotId, rows);
      });
      const taskRows = byTask.get(scoreSlot.taskId) || [];
      taskRows.push({ scoreSlot, result });
      byTask.set(scoreSlot.taskId, taskRows);
    });
    return {
      tasks,
      byId,
      byResponse,
      byTask,
      earnedMarks: [...byId.values()].reduce((sum, row) => sum + row.earnedMarks, 0),
      availableMarks: [...byId.values()].reduce((sum, row) => sum + row.availableMarks, 0),
    };
  }

  function recoveredReferenceBand(packageData, runtimeState) {
    const result = runtimeState?.result || {};
    const snapshot = packageData?.manifest?.extensions?.homeworkSnapshot || {};
    const parts = Array.isArray(result.partScores) ? result.partScores : [];
    const fullPassageSelection = snapshot.schemaVersion === 'ielts-reading-homework-snapshot.v0'
      ? Array.isArray(snapshot.passages) && snapshot.passages.length === packageData.candidate.parts.length
      : snapshot.compositionMode === 'full-passage' && Array.isArray(snapshot.selections) &&
        snapshot.selections.length === packageData.candidate.parts.length && snapshot.selections.every((selection) => selection.scope === 'full');
    const eligible = fullPassageSelection && packageData.candidate.parts.length === 3 &&
      Number(result.availableMarks) === 40 && Number(result.total) === 40 && parts.length === 3 &&
      parts.every((part) => Number(part.availableMarks) > 0) &&
      parts.reduce((sum, part) => sum + Number(part.availableMarks || 0), 0) === 40;
    if (!eligible) return { eligible: false, value: 0 };
    const thresholds = [[39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [20, 5.5], [16, 5], [13, 4.5], [10, 4], [7, 3.5], [5, 3], [3, 2.5], [2, 2], [1, 1], [0, 0]];
    const row = thresholds.find(([minimum]) => Number(result.earnedMarks) >= minimum);
    return { eligible: Boolean(row), value: row ? row[1] : 0 };
  }

  function rebuildSubmissionReport(packageData, runtimeState, questionCatalog) {
    if (!runtimeState?.submitted || !runtimeState.result || !Array.isArray(questionCatalog) || !questionCatalog.length) {
      throw new Error('已提交现场缺少可重建的成绩数据。');
    }
    const candidate = packageData.candidate;
    const scored = recoveredSubmissionScore(packageData, runtimeState);
    const answers = runtimeState.answers || {};
    const responseSlots = new Map(candidate.responseSlots.map((slot) => [slot.responseSlotId, slot]));
    const statuses = new Map();
    const summaryStatuses = new Map();
    candidate.parts.forEach((part, partIndex) => {
      const partNumber = Math.max(1, Number(part.ordinal || part.part || partIndex + 1));
      (part.tasks || []).forEach((task) => {
        const taskResponseIds = Array.isArray(task.responseSlotIds) ? task.responseSlotIds : [];
        if (task.interactionVariant === 'choice_set') {
          const options = [
            ...((task.content?.options || [])),
            ...((task.content?.items || []).flatMap((item) => item.options || [])),
          ];
          const canonicalByAnswer = new Map(options.map((option) => [normalizeRecoveredVisibleAnswer(option.optionId), String(option.optionId)]));
          const selected = [];
          const used = new Set();
          const limit = Math.max(1, Number(task.rules?.maxSelections) || taskResponseIds.length || 2);
          taskResponseIds.map((id) => answers[id]).filter(Boolean).forEach((value) => {
            const normalized = normalizeRecoveredVisibleAnswer(value);
            const canonical = canonicalByAnswer.get(normalized);
            if (!canonical || used.has(normalized) || selected.length >= limit) return;
            selected.push(canonical);
            used.add(normalized);
          });
          const accepted = new Set((scored.byTask.get(task.taskId) || []).flatMap(({ scoreSlot }) =>
            (scoreSlot.accepted || []).map((entry) => normalizeRecoveredVisibleAnswer(entry.value))));
          taskResponseIds.forEach((responseSlotId, index) => {
            const slot = responseSlots.get(responseSlotId);
            const answer = selected[index] || '';
            if (!slot) throw new Error('待保存记录的题号关系无法校验。');
            const status = !answer ? 'unanswered' : accepted.has(normalizeRecoveredVisibleAnswer(answer)) ? 'correct' : 'incorrect';
            statuses.set(`${partNumber}|${String(slot.displayNumber)}`, status);
            summaryStatuses.set(`${partNumber}|${String(slot.displayNumber)}`, status);
          });
          return;
        }
        taskResponseIds.forEach((responseSlotId) => {
          const slot = responseSlots.get(responseSlotId);
          const scoredRows = scored.byResponse.get(responseSlotId) || [];
          if (!slot || !scoredRows.length) throw new Error('待保存记录的评分题号无法校验。');
          const { scoreSlot, result } = scoredRows[0];
          const visiblyAnswered = normalizeRecoveredVisibleAnswer(answers[responseSlotId]) !== '';
          const reportAnswered = scoreSlot.evaluation === 'atomic-unordered-text-set'
            ? result.status !== 'unanswered'
            : visiblyAnswered;
          statuses.set(`${partNumber}|${String(slot.displayNumber)}`, !reportAnswered ? 'unanswered' :
            result.status === 'correct' ? 'correct' : 'incorrect');
          summaryStatuses.set(`${partNumber}|${String(slot.displayNumber)}`, !visiblyAnswered ? 'unanswered' :
            result.status === 'correct' ? 'correct' : 'incorrect');
        });
      });
    });
    const questionOutcomes = candidate.parts.map((part, index) => {
      const partNumber = Math.max(1, Number(part.ordinal || part.part || index + 1));
      const buckets = { correct: [], incorrect: [], partial: [], unanswered: [] };
      questionCatalog.filter((question) => Number(question.part) === partNumber)
        .sort((left, right) => Number(left.questionNumber) - Number(right.questionNumber))
        .forEach((question) => {
          const status = statuses.get(`${partNumber}|${question.questionNumber}`);
          if (!status || !Object.prototype.hasOwnProperty.call(buckets, status)) {
            throw new Error('待保存记录的逐题结果无法完整重建。');
          }
          buckets[status].push(String(question.questionNumber));
        });
      return { part: partNumber, ...buckets };
    });
    const counts = questionCatalog.reduce((totals, question) => {
      const status = summaryStatuses.get(`${Number(question.part)}|${question.questionNumber}`);
      if (!status || !Object.prototype.hasOwnProperty.call(totals, status)) throw new Error('待保存记录的提交摘要无法完整重建。');
      totals[status] += 1;
      return totals;
    }, { correct: 0, incorrect: 0, partial: 0, unanswered: 0 });
    const result = runtimeState.result;
    const summaryTotal = counts.correct + counts.incorrect + counts.partial + counts.unanswered;
    const outcomeTotal = questionOutcomes.reduce((total, part) => total + part.correct.length + part.incorrect.length + part.partial.length + part.unanswered.length, 0);
    if (outcomeTotal !== questionCatalog.length || summaryTotal !== questionCatalog.length || summaryTotal !== Number(result.total) ||
        counts.correct !== Number(result.correct) || counts.incorrect !== Number(result.incorrect) ||
        counts.unanswered !== Number(result.unanswered) || counts.partial !== Number(result.partial || 0) ||
        scored.earnedMarks !== Number(result.earnedMarks) || scored.availableMarks !== Number(result.availableMarks)) {
      throw new Error('待保存记录的逐题结果与提交总分不一致。');
    }
    return {
      referenceBand: recoveredReferenceBand(packageData, runtimeState),
      questionOutcomes,
    };
  }

  function submissionReportForRetry(report, packageData, runtimeState, session) {
    const existing = storedQuestionOutcomes(report, session);
    if (existing.length === session.questionCatalog.length &&
        new Set(existing.map((item) => item.questionId)).size === session.questionCatalog.length) {
      return cloneJson(report);
    }
    const rebuilt = rebuildSubmissionReport(packageData, runtimeState, session.questionCatalog);
    return {
      ...(report && typeof report === 'object' ? cloneJson(report) : {}),
      referenceBand: report?.referenceBand && typeof report.referenceBand === 'object'
        ? cloneJson(report.referenceBand)
        : rebuilt.referenceBand,
      questionOutcomes: rebuilt.questionOutcomes,
    };
  }

  function sessionForResumableEntry(entry) {
    const normalizedEntry = validatedResumableEntry(entry, entry?.kind);
    if (!normalizedEntry || normalizedEntry.releaseId !== manifest.releaseId) {
      throw new Error('这条待保存记录来自另一版题库。');
    }
    const normalized = normalizedSelections(normalizedEntry.selections);
    const request = {
      schemaVersion: core.HOMEWORK_REQUEST_V1,
      mode: 'homework',
      title: normalizedEntry.title,
      compositionMode: normalizedEntry.compositionMode,
      selections: normalized.map((selection) => ({ ...selection })),
      reviewMode: 'full-review',
      timerPolicy: { ...normalizedEntry.timerPolicy },
      watermarkText: 'ZYZ READING WALKS',
    };
    const packageData = core.assembleHomework(request, library);
    const snapshot = packageData.manifest.extensions.homeworkSnapshot;
    const runtimeStateKey = normalizedEntry.runtimeStateKey;
    const runtimeSuffix = `.${packageData.manifest.packageId}.${packageData.manifest.contentVersion}`;
    const runtimeStoragePrefix = runtimeStateKey.slice(0, -runtimeSuffix.length);
    if (snapshot.snapshotHash !== normalizedEntry.snapshotHash ||
        packageData.manifest.contentVersion !== normalizedEntry.packageContentVersion ||
        !runtimeStateKey.endsWith(runtimeSuffix)) {
      throw new Error('题库内容或生成规则已变化，待保存记录未被改写。');
    }
    const session = {
      sessionId: `retry.${Date.now().toString(36)}.${snapshot.snapshotHash.slice(0, 12)}`,
      attemptSessionId: normalizedEntry.attemptSessionId,
      kind: normalizedEntry.kind,
      scope: normalizedEntry.compositionMode === 'task-drill' ? 'task' : 'full-passage',
      compositionMode: normalizedEntry.compositionMode,
      title: normalizedEntry.title,
      selections: normalized,
      passageIds: normalized.map((selection) => selection.passageId),
      taskIds: normalized.flatMap((selection) => selection.taskIds || []),
      taskIdsByPassage: Object.fromEntries(normalized.map((selection) => [selection.passageId, [...(selection.taskIds || [])]])),
      questionCatalog: questionCatalogForPackage(packageData),
      snapshotHash: snapshot.snapshotHash,
      packageContentVersion: packageData.manifest.contentVersion,
      runtimeStateKey,
      attemptLedgerKey: `${runtimeStoragePrefix}.attempt-ledger.v1.${snapshot.snapshotHash.toLowerCase()}`,
      timerPolicy: { ...normalizedEntry.timerPolicy },
      startedAt: normalizedEntry.startedAt,
      isReplay: false,
      isResume: false,
      isPendingRetry: true,
    };
    session.pendingSubmissionReport = submissionReportForRetry(
      normalizedEntry.submissionReport,
      packageData,
      normalizedEntry.runtimeState,
      session,
    );
    return session;
  }

  async function retryPendingSubmission(kind) {
    const normalizedKind = resumableKind(kind);
    if (!normalizedKind) return toast('这条待保存记录已经不存在。');
    let entry = null;
    try {
      const currentSessions = readResumableSessions();
      state.resumableSessions = currentSessions;
      entry = currentSessions[normalizedKind];
    } catch (error) {
      renderResumableSessions();
      return toast(`暂未保存：${error.message || error}`, 6000);
    }
    if (!entry || entry.status !== 'submitted-pending') return toast('这条待保存记录已经不存在。');
    if (state.submissionRetryKinds.has(normalizedKind)) return;
    state.submissionRetryKinds.add(normalizedKind);
    renderResumableSessions();
    try {
      toast('正在重新保存学习记录与本机复盘…', 5000);
      const session = sessionForResumableEntry(entry);
      const saved = await recordRunnerSubmission(
        entry.runtimeState,
        session.pendingSubmissionReport,
        entry.runtimeState,
        entry.attemptLedger,
        session,
      );
      if (!saved) throw new Error('浏览器仍未能完成写入，待保存内容已保留。');
      toast('学习记录与本机复盘已安全保存。', 5000);
    } catch (error) {
      toast(`暂未保存：${error.message || error}`, 6000);
    } finally {
      state.submissionRetryKinds.delete(normalizedKind);
      try { state.resumableSessions = readResumableSessions(); }
      catch (error) { console.warn('Could not refresh resumable sessions after retry.', error); }
      renderResumableSessions();
    }
  }

  function storedQuestionOutcomes(report, session) {
    const grouped = Array.isArray(report?.questionOutcomes) ? report.questionOutcomes : [];
    if (!grouped.length) return [];
    const statuses = new Map();
    grouped.forEach((part) => {
      const partNumber = Math.max(1, Number(part?.part || 1));
      ['correct', 'incorrect', 'partial', 'unanswered'].forEach((status) => {
        (Array.isArray(part?.[status]) ? part[status] : []).forEach((token) => {
          const questionNumber = String(token || '').trim();
          if (!questionNumber) return;
          statuses.set(`${partNumber}|${questionNumber}`, status);
        });
      });
    });
    return (session.questionCatalog || []).flatMap((question) => {
      const partNumber = Math.max(1, Number(question.part || session.passageIds.indexOf(question.passageId) + 1));
      const status = statuses.get(`${partNumber}|${question.questionNumber}`);
      if (!status) return [];
      return [{
        questionId: `${question.passageId}|${question.taskId}|${question.questionNumber}`,
        questionNumber: question.questionNumber,
        passageId: question.passageId,
        taskId: question.taskId,
        questionType: question.questionType,
        taskLabel: question.taskLabel,
        status,
      }];
    });
  }

  function attemptAssignmentCode(snapshotHash) {
    const compact = String(snapshotHash || '').slice(0, 10).toUpperCase();
    return /^[0-9A-F]{10}$/u.test(compact)
      ? `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 10)}`
      : '';
  }

  function syntheticAttemptLedger(runtimeState, snapshotHash) {
    const submissionId = String(runtimeState?.submissionId || '');
    const attemptNumber = Math.max(1, Math.floor(Number(runtimeState?.attemptNumber) || 1));
    const assignmentCode = attemptAssignmentCode(snapshotHash);
    const expectedMarker = `${assignmentCode}-A${attemptNumber}`;
    if (!assignmentCode || !/^[A-Za-z0-9._:-]{8,160}$/u.test(submissionId) ||
        attemptNumber > 1000 || runtimeState?.attemptMarker !== expectedMarker) {
      throw new Error('本机现场缺少可验证的提交身份。');
    }
    const seenSubmissionIds = Array.from({ length: attemptNumber }, (_unused, index) => (
      index === attemptNumber - 1 ? submissionId : `replay.placeholder.${String(snapshotHash).slice(0, 12)}.${index + 1}`
    ));
    const optionalNumber = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
      ? null
      : Number(value);
    const firstHistoryNumber = Math.max(1, attemptNumber - 19);
    const history = [];
    for (let number = firstHistoryNumber; number <= attemptNumber; number += 1) {
      const isCurrent = number === attemptNumber;
      history.push({
        submissionId: seenSubmissionIds[number - 1],
        attemptNumber: number,
        attemptMarker: `${assignmentCode}-A${number}`,
        submittedAt: isCurrent ? optionalNumber(runtimeState?.submittedAt) : null,
        elapsedSeconds: isCurrent ? optionalNumber(runtimeState?.elapsedSeconds) : null,
        earnedMarks: isCurrent ? optionalNumber(runtimeState?.result?.earnedMarks) : null,
        availableMarks: isCurrent ? optionalNumber(runtimeState?.result?.availableMarks) : null,
        answered: isCurrent ? optionalNumber(runtimeState?.result?.answered) : null,
        total: isCurrent ? optionalNumber(runtimeState?.result?.total) : null,
        migrated: false,
      });
    }
    return JSON.stringify({
      schemaVersion: 'ielts-reading-attempt-ledger.v1',
      assignmentCode,
      submissionCount: attemptNumber,
      seenSubmissionIds,
      history,
    });
  }

  function replayAttemptLedger(rawLedger, runtimeState, snapshotHash) {
    if (typeof rawLedger === 'string' && rawLedger.length > 0 && rawLedger.length <= 65536) {
      try {
        const parsed = JSON.parse(rawLedger);
        const attemptNumber = Math.max(1, Math.floor(Number(runtimeState?.attemptNumber) || 1));
        if (parsed?.schemaVersion === 'ielts-reading-attempt-ledger.v1' &&
            parsed.assignmentCode === attemptAssignmentCode(snapshotHash) &&
            Array.isArray(parsed.seenSubmissionIds) &&
            parsed.seenSubmissionIds[attemptNumber - 1] === runtimeState?.submissionId) return rawLedger;
      } catch (_error) { /* synthesize a private replay ledger below */ }
    }
    return syntheticAttemptLedger(runtimeState, snapshotHash);
  }

  function privateAttemptPayload(attemptSnapshot, attemptLedger, session) {
    return {
      snapshotHash: session.snapshotHash,
      packageContentVersion: session.packageContentVersion,
      runtimeStateKey: session.runtimeStateKey,
      requestTitle: session.title,
      compositionMode: session.compositionMode,
      mode: session.kind,
      selections: session.selections,
      timerPolicy: session.timerPolicy,
      runtimeState: attemptSnapshot,
      attemptLedger: replayAttemptLedger(attemptLedger, attemptSnapshot, session.snapshotHash),
    };
  }

  function annotationDataFromState(source) {
    const value = source && typeof source === 'object' ? source : {};
    return cloneJson({
      highlights: value.highlights && typeof value.highlights === 'object' ? value.highlights : {},
      questionHighlights: value.questionHighlights && typeof value.questionHighlights === 'object' ? value.questionHighlights : {},
      notes: Array.isArray(value.notes) ? value.notes : [],
      questionFlags: Object.fromEntries(Object.entries(
        Object.prototype.hasOwnProperty.call(value, 'reviewQuestionFlags') ? value.reviewQuestionFlags || {} : value.questionFlags || {},
      ).filter(([key, flag]) => key.length > 0 && key.length <= 220 && !['__proto__', 'prototype', 'constructor'].includes(key) && flag === true)),
    });
  }

  function annotationFingerprint(value) {
    const data = annotationDataFromState(value);
    return JSON.stringify([data.highlights, data.questionHighlights, data.notes, data.questionFlags]);
  }

  function annotationEnvelopeData(raw, session) {
    if (!raw || typeof raw !== 'object' || raw.schemaVersion !== ANNOTATION_OVERLAY_SCHEMA_VERSION) {
      throw new Error('复盘标注版本无法识别，已拒绝覆盖原记录。');
    }
    const recordId = String(session?.replayRecordId || raw.submissionId || '');
    if (!recordId || String(raw.submissionId || '') !== recordId ||
        String(raw.snapshotHash || '') !== String(session?.snapshotHash || '') ||
        String(raw.packageContentVersion || '') !== String(session?.packageContentVersion || '')) {
      throw new Error('复盘标注与当前提交身份不一致，已拒绝写入。');
    }
    return annotationDataFromState(raw);
  }

  function annotationGuards(session, context) {
    return {
      expectedSubmissionId: context.submissionId,
      expectedSnapshotHash: session.snapshotHash,
      expectedContentVersion: session.packageContentVersion,
      expectedRevision: context.revision,
    };
  }

  function initializeReviewAnnotationContext(session, initialState, revision = 0, hasOverlay = false) {
    if (!session || !initialState) return null;
    const data = annotationDataFromState(initialState);
    const recordId = String(session.replayRecordId || initialState.submissionId || '');
    if (!recordId || recordId !== String(initialState.submissionId || recordId)) return null;
    const fingerprint = annotationFingerprint(data);
    const context = {
      recordId,
      submissionId: recordId,
      revision: Math.max(0, Math.floor(Number(revision) || 0)),
      hasOverlay: Boolean(hasOverlay),
      baseData: cloneJson(data),
      baseFingerprint: fingerprint,
      latestData: cloneJson(data),
      latestFingerprint: fingerprint,
      persistedFingerprint: fingerprint,
      dirty: false,
      writeTimer: 0,
      writeActive: false,
      writeAgain: false,
      forceReadback: false,
      writeTail: Promise.resolve(),
      lastError: '',
      lastErrorShown: '',
    };
    session.annotationContext = context;
    const pending = session.pendingAnnotationOverlay;
    session.pendingAnnotationOverlay = null;
    if (pending?.overlay) stageRunnerAnnotationOverlay(session, pending.overlay, pending.reason || 'checkpoint');
    return context;
  }

  function showAnnotationPersistenceFailure(session, error) {
    if (!session || state.currentSession !== session) return;
    const message = String(error?.message || error || '未知错误');
    const context = session.annotationContext;
    if (context) context.lastError = message;
    byId('runner-status').textContent = '复盘标注暂未保存 · 请留在当前页面';
    if (!context || context.lastErrorShown !== message) {
      if (context) context.lastErrorShown = message;
      toast(`复盘标注暂未保存：${message}。请留在当前页面重试。`, 7000);
    }
  }

  async function verifyReviewAnnotationReadback(session, context, expectedFingerprint) {
    if (!records?.readAttemptAnnotationOverlay) throw new Error('当前版本缺少复盘标注回读接口。');
    const stored = await records.readAttemptAnnotationOverlay(context.recordId, {
      expectedSubmissionId: context.submissionId,
      expectedSnapshotHash: session.snapshotHash,
      expectedContentVersion: session.packageContentVersion,
    });
    if (!stored || Number(stored.revision) !== Number(context.revision) ||
        annotationFingerprint(stored.annotationData) !== expectedFingerprint) {
      throw new Error('复盘标注写入后未能通过回读校验。');
    }
    return stored;
  }

  function enqueueReviewAnnotationWrite(session, options = {}) {
    const context = session?.annotationContext;
    if (!context) return Promise.reject(new Error('复盘标注保存上下文尚未建立。'));
    context.writeAgain = true;
    if (options.forceReadback) context.forceReadback = true;
    if (context.writeActive) return context.writeTail;
    context.writeActive = true;
    const run = async () => {
      while (context.writeAgain) {
        context.writeAgain = false;
        const writeData = cloneJson(context.latestData);
        const writeFingerprint = annotationFingerprint(writeData);
        if (writeFingerprint !== context.persistedFingerprint) {
          if (!records?.updateAttemptAnnotationOverlay) throw new Error('当前版本缺少复盘标注写入接口。');
          const updated = await records.updateAttemptAnnotationOverlay(
            context.recordId,
            writeData,
            annotationGuards(session, context),
          );
          if (!updated || Number(updated.previousRevision) !== context.revision ||
              Number(updated.revision) !== context.revision + 1) {
            throw new Error('复盘标注 revision 校验失败。');
          }
          context.revision = Number(updated.revision);
          context.hasOverlay = true;
          context.persistedFingerprint = writeFingerprint;
          await verifyReviewAnnotationReadback(session, context, writeFingerprint);
        } else if (context.forceReadback) {
          await verifyReviewAnnotationReadback(session, context, writeFingerprint);
        }
        context.forceReadback = false;
        if (context.latestFingerprint !== context.persistedFingerprint) context.writeAgain = true;
      }
      context.lastError = '';
      context.lastErrorShown = '';
      if (state.currentSession === session && state.runnerChildState?.submitted) {
        byId('runner-status').textContent = '已自动保存 · 本机复盘';
      }
      return true;
    };
    context.writeTail = Promise.resolve(context.writeTail).then(run, run)
      .catch((error) => {
        showAnnotationPersistenceFailure(session, error);
        throw error;
      })
      .finally(() => { context.writeActive = false; });
    return context.writeTail;
  }

  function scheduleReviewAnnotationWrite(session, immediate) {
    const context = session?.annotationContext;
    if (!context || context.latestFingerprint === context.persistedFingerprint) return;
    window.clearTimeout(context.writeTimer);
    context.writeTimer = 0;
    if (immediate) {
      enqueueReviewAnnotationWrite(session).catch(() => undefined);
      return;
    }
    context.writeTimer = window.setTimeout(() => {
      context.writeTimer = 0;
      enqueueReviewAnnotationWrite(session).catch(() => undefined);
    }, ANNOTATION_AUTOSAVE_DEBOUNCE_MS);
  }

  function stageRunnerAnnotationOverlay(session, rawOverlay, reason = 'checkpoint') {
    if (!session || !rawOverlay) return false;
    if (!session.annotationContext) {
      session.pendingAnnotationOverlay = { overlay: cloneJson(rawOverlay), reason };
      return false;
    }
    let data;
    try {
      data = annotationEnvelopeData(rawOverlay, session);
    } catch (error) {
      showAnnotationPersistenceFailure(session, error);
      return false;
    }
    const context = session.annotationContext;
    context.latestData = cloneJson(data);
    context.latestFingerprint = annotationFingerprint(data);
    context.dirty = context.latestFingerprint !== context.baseFingerprint;
    const immediateReasons = new Set([
      'question-flag', 'highlight', 'note-input', 'note-structure', 'note-blur', 'notes-close',
      'part-change', 'review-view-change', 'exit', 'restart', 'pagehide',
    ]);
    scheduleReviewAnnotationWrite(session, immediateReasons.has(String(reason || '')));
    return true;
  }

  async function flushReviewAnnotations(session, options = {}) {
    const context = session?.annotationContext;
    if (!context) throw new Error('复盘标注保存上下文尚未建立。');
    window.clearTimeout(context.writeTimer);
    context.writeTimer = 0;
    if (options.restoreData) {
      context.latestData = cloneJson(options.restoreData);
      context.latestFingerprint = annotationFingerprint(context.latestData);
      context.dirty = context.latestFingerprint !== context.baseFingerprint;
    }
    await enqueueReviewAnnotationWrite(session, { forceReadback: true });
    if (context.latestFingerprint !== context.persistedFingerprint) {
      throw new Error('复盘标注仍有尚未落盘的修改。');
    }
    return true;
  }

  function clearReviewAnnotationContext(session) {
    const context = session?.annotationContext;
    if (context) window.clearTimeout(context.writeTimer);
    if (session) {
      session.annotationContext = null;
      session.pendingAnnotationOverlay = null;
    }
  }

  function clearResumableCheckpointForSession(session) {
    if (!session || session.isReplay) return false;
    const sessions = readResumableSessions();
    const entry = sessions[session.kind];
    if (!entry || entry.snapshotHash !== session.snapshotHash || entry.runtimeStateKey !== session.runtimeStateKey ||
        (entry.attemptSessionId && session.attemptSessionId && entry.attemptSessionId !== session.attemptSessionId)) return false;
    sessions[session.kind] = null;
    writeResumableSessions(sessions);
    return true;
  }

  async function recordRunnerSubmission(childState, report, attemptSnapshot, attemptLedger, sessionOverride = null) {
    return withResumableMutationLock(() => recordRunnerSubmissionUnlocked(
      childState,
      report,
      attemptSnapshot,
      attemptLedger,
      sessionOverride,
    ));
  }

  async function recordRunnerSubmissionUnlocked(childState, report, attemptSnapshot, attemptLedger, sessionOverride = null) {
    const session = sessionOverride || state.currentSession;
    if (!session || session.isReplay || !childState?.submitted) return false;
    const submissionIdentity = childState.submissionId
      || `${session.snapshotHash}|${childState.submittedAt || ''}|${childState.attemptNumber || 1}`;
    const recordId = childState.submissionId || `submission.${session.attemptSessionId || session.sessionId}`;
    try {
      if (resumableAttemptIsDiscarded(session.attemptSessionId)) {
        state.lastRecordedSubmissionId = submissionIdentity;
        try { clearResumableCheckpointForSession(session); } catch (error) { console.warn('Could not clear the discarded checkpoint.', error); }
        if (state.currentSession?.sessionId === session.sessionId) byId('runner-status').textContent = '已放弃 · 未写入记录';
        return true;
      }
      if (session.isPendingRetry) {
        const pendingEntry = readResumableSessions()[session.kind];
        if (!pendingEntry || pendingEntry.status !== 'submitted-pending' ||
            pendingEntry.attemptSessionId !== session.attemptSessionId ||
            pendingEntry.runtimeState?.submissionId !== childState.submissionId) {
          throw new Error('这条待保存记录已被放弃或已在另一页面发生变化。');
        }
      }
      if (submissionIsDeleted(recordId)) {
        state.lastRecordedSubmissionId = submissionIdentity;
        try { clearResumableCheckpointForSession(session); } catch (error) { console.warn('Could not clear the submitted checkpoint.', error); }
        if (state.currentSession?.sessionId === session.sessionId) byId('runner-status').textContent = '已提交 · 记录已删除';
        return true;
      }
    } catch (error) {
      console.warn('Could not validate deleted-submission protection.', error);
      if (state.currentSession?.sessionId === session.sessionId) byId('runner-status').textContent = '已提交 · 记录保护异常';
      return false;
    }
    const result = childState.result || {};
    const referenceBand = session.kind === 'mock' && report?.referenceBand?.eligible
      ? Number(report.referenceBand.value)
      : null;
    const score = {
      earnedMarks: Number(result.earnedMarks || 0),
      availableMarks: Number(result.availableMarks || 0),
      answered: Number(result.answered || 0),
      total: Number(result.total || 0),
      correct: Number(result.correct || 0),
      partial: Number(result.partial || 0),
      incorrect: Number(result.incorrect || 0),
      unanswered: Number(result.unanswered || 0),
      band: Number.isFinite(referenceBand) ? referenceBand : null,
      percent: Number(result.availableMarks || 0) > 0
        ? Math.round((Number(result.earnedMarks || 0) / Number(result.availableMarks || 0)) * 1000) / 10
        : 0,
    };
    const payload = {
      recordId,
      kind: 'submission',
      mode: session.kind,
      scope: session.scope,
      sessionId: session.attemptSessionId || session.sessionId,
      releaseId: manifest.releaseId,
      month: manifest.month,
      snapshotHash: session.snapshotHash,
      packageContentVersion: session.packageContentVersion,
      passageIds: session.passageIds,
      taskIds: session.taskIds,
      contentRefs: session.passageIds.map((passageId, index) => ({
        passageId,
        taskIds: session.taskIdsByPassage?.[passageId] || [],
        titleEn: passageById.get(passageId)?.title || '',
        titleZh: passageById.get(passageId)?.titleZh || '',
        part: passageById.get(passageId)?.passagePosition || index + 1,
        frequency: frequencyFor(passageById.get(passageId)),
        difficultyLabel: difficultyMeta(passageById.get(passageId)).tier,
        difficultyScore: Number.isFinite(Number(difficultyMeta(passageById.get(passageId)).value))
          ? Number(difficultyMeta(passageById.get(passageId)).value)
          : null,
        questionTypes: taskGroupsForPassage(passageId)
          .filter((task) => session.scope !== 'task' || (session.taskIdsByPassage?.[passageId] || []).includes(task.taskId))
          .map(taskQuestionTypeLabel),
        contentRevision: manifestById.get(passageId)?.contentRevision || 1,
      })),
      startedAt: session.startedAt || childState.attemptStartedAt,
      submittedAt: childState.submittedAt || Date.now(),
      elapsedSeconds: Number(childState.elapsedSeconds || 0),
      score,
      statusCounts: {
        correct: Number(result.correct || 0),
        partial: Number(result.partial || 0),
        incorrect: Number(result.incorrect || 0),
        unanswered: Number(result.unanswered || 0),
      },
      passageResults: (result.partScores || []).map((part, index) => ({
        passageId: session.passageIds[index] || null,
        part: Number(part.part || index + 1),
        earnedMarks: Number(part.earnedMarks || 0),
        availableMarks: Number(part.availableMarks || 0),
        answered: Number(part.answered || 0),
        total: Number(part.total || 0),
        elapsedSeconds: Math.round(Number(childState.partElapsedMilliseconds?.[part.part] || 0) / 1000),
      })),
      questionOutcomes: storedQuestionOutcomes(report, session),
      attemptNumber: Number(childState.attemptNumber || 1),
      submissionReason: childState.submissionReason || 'manual',
    };
    try {
      const storedRecord = await records?.recordSubmission(payload);
      if (!storedRecord?.recordId || storedRecord.recordId !== recordId) {
        throw new Error('学习记录写入后未能通过身份校验。');
      }
      const verifiedRecords = await records.listRecords();
      const verifiedRecord = verifiedRecords.find((row) => row.recordId === recordId);
      if (!verifiedRecord || verifiedRecord.snapshotHash !== session.snapshotHash || verifiedRecord.mode !== session.kind) {
        throw new Error('学习记录写入后未能通过回读校验。');
      }
      if (!attemptSnapshot || !records?.putAttemptSnapshot || !records?.getAttemptSnapshot) {
        throw new Error('本机复盘现场缺失，已保留待保存内容。');
      }
      await records.putAttemptSnapshot(recordId, privateAttemptPayload(attemptSnapshot, attemptLedger, session));
      const verifiedSnapshot = await records.getAttemptSnapshot(recordId);
      if (!verifiedSnapshot?.payload?.runtimeState?.submitted ||
          verifiedSnapshot.payload.runtimeState.submissionId !== childState.submissionId ||
          verifiedSnapshot.payload.snapshotHash !== session.snapshotHash) {
        throw new Error('本机复盘现场写入后未能通过回读校验。');
      }
      initializeReviewAnnotationContext(session, verifiedSnapshot.payload.runtimeState, 0, false);
      state.lastRecordedSubmissionId = submissionIdentity;
      if (state.currentSession?.sessionId === session.sessionId) {
        byId('runner-status').textContent = '已提交 · 可复盘';
      }
      await refreshRecords();
      try { clearResumableCheckpointForSession(session); } catch (error) { console.warn('Could not clear the submitted checkpoint.', error); }
      return true;
    } catch (error) {
      state.lastRecordedSubmissionId = null;
      console.warn('Could not safely store the submission and replay snapshot.', error);
      if (state.currentSession?.sessionId === session.sessionId) byId('runner-status').textContent = '已提交 · 记录待保存';
      return false;
    }
  }

  function beginSubmissionPersistence(session, data) {
    const runtimeState = data.attemptSnapshot && typeof data.attemptSnapshot === 'object'
      ? data.attemptSnapshot
      : null;
    const identity = runtimeState?.submissionId
      || `${session.snapshotHash}|${runtimeState?.submittedAt || ''}|${runtimeState?.attemptNumber || 1}`;
    const current = state.submissionSave;
    if (current && current.sessionId === session.sessionId && current.identity === identity &&
        (!current.settled || current.saved)) return current;
    const tracker = {
      sessionId: session.sessionId,
      identity,
      checkpointSafe: false,
      settled: false,
      saved: false,
      promise: null,
    };
    tracker.promise = (async () => {
      if (runtimeState?.submitted) {
        try {
          await persistSessionCheckpoint(session, runtimeState, 'submitted-pending', {
            submissionReport: data.report,
            attemptLedger: data.attemptLedger,
          });
          tracker.checkpointSafe = true;
        } catch (error) {
          console.warn('Could not preserve a pending submitted checkpoint.', error);
        }
      }
      return recordRunnerSubmission(runtimeState, data.report, runtimeState, data.attemptLedger, session);
    })().then((saved) => {
        tracker.settled = true;
        tracker.saved = saved === true;
        if (!tracker.saved && tracker.checkpointSafe) renderResumableSessions();
        return tracker.saved;
      })
      .catch((error) => {
        tracker.settled = true;
        tracker.saved = false;
        console.warn('Could not process submitted runner state.', error);
        if (tracker.checkpointSafe) renderResumableSessions();
        return false;
      });
    state.submissionSave = tracker;
    return tracker;
  }

  function matchingPendingSubmission(session) {
    try {
      const entry = readResumableSessions()[session.kind];
      return Boolean(entry && entry.status === 'submitted-pending' &&
        entry.snapshotHash === session.snapshotHash &&
        entry.attemptSessionId === session.attemptSessionId);
    } catch (_error) { return false; }
  }

  async function awaitSubmissionSafety(session) {
    await Promise.resolve();
    const tracker = state.submissionSave;
    if (!tracker || tracker.sessionId !== session.sessionId) {
      throw new Error('提交结果尚未形成可验证的本机保存任务。');
    }
    const saved = await tracker.promise;
    const pendingSafe = tracker.checkpointSafe && matchingPendingSubmission(session);
    if (!saved && !pendingSafe) throw new Error('提交结果和完整复盘现场均未能安全写入。');
    return { saved, pendingSafe };
  }

  function denyRunnerRestartRequest(restartRequest = state.restartRequest) {
    const session = state.currentSession;
    const frame = byId('practice-frame');
    if (restartRequest && session?.sessionId === restartRequest.sessionId && frame?.contentWindow) {
      frame.contentWindow.postMessage({
        type: 'zyz-student-runner-restart-denied.v1',
        sessionId: restartRequest.sessionId,
        requestId: restartRequest.requestId,
      }, '*');
    }
    if (state.restartRequest === restartRequest) state.restartRequest = null;
  }

  function handleRunnerRestartRequest(sessionId, requestId) {
    const session = state.currentSession;
    const frame = byId('practice-frame');
    const normalizedRequestId = String(requestId || '').trim();
    if (!session || session.sessionId !== sessionId || !frame?.contentWindow || !normalizedRequestId) return;
    if (state.restartRequest) {
      if (state.restartRequest.requestId !== normalizedRequestId) {
        frame.contentWindow.postMessage({
          type: 'zyz-student-runner-restart-denied.v1',
          sessionId: session.sessionId,
          requestId: normalizedRequestId,
        }, '*');
      }
      return;
    }
    state.restartRequest = { sessionId, requestId: normalizedRequestId };
    openActionDialog({
      kind: 'restart-runner',
      opener: frame,
      eyebrow: 'PRACTICE',
      title: '重新开始本次练习？',
      description: '将清空本次答案、Highlights、Notes 和复盘结果，并从头开始。此操作无法撤销。',
      cancelLabel: '取消',
      confirmLabel: '重新开始',
      danger: false,
    });
  }

  async function confirmRunnerRestartRequest() {
    const restartRequest = state.restartRequest;
    const session = state.currentSession;
    const frame = byId('practice-frame');
    if (!restartRequest || !session || session.sessionId !== restartRequest.sessionId || !frame?.contentWindow) {
      throw new Error('答题会话已变更，未重新开始。');
    }
    setActionDialogStatus('正在保存复盘标注…');
    if (!session.isReplay) {
      const safety = await awaitSubmissionSafety(session);
      if (!safety.saved) {
        throw new Error('本次提交仍在“记录待保存”中，请先退出并从页面上方重试保存。');
      }
    }
    await flushReviewAnnotations(session);
    if (state.currentSession !== session || state.restartRequest !== restartRequest) {
      throw new Error('答题会话已变更，未重新开始。');
    }
    if (session.isReplay && session.isHistoricalReplay) {
      const oldReplayStorage = (() => { try { return frame.contentWindow.localStorage; } catch (_) { return null; } })();
      await startSession(session.kind, session.selections, {
        compositionMode: session.compositionMode,
        title: session.title,
        timerPolicy: session.timerPolicy,
      });
      if (state.currentSession === session || !state.currentSession || state.currentSession.isReplay) {
        throw new Error('未能按当前题库开始新练习，原复盘与已保存标注仍保留。');
      }
      for (const key of session.replayCleanupKeys || []) {
        try { oldReplayStorage?.removeItem(key); } catch (_) { /* retain isolated old replay cache if cleanup is unavailable */ }
      }
      clearReviewAnnotationContext(session);
      closeActionDialog({ restoreFocus: false, force: true });
      if (state.restartRequest === restartRequest) state.restartRequest = null;
      return;
    }
    if (session.isReplay) {
      session.isReplay = false;
      session.isResume = false;
      session.replayRecordId = '';
      session.replayCleanupKeys = [];
      session.attemptSessionId = `${Date.now().toString(36)}.restarted.${Math.random().toString(36).slice(2, 9)}`;
      session.startedAt = Date.now();
      session.lastCheckpointSavedAt = 0;
      session.checkpointWritePending = false;
      state.lastRecordedSubmissionId = null;
      state.submissionSave = null;
      clearReviewAnnotationContext(session);
      byId('runner-status').textContent = '再次练习';
      closeActionDialog({ restoreFocus: false, force: true });
      frame.contentWindow.postMessage({
        type: 'zyz-student-runner-restart-approved.v1',
        sessionId: session.sessionId,
        requestId: restartRequest.requestId,
      }, '*');
      if (state.restartRequest === restartRequest) state.restartRequest = null;
      return;
    }
    state.submissionSave = null;
    clearReviewAnnotationContext(session);
    byId('runner-status').textContent = '再次练习';
    closeActionDialog({ restoreFocus: false, force: true });
    frame.contentWindow.postMessage({
      type: 'zyz-student-runner-restart-approved.v1',
      sessionId: session.sessionId,
      requestId: restartRequest.requestId,
    }, '*');
    if (state.restartRequest === restartRequest) state.restartRequest = null;
  }

  async function exitFullscreenBeforeRunnerExit() {
    if (!document.fullscreenElement || typeof document.exitFullscreen !== 'function') return;
    try {
      await document.exitFullscreen();
    } catch (_error) { /* exitRunner still provides the existing safe confirmation path */ }
  }

  function onRunnerMessage(event) {
    const frame = byId('practice-frame');
    const data = event.data;
    if (event.source !== frame.contentWindow || !data) return;
    if (!state.currentSession || data.sessionId !== state.currentSession.sessionId) return;
    if (data.type === 'zyz-student-runner-pause-ready.v1' || data.type === 'zyz-student-runner-pause-failed.v1') {
      const pending = state.pauseRequest;
      if (!pending || pending.sessionId !== data.sessionId || pending.requestId !== data.requestId) return;
      if (data.type === 'zyz-student-runner-pause-failed.v1') {
        finishPauseRequest(null, new Error(data.message || '答题页面未能确认保存。'));
      } else if (!data.resumeSnapshot || typeof data.resumeSnapshot !== 'object') {
        finishPauseRequest(null, new Error('答题页面返回的暂停点无效。'));
      } else {
        finishPauseRequest(data.resumeSnapshot, null);
      }
      return;
    }
    if (data.type === 'zyz-student-runner-annotation.v1') {
      stageRunnerAnnotationOverlay(state.currentSession, data.annotationOverlay, data.reason);
      return;
    }
    if (data.type === 'zyz-student-runner-exit-request.v1') {
      void exitFullscreenBeforeRunnerExit().then(() => exitRunner());
      return;
    }
    if (data.type === 'zyz-student-runner-restart-request.v1') {
      handleRunnerRestartRequest(data.sessionId, data.requestId);
      return;
    }
    if (data.type !== 'zyz-student-runner-state.v1') return;
    window.clearTimeout(state.runnerReadyTimeout);
    state.runnerReadyTimeout = 0;
    state.runnerChildState = data.state && typeof data.state === 'object' ? data.state : null;
    syncRunnerZoomState({ force: true });
    if (data.annotationOverlay) {
      stageRunnerAnnotationOverlay(state.currentSession, data.annotationOverlay, 'checkpoint');
    }
    if (state.currentSession.isReplay) {
      const restored = Boolean(state.runnerChildState?.submitted)
        && state.runnerChildState?.submissionId === state.currentSession.replayRecordId;
      byId('runner-status').textContent = restored ? '已恢复 · 本机复盘' : '复盘校验失败';
      if (!restored) toast('这条记录的本机现场已失效；成绩摘要仍保留。', 5000);
      return;
    }
    if (!state.runnerChildState?.submitted && data.resumeSnapshot && typeof data.resumeSnapshot === 'object') {
      const now = Date.now();
      const session = state.currentSession;
      if ((!session.lastCheckpointSavedAt || now - session.lastCheckpointSavedAt >= 4000) && !session.checkpointWritePending) {
        session.checkpointWritePending = true;
        persistSessionCheckpoint(session, data.resumeSnapshot, 'active').then(() => {
          if (state.currentSession !== session) return;
          session.lastCheckpointSavedAt = Date.now();
          frame.contentWindow.postMessage({
            type: 'zyz-student-runner-checkpoint-accepted.v1',
            sessionId: session.sessionId,
            checkpointFingerprint: String(data.checkpointFingerprint || ''),
          }, '*');
          if (session.isResume) byId('runner-status').textContent = '已恢复 · 进度保存在本机';
        }).catch((error) => {
          if (state.currentSession !== session) return;
          console.warn('Could not update the resumable session checkpoint.', error);
          byId('runner-status').textContent = '进行中 · 本机保存待重试';
        }).finally(() => { session.checkpointWritePending = false; });
      }
    } else if (state.runnerChildState?.submitted) {
      if (state.currentSession.discardRequested) {
        state.currentSession.deferredSubmissionData = data;
        return;
      }
      beginSubmissionPersistence(state.currentSession, data);
    }
  }

  async function onResumableStorageEvent(event) {
    if (event.storageArea !== window.localStorage ||
        ![DISCARDED_RESUMABLE_ATTEMPTS_STORAGE_KEY, RESUMABLE_SESSIONS_STORAGE_KEY].includes(event.key)) return;
    let latestSessions;
    try {
      latestSessions = readResumableSessions();
      state.resumableSessions = latestSessions;
      renderResumableSessions();
    } catch (error) {
      console.warn('Could not reconcile a resumable-session change from another page.', error);
      return;
    }
    const session = state.currentSession;
    if (!session || session.isReplay) return;
    let discarded = false;
    try { discarded = resumableAttemptIsDiscarded(session.attemptSessionId); }
    catch (error) {
      console.warn('Could not validate discarded-session protection from another page.', error);
      return;
    }
    const currentEntry = latestSessions[session.kind];
    const submittedElsewhere = !state.runnerChildState?.submitted &&
      currentEntry?.attemptSessionId === session.attemptSessionId &&
      currentEntry.status === 'submitted-pending';
    if (!discarded && !submittedElsewhere) return;
    if (actionDialogIsOpen()) closeActionDialog({ restoreFocus: false, force: true });
    if (discarded) {
      try {
        await finalizeDiscardedRunner(session);
      } catch (error) {
        console.warn('Could not remove a stale discarded runtime from another page.', error);
      }
    } else {
      finalizeExitRunner({ restoreFocus: false });
    }
    route('home');
    window.requestAnimationFrame(() => document.querySelector('.brand')?.focus?.());
    toast(discarded
      ? '这次未完成内容已在另一个页面被放弃，当前旧页面已关闭。'
      : '这次作答已在另一个页面提交，当前旧页面已关闭。', 6000);
  }

  function finishPauseRequest(result, error) {
    const pending = state.pauseRequest;
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    state.pauseRequest = null;
    if (error) pending.reject(error);
    else pending.resolve(result);
  }

  function requestRunnerPauseSnapshot() {
    const session = state.currentSession;
    const frame = byId('practice-frame');
    if (!session || session.isReplay || !frame?.contentWindow) {
      return Promise.reject(new Error('当前答题页面不能创建暂停点。'));
    }
    if (state.pauseRequest) return Promise.reject(new Error('正在保存当前答题现场。'));
    const requestId = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 9)}`;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        if (state.pauseRequest?.requestId !== requestId) return;
        state.pauseRequest = null;
        reject(new Error('答题页面未在限定时间内确认保存，请留在当前页面重试。'));
      }, PAUSE_REQUEST_TIMEOUT_MS);
      state.pauseRequest = { requestId, sessionId: session.sessionId, resolve, reject, timeout };
      try {
        frame.contentWindow.postMessage({
          type: 'zyz-student-runner-pause-request.v1',
          sessionId: session.sessionId,
          requestId,
        }, '*');
      } catch (error) {
        finishPauseRequest(null, new Error(`无法请求保存当前答题现场：${error.message || error}`));
      }
    });
  }

  function finalizeExitRunner(options = {}) {
    const frame = byId('practice-frame');
    const opener = state.runnerOpener;
    byId('runner').hidden = true;
    document.body.style.overflow = '';
    resetRunnerZoomState();
    window.clearTimeout(state.runnerReadyTimeout);
    state.runnerReadyTimeout = 0;
    if (state.pauseRequest) finishPauseRequest(null, new Error('答题页面已经关闭。'));
    if (state.currentSession?.isReplay) {
      try {
        frame.contentWindow.postMessage({ type: 'zyz-student-runner-cleanup-replay.v1', sessionId: state.currentSession.sessionId }, '*');
        (state.currentSession.replayCleanupKeys || []).forEach((key) => frame.contentWindow.localStorage.removeItem(key));
      } catch (_error) { /* isolated replay storage expires with the frame */ }
    }
    clearReviewAnnotationContext(state.currentSession);
    if (!options.frameAlreadyBlank) frame.srcdoc = '<!doctype html><html><body></body></html>';
    state.runnerChildState = null;
    state.currentSession = null;
    state.submissionSave = null;
    state.restartRequest = null;
    state.runnerOpener = null;
    refreshRecords();
    renderResumableSessions();
    if (options.restoreFocus === false) return;
    window.requestAnimationFrame(() => {
      const resumeButton = options.focusResumeKind
        ? document.querySelector(`[data-resume-session="${options.focusResumeKind}"], [data-retry-submission="${options.focusResumeKind}"]`)
        : null;
      (resumeButton || opener)?.focus?.();
    });
  }

  async function finalizeDiscardedRunner(session) {
    const frame = byId('practice-frame');
    const runtimeStateKey = String(session?.runtimeStateKey || '');
    if (!session || !frame || !runtimeStateKey) throw new Error('无法识别要清理的答题现场。');
    const blankLoaded = new Promise((resolve) => {
      let settled = false;
      let timeout = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        frame.removeEventListener('load', finish);
        resolve();
      };
      frame.addEventListener('load', finish, { once: true });
      timeout = window.setTimeout(finish, 2000);
    });
    finalizeExitRunner({ restoreFocus: false });
    await blankLoaded;
    return withResumableMutationLock(() => clearUnreferencedFreshRuntimeState(runtimeStateKey));
  }

  function openRunnerExitDialog(opener = byId('practice-frame'), options = {}) {
    if (!state.currentSession || state.currentSession.isReplay) return;
    const isMock = state.currentSession.kind === 'mock';
    const timerPauseText = state.currentSession.timerPolicy?.enabled ? '计时会暂停；' : '';
    openActionDialog({
      kind: isMock ? 'exit-mock' : 'exit-practice',
      opener,
      eyebrow: isMock ? 'MOCK TEST' : 'PRACTICE',
      title: isMock ? '离开当前模考？' : '退出并暂停练习？',
      description: `选择“退出并暂停”后，${timerPauseText}当前答案、题目标记、Highlight 与 Notes 会保存在这台设备。之后可从页面上方继续${isMock ? '模考' : '练习'}；未提交内容不会计入学习记录。`,
      showBackup: false,
      alternateKind: isMock ? 'discard-active-mock-confirm' : 'discard-active-practice-confirm',
      alternateLabel: isMock ? '放弃本次模考' : '放弃本次练习',
      cancelLabel: '继续作答',
      confirmLabel: '退出并暂停',
      danger: false,
      initialFocus: options.initialFocus || 'cancel',
    });
  }

  function activeDiscardSessionKind(actionKind) {
    return ({
      'discard-active-mock-confirm': 'mock',
      'discard-active-practice-confirm': 'practice',
    })[String(actionKind || '')] || '';
  }

  function openActiveSessionDiscardConfirmation(opener = byId('action-dialog-alternate')) {
    const session = state.currentSession;
    if (!session || session.isReplay || !['mock', 'practice'].includes(session.kind)) return;
    const isMock = session.kind === 'mock';
    openActionDialog({
      kind: isMock ? 'discard-active-mock-confirm' : 'discard-active-practice-confirm',
      attemptSessionId: session.attemptSessionId,
      runtimeStateKey: session.runtimeStateKey,
      opener,
      eyebrow: isMock ? 'MOCK TEST' : 'PRACTICE',
      title: `永久放弃这次${isMock ? '模考' : '练习'}？`,
      description: '当前答案、题目标记、Highlight 与 Notes 将从这台设备删除，无法恢复，也不会生成学习记录。',
      cancelLabel: '返回',
      confirmLabel: '永久放弃',
      danger: true,
    });
  }

  function handleActionDialogCancel() {
    if (state.actionDialog.busy) return;
    if (state.actionDialog.kind === 'restart-runner') {
      const restartRequest = state.restartRequest;
      closeActionDialog({ restoreFocus: false });
      denyRunnerRestartRequest(restartRequest);
      return;
    }
    const discardKind = activeDiscardSessionKind(state.actionDialog.kind);
    if (discardKind && state.currentSession?.kind === discardKind) {
      openRunnerExitDialog(byId('practice-frame'), { initialFocus: 'alternate' });
      return;
    }
    closeActionDialog();
  }

  function handleActionDialogAlternate() {
    if (state.actionDialog.alternateKind === 'discard-review-annotations') {
      void discardReviewAnnotationChanges();
      return;
    }
    const discardKind = activeDiscardSessionKind(state.actionDialog.alternateKind);
    if (state.actionDialog.busy || !discardKind || state.currentSession?.kind !== discardKind) return;
    openActiveSessionDiscardConfirmation(byId('action-dialog-alternate'));
  }

  function openReviewExitDialog(session, opener = byId('practice-frame')) {
    const context = session?.annotationContext;
    if (!session || !context || state.currentSession !== session) return;
    openActionDialog({
      kind: 'exit-review-annotations',
      recordId: context.recordId,
      opener,
      eyebrow: 'REVIEW NOTES',
      title: '退出复盘？',
      description: '本次复盘对题目标记、Highlight 和 Notes 的修改已自动保存。若选择“放弃本次修改”，将恢复至进入复盘前的状态。',
      showBackup: false,
      alternateKind: 'discard-review-annotations',
      alternateLabel: '放弃本次修改',
      cancelLabel: '继续复盘',
      confirmLabel: '保留修改并退出',
      danger: false,
      initialFocus: 'cancel',
    });
  }

  async function requestSubmittedReviewExit(session) {
    if (!session || state.currentSession !== session) return;
    const tracker = state.submissionSave;
    if (tracker?.exitPending) return;
    if (tracker && tracker.sessionId === session.sessionId) tracker.exitPending = true;
    try {
      byId('runner-status').textContent = session.isReplay ? '正在确认复盘标注…' : '正在确认本机记录与复盘标注…';
      if (!session.isReplay) {
        const safety = await awaitSubmissionSafety(session);
        if (!safety.saved) {
          throw new Error('提交结果仍在“记录待保存”中，尚不能安全写入复盘标注。');
        }
      }
      await flushReviewAnnotations(session);
      if (state.currentSession !== session) return;
      if (session.annotationContext?.dirty) {
        openReviewExitDialog(session);
      } else {
        finalizeExitRunner();
      }
    } catch (error) {
      if (state.currentSession !== session) return;
      byId('runner-status').textContent = '复盘标注暂未保存 · 请留在当前页面';
      toast(`暂未退出：${error.message || error}`, 6500);
    } finally {
      if (state.currentSession === session && tracker) tracker.exitPending = false;
    }
  }

  async function discardReviewAnnotationChanges() {
    if (!actionDialogIsOpen() || state.actionDialog.busy ||
        state.actionDialog.kind !== 'exit-review-annotations' ||
        state.actionDialog.alternateKind !== 'discard-review-annotations') return;
    const action = { ...state.actionDialog };
    const session = state.currentSession;
    const context = session?.annotationContext;
    if (!session || !context || context.recordId !== action.recordId) return;
    setActionDialogBusy(true);
    setActionDialogStatus('正在恢复进入复盘前的题目标记、Highlight 与 Notes…');
    try {
      await flushReviewAnnotations(session, { restoreData: context.baseData });
      if (state.currentSession !== session || session.annotationContext !== context) return;
      context.dirty = false;
      closeActionDialog({ restoreFocus: false, force: true });
      finalizeExitRunner();
    } catch (error) {
      if (state.currentSession !== session || !actionDialogIsOpen()) return;
      setActionDialogStatus(`暂未退出：${error.message || error}。复盘页仍然保留。`, true);
      setActionDialogBusy(false);
    }
  }

  function exitRunner() {
    if (!state.currentSession || actionDialogIsOpen()) return;
    const submitted = Boolean(state.runnerChildState?.submitted);
    if (submitted) {
      void requestSubmittedReviewExit(state.currentSession);
      return;
    }
    if (state.currentSession.isReplay) {
      toast('复盘现场未通过提交状态校验，暂不能退出。', 6000);
      return;
    }
    openRunnerExitDialog(byId('practice-frame'));
  }

  async function confirmActionDialog() {
    if (!actionDialogIsOpen() || state.actionDialog.busy) return;
    const action = { ...state.actionDialog };
    if (action.expectedPhrase && byId('action-dialog-phrase').value !== action.expectedPhrase) return;
    setActionDialogStatus();
    setActionDialogBusy(true);
    let deletionProtection = null;
    let deletionCommitted = false;
    let activeDiscardSession = null;
    let activeDiscardCommitted = false;
    try {
      if (action.kind === 'restart-runner') {
        await confirmRunnerRestartRequest();
        return;
      }
      if (action.kind === 'exit-review-annotations') {
        const session = state.currentSession;
        const context = session?.annotationContext;
        if (!session || !context || context.recordId !== action.recordId) {
          throw new Error('当前复盘记录已经发生变化。');
        }
        setActionDialogStatus('正在回读确认题目标记、Highlight 与 Notes…');
        await flushReviewAnnotations(session);
        if (state.currentSession !== session || session.annotationContext !== context) return;
        closeActionDialog({ restoreFocus: false, force: true });
        finalizeExitRunner();
        return;
      }
      const activeDiscardKind = activeDiscardSessionKind(action.kind);
      if (activeDiscardKind) {
        const session = state.currentSession;
        const modeLabel = activeDiscardKind === 'mock' ? '模考' : '练习';
        if (!session || session.kind !== activeDiscardKind || session.isReplay) {
          throw new Error(`当前页面没有可以放弃的${modeLabel}。`);
        }
        if (session.attemptSessionId !== action.attemptSessionId ||
            session.runtimeStateKey !== action.runtimeStateKey) {
          throw new Error(`这次${modeLabel}的答题会话已变更，未执行删除。`);
        }
        activeDiscardSession = session;
        setActionDialogStatus('正在验证并删除本机答题现场…');
        if (state.runnerChildState?.submitted) {
          throw new Error(`这次${modeLabel}已经提交，不能作为未完成${modeLabel}放弃。`);
        }
        session.discardRequested = true;
        session.deferredSubmissionData = null;
        const discarded = await discardResumableSessionAndPendingRecord(activeDiscardKind, {
          attemptSessionId: action.attemptSessionId,
          runtimeStateKey: action.runtimeStateKey,
          pendingSubmission: false,
        });
        if (!discarded?.discarded) throw new Error(`浏览器未能确认这次${modeLabel}已删除。`);
        activeDiscardCommitted = true;
        if (state.currentSession !== activeDiscardSession) return;
        closeActionDialog({ restoreFocus: false, force: true });
        await finalizeDiscardedRunner(activeDiscardSession);
        route('home');
        window.requestAnimationFrame(() => document.querySelector('.brand')?.focus?.());
        toast(`本次${modeLabel}已放弃，未生成记录。`, 5000);
        return;
      }
      if (action.kind === 'exit-mock' || action.kind === 'exit-practice') {
        const session = state.currentSession;
        if (!session || session.isReplay) throw new Error('当前答题页面不能创建暂停点。');
        setActionDialogStatus('正在暂停计时并验证本机进度…');
        const runtimeState = await requestRunnerPauseSnapshot();
        if (state.currentSession !== session) throw new Error('答题会话在保存过程中发生变化。');
        if (runtimeState.submitted) {
          setActionDialogStatus('提交已完成，正在验证学习记录与本机复盘…');
          const submissionSafety = await awaitSubmissionSafety(session);
          closeActionDialog({ restoreFocus: false, force: true });
          finalizeExitRunner({ focusResumeKind: submissionSafety.saved ? '' : session.kind });
          if (!submissionSafety.saved) toast('提交已完成；学习记录仍待保存，可从页面上方重试。', 6000);
          return;
        }
        await persistSessionCheckpoint(session, runtimeState, 'paused');
        closeActionDialog({ restoreFocus: false, force: true });
        finalizeExitRunner({ focusResumeKind: session.kind });
        toast(`${session.kind === 'mock' ? '模考' : '练习'}已暂停，答案、题目标记、Highlight 与 Notes 已保存在本机。`, 5000);
        return;
      }
      if (action.kind === 'discard-resumable-session') {
        const kind = resumableKind(action.recordId);
        if (!kind) throw new Error('未完成内容的模式无效。');
        const pendingBefore = state.resumableSessions[kind]?.status === 'submitted-pending';
        setActionDialogStatus(pendingBefore ? '正在删除这条待保存记录…' : '正在删除这次未完成内容…');
        const discardResult = await discardResumableSessionAndPendingRecord(kind, {
          attemptSessionId: action.attemptSessionId,
          submissionId: action.submissionId,
          runtimeStateKey: action.runtimeStateKey,
          pendingSubmission: action.pendingSubmission,
        });
        const pendingSubmission = discardResult.pendingSubmission;
        closeActionDialog({ restoreFocus: false, force: true });
        toast(pendingSubmission
          ? `已放弃这条待保存的${kind === 'mock' ? '模考' : '练习'}记录。`
          : `已放弃这次未完成的${kind === 'mock' ? '模考' : '练习'}。`);
        return;
      }
      if (action.kind === 'delete-record') {
        const visibleRows = sortedSubmissionRecords().filter((row) => recordMatchesFilter(row, state.recordFilter));
        const targetIndex = Math.max(0, visibleRows.findIndex((row) => row.recordId === action.recordId));
        const targetRow = visibleRows.find((row) => row.recordId === action.recordId) || recordById(action.recordId);
        if (!targetRow) throw new Error('这条记录已经不存在。');
        deletionProtection = protectDeletedSubmissions([targetRow.recordId]);
        const result = await records.deleteSubmission(action.recordId);
        deletionCommitted = Boolean(result?.deleted);
        if (!result?.deleted || !result?.verified) throw new Error('这条记录未能通过安全删除验证。');
        let runtimeCleanupWarning = '';
        try { removeDeletedOrdinaryRuntimeStates([targetRow]); } catch (error) { runtimeCleanupWarning = error.message || String(error); }
        closeActionDialog({ restoreFocus: false, force: true });
        await refreshRecords();
        toast(runtimeCleanupWarning
          ? `记录和复盘已删除；${runtimeCleanupWarning} 删除保护仍会阻止它重新出现。`
          : '这条记录及其本机复盘现场已删除。', 6000);
        window.requestAnimationFrame(() => {
          const triggers = [...document.querySelectorAll('.record-more-trigger')];
          (triggers[Math.min(targetIndex, Math.max(0, triggers.length - 1))] || byId('recent-records-title'))?.focus?.();
        });
        return;
      }
      if (action.kind === 'clear-records') {
        const submittedRows = sortedSubmissionRecords();
        deletionProtection = protectDeletedSubmissions(submittedRows.map((row) => row.recordId));
        const result = await records.clearAll({ includePreferences: false });
        deletionCommitted = Boolean(result?.cleared || result?.primaryStoreCleared);
        if (!result?.cleared || !result?.verified || !result?.preferencesPreserved) {
          throw new Error('本机记录未能通过完整清空验证。');
        }
        let runtimeCleanupWarning = '';
        try { removeDeletedOrdinaryRuntimeStates(submittedRows); } catch (error) { runtimeCleanupWarning = error.message || String(error); }
        closeActionDialog({ restoreFocus: false, force: true });
        await refreshRecords();
        toast(runtimeCleanupWarning
          ? `已清空 ${Number(result.deletedRecordCount || 0)} 条记录；${runtimeCleanupWarning} 删除保护仍会阻止旧记录重新出现。`
          : `已清空 ${Number(result.deletedRecordCount || 0)} 条本机学习记录；界面偏好已保留。`, 6000);
        window.requestAnimationFrame(() => byId('clear-records')?.focus?.());
        return;
      }
      throw new Error('无法识别这项确认操作。');
    } catch (error) {
      const failedDiscardKind = activeDiscardSessionKind(action.kind);
      if (failedDiscardKind && !activeDiscardCommitted && activeDiscardSession &&
          state.currentSession !== activeDiscardSession) {
        console.warn('旧答题会话的放弃操作已结束，不更新当前页面。', error);
        return;
      }
      if (failedDiscardKind && activeDiscardCommitted && state.currentSession === null) {
        route('home');
        window.requestAnimationFrame(() => document.querySelector('.brand')?.focus?.());
        toast(`本次${failedDiscardKind === 'mock' ? '模考' : '练习'}已放弃；本机现场清理未能完整确认，请刷新页面。`, 7000);
        console.warn('放弃已生效，但答题页收尾清理失败。', error);
        return;
      }
      if (failedDiscardKind && !activeDiscardCommitted && activeDiscardSession &&
          state.currentSession === activeDiscardSession &&
          activeDiscardSession.kind === failedDiscardKind &&
          activeDiscardSession.attemptSessionId === action.attemptSessionId) {
        const session = activeDiscardSession;
        const deferredSubmissionData = session.deferredSubmissionData;
        session.discardRequested = false;
        session.deferredSubmissionData = null;
        if (deferredSubmissionData?.state?.submitted) beginSubmissionPersistence(session, deferredSubmissionData);
      }
      let rollbackMessage = '';
      const mutationRollbackUnverified = error?.clearRollbackVerified === false || error?.deleteRollbackVerified === false;
      if (deletionProtection && !deletionCommitted && !mutationRollbackUnverified) {
        try { rollbackDeletedSubmissionProtection(deletionProtection); }
        catch (rollbackError) { rollbackMessage = `；${rollbackError.message || rollbackError}`; }
      } else if (deletionProtection && !deletionCommitted && mutationRollbackUnverified) {
        rollbackMessage = '；原数据回滚未能确认，已保留删除保护以防旧记录重新出现';
      }
      const prefix = action.kind === 'exit-mock' || action.kind === 'exit-practice' || action.kind === 'exit-review-annotations'
        ? '暂未退出：浏览器未能完整保存当前进度。答题页仍然保留'
        : failedDiscardKind
          ? activeDiscardCommitted
            ? `本次${failedDiscardKind === 'mock' ? '模考' : '练习'}已安全删除，但页面未能完成返回；请刷新页面`
            : `暂未放弃：浏览器未能安全删除当前${failedDiscardKind === 'mock' ? '模考' : '练习'}。答题页仍然保留`
        : '操作未完成';
      setActionDialogStatus(`${prefix}：${error.message || error}${rollbackMessage}`, true);
      setActionDialogBusy(false);
    }
  }

  function formatDuration(seconds) {
    const value = Math.max(0, Number(seconds || 0));
    if (value < 60) return `${Math.round(value)} 秒`;
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    return hours ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`;
  }

  function selectionsFromRecord(row, snapshotPayload) {
    const storedSelections = Array.isArray(snapshotPayload?.selections) ? snapshotPayload.selections : [];
    const scope = snapshotPayload?.compositionMode === 'task-drill' || row.scope === 'task' ? 'task' : 'full';
    const passageIds = Array.isArray(row.passageIds) ? row.passageIds : [];
    const selections = storedSelections.length ? storedSelections : passageIds.map((passageId) => {
      const ref = (row.contentRefs || []).find((item) => item.passageId === passageId) || {};
      const taskIds = Array.isArray(ref.taskIds) ? ref.taskIds : ref.taskId ? [ref.taskId] : [];
      return { passageId, scope, ...(taskIds.length ? { taskIds } : {}) };
    });
    if (!selections.length || selections.length > 3) throw new Error('记录缺少可恢复的篇章信息。');
    selections.forEach((selection) => {
      const passage = passageById.get(selection.passageId);
      if (!passage) throw new Error('记录中的文章已不在当前练习包。');
      if (scope === 'task') {
        const taskIds = Array.isArray(selection.taskIds) ? selection.taskIds : selection.taskId ? [selection.taskId] : [];
        const validIds = new Set((passage.composition?.taskGroups || []).map((task) => task.taskId));
        if (!taskIds.length || taskIds.some((taskId) => !validIds.has(taskId))) throw new Error('记录中的题型已不在当前练习包。');
      }
    });
    return selections.map((selection) => normalizedSelection({ ...selection, scope })).filter(Boolean);
  }

  async function reopenAttempt(recordId) {
    const row = selectedSubmissionRecords().find((item) => item.recordId === recordId);
    if (!row) return toast('没有找到这条提交记录。');
    if (!records?.getAttemptSnapshot) return toast('当前版本只保留了成绩摘要，尚不能打开完整现场。', 5000);
    try {
      const stored = await records.getAttemptSnapshot(recordId);
      if (!stored?.payload?.runtimeState) {
        toast('这是一条旧记录，没有保存答案、Highlight 与 Notes 的完整现场。', 6000);
        return;
      }
      if (stored.payload.snapshotHash !== row.snapshotHash) throw new Error('本机现场与成绩记录的版本不一致。');
      if (!stored.payload.runtimeState.submitted || stored.payload.runtimeState.submissionId !== row.recordId) {
        throw new Error('本机现场无法通过提交身份校验。');
      }
      const selections = selectionsFromRecord(row, stored.payload);
      startSession(row.mode === 'mock' ? 'mock' : 'practice', selections, {
        compositionMode: stored.payload.compositionMode || (row.scope === 'task' ? 'task-drill' : 'full-passage'),
        title: stored.payload.requestTitle || undefined,
        expectedSnapshotHash: row.snapshotHash,
        expectedPackageContentVersion: stored.payload.packageContentVersion,
        replayRecordId: row.recordId,
        timerPolicy: stored.payload.timerPolicy || { enabled: false, durationSeconds: 0, expiryAction: 'continue' },
      });
    } catch (error) {
      toast(`无法复盘：${error.message || error}`, 6000);
    }
  }

  function finiteRecordNumber(value, fallback = 0) {
    if (value === null || value === undefined || value === '') return fallback;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function scoreNumbers(row) {
    const score = row?.score || {};
    return {
      earned: Math.max(0, finiteRecordNumber(score.earnedMarks ?? row?.earnedMarks)),
      available: Math.max(0, finiteRecordNumber(score.availableMarks ?? row?.availableMarks ?? row?.total)),
      answered: Math.max(0, finiteRecordNumber(score.answered,
        (row?.passageResults || []).reduce((sum, item) => sum + finiteRecordNumber(item?.answered), 0))),
    };
  }

  /* BEGIN T47R3 HOME BAND CONVERTER AUTHORITY — BUILD-EXTRACTED FROM LOCKED RUNNER MODULE */
  const ACADEMIC_READING_BAND_THRESHOLDS = Object.freeze([
    Object.freeze({ minimum: 39, band: 9 }),
    Object.freeze({ minimum: 37, band: 8.5 }),
    Object.freeze({ minimum: 35, band: 8 }),
    Object.freeze({ minimum: 33, band: 7.5 }),
    Object.freeze({ minimum: 30, band: 7 }),
    Object.freeze({ minimum: 27, band: 6.5 }),
    Object.freeze({ minimum: 23, band: 6 }),
    Object.freeze({ minimum: 20, band: 5.5 }),
    Object.freeze({ minimum: 16, band: 5 }),
    Object.freeze({ minimum: 13, band: 4.5 }),
    Object.freeze({ minimum: 10, band: 4 }),
    Object.freeze({ minimum: 7, band: 3.5 }),
    Object.freeze({ minimum: 5, band: 3 }),
    Object.freeze({ minimum: 3, band: 2.5 }),
    Object.freeze({ minimum: 2, band: 2 }),
    Object.freeze({ minimum: 1, band: 1 }),
    Object.freeze({ minimum: 0, band: 0 }),
  ]);

  function academicReadingBand(rawScore) {
    if (typeof rawScore !== 'number' || !Number.isInteger(rawScore) || rawScore < 0 || rawScore > 40) return null;
    const score = rawScore;
    const match = ACADEMIC_READING_BAND_THRESHOLDS.find((entry) => score >= entry.minimum);
    return match ? match.band : null;
  }
  /* END T47R3 HOME BAND CONVERTER AUTHORITY */

  /* BEGIN T45R1 MOCK BAND RECORD CARD */
  const RECORD_BAND_NOTE = '按 IELTS Academic Reading 公开典型换算估算，实际试卷分界可能略有不同。';

  function recordBandValue(row, score = scoreNumbers(row)) {
    if (row?.mode !== 'mock' || score.available !== 40 ||
        !Number.isInteger(score.earned) || score.earned < 0 || score.earned > 40) return null;
    const rawStored = row?.score?.band;
    const stored = rawStored === null || rawStored === undefined || rawStored === ''
      ? null
      : Number(rawStored);
    if (Number.isFinite(stored) && stored >= 0 && stored <= 9) return stored;
    const estimated = academicReadingBand(score.earned);
    return Number.isFinite(estimated) ? estimated : null;
  }
  /* END T45R1 MOCK BAND RECORD CARD */

  function isCompleteMockRecord(row) {
    const score = scoreNumbers(row);
    return row?.mode === 'mock' && score.available === 40;
  }

  function originalPassagePart(row, item) {
    const passageId = String(item?.passageId || '');
    const storedRef = passageId
      ? (Array.isArray(row?.contentRefs) ? row.contentRefs : []).find((ref) => ref?.passageId === passageId)
      : null;
    const catalogPart = Number(storedRef?.part ?? passageById.get(passageId)?.passagePosition);
    if ([1, 2, 3].includes(catalogPart)) return catalogPart;
    const runtimePart = Number(item?.part);
    return recordPassageIds(row).length === 3 && [1, 2, 3].includes(runtimePart) ? runtimePart : null;
  }

  function passageScoresForRecord(row) {
    const scores = new Map();
    const directPassageIds = new Set();
    const directPartsWithoutIds = new Set();
    (Array.isArray(row?.passageResults) ? row.passageResults : []).forEach((item, index) => {
      const part = originalPassagePart(row, item);
      const available = finiteRecordNumber(item?.availableMarks);
      if (![1, 2, 3].includes(part) || available <= 0) return;
      const passageId = String(item?.passageId || '');
      const key = passageId ? `passage:${passageId}` : `direct:${part}:${index}`;
      const current = scores.get(key) || { passageId: passageId || '', part, earned: 0, available: 0 };
      current.earned += Math.max(0, finiteRecordNumber(item?.earnedMarks));
      current.available += Math.max(0, available);
      scores.set(key, current);
      if (passageId) directPassageIds.add(passageId);
      else directPartsWithoutIds.add(part);
    });
    (Array.isArray(row?.questionOutcomes) ? row.questionOutcomes : []).forEach((item) => {
      const part = originalPassagePart(row, item);
      const passageId = String(item?.passageId || '');
      if (![1, 2, 3].includes(part)
        || (passageId && directPassageIds.has(passageId))
        || (!passageId && directPartsWithoutIds.has(part))) return;
      const available = Math.max(0, finiteRecordNumber(item?.availableMarks));
      if (available <= 0) return;
      const key = passageId ? `fallback:${passageId}` : `fallback:${part}`;
      const current = scores.get(key) || { passageId: passageId || '', part, earned: 0, available: 0 };
      current.earned += Math.max(0, finiteRecordNumber(item?.earnedMarks));
      current.available += available;
      scores.set(key, current);
    });
    return Array.from(scores.values()).filter((item) => item.available > 0);
  }

  function partScoresForRecord(row) {
    const parts = new Map();
    passageScoresForRecord(row).forEach((item) => {
      const current = parts.get(item.part) || { earned: 0, available: 0 };
      current.earned += item.earned;
      current.available += item.available;
      parts.set(item.part, current);
    });
    return parts;
  }

  function aggregateRecordRows(rows) {
    const completePassageIds = new Set();
    const perfectPassageIds = new Set();
    const totals = {
      rows,
      recordCount: rows.length,
      completionCount: rows.length,
      elapsedSeconds: 0,
      answered: 0,
      earned: 0,
      available: 0,
      accuracy: null,
      fullMockCount: 0,
      mockAverage: null,
      completePassageCount: 0,
      perfectPassageCount: 0,
      parts: {
        1: { earned: 0, available: 0, percent: null },
        2: { earned: 0, available: 0, percent: null },
        3: { earned: 0, available: 0, percent: null },
      },
    };
    let fullMockEarned = 0;
    rows.forEach((row) => {
      const score = scoreNumbers(row);
      totals.elapsedSeconds += Math.max(0, finiteRecordNumber(row?.elapsedSeconds));
      totals.answered += score.answered;
      totals.earned += score.earned;
      totals.available += score.available;
      if (isCompleteMockRecord(row)) {
        totals.fullMockCount += 1;
        fullMockEarned += score.earned;
      }
      partScoresForRecord(row).forEach((value, part) => {
        totals.parts[part].earned += value.earned;
        totals.parts[part].available += value.available;
      });
      passageScoresForRecord(row).forEach((value) => {
        if (row?.scope === 'task' || !value.passageId) return;
        const passage = passageById.get(value.passageId);
        const expectedMarks = passage
          ? finiteRecordNumber(passage?.maxMarks ?? passage?.questionCount)
          : [13, 14].includes(value.available) ? value.available : 0;
        if (expectedMarks <= 0 || value.available !== expectedMarks) return;
        completePassageIds.add(value.passageId);
        if (Math.abs(value.earned - value.available) < 1e-9) perfectPassageIds.add(value.passageId);
      });
    });
    totals.completePassageCount = completePassageIds.size;
    totals.perfectPassageCount = perfectPassageIds.size;
    totals.accuracy = totals.available > 0 ? (totals.earned / totals.available) * 100 : null;
    totals.mockAverage = totals.fullMockCount > 0 ? fullMockEarned / totals.fullMockCount : null;
    [1, 2, 3].forEach((part) => {
      const item = totals.parts[part];
      item.percent = item.available > 0 ? (item.earned / item.available) * 100 : null;
    });
    return totals;
  }

  function compactDecimal(value, digits = 1) {
    if (value === null || value === undefined || value === '') return '—';
    if (!Number.isFinite(Number(value))) return '—';
    const rounded = Math.round(Number(value) * (10 ** digits)) / (10 ** digits);
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(digits);
  }

  function percentLabel(value) {
    if (value === null || value === undefined || value === '') return '—';
    return Number.isFinite(Number(value)) ? `${compactDecimal(value)}%` : '—';
  }

  function recordTimestampLabel(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const pad = (part) => String(part).padStart(2, '0');
    return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} · ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function sortedSubmissionRecords() {
    return selectedSubmissionRecords().sort((a, b) => Date.parse(b.submittedAt || b.updatedAt || 0) - Date.parse(a.submittedAt || a.updatedAt || 0));
  }

  function recordMatchesFilter(row, filter) {
    if (filter === 'mock') return row?.mode === 'mock';
    if (filter === 'practice') return row?.mode !== 'mock';
    return true;
  }

  /* BEGIN T49 RECORD PASSAGE METADATA CONTRACT */
  function recordPassageMetadata(passageId) {
    const passage = typeof passageId === 'string' ? passageById.get(passageId) : null;
    if (!passage) return null;

    const manifestFrequency = manifestById.get(passageId)?.frequency;
    const libraryFrequencyTier = passage.monthlyFrequency?.frequency_tier;
    const manifestHasFrequency = ['high', 'medium', 'low'].includes(manifestFrequency);
    const libraryHasFrequency = ['高频', '中频', '低频'].includes(libraryFrequencyTier);
    const frequency = manifestHasFrequency || (!manifestFrequency && libraryHasFrequency)
      ? frequencyFor(passage)
      : null;
    const safeFrequency = ['high', 'medium', 'low'].includes(frequency) ? frequency : null;

    const rawDifficulty = passage.difficulty_current;
    const numericDifficulty = rawDifficulty === null || rawDifficulty === undefined || rawDifficulty === ''
      ? Number.NaN
      : Number(rawDifficulty);
    const candidateDifficulty = Number.isFinite(numericDifficulty) ? difficultyMeta(passage) : null;
    const safeDifficulty = candidateDifficulty
      && ['easy', 'standard', 'hard'].includes(candidateDifficulty.key)
      && ['偏易', '标准', '偏难'].includes(candidateDifficulty.tier)
      && Number.isFinite(Number(candidateDifficulty.value))
      ? candidateDifficulty
      : null;

    return safeFrequency || safeDifficulty ? { frequency: safeFrequency, difficulty: safeDifficulty } : null;
  }

  function recordPassageMetadataMarkup(passageId) {
    const metadata = recordPassageMetadata(passageId);
    if (!metadata) return '';
    const frequencyMarkup = metadata.frequency
      ? `<span class="meta-pill metadata-pill metadata-pill--frequency-${metadata.frequency} frequency-${metadata.frequency}">${frequencyLabel(metadata.frequency)}</span>`
      : '';
    const difficultyMarkup = metadata.difficulty
      ? `<span class="meta-pill metadata-pill metadata-pill--difficulty-${metadata.difficulty.key} difficulty-${metadata.difficulty.key}">${htmlEscape(metadata.difficulty.tier)} · ${metadata.difficulty.value}</span>`
      : '';
    if (!frequencyMarkup && !difficultyMarkup) return '';
    return `<div class="record-passage-metadata metadata-pills" data-meta-component="record-passage-metadata" data-meta-size="record" data-meta-order="frequency,difficulty" data-record-passage-id="${htmlEscape(passageId)}" aria-label="文章频率与难度">${frequencyMarkup}${difficultyMarkup}</div>`;
  }
  /* END T49 RECORD PASSAGE METADATA CONTRACT */

  function renderRecords() {
    const allRows = sortedSubmissionRecords();
    const filter = ['all', 'practice', 'mock'].includes(state.recordFilter) ? state.recordFilter : 'all';
    state.recordFilter = filter;
    const rows = allRows.filter((row) => recordMatchesFilter(row, filter));
    const summary = aggregateRecordRows(allRows);
    const recordCounts = {
      all: allRows.length,
      practice: allRows.filter((row) => row?.mode !== 'mock').length,
      mock: allRows.filter((row) => row?.mode === 'mock').length,
    };
    const hasRecords = summary.recordCount > 0;
    byId('record-time').textContent = hasRecords ? formatDuration(summary.elapsedSeconds) : '—';
    byId('record-questions').textContent = hasRecords ? `${summary.answered} 题` : '—';
    byId('record-attempts').textContent = hasRecords ? `${summary.recordCount} 次完成` : '—';
    byId('record-accuracy').textContent = percentLabel(summary.accuracy);
    byId('record-mock-count').textContent = summary.mockAverage === null
      ? '—'
      : `${compactDecimal(summary.mockAverage)} / 40`;
    const mockAverage = summary.mockAverage === null ? '平均 —' : `平均 ${compactDecimal(summary.mockAverage)} / 40`;
    byId('record-mock-average').textContent = mockAverage;
    byId('record-side-mock-average').textContent = summary.mockAverage === null ? '—' : `${compactDecimal(summary.mockAverage)} / 40`;
    byId('record-filter-all-count').textContent = String(recordCounts.all);
    byId('record-filter-practice-count').textContent = String(recordCounts.practice);
    byId('record-filter-mock-count').textContent = String(recordCounts.mock);
    byId('record-filter').querySelectorAll('[data-record-filter]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.recordFilter === filter));
    });
    byId('record-list-count').textContent = filter === 'all'
      ? `共 ${rows.length} 次`
      : `${filter === 'mock' ? '模考' : '练习'} · ${rows.length} 次`;
    [1, 2, 3].forEach((part) => {
      const value = summary.parts[part].percent;
      byId(`record-p${part}-accuracy`).textContent = percentLabel(value);
      byId(`record-p${part}-bar`).style.width = `${Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0}%`;
    });
    byId('record-list').innerHTML = rows.length ? rows.map((row, rowIndex) => {
      const score = scoreNumbers(row);
      const referenceBand = recordBandValue(row, score);
      const submittedAt = new Date(row.submittedAt || row.updatedAt || Date.now());
      const actionsId = `record-actions-${rowIndex + 1}`;
      return `<article class="record-card">
        <header class="record-card-header">
          <div class="record-card-timestamp"><span class="record-mode">${row.mode === 'mock' ? '模考' : '练习'}</span><span class="record-card-when"><time datetime="${htmlEscape(submittedAt.toISOString())}">${htmlEscape(recordTimestampLabel(submittedAt))}</time><span class="record-card-elapsed">用时 ${htmlEscape(formatDuration(row.elapsedSeconds))}</span></span></div>
          <strong class="record-card-score">${score.earned}/${score.available}${referenceBand === null ? '' : `<small class="record-card-band" title="${htmlEscape(RECORD_BAND_NOTE)}" aria-label="参考 Band ${referenceBand.toFixed(1)}；${htmlEscape(RECORD_BAND_NOTE)}">参考 Band <span class="record-card-band-value">${referenceBand.toFixed(1)}</span></small>`}</strong>
        </header>
        <div class="record-passage-list" aria-label="本次篇章">${recordPassageTitleItems(row).map((item) => {
          const partLabel = item.part ? `P${item.part}` : '篇';
          const partClass = item.part ? `record-passage-part-p${item.part}` : 'record-passage-part-unknown';
          return `<div class="record-passage-line"><span class="record-passage-part ${partClass}">${partLabel}</span><div class="record-passage-copy"><strong>${htmlEscape(item.titleEn)}</strong>${item.titleZh ? `<small>${htmlEscape(item.titleZh)}</small>` : ''}${recordPassageMetadataMarkup(item.passageId)}</div></div>`;
        }).join('')}</div>
        <div class="record-card-actions">
          <button class="record-replay" type="button" data-action="reopen-attempt" data-record-id="${htmlEscape(row.recordId)}">查看复盘</button>
          <div class="record-more">
            <button class="record-more-trigger" type="button" data-action="toggle-record-menu" data-record-id="${htmlEscape(row.recordId)}" aria-controls="${actionsId}" aria-expanded="false" aria-label="更多记录操作"><span aria-hidden="true">···</span></button>
            <div id="${actionsId}" class="record-more-menu" hidden><button type="button" data-action="delete-record" data-record-id="${htmlEscape(row.recordId)}">删除这条记录</button></div>
          </div>
        </div>
      </article>`;
    }).join('') : `<div class="empty-records">${filter === 'all' ? '尚无提交记录' : `暂无${filter === 'mock' ? '模考' : '练习'}记录`}</div>`;
  }

  function recordById(recordId) {
    return selectedSubmissionRecords().find((row) => row.recordId === recordId) || null;
  }

  function recordPassageTitleItems(row) {
    const items = recordPassageIds(row).map((id) => {
      const passage = passageById.get(id);
      const stored = (row?.contentRefs || []).find((ref) => ref?.passageId === id);
      const titleEn = stored?.titleEn || passage?.title || '历史练习内容（题库已更新）';
      const titleZh = stored?.titleZh || passage?.titleZh || '';
      return { passageId: id, part: originalPassagePart(row, { passageId: id }), titleEn, titleZh };
    }).filter(Boolean);
    return items.length ? items : [{ passageId: '', part: null, titleEn: '历史练习内容（题库已更新）', titleZh: '' }];
  }

  function recordTitleItems(row) {
    return recordPassageTitleItems(row).map((item) => item.titleZh
      ? `${item.titleEn}（${item.titleZh}）`
      : item.titleEn);
  }

  function recordTitles(row) {
    return recordTitleItems(row).join(' · ') || '历史练习内容（题库已更新）';
  }

  function recordPercent(row) {
    const rawStored = row?.score?.percent;
    const stored = Number(rawStored);
    if (rawStored !== null && rawStored !== undefined && rawStored !== '' && Number.isFinite(stored)) return stored;
    const earned = Number(row?.score?.earnedMarks || 0);
    const available = Number(row?.score?.availableMarks || 0);
    return available > 0 ? Math.round((earned / available) * 1000) / 10 : 0;
  }

  function downloadText(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function roundedRectPath(context, x, y, width, height, radius) {
    const r = Math.min(Math.max(0, radius), width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function fillRoundedRect(context, x, y, width, height, radius, fillStyle) {
    context.save();
    context.fillStyle = fillStyle;
    roundedRectPath(context, x, y, width, height, radius);
    context.fill();
    context.restore();
  }

  function wrappedCanvasText(context, text, x, y, maxWidth, lineHeight, maxLines = Number.POSITIVE_INFINITY) {
    const tokens = String(text || '').match(/[A-Za-z0-9À-ž’'\-–—]+|\s+|./gu) || [];
    const lines = [];
    let line = '';
    tokens.forEach((token) => {
      const candidate = `${line}${token}`.replace(/^\s+/, '');
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line.trimEnd());
        line = token.replace(/^\s+/, '');
      } else line = candidate;
    });
    if (line || !lines.length) lines.push(line.trimEnd());
    const visible = lines.slice(0, maxLines);
    if (lines.length > maxLines && visible.length) {
      let last = `${visible[visible.length - 1]}…`;
      while (last.length > 1 && context.measureText(last).width > maxWidth) last = `${last.slice(0, -2)}…`;
      visible[visible.length - 1] = last;
    }
    visible.forEach((value, index) => context.fillText(value, x, y + index * lineHeight));
    return y + visible.length * lineHeight;
  }

  function renderLegacyAchievementCanvas(row) {
    const canvas = byId('achievement-canvas');
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !row) return;
    const score = row.score || {};
    const earned = Number(score.earnedMarks || 0);
    const available = Number(score.availableMarks || 0);
    const answered = Number(score.answered || 0);
    const total = Number(score.total ?? score.availableMarks ?? 0);
    const percent = recordPercent(row);
    const completion = total > 0 ? Math.min(100, Math.round((answered / total) * 100)) : 0;
    const titles = recordTitleItems(row);
    const submittedAt = new Date(row.submittedAt || row.updatedAt || Date.now());
    const dateLabel = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(submittedAt);
    const modeLabel = row.mode === 'mock' ? '阅读模考' : '阅读练习';
    const colors = { bg: '#f7f3f1', navy: '#17485a', teal: '#2f7f78', rose: '#df9b9e', ink: '#172832', muted: '#687780', line: '#d8e1e3', white: '#ffffff' };

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = colors.bg;
    context.fillRect(0, 0, canvas.width, canvas.height);
    fillRoundedRect(context, 68, 64, 944, 1222, 44, colors.white);

    fillRoundedRect(context, 112, 108, 118, 78, 24, colors.navy);
    context.fillStyle = colors.white;
    context.font = '700 34px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('ZYZ', 171, 147);
    context.textAlign = 'left';
    context.fillStyle = colors.navy;
    context.font = '700 34px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
    context.fillText('ZYZ READING WALKS', 258, 135);
    context.fillStyle = colors.muted;
    context.font = '500 24px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
    context.fillText(`${dateLabel} · ${modeLabel}`, 258, 174);

    context.fillStyle = colors.ink;
    context.font = '700 52px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
    context.textBaseline = 'alphabetic';
    context.fillText('今天的阅读练习完成了', 112, 282);
    context.fillStyle = colors.muted;
    context.font = '400 25px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
    context.fillText('每一次认真作答，都在把阅读走得更稳。', 112, 326);

    fillRoundedRect(context, 112, 374, 410, 258, 32, colors.navy);
    context.fillStyle = '#d9eeeb';
    context.font = '600 25px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
    context.fillText('本次正确率', 150, 426);
    context.fillStyle = colors.white;
    context.font = '700 92px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    context.fillText(`${percent}%`, 148, 532);
    context.fillStyle = '#d9eeeb';
    context.font = '500 27px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
    context.fillText(`得分 ${earned}/${available}`, 150, 590);

    fillRoundedRect(context, 546, 374, 422, 258, 32, '#edf5f4');
    const statRows = [
      ['完成进度', `${answered}/${total}`],
      ['主动用时', formatDuration(row.elapsedSeconds)],
      ['练习篇章', `${Math.max(1, recordPassageIds(row).length)} 篇`],
    ];
    statRows.forEach(([label, value], index) => {
      const y = 428 + index * 67;
      context.fillStyle = colors.muted;
      context.font = '500 23px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
      context.fillText(label, 582, y);
      context.fillStyle = colors.ink;
      context.font = '700 28px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
      context.textAlign = 'right';
      context.fillText(value, 930, y);
      context.textAlign = 'left';
    });

    context.fillStyle = colors.ink;
    context.font = '700 28px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
    context.fillText('答题完成度', 112, 708);
    context.fillStyle = colors.muted;
    context.font = '600 24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    context.textAlign = 'right';
    context.fillText(`${completion}%`, 968, 708);
    context.textAlign = 'left';
    fillRoundedRect(context, 112, 736, 856, 24, 12, '#e6ecee');
    if (completion > 0) fillRoundedRect(context, 112, 736, Math.max(24, 856 * completion / 100), 24, 12, colors.rose);

    context.fillStyle = colors.ink;
    context.font = '700 28px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
    context.fillText('本次内容', 112, 834);
    let titleY = 886;
    context.font = '600 25px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
    (titles.length ? titles : ['历史练习内容（题库已更新）']).slice(0, 3).forEach((title, index) => {
      context.fillStyle = colors.teal;
      context.beginPath();
      context.arc(126, titleY - 8, 7, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = colors.ink;
      titleY = wrappedCanvasText(context, title, 154, titleY, 782, 34, 2) + 18;
      if (index < Math.min(titles.length, 3) - 1) {
        context.strokeStyle = colors.line;
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(154, titleY - 8);
        context.lineTo(936, titleY - 8);
        context.stroke();
      }
    });

    context.fillStyle = colors.navy;
    context.font = '700 28px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
    context.fillText('把每次练习，走成更稳的路。', 112, 1206);
    context.fillStyle = colors.muted;
    context.font = '400 21px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
  }

  function openLegacyAchievement(recordId) {
    const rows = selectedSubmissionRecords().sort((a, b) => Number(b.submittedAt || b.updatedAt || 0) - Number(a.submittedAt || a.updatedAt || 0));
    const row = recordId ? recordById(recordId) : rows[0];
    if (!row) return toast('完成一次练习后，即可生成学习成就卡。');
    state.achievementRecordId = row.recordId;
    renderLegacyAchievementCanvas(row);
    const dialog = byId('achievement-dialog');
    dialog.hidden = false;
    document.body.classList.add('achievement-open');
    window.requestAnimationFrame(() => dialog.querySelector('.achievement-dialog')?.focus());
  }

  function closeLegacyAchievement() {
    byId('achievement-dialog').hidden = true;
    document.body.classList.remove('achievement-open');
    state.achievementRecordId = null;
  }

  function downloadLegacyAchievement() {
    const row = recordById(state.achievementRecordId);
    const canvas = byId('achievement-canvas');
    if (!row || !canvas) return toast('请先选择一条练习记录。');
    const date = new Date(row.submittedAt || row.updatedAt || Date.now()).toISOString().slice(0, 10);
    const filename = `ZYZ-Reading-Achievement-${date}.png`;
    const saveBlob = (blob) => {
      if (!blob) return toast('当前浏览器未能生成图片，请尝试更新浏览器。', 5000);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('学习成就卡已保存。');
    };
    if (typeof canvas.toBlob === 'function') canvas.toBlob(saveBlob, 'image/png');
    else {
      const binary = atob(canvas.toDataURL('image/png').split(',')[1]);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      saveBlob(new Blob([bytes], { type: 'image/png' }));
    }
  }

  function achievementGraphemes(value) {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value), (item) => item.segment);
    }
    return Array.from(value);
  }

  function achievementNameMeta(raw) {
    const value = String(raw || '').trim().replace(/\s+/gu, ' ');
    const characters = achievementGraphemes(value);
    const hasHan = characters.some((character) => /\p{Script=Han}/u.test(character));
    const limit = hasHan ? 8 : 12;
    return { value, count: characters.length, limit, hasHan, valid: characters.length <= limit };
  }

  function achievementAvailability(model) {
    return {
      time: model.recordCount > 0,
      questions: model.recordCount > 0,
      accuracy: Number.isFinite(model.accuracy),
      mock: model.fullMockCount > 0,
      attempts: model.completionCount > 0,
      parts: [1, 2, 3].some((part) => Number.isFinite(model.parts[part].percent)),
      sets: model.fullMockCount > 0,
      perfect: model.completePassageCount > 0,
    };
  }

  function achievementSelectedExtras() {
    if (!(state.achievement.extras instanceof Set)) state.achievement.extras = new Set();
    return state.achievement.extras;
  }

  function achievementDuplicateExtra() {
    return ({ questions: 'questions', accuracy: 'accuracy', mock: 'mock' })[state.achievement.hero] || '';
  }

  function achievementEffectiveExtras(model) {
    const availability = achievementAvailability(model);
    const duplicate = achievementDuplicateExtra();
    return Array.from(achievementSelectedExtras())
      .filter((key) => availability[key] && key !== duplicate)
      .slice(0, 4);
  }

  function achievementDefaultExtras(model) {
    const defaults = new Set(['questions', 'parts']);
    if (model.completePassageCount > 0) defaults.add('perfect');
    if (model.fullMockCount > 0) defaults.add('mock');
    else if (Number.isFinite(model.accuracy)) defaults.add('accuracy');
    if (defaults.size < 4 && model.completionCount > 0) defaults.add('attempts');
    return defaults;
  }

  function compactAchievementDuration(seconds) {
    const minutes = Math.max(0, Math.round(finiteRecordNumber(seconds) / 60));
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return hours > 0
      ? { value: String(hours), unit: remainder ? `小时 ${remainder} 分` : '小时' }
      : { value: String(minutes), unit: '分钟' };
  }

  function achievementHeroMetric(model, key) {
    if (key === 'questions') return { label: '累计作答题数', value: String(model.answered), unit: '题' };
    if (key === 'accuracy') return { label: '整体正确率', value: percentLabel(model.accuracy), unit: '' };
    if (key === 'mock') return { label: '平均模考分数', value: compactDecimal(model.mockAverage), unit: '/ 40' };
    return { label: '累计作答时长', ...compactAchievementDuration(model.elapsedSeconds) };
  }

  function achievementExtraMetric(model, key) {
    if (key === 'questions') return { label: '累计作答', value: `${model.answered} 题` };
    if (key === 'attempts') return { label: '完成次数', value: `${model.completionCount} 次` };
    if (key === 'mock') return { label: '平均模考', value: `${compactDecimal(model.mockAverage)} / 40` };
    if (key === 'sets') return { label: '完整模考', value: `${model.fullMockCount} 套` };
    if (key === 'accuracy') return { label: '整体正确率', value: percentLabel(model.accuracy) };
    if (key === 'perfect') return { label: '满分篇章', value: `${model.perfectPassageCount} 篇` };
    return null;
  }

  function drawAchievementMetricCard(context, x, y, width, height, metric, colors) {
    fillRoundedRect(context, x, y, width, height, 22, colors.soft);
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillStyle = colors.muted;
    context.font = '600 21px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
    context.fillText(metric.label, x + 25, y + 43);
    context.fillStyle = colors.ink;
    context.font = '760 38px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
    context.fillText(metric.value, x + 25, y + 96);
  }

  function drawAchievementParts(context, x, y, width, model, colors) {
    const height = 238;
    fillRoundedRect(context, x, y, width, height, 24, colors.soft);
    context.textAlign = 'left';
    context.fillStyle = colors.muted;
    context.font = '600 21px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
    context.fillText('P1–P3 正确率', x + 27, y + 43);
    const gap = 22;
    const innerWidth = width - 54;
    const columnWidth = (innerWidth - gap * 2) / 3;
    const accents = ['#7c878c', '#68899b', '#735f7c'];
    [1, 2, 3].forEach((part, index) => {
      const columnX = x + 27 + index * (columnWidth + gap);
      const value = model.parts[part].percent;
      context.fillStyle = colors.muted;
      context.font = '700 20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      context.fillText(`P${part}`, columnX, y + 91);
      context.textAlign = 'right';
      context.fillStyle = colors.ink;
      context.font = '760 29px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      context.fillText(percentLabel(value), columnX + columnWidth, y + 92);
      context.textAlign = 'left';
      fillRoundedRect(context, columnX, y + 126, columnWidth, 12, 6, '#e1dadd');
      if (Number.isFinite(value) && value > 0) {
        fillRoundedRect(context, columnX, y + 126, Math.max(12, columnWidth * Math.min(100, value) / 100), 12, 6, accents[index]);
      }
    });
    return height;
  }

  function achievementNameFont(context, value, maxWidth) {
    let size = 34;
    context.font = `760 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif`;
    while (size > 25 && context.measureText(value).width > maxWidth) {
      size -= 1;
      context.font = `760 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif`;
    }
    return size;
  }

  function renderAchievementCanvas(model) {
    const canvas = byId('achievement-canvas');
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !model?.recordCount) {
      if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const colors = {
      outer: '#e8e0e4', card: '#fdf9f6', ink: '#332d34', purple: '#59476a',
      muted: '#796f76', soft: '#f1eaf2', line: '#ded3d7',
    };
    const card = { x: 54, y: 46, width: 972, height: 1258, radius: 46 };
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = colors.outer;
    context.fillRect(0, 0, canvas.width, canvas.height);
    fillRoundedRect(context, card.x, card.y, card.width, card.height, card.radius, colors.card);

    context.save();
    roundedRectPath(context, card.x, card.y, card.width, card.height, card.radius);
    context.clip();
    context.strokeStyle = 'rgba(105, 86, 124, .105)';
    context.lineWidth = 34;
    context.beginPath();
    context.arc(card.x + card.width + 20, card.y - 31, 102, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = 'rgba(101, 85, 119, .065)';
    context.lineWidth = 46;
    context.beginPath();
    context.arc(card.x + card.width + 9, card.y + card.height + 1, 126, 0, Math.PI * 2);
    context.stroke();
    context.restore();

    const left = 112;
    const right = 968;
    context.textBaseline = 'alphabetic';
    context.textAlign = 'left';
    context.fillStyle = colors.muted;
    context.font = '700 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    context.fillText('ZYZ READING WALKS', left, 142);
    if (state.achievement.name) {
      context.textAlign = 'right';
      context.fillStyle = colors.purple;
      const fontSize = achievementNameFont(context, state.achievement.name, 430);
      context.font = `760 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif`;
      context.fillText(state.achievement.name, right, 142);
      context.textAlign = 'left';
    }

    context.fillStyle = colors.purple;
    context.font = '820 28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    context.fillText('MY READING MILESTONE', left, 288);
    const hero = achievementHeroMetric(model, state.achievement.hero);
    context.fillStyle = colors.purple;
    const heroFontSize = hero.value.length >= 6 ? 110 : hero.value.length >= 4 ? 126 : 150;
    context.font = `850 ${heroFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif`;
    context.fillText(hero.value, left, 448);
    if (hero.unit) {
      const valueWidth = context.measureText(hero.value).width;
      context.font = '700 30px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
      context.fillText(hero.unit, Math.min(left + valueWidth + 18, 775), 442);
    }
    context.fillStyle = colors.muted;
    context.font = '600 26px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
    context.fillText(hero.label, left, 505);
    context.strokeStyle = colors.line;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(left, 570);
    context.lineTo(right, 570);
    context.stroke();

    const selected = achievementEffectiveExtras(model);
    const hasParts = selected.includes('parts');
    const regular = selected.filter((key) => key !== 'parts').map((key) => achievementExtraMetric(model, key)).filter(Boolean);
    let cursorY = 626;
    if (regular.length) {
      const columns = regular.length === 1 ? 1 : regular.length === 3 ? 3 : 2;
      const gap = 18;
      const width = (right - left - gap * (columns - 1)) / columns;
      const height = 126;
      regular.forEach((metric, index) => {
        const rowIndex = Math.floor(index / columns);
        const columnIndex = index % columns;
        drawAchievementMetricCard(context, left + columnIndex * (width + gap), cursorY + rowIndex * (height + gap), width, height, metric, colors);
      });
      cursorY += Math.ceil(regular.length / columns) * (height + gap) + 17;
    }
    if (hasParts) drawAchievementParts(context, left, cursorY, right - left, model, colors);
  }

  function syncAchievementBuilder() {
    const model = aggregateRecordRows(sortedSubmissionRecords());
    const availability = achievementAvailability(model);
    if (!availability[state.achievement.hero]) {
      state.achievement.hero = ['time', 'questions', 'accuracy', 'mock'].find((key) => availability[key]) || 'time';
    }
    const duplicate = achievementDuplicateExtra();
    if (duplicate) achievementSelectedExtras().delete(duplicate);
    const effectiveExtras = achievementEffectiveExtras(model);
    const effectiveSet = new Set(effectiveExtras);
    const selectedCount = effectiveExtras.length;
    document.querySelectorAll('input[name="achievement-hero"]').forEach((input) => {
      input.checked = input.value === state.achievement.hero;
      input.disabled = !availability[input.value];
    });
    byId('achievement-extra-options').querySelectorAll('input[type="checkbox"]').forEach((input) => {
      const isDuplicate = input.value === duplicate;
      const unavailable = !availability[input.value];
      input.checked = effectiveSet.has(input.value);
      input.disabled = isDuplicate || unavailable || (selectedCount >= 4 && !input.checked);
      input.closest('label')?.setAttribute('title', isDuplicate
        ? '已作为主角数字显示'
        : unavailable ? '全部记录暂无可计算数据' : '');
    });
    byId('achievement-extra-count').textContent = `已选 ${selectedCount} / 4`;
    byId('achievement-empty-message').hidden = model.recordCount > 0;
    byId('download-achievement').disabled = model.recordCount === 0 || !state.achievement.nameValid;
    renderAchievementCanvas(model);
    return model;
  }

  function updateAchievementName(raw) {
    const meta = achievementNameMeta(raw);
    const input = byId('achievement-name');
    const note = byId('achievement-name-note');
    state.achievement.nameValid = meta.valid;
    state.achievement.name = meta.valid ? meta.value : '';
    input.setAttribute('aria-invalid', String(!meta.valid));
    note.textContent = !meta.value
      ? '姓名默认留空，只用于本次生成。'
      : meta.valid
        ? `当前 ${meta.count} / ${meta.limit} ${meta.hasHan ? '个字' : '个字符'}，卡片会自动调整字号。`
        : `已超过 ${meta.limit} ${meta.hasHan ? '个字' : '个字符'}，请精简后再保存。`;
    syncAchievementBuilder();
  }

  function openAchievement() {
    if (!selectedSubmissionRecords().length) return toast('完成一次练习后，即可生成学习成就卡。');
    state.achievement.hero = 'time';
    state.achievement.extras = achievementDefaultExtras(aggregateRecordRows(sortedSubmissionRecords()));
    state.achievement.name = '';
    state.achievement.nameValid = true;
    byId('achievement-name').value = '';
    byId('achievement-name').setAttribute('aria-invalid', 'false');
    byId('achievement-name-note').textContent = '姓名默认留空，只用于本次生成。';
    syncAchievementBuilder();
    const dialog = byId('achievement-dialog');
    dialog.hidden = false;
    document.body.classList.add('achievement-open');
    window.requestAnimationFrame(() => dialog.querySelector('.achievement-dialog')?.focus());
  }

  function closeAchievement() {
    byId('achievement-dialog').hidden = true;
    document.body.classList.remove('achievement-open');
    state.achievement.name = '';
    state.achievement.nameValid = true;
  }

  function downloadAchievement() {
    const model = syncAchievementBuilder();
    const canvas = byId('achievement-canvas');
    if (!model.recordCount || !canvas) return toast('还没有可以生成成就卡的记录。');
    if (!state.achievement.nameValid) return toast('请先精简姓名或昵称。');
    const filename = `ZYZ-Reading-Achievement-${new Date().toISOString().slice(0, 10)}.png`;
    const saveBlob = (blob) => {
      if (!blob) return toast('当前浏览器未能生成图片，请尝试更新浏览器。', 5000);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('学习成就卡已保存。');
    };
    if (typeof canvas.toBlob === 'function') canvas.toBlob(saveBlob, 'image/png');
    else {
      const binary = atob(canvas.toDataURL('image/png').split(',')[1]);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      saveBlob(new Blob([bytes], { type: 'image/png' }));
    }
  }

  async function exportQuestionDetailsCSV() {
    try {
      const csv = await records.exportQuestionOutcomesCSV();
      downloadText(`ZYZ-Reading-Question-Details-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
      toast('逐题明细已导出，可直接用 Excel 打开。');
    } catch (error) { toast(`导出失败：${error.message || error}`, 5000); }
  }

  function resumableSessionsForBackup(storage = window.localStorage) {
    const sessions = readResumableSessions(storage);
    ['practice', 'mock'].forEach((kind) => {
      const entry = sessions[kind];
      if (!entry || entry.status !== 'active') return;
      const raw = storage.getItem(entry.runtimeStateKey);
      if (raw === null) return;
      try {
        const runtimeState = validatedRuntimeState(JSON.parse(raw), {
          expectSubmitted: false,
          timerPolicy: entry.timerPolicy,
          status: 'active',
          partCount: entry.selections.length,
        });
        if (Number(runtimeState.updatedAt || 0) <= Number(entry.runtimeState.updatedAt || 0)) return;
        sessions[kind] = validatedResumableEntry({
          ...entry,
          runtimeState,
          savedAt: Date.now(),
        }, kind);
      } catch (_error) { /* keep the last verified outer checkpoint */ }
    });
    return sessions;
  }

  async function exportFullBackup() {
    try {
      const backup = await records.exportPersonalBackup({ includePreferences: true });
      backup.resumableSessions = {
        schemaVersion: RESUMABLE_SESSIONS_SCHEMA_VERSION,
        sessions: resumableSessionsForBackup(),
      };
      const text = JSON.stringify(backup, null, 2);
      downloadText(`ZYZ-Reading-Personal-Backup-${new Date().toISOString().slice(0, 10)}.json`, text, 'application/json;charset=utf-8');
      toast('完整个人备份已导出；其中包含你的答案、题目标记、Highlight 与 Notes，请妥善保存。', 6000);
      return true;
    } catch (error) {
      toast(`备份失败：${error.message || error}`, 5000);
      return false;
    }
  }

  async function exportBackupFromActionDialog() {
    if (state.actionDialog.kind !== 'clear-records' || state.actionDialog.busy) return;
    setActionDialogStatus('正在生成完整备份…');
    setActionDialogBusy(true);
    const exported = await exportFullBackup();
    setActionDialogBusy(false);
    setActionDialogStatus(
      exported ? '备份文件已开始下载。请确认文件已保存，再决定是否永久清空。' : '备份未完成，请勿清空记录。',
      !exported,
    );
  }

  // T52R4: user confirmation only; original backup parsing/merge remains below.
  let fullBackupImportBusy = false;
  let fullBackupImportConfirmation = null;
  function settleFullBackupImportConfirmation(confirmed) {
    const pending = fullBackupImportConfirmation;
    if (!pending) return;
    fullBackupImportConfirmation = null;
    byId('record-import-cancel').disabled = true;
    byId('record-import-confirm-button').disabled = true;
    byId('record-import-confirm').close();
    const opener = pending.opener;
    if (opener?.isConnected && opener.getClientRects().length) opener.focus();
    else document.querySelector('.records-recovery summary')?.focus();
    pending.resolve(confirmed === true);
  }
  function confirmFullBackupImport() {
    if (fullBackupImportConfirmation) return Promise.resolve(false);
    return new Promise((resolve) => {
      fullBackupImportConfirmation = { resolve, opener: byId('import-full-backup') };
      byId('record-import-cancel').disabled = false;
      byId('record-import-confirm-button').disabled = false;
      byId('record-import-confirm').showModal();
      byId('record-import-confirm-title').focus();
    });
  }
  function bindFullBackupImportConfirmation() {
    const dialog = byId('record-import-confirm');
    byId('record-import-cancel').addEventListener('click', () => settleFullBackupImportConfirmation(false));
    byId('record-import-confirm-button').addEventListener('click', () => settleFullBackupImportConfirmation(true));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); settleFullBackupImportConfirmation(false); });
    dialog.addEventListener('close', () => settleFullBackupImportConfirmation(false));
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const first = byId('record-import-cancel');
      const last = byId('record-import-confirm-button');
      if (event.shiftKey && (document.activeElement === first || document.activeElement === byId('record-import-confirm-title'))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    });
  }
  // END T52R4 import confirmation.

  async function importFullBackup(file) {
    if (!file || fullBackupImportBusy) return;
    fullBackupImportBusy = true;
    try {
    const confirmed = await confirmFullBackupImport();
    if (!confirmed) return toast('已取消恢复，没有写入任何数据。');
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      let incomingResumable = { practice: null, mock: null };
      if (backup?.resumableSessions !== undefined) {
        if (backup.resumableSessions?.schemaVersion !== RESUMABLE_SESSIONS_SCHEMA_VERSION ||
            !backup.resumableSessions.sessions || typeof backup.resumableSessions.sessions !== 'object') {
          throw new Error('备份中的未完成内容格式不受支持。');
        }
        incomingResumable = {
          practice: validatedResumableEntry(backup.resumableSessions.sessions.practice, 'practice'),
          mock: validatedResumableEntry(backup.resumableSessions.sessions.mock, 'mock'),
        };
      }
      let resumedImports = 0;
      let resumedConflicts = 0;
      let result;
      await withResumableMutationLock(async () => {
        const currentResumable = readResumableSessions();
        const mergedResumable = { ...currentResumable };
        ['practice', 'mock'].forEach((kind) => {
          if (!incomingResumable[kind] || incomingResumable[kind].status === 'submitted') return;
          if (currentResumable[kind] && currentResumable[kind].status !== 'submitted') resumedConflicts += 1;
          else {
            mergedResumable[kind] = incomingResumable[kind];
            resumedImports += 1;
          }
        });
        const storage = window.localStorage;
        const previousResumableRaw = storage.getItem(RESUMABLE_SESSIONS_STORAGE_KEY);
        let resumableWritten = false;
        if (resumedImports) {
          writeResumableSessions(mergedResumable, storage);
          resumableWritten = true;
        }
        try {
          result = await records.importPersonalBackup(backup, { preferencesMode: 'merge' });
        } catch (error) {
          if (resumableWritten) {
            if (previousResumableRaw === null) storage.removeItem(RESUMABLE_SESSIONS_STORAGE_KEY);
            else storage.setItem(RESUMABLE_SESSIONS_STORAGE_KEY, previousResumableRaw);
            if (storage.getItem(RESUMABLE_SESSIONS_STORAGE_KEY) !== previousResumableRaw) {
              throw new Error(`${error.message || error}；未完成内容的索引回滚也未能确认。`);
            }
            state.resumableSessions = readResumableSessions(storage);
            renderResumableSessions();
          }
          throw error;
        }
      });
      await refreshRecords();
      const recordChanges = Number(result?.records?.added || 0) + Number(result?.records?.updated || 0);
      const snapshotChanges = Number(result?.attemptSnapshots?.added || 0) + Number(result?.attemptSnapshots?.updated || 0);
      toast(`完整备份已恢复：写入 ${recordChanges} 条记录、${snapshotChanges} 个复盘现场${resumedImports ? `、${resumedImports} 项未完成内容` : ''}${resumedConflicts ? `；${resumedConflicts} 项本机未完成内容已优先保留` : ''}。`, 7000);
    } catch (error) { toast(`恢复失败：${error.message || error}`, 6000); }
    } finally { fullBackupImportBusy = false; }
  }

  async function exportRecords() {
    try {
      const data = await records.exportData();
      const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `ZYZ-Reading-Records-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('练习记录已导出。');
    } catch (error) { toast(`导出失败：${error.message || error}`, 5000); }
  }

  async function importRecords(file) {
    if (!file) return;
    try {
      const result = await records.importData(await file.text());
      await refreshRecords();
      const changed = Number(result?.added || 0) + Number(result?.updated || 0);
      const skipped = Number(result?.skippedOlder || 0) + Number(result?.skippedDuplicate || 0)
        + Number(result?.conflicts || 0) + Number(result?.invalid || 0);
      toast(`导入完成：写入 ${changed} 条，跳过 ${skipped} 条。`);
    } catch (error) { toast(`导入失败：${error.message || error}`, 5000); }
  }

  function bindEvents() {
    bindRecordBackupGuide();
    bindFullBackupImportConfirmation();
    window.addEventListener('message', onRunnerMessage);
    window.addEventListener('storage', onResumableStorageEvent);
    window.addEventListener('pagehide', () => {
      const session = state.currentSession;
      const context = session?.annotationContext;
      if (!context) return;
      window.clearTimeout(context.writeTimer);
      context.writeTimer = 0;
      enqueueReviewAnnotationWrite(session).catch(() => undefined);
    });
    window.addEventListener('resize', syncRunnerZoomState, { passive: true });
    window.visualViewport?.addEventListener('resize', syncRunnerZoomState, { passive: true });
    window.visualViewport?.addEventListener('scroll', syncRunnerZoomState, { passive: true });
    const runnerViewport = byId('runner-pan-viewport');
    if (runnerViewport && typeof ResizeObserver === 'function') {
      runnerViewportResizeObserver = new ResizeObserver(syncRunnerZoomState);
      runnerViewportResizeObserver.observe(runnerViewport);
    }
    syncRunnerZoomState();
    document.addEventListener('click', (event) => {
      const routeButton = event.target.closest('[data-route]');
      if (routeButton) route(routeButton.dataset.route);
      if (!event.target.closest('.record-more')) closeRecordMenus();
    });
    byId('resume-session-list').addEventListener('click', (event) => {
      const resume = event.target.closest('[data-resume-session]');
      if (resume) return resumeSavedSession(resume.dataset.resumeSession);
      const retry = event.target.closest('[data-retry-submission]');
      if (retry) return retryPendingSubmission(retry.dataset.retrySubmission);
      const discard = event.target.closest('[data-discard-session]');
      if (!discard) return;
      const kind = resumableKind(discard.dataset.discardSession);
      const entry = state.resumableSessions[kind];
      if (!entry) return renderResumableSessions();
      const pendingSubmission = entry.status === 'submitted-pending';
      openActionDialog({
        kind: 'discard-resumable-session',
        recordId: kind,
        attemptSessionId: entry.attemptSessionId,
        submissionId: pendingSubmission ? entry.runtimeState?.submissionId : '',
        runtimeStateKey: entry.runtimeStateKey,
        pendingSubmission,
        opener: discard,
        eyebrow: pendingSubmission ? 'UNSAVED RECORD' : 'UNFINISHED WORK',
        title: pendingSubmission
          ? `放弃这条待保存的${kind === 'mock' ? '模考' : '练习'}记录？`
          : `放弃这次未完成的${kind === 'mock' ? '模考' : '练习'}？`,
        description: pendingSubmission
          ? '这次提交的成绩摘要、答案、Highlight 与 Notes 将无法再从此暂停点保存；其他记录不会受影响。此操作无法撤销。'
          : '其中的答案、Highlight 与 Notes 将从本机永久删除；已提交记录和其他未完成内容不会受影响。',
        cancelLabel: '保留',
        confirmLabel: '永久放弃',
      });
    });
    document.addEventListener('keydown', handleActionDialogKeydown);
    document.addEventListener('keydown', (event) => {
      if (actionDialogIsOpen() || event.key !== 'Escape') return;
      const openMenu = document.querySelector('.record-more-trigger[aria-expanded="true"]');
      if (!openMenu) return;
      event.preventDefault();
      closeRecordMenus({ restoreFocus: true });
    });
    byId('home-progress-control').addEventListener('click', () => {
      state.homeProgressScopeIndex = (state.homeProgressScopeIndex + 1) % HOME_PROGRESS_SCOPES.length;
      renderHomeStats();
    });
    document.querySelectorAll('[data-practice-mode]').forEach((button) => button.addEventListener('click', () => setPracticeMode(button.dataset.practiceMode)));
    document.querySelectorAll('button[data-view-mode]').forEach((button) => button.addEventListener('click', () => setViewMode(button.dataset.viewMode)));
    byId('practice-search').addEventListener('input', (event) => { state.filters.search = event.target.value; renderPassages(); });
    ['position-filter', 'frequency-filter', 'difficulty-filter'].forEach((id) => byId(id).addEventListener('click', (event) => {
      const button = event.target.closest('button[data-value]');
      if (!button) return;
      const targetSet = id === 'position-filter'
        ? state.filters.positions
        : id === 'frequency-filter' ? state.filters.frequencies : state.filters.difficulties;
      if (targetSet.has(button.dataset.value)) targetSet.delete(button.dataset.value); else targetSet.add(button.dataset.value);
      button.setAttribute('aria-pressed', String(targetSet.has(button.dataset.value)));
      renderPassages();
    }));
    byId('unseen-only-button').addEventListener('click', () => {
      const checkbox = byId('unseen-only');
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
    byId('unseen-only').addEventListener('change', (event) => {
      state.filters.unseenOnly = event.currentTarget.checked;
      syncUnseenOnlyControl();
      renderPassages();
    });
    syncUnseenOnlyControl();
    byId('question-type-filter').addEventListener('change', (event) => { state.filters.questionType = event.target.value; renderPassages(); });
    byId('sort-control').addEventListener('change', (event) => { state.sort = event.target.value; renderPassages(); });
    byId('clear-practice-filters').addEventListener('click', () => {
      state.filters = { search: '', positions: new Set(), frequencies: new Set(), difficulties: new Set(), questionType: '', unseenOnly: false };
      byId('practice-search').value = '';
      byId('question-type-filter').value = '';
      byId('unseen-only').checked = false;
      syncUnseenOnlyControl();
      document.querySelectorAll('#position-filter button, #frequency-filter button, #difficulty-filter button').forEach((button) => button.setAttribute('aria-pressed', 'false'));
      renderPassages();
    });
    byId('passage-grid').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      if (button.dataset.action === 'toggle-full') toggleFullPassage(button.dataset.passageId);
      if (button.dataset.action === 'select-task') selectTask(button.dataset.passageId, button.dataset.taskId);
      if (button.dataset.action === 'reopen-attempt') reopenAttempt(button.dataset.recordId);
    });
    byId('selection-list').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      if (button.dataset.action === 'remove-selection-task') return removeSelectionTask(button.dataset.passageId, button.dataset.taskId);
      if (button.dataset.action === 'remove-selection') {
        state.selections = state.selections.filter((selection) => selection.passageId !== button.dataset.passageId);
        renderPassages();
      }
    });
    byId('start-practice').addEventListener('click', () => startSession('practice', state.selections, { timerPolicy: practiceTimerPolicy() }));
    const timerEnabled = byId('practice-timer-enabled');
    if (timerEnabled) timerEnabled.addEventListener('change', (event) => {
      state.practiceTimer.enabled = event.target.checked;
      if (state.practiceTimer.enabled && state.practiceTimer.preset === 'recommended') state.practiceTimer.customMinutes = recommendedPracticeMinutes();
      renderPracticeTimer();
      renderPracticeSelectionFooter();
    });
    const timerOptions = byId('practice-duration-options');
    if (timerOptions) timerOptions.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-minutes]');
      if (button) choosePracticeTimerPreset(button.dataset.minutes);
    });
    const customDuration = byId('practice-duration-custom');
    const customDurationInput = customDuration?.matches('input') ? customDuration : customDuration?.querySelector('input');
    if (customDurationInput) customDurationInput.addEventListener('input', (event) => {
      state.practiceTimer.customMinutes = Math.min(180, Math.max(1, Math.round(Number(event.target.value) || recommendedPracticeMinutes())));
      renderPracticeSelectionFooter();
    });
    document.querySelectorAll('input[name="practice-timer-mode"]').forEach((input) => input.addEventListener('change', () => {
      if (input.checked) state.practiceTimer.expiryAction = input.value === 'submit' ? 'submit' : 'continue';
      renderPracticeSelectionFooter();
    }));
    document.querySelectorAll('[data-mock-mode]').forEach((button) => button.addEventListener('click', () => setMockMode(button.dataset.mockMode)));
    byId('mock-difficulty-filter').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-value]');
      if (button) toggleMockDifficulty(button.dataset.value, button);
    });
    byId('generate-mock').addEventListener('click', () => generateMock({ requireDifferentFrom: currentMockPassages() }));
    document.querySelectorAll('input[name="mock-frequency"], #mock-unseen-priority').forEach((input) => input.addEventListener('change', () => generateMock()));
    byId('mock-surprise-enabled').addEventListener('change', (event) => setMockSurprise(event.target.checked));
    byId('mock-manual-controls').addEventListener('click', (event) => {
      const positionTab = event.target.closest('[data-manual-mock-position-tab]');
      if (positionTab) return setManualMockPosition(Number(positionTab.dataset.manualMockPositionTab));
      const frequency = event.target.closest('#manual-mock-frequency-filter button[data-value]');
      if (frequency) return toggleManualMockFilter('frequency', frequency.dataset.value);
      const difficulty = event.target.closest('#manual-mock-difficulty-filter button[data-value]');
      if (difficulty) return toggleManualMockFilter('difficulty', difficulty.dataset.value);
      const passage = event.target.closest('[data-manual-passage-id]');
      if (passage) selectManualMockPassage(passage.dataset.manualPassageId);
    });
    byId('manual-mock-search').addEventListener('input', (event) => {
      state.manualMockFilters.search = event.target.value;
      renderManualMockControls({ resetScroll: true });
    });
    byId('start-mock').addEventListener('click', () => startSession('mock', state.mockSelection));
    byId('open-latest-achievement').addEventListener('click', () => openAchievement());
    byId('export-full-backup').addEventListener('click', exportFullBackup);
    byId('import-full-backup').addEventListener('change', (event) => {
      importFullBackup(event.target.files?.[0]);
      event.target.value = '';
    });
    byId('export-records').addEventListener('click', exportRecords);
    byId('record-list').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      if (button.dataset.action === 'reopen-attempt') {
        closeRecordMenus();
        reopenAttempt(button.dataset.recordId);
        return;
      }
      if (button.dataset.action === 'toggle-record-menu') {
        const opening = button.getAttribute('aria-expanded') !== 'true';
        closeRecordMenus({ except: button });
        button.setAttribute('aria-expanded', String(opening));
        const menu = button.parentElement?.querySelector('.record-more-menu');
        if (menu) menu.hidden = !opening;
        return;
      }
      if (button.dataset.action === 'delete-record') {
        const row = recordById(button.dataset.recordId);
        if (!row) return toast('这条记录已经不存在。');
        openActionDialog({
          kind: 'delete-record',
          recordId: row.recordId,
          opener: button.closest('.record-more')?.querySelector('.record-more-trigger') || button,
          eyebrow: 'LOCAL RECORD',
          title: `删除这次${row.mode === 'mock' ? '模考' : '练习'}记录？`,
          description: '将同时删除这次的成绩摘要和本机复盘现场，不会影响其他记录。此操作无法撤销。',
          cancelLabel: '取消',
          confirmLabel: '删除记录',
        });
      }
    });
    byId('record-filter').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-record-filter]');
      if (!button) return;
      state.recordFilter = button.dataset.recordFilter;
      renderRecords();
    });
    byId('achievement-hero-options').addEventListener('change', (event) => {
      const input = event.target.closest('input[name="achievement-hero"]');
      if (!input?.checked) return;
      state.achievement.hero = input.value;
      syncAchievementBuilder();
    });
    byId('achievement-extra-options').addEventListener('change', (event) => {
      const input = event.target.closest('input[type="checkbox"]');
      if (!input) return;
      const selected = achievementSelectedExtras();
      const model = aggregateRecordRows(sortedSubmissionRecords());
      if (input.checked && achievementEffectiveExtras(model).length >= 4) {
        input.checked = false;
        toast('补充数据最多选择 4 项。');
        return;
      }
      if (input.checked) selected.add(input.value);
      else selected.delete(input.value);
      syncAchievementBuilder();
    });
    byId('achievement-name').addEventListener('input', (event) => updateAchievementName(event.target.value));
    byId('close-achievement').addEventListener('click', closeAchievement);
    byId('cancel-achievement').addEventListener('click', closeAchievement);
    byId('download-achievement').addEventListener('click', downloadAchievement);
    byId('achievement-dialog').addEventListener('click', (event) => {
      if (event.target === byId('achievement-dialog')) closeAchievement();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !byId('achievement-dialog').hidden) closeAchievement();
    });
    byId('import-records').addEventListener('change', (event) => { importRecords(event.target.files?.[0]); event.target.value = ''; });
    byId('action-dialog-cancel').addEventListener('click', handleActionDialogCancel);
    byId('action-dialog-confirm').addEventListener('click', confirmActionDialog);
    byId('action-dialog-phrase').addEventListener('input', syncActionDialogPhrase);
    byId('action-dialog-backup').addEventListener('click', exportBackupFromActionDialog);
    byId('action-dialog-alternate').addEventListener('click', handleActionDialogAlternate);
    byId('clear-records').addEventListener('click', (event) => {
      const completedCount = sortedSubmissionRecords().length;
      openActionDialog({
        kind: 'clear-records',
        opener: event.currentTarget,
        eyebrow: 'LOCAL DATA',
        title: '清空全部记录？',
        description: `只清除本机的 ${completedCount} 条已提交学习记录及对应复盘；未完成的练习或模考仍会保留。此操作无法撤销。`,
        expectedPhrase: '清空',
        showBackup: true,
        cancelLabel: '取消',
        confirmLabel: '永久清空',
      });
    });
  }

  /* BEGIN T49 WORDMARK INK EDGE ALIGNMENT CONTRACT */
  function passageWordmarkInkOffset(mainElement, byElement) {
    if (!mainElement || !byElement || typeof document.createElement !== 'function') return null;
    try {
      const canvas = document.createElement('canvas');
      const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
      if (!context || typeof context.measureText !== 'function') return null;
      const measure = (element) => {
        const style = getComputedStyle(element);
        const font = style.font || `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;
        context.font = font;
        const glyph = String(element.textContent || '').trim().charAt(0);
        const metrics = glyph ? context.measureText(glyph) : null;
        return metrics && 'actualBoundingBoxLeft' in metrics && Number.isFinite(metrics.actualBoundingBoxLeft)
          ? metrics.actualBoundingBoxLeft
          : null;
      };
      const mainLeft = measure(mainElement);
      const byLeft = measure(byElement);
      if (mainLeft === null || byLeft === null) return null;
      const mainOrigin = mainElement.getBoundingClientRect().left;
      const byOrigin = byElement.getBoundingClientRect().left;
      const offset = (mainOrigin - mainLeft) - (byOrigin - byLeft);
      return Number.isFinite(offset) && Math.abs(offset) <= 4 ? offset : null;
    } catch (_error) {
      return null;
    }
  }

  function setupHomeWordmarkInkAlignment() {
    const root = document.querySelector('.brand-copy');
    const main = root?.querySelector('strong');
    const by = root?.querySelector('small');
    if (!root || !main || !by) return;
    const apply = () => {
      try {
        root.style.setProperty('--passage-home-by-ink-offset', '0px');
        const offset = passageWordmarkInkOffset(main, by);
        if (offset === null) throw new Error('canvas metrics unavailable');
        root.style.setProperty('--passage-home-by-ink-offset', `${offset.toFixed(3)}px`);
        root.dataset.wordmarkInkOffset = offset.toFixed(3);
        root.dataset.wordmarkInkAlignment = 'measured';
      } catch (_error) {
        root.style.removeProperty('--passage-home-by-ink-offset');
        root.dataset.wordmarkInkAlignment = 'safe-fallback';
      }
    };
    apply();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
    try {
      if (document.fonts?.ready && typeof document.fonts.ready.then === 'function') document.fonts.ready.then(apply).catch(() => {});
    } catch (_error) {}
    window.addEventListener('load', apply, { once: true, passive: true });
    window.addEventListener('pageshow', apply, { passive: true });
  }
  /* END T49 WORDMARK INK EDGE ALIGNMENT CONTRACT */

  async function init() {
    if (!library || !manifest || !runtimeTemplate || !core || !records) {
      document.body.innerHTML = '<p style="padding:32px;font-family:Arial">练习包数据不完整，请重新获取文件。</p>';
      return;
    }
    document.title = 'PASSAGE by ZYZ';
    setupHomeWordmarkInkAlignment();
    renderEditionBadge();
    const questionTypes = new Set();
    passages.forEach((passage) => (passage.composition?.taskGroups || []).forEach((task) => {
      questionTypes.add(taskQuestionTypeLabel(task));
    }));
    const orderedTypes = [
      ...PREFERRED_TYPE_FILTERS.filter((label) => questionTypes.has(label)),
      ...[...questionTypes].filter((label) => !PREFERRED_TYPE_FILTERS.includes(label)).sort((a, b) => a.localeCompare(b, 'en')),
    ];
    byId('question-type-filter').innerHTML = '<option value="">全部题型</option>'
      + orderedTypes.map((label) => `<option value="${htmlEscape(label)}">${htmlEscape(label)}</option>`).join('');
    let resumableLoadError = null;
    try { state.resumableSessions = await withResumableMutationLock(() => reconcileResumableSessionsWithRuntime()); }
    catch (error) { resumableLoadError = error; }
    setupPracticeSelectionScroll();
    bindEvents();
    renderResumableSessions();
    if (resumableLoadError) {
      console.warn('Could not validate resumable sessions.', resumableLoadError);
      toast('检测到无法校验的未完成内容；原数据已保留，未自动恢复。', 6000);
    }
    await records.init();
    await refreshRecords();
    renderPassages();
    generateMock();
    route(location.hash.slice(1) || 'home');
    window.addEventListener('hashchange', () => route(location.hash.slice(1) || 'home'));
  }

  init().catch((error) => {
    console.error(error);
    document.body.textContent = "重建版启动失败，请查看控制台错误。";
  });
})();