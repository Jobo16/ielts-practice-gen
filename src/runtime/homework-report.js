
(function (root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.IELTSHomeworkReport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 'ielts-reading-homework-report.v0.3';
  const PART_TIMING_SCHEMA_VERSION = 'ielts-reading-part-timing.v1';
  const ACADEMIC_READING_BAND_NOTE = '按 IELTS 公开典型换算估算；实际试卷分界可能略有不同。';
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
  const UNKNOWN = '未记录';
  const DEFAULT_ASSIGNMENT_TITLE = 'ZYZ 阅读练习';
  const DEFAULT_LOCALE = 'zh-CN';
  const DEFAULT_TIME_ZONE = 'Asia/Shanghai';

  function sanitizeTimestamp(value) {
    let timestamp = null;
    if (value instanceof Date) timestamp = value.getTime();
    else if (typeof value === 'number') timestamp = value;
    else if (typeof value === 'string' && value.trim() && !/^\d+(?:\.\d+)?$/u.test(value.trim())) {
      timestamp = Date.parse(value.trim());
    }
    if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > 8640000000000000) return null;
    return Math.trunc(timestamp);
  }

  function sanitizeElapsed(value) {
    const number = typeof value === 'number' ? value : null;
    if (!Number.isFinite(number) || number < 0) return null;
    return Math.floor(number);
  }

  function sanitizeElapsedMilliseconds(value) {
    const number = typeof value === 'number' ? value : null;
    if (!Number.isFinite(number) || number < 0) return null;
    return Math.floor(number);
  }

  function sanitizePartNumber(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
  }

  function sanitizePartElapsedMilliseconds(value, allowedParts) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const allowed = Array.isArray(allowedParts)
      ? new Set(allowedParts.map(sanitizePartNumber).filter((part) => part !== null))
      : null;
    const sanitized = {};
    Object.entries(source).forEach(([key, elapsed]) => {
      const part = sanitizePartNumber(key);
      const milliseconds = sanitizeElapsedMilliseconds(elapsed);
      if (part === null || milliseconds === null || (allowed && !allowed.has(part))) return;
      sanitized[String(part)] = milliseconds;
    });
    return Object.freeze(sanitized);
  }

  function settlePartTiming(input) {
    const source = input && typeof input === 'object' ? input : {};
    const elapsedMillisecondsByPart = {
      ...sanitizePartElapsedMilliseconds(source.elapsedMillisecondsByPart, source.allowedParts),
    };
    const part = sanitizePartNumber(source.part);
    const startedAt = sanitizeTimestamp(source.activePartStartedAt);
    const endedAt = sanitizeTimestamp(source.endedAt !== undefined ? source.endedAt : source.now);
    if (part !== null && startedAt !== null && endedAt !== null && endedAt >= startedAt) {
      const previous = sanitizeElapsedMilliseconds(elapsedMillisecondsByPart[String(part)]) || 0;
      elapsedMillisecondsByPart[String(part)] = previous + (endedAt - startedAt);
    }
    return Object.freeze({
      schemaVersion: PART_TIMING_SCHEMA_VERSION,
      elapsedMillisecondsByPart: Object.freeze(elapsedMillisecondsByPart),
      activePartStartedAt: null,
    });
  }

  function elapsedSeconds(startedAt, endedAt, frozenElapsedSeconds) {
    let start = startedAt;
    let end = endedAt;
    let frozen = frozenElapsedSeconds;

    if (startedAt && typeof startedAt === 'object' && !(startedAt instanceof Date)) {
      const options = startedAt;
      start = options.startedAt;
      end = options.submittedAt !== undefined
        ? options.submittedAt
        : options.endedAt !== undefined
          ? options.endedAt
          : options.now;
      frozen = options.elapsedSeconds !== undefined
        ? options.elapsedSeconds
        : options.frozenElapsedSeconds;
    }

    const frozenSeconds = sanitizeElapsed(frozen);
    if (frozenSeconds !== null) return frozenSeconds;

    const startTimestamp = sanitizeTimestamp(start);
    const endTimestamp = sanitizeTimestamp(end);
    if (startTimestamp === null || endTimestamp === null || endTimestamp < startTimestamp) return null;
    return Math.floor((endTimestamp - startTimestamp) / 1000);
  }

  function formatElapsed(value) {
    const totalSeconds = sanitizeElapsed(value);
    if (totalSeconds === null) return UNKNOWN;
    if (totalSeconds < 60) return `${totalSeconds} 秒`;
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60) return `${totalMinutes} 分 ${String(seconds).padStart(2, '0')} 秒`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours} 小时 ${String(minutes).padStart(2, '0')} 分 ${String(seconds).padStart(2, '0')} 秒`;
  }

  function dateFormatOptions(optionsOrTimeZone, localeOverride) {
    if (optionsOrTimeZone && typeof optionsOrTimeZone === 'object') {
      return {
        locale: String(optionsOrTimeZone.locale || DEFAULT_LOCALE),
        timeZone: String(optionsOrTimeZone.timeZone || DEFAULT_TIME_ZONE),
      };
    }
    return {
      locale: String(localeOverride || DEFAULT_LOCALE),
      timeZone: String(optionsOrTimeZone || DEFAULT_TIME_ZONE),
    };
  }

  function formatSubmittedAt(value, optionsOrTimeZone, localeOverride) {
    const timestamp = sanitizeTimestamp(value);
    if (timestamp === null) return UNKNOWN;
    const config = dateFormatOptions(optionsOrTimeZone, localeOverride);
    try {
      const parts = new Intl.DateTimeFormat(config.locale, {
        timeZone: config.timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(timestamp);
      const values = {};
      parts.forEach((part) => {
        if (part.type !== 'literal') values[part.type] = part.value;
      });
      if (!values.year || !values.month || !values.day || !values.hour || !values.minute) return UNKNOWN;
      return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
    } catch (_error) {
      return UNKNOWN;
    }
  }

  function cleanText(value, fallback) {
    const text = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
    return text || fallback;
  }

  function nonNegativeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function nonNegativeInteger(value) {
    return Math.floor(nonNegativeNumber(value));
  }

  function displayNumber(value) {
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  }

  function displayPercent(value) {
    if (value === null) return UNKNOWN;
    const rounded = Math.round(value * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
  }

  function displayBand(value) {
    return Number.isFinite(value) ? Number(value).toFixed(1) : UNKNOWN;
  }

  function displaySignedNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return UNKNOWN;
    if (number === 0) return '无变化';
    return `${number > 0 ? '+' : '−'}${displayNumber(Math.abs(number))}`;
  }

  function displaySignedPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return UNKNOWN;
    if (number === 0) return '无变化';
    const magnitude = Math.round(Math.abs(number) * 10) / 10;
    return `${number > 0 ? '+' : '−'}${Number.isInteger(magnitude) ? magnitude : magnitude.toFixed(1)}%`;
  }

  function displaySignedElapsed(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return UNKNOWN;
    if (number === 0) return '无变化';
    return `${number > 0 ? '+' : '−'}${formatElapsed(Math.abs(number))}`;
  }

  function academicReadingBand(rawScore) {
    if (typeof rawScore !== 'number' || !Number.isInteger(rawScore) || rawScore < 0 || rawScore > 40) return null;
    const score = rawScore;
    const match = ACADEMIC_READING_BAND_THRESHOLDS.find((entry) => score >= entry.minimum);
    return match ? match.band : null;
  }

  function sanitizeDifficultyTier(value) {
    const aliases = {
      easy: 'easy',
      standard: 'standard',
      hard: 'hard',
      '偏易': 'easy',
      '标准': 'standard',
      '偏难': 'hard',
    };
    return aliases[String(value == null ? '' : value).trim()] || null;
  }

  function createReferenceBand(input, passages, score, completion) {
    const context = input && typeof input === 'object' ? input : {};
    const passageCount = Array.isArray(passages) ? passages.length : 0;
    const eligible = context.testType === 'academic-reading' &&
      context.compositionMode === 'full-passage' &&
      context.fullPassageSelection === true &&
      passageCount === 3 &&
      score.availableMarks === 40 &&
      completion.total === 40 &&
      passages.every((passage) => passage.score.availableMarks > 0) &&
      passages.reduce((sum, passage) => sum + passage.score.availableMarks, 0) === 40;
    const value = eligible ? academicReadingBand(score.earnedMarks) : null;
    return Object.freeze({
      eligible: eligible && value !== null,
      value,
      note: eligible && value !== null ? ACADEMIC_READING_BAND_NOTE : null,
    });
  }

  function createAttemptHistory(records, options) {
    const config = options && typeof options === 'object' ? options : {};
    const assignmentCode = sanitizeAssignmentCode(config.assignmentCode);
    const locale = cleanText(config.locale, DEFAULT_LOCALE);
    const timeZone = cleanText(config.timeZone, DEFAULT_TIME_ZONE);
    const seen = new Set();
    const rows = (Array.isArray(records) ? records : []).map((entry) => {
      const source = entry && typeof entry === 'object' ? entry : {};
      const attemptNumber = Number.isInteger(source.attemptNumber) && source.attemptNumber > 0
        ? source.attemptNumber
        : null;
      const marker = assignmentCode && attemptNumber !== null
        ? `${assignmentCode}-A${attemptNumber}`
        : null;
      const availableMarks = Number(source.availableMarks);
      const earnedMarks = Number(source.earnedMarks);
      const total = Number(source.total);
      const answered = Number(source.answered);
      const elapsed = sanitizeElapsed(source.elapsedSeconds);
      const submittedAt = sanitizeTimestamp(source.submittedAt);
      if (attemptNumber === null || seen.has(attemptNumber) || source.attemptMarker !== marker ||
          !Number.isFinite(availableMarks) || availableMarks < 0 ||
          !Number.isFinite(earnedMarks) || earnedMarks < 0 || earnedMarks > availableMarks ||
          !Number.isInteger(total) || total < 0 || !Number.isInteger(answered) || answered < 0 || answered > total) {
        return null;
      }
      seen.add(attemptNumber);
      const accuracyPercent = availableMarks > 0 ? (earnedMarks / availableMarks) * 100 : null;
      return Object.freeze({
        attemptNumber,
        attemptMarker: marker,
        submittedAt,
        elapsedSeconds: elapsed,
        score: Object.freeze({ earnedMarks, availableMarks, accuracyPercent }),
        completion: Object.freeze({ answered, total }),
        display: Object.freeze({
          record: `A${attemptNumber}`,
          submittedAt: formatSubmittedAt(submittedAt, { locale, timeZone }),
          score: availableMarks > 0 ? `${displayNumber(earnedMarks)}/${displayNumber(availableMarks)}` : UNKNOWN,
          accuracy: displayPercent(accuracyPercent),
          completion: total > 0 ? `${answered}/${total}` : UNKNOWN,
          elapsed: formatElapsed(elapsed),
        }),
      });
    }).filter(Boolean).sort((left, right) => left.attemptNumber - right.attemptNumber);

    const baseline = rows.length > 1 ? rows[0] : null;
    const current = rows.length > 1 ? rows[rows.length - 1] : null;
    const comparison = baseline && current ? Object.freeze({
      baselineAttemptNumber: baseline.attemptNumber,
      currentAttemptNumber: current.attemptNumber,
      scoreDelta: current.score.earnedMarks - baseline.score.earnedMarks,
      accuracyDelta: current.score.accuracyPercent === null || baseline.score.accuracyPercent === null
        ? null
        : current.score.accuracyPercent - baseline.score.accuracyPercent,
      answeredDelta: current.completion.answered - baseline.completion.answered,
      elapsedDelta: current.elapsedSeconds === null || baseline.elapsedSeconds === null
        ? null
        : current.elapsedSeconds - baseline.elapsedSeconds,
      display: Object.freeze({
        scoreDelta: displaySignedNumber(current.score.earnedMarks - baseline.score.earnedMarks),
        accuracyDelta: current.score.accuracyPercent === null || baseline.score.accuracyPercent === null
          ? UNKNOWN
          : displaySignedPercent(current.score.accuracyPercent - baseline.score.accuracyPercent),
        answeredDelta: displaySignedNumber(current.completion.answered - baseline.completion.answered),
        elapsedDelta: current.elapsedSeconds === null || baseline.elapsedSeconds === null
          ? UNKNOWN
          : displaySignedElapsed(current.elapsedSeconds - baseline.elapsedSeconds),
      }),
    }) : null;
    return Object.freeze({ rows: Object.freeze(rows), comparison });
  }

  function sanitizeAssignmentCode(value) {
    const text = cleanText(value, '');
    return /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{2}$/u.test(text) ? text : null;
  }

  function sanitizeAttempt(input) {
    const source = input && typeof input === 'object' ? input : {};
    const assignmentCode = sanitizeAssignmentCode(source.assignmentCode);
    const attemptNumber = Number.isInteger(source.attemptNumber) && source.attemptNumber > 0
      ? source.attemptNumber
      : null;
    const expectedMarker = assignmentCode && attemptNumber !== null
      ? `${assignmentCode}-A${attemptNumber}`
      : null;
    const attemptMarker = typeof source.attemptMarker === 'string' && source.attemptMarker === expectedMarker
      ? source.attemptMarker
      : null;
    const recorded = Boolean(assignmentCode && attemptNumber !== null && attemptMarker);
    return Object.freeze({
      assignmentCode,
      attemptNumber: recorded ? attemptNumber : null,
      attemptMarker: recorded ? attemptMarker : null,
      recorded,
    });
  }

  function createReportModel(input) {
    const source = input && typeof input === 'object' ? input : {};
    const scoreSource = source.score && typeof source.score === 'object' ? source.score : {};
    const completionSource = source.completion && typeof source.completion === 'object' ? source.completion : {};
    const statusSource = source.statusCounts && typeof source.statusCounts === 'object'
      ? source.statusCounts
      : source.status && typeof source.status === 'object'
        ? source.status
        : source;

    const assignmentTitle = cleanText(source.assignmentTitle, DEFAULT_ASSIGNMENT_TITLE);
    const passageTitles = (Array.isArray(source.passageTitles) ? source.passageTitles : [])
      .map((title) => cleanText(title, ''))
      .filter(Boolean);
    const passageSource = Array.isArray(source.passages) ? source.passages : passageTitles.map((title, index) => ({
      part: index + 1,
      label: `Passage ${index + 1}`,
      title,
    }));
    const partTimingComplete = source.partTimingComplete === true;
    const partElapsedMilliseconds = sanitizePartElapsedMilliseconds(source.partElapsedMilliseconds);
    const passages = Object.freeze(passageSource.map((entry, index) => {
      const item = entry && typeof entry === 'object' ? entry : {};
      const part = sanitizePartNumber(item.part) || index + 1;
      const label = cleanText(item.label, `Passage ${part}`);
      const title = cleanText(item.title, passageTitles[index] || label);
      const scoreSource = item.score && typeof item.score === 'object' ? item.score : item;
      const availableMarks = nonNegativeNumber(scoreSource.availableMarks);
      const earnedMarks = Math.min(nonNegativeNumber(scoreSource.earnedMarks), availableMarks);
      const accuracyPercent = availableMarks > 0 ? (earnedMarks / availableMarks) * 100 : null;
      const completionSource = item.completion && typeof item.completion === 'object' ? item.completion : item;
      const completionTotal = nonNegativeInteger(completionSource.total);
      const completionAnswered = Math.min(nonNegativeInteger(completionSource.answered), completionTotal);
      const difficultyTier = sanitizeDifficultyTier(item.difficultyTier);
      const elapsedMilliseconds = partTimingComplete
        ? (sanitizeElapsedMilliseconds(partElapsedMilliseconds[String(part)]) || 0)
        : null;
      const durationSeconds = elapsedMilliseconds === null ? null : Math.floor(elapsedMilliseconds / 1000);
      return Object.freeze({
        part,
        label,
        title,
        difficultyTier,
        score: Object.freeze({ earnedMarks, availableMarks, accuracyPercent }),
        completion: Object.freeze({ answered: completionAnswered, total: completionTotal }),
        timing: Object.freeze({ elapsedMilliseconds, elapsedSeconds: durationSeconds }),
        display: Object.freeze({
          score: availableMarks > 0 ? `${displayNumber(earnedMarks)}/${displayNumber(availableMarks)}` : UNKNOWN,
          accuracy: displayPercent(accuracyPercent),
          completion: completionTotal > 0 ? `${completionAnswered}/${completionTotal}` : UNKNOWN,
          elapsed: formatElapsed(durationSeconds),
        }),
      });
    }));

    const availableMarks = nonNegativeNumber(scoreSource.availableMarks);
    const earnedMarks = Math.min(nonNegativeNumber(scoreSource.earnedMarks), availableMarks);
    const accuracyPercent = availableMarks > 0 ? (earnedMarks / availableMarks) * 100 : null;

    const completionTotal = nonNegativeInteger(completionSource.total);
    const completionAnswered = Math.min(nonNegativeInteger(completionSource.answered), completionTotal);
    const statusCounts = Object.freeze({
      correct: nonNegativeInteger(statusSource.correct),
      incorrect: nonNegativeInteger(statusSource.incorrect),
      unanswered: nonNegativeInteger(statusSource.unanswered),
    });

    const startedAt = sanitizeTimestamp(source.startedAt);
    const submittedAt = sanitizeTimestamp(source.submittedAt);
    const frozenElapsed = source.elapsedSeconds !== undefined ? source.elapsedSeconds : source.elapsed;
    const durationSeconds = elapsedSeconds(startedAt, submittedAt, frozenElapsed);
    const locale = cleanText(source.locale, DEFAULT_LOCALE);
    const timeZone = cleanText(source.timeZone, DEFAULT_TIME_ZONE);
    const shortFingerprint = cleanText(source.shortFingerprint, '');
    const attempt = sanitizeAttempt(source.attempt);

    const score = Object.freeze({ earnedMarks, availableMarks, accuracyPercent });
    const completion = Object.freeze({ answered: completionAnswered, total: completionTotal });
    const timing = Object.freeze({ startedAt, submittedAt, elapsedSeconds: durationSeconds });
    const referenceBand = createReferenceBand(source.bandContext, passages, score, completion);
    const attemptHistory = createAttemptHistory(source.attemptHistory, {
      assignmentCode: attempt.assignmentCode,
      locale,
      timeZone,
    });
    const display = Object.freeze({
      assignmentTitle,
      passageTitles: Object.freeze([...passageTitles]),
      passageScope: passageTitles.length ? passageTitles.join(' · ') : UNKNOWN,
      score: availableMarks > 0 ? `${displayNumber(earnedMarks)}/${displayNumber(availableMarks)}` : UNKNOWN,
      referenceBand: referenceBand.eligible ? displayBand(referenceBand.value) : UNKNOWN,
      accuracy: displayPercent(accuracyPercent),
      completion: completionTotal > 0 ? `${completionAnswered}/${completionTotal}` : UNKNOWN,
      status: `正确 ${statusCounts.correct} · 已答未得分 ${statusCounts.incorrect} · 未作答 ${statusCounts.unanswered}`,
      elapsed: formatElapsed(durationSeconds),
      submittedAt: formatSubmittedAt(submittedAt, { locale, timeZone }),
      shortFingerprint: shortFingerprint || UNKNOWN,
      assignmentCode: attempt.assignmentCode || UNKNOWN,
      attemptMarker: attempt.attemptMarker || UNKNOWN,
      recordLabel: attempt.recorded ? `A${attempt.attemptNumber}` : UNKNOWN,
    });

    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      assignmentTitle,
      passageTitles: Object.freeze([...passageTitles]),
      passages,
      score,
      completion,
      statusCounts,
      timing,
      referenceBand,
      shortFingerprint,
      attempt,
      attemptHistory,
      display,
    });
  }

  return Object.freeze({
    SCHEMA_VERSION,
    PART_TIMING_SCHEMA_VERSION,
    sanitizeTimestamp,
    sanitizePartElapsedMilliseconds,
    settlePartTiming,
    elapsedSeconds,
    formatElapsed,
    formatSubmittedAt,
    academicReadingBand,
    createAttemptHistory,
    sanitizeAttempt,
    createReportModel,
  });
});

    