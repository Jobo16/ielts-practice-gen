
(function (root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.IELTSAttemptLedger = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 'ielts-reading-attempt-ledger.v1';
  const MAX_HISTORY = 20;
  const RECORD_FIELDS = Object.freeze([
    'submissionId',
    'attemptNumber',
    'attemptMarker',
    'submittedAt',
    'elapsedSeconds',
    'earnedMarks',
    'availableMarks',
    'answered',
    'total',
    'migrated',
  ]);
  const INVALID = Symbol('invalid');

  function fullSnapshotHash(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    const match = text.match(/^(?:sha256:|homework\.snapshot\.)?([0-9a-f]{64})$/iu);
    return match ? match[1].toLowerCase() : null;
  }

  function snapshotHashFromIdentity(identity) {
    const direct = fullSnapshotHash(identity);
    if (direct) return direct;
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return null;

    const candidates = [
      identity.snapshotHash,
      identity.assignmentIdentity,
      identity.homeworkSnapshot,
      identity.snapshot,
      identity.manifest && identity.manifest.extensions && identity.manifest.extensions.homeworkSnapshot,
    ];
    for (const candidate of candidates) {
      const nestedDirect = fullSnapshotHash(candidate);
      if (nestedDirect) return nestedDirect;
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        const nestedHash = fullSnapshotHash(candidate.snapshotHash);
        if (nestedHash) return nestedHash;
      }
    }
    return null;
  }

  function assignmentCodeFromIdentity(identity) {
    const snapshotHash = snapshotHashFromIdentity(identity);
    if (!snapshotHash) return null;
    const compact = snapshotHash.slice(0, 10).toUpperCase();
    return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 10)}`;
  }

  function validAssignmentCode(value) {
    return typeof value === 'string' && /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{2}$/u.test(value);
  }

  function positiveInteger(value) {
    const number = typeof value === 'number' ? value : Number.NaN;
    return Number.isInteger(number) && number > 0 ? number : null;
  }

  function nonNegativeInteger(value) {
    const number = typeof value === 'number' ? value : Number.NaN;
    return Number.isInteger(number) && number >= 0 ? number : null;
  }

  function optionalNonNegativeInteger(value) {
    if (value === null || value === undefined || value === '') return null;
    const normalized = nonNegativeInteger(value);
    return normalized === null ? INVALID : normalized;
  }

  function optionalNonNegativeNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = typeof value === 'number' ? value : Number.NaN;
    return Number.isFinite(number) && number >= 0 ? number : INVALID;
  }

  function optionalTimestamp(value) {
    if (value === null || value === undefined || value === '') return null;
    let timestamp = null;
    if (value instanceof Date) timestamp = value.getTime();
    else if (typeof value === 'number') timestamp = value;
    else if (typeof value === 'string' && value.trim() && !/^\d+(?:\.\d+)?$/u.test(value.trim())) {
      timestamp = Date.parse(value.trim());
    }
    if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > 8640000000000000) return INVALID;
    return Math.trunc(timestamp);
  }

  function cleanSubmissionId(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (text.length < 8 || text.length > 160 || !/^[A-Za-z0-9._:-]+$/u.test(text)) return null;
    return text;
  }

  function formatAttemptMarker(assignmentCode, attemptNumber) {
    const number = positiveInteger(attemptNumber);
    if (!validAssignmentCode(assignmentCode) || number === null) return null;
    return `${assignmentCode}-A${number}`;
  }

  function freezeRecord(record) {
    return Object.freeze(record);
  }

  function cleanRecord(source, assignmentCode, forcedAttemptNumber, existingRecord) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    const submissionId = cleanSubmissionId(source.submissionId);
    const attemptNumber = forcedAttemptNumber === undefined
      ? positiveInteger(source.attemptNumber)
      : positiveInteger(forcedAttemptNumber);
    if (!submissionId || attemptNumber === null) return null;

    const attemptMarker = formatAttemptMarker(assignmentCode, attemptNumber);
    if (!attemptMarker || (existingRecord && source.attemptMarker !== attemptMarker)) return null;

    const submittedAt = optionalTimestamp(source.submittedAt);
    const elapsedSeconds = optionalNonNegativeInteger(source.elapsedSeconds);
    const earnedMarks = optionalNonNegativeNumber(source.earnedMarks);
    const availableMarks = optionalNonNegativeNumber(source.availableMarks);
    const answered = optionalNonNegativeInteger(source.answered);
    const total = optionalNonNegativeInteger(source.total);
    if ([submittedAt, elapsedSeconds, earnedMarks, availableMarks, answered, total].includes(INVALID)) return null;
    if ((earnedMarks === null) !== (availableMarks === null) ||
        (earnedMarks !== null && earnedMarks > availableMarks)) return null;
    if ((answered === null) !== (total === null) || (answered !== null && answered > total)) return null;
    if (existingRecord && typeof source.migrated !== 'boolean') return null;

    return freezeRecord({
      submissionId,
      attemptNumber,
      attemptMarker,
      submittedAt,
      elapsedSeconds,
      earnedMarks,
      availableMarks,
      answered,
      total,
      migrated: source.migrated === true,
    });
  }

  function createEmptyLedger(identity) {
    const assignmentCode = assignmentCodeFromIdentity(identity);
    if (!assignmentCode) return null;
    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      assignmentCode,
      submissionCount: 0,
      seenSubmissionIds: Object.freeze([]),
      history: Object.freeze([]),
    });
  }

  function result(status, ledger, reason) {
    return Object.freeze({
      status,
      valid: status !== 'invalid',
      reason: reason || null,
      ledger,
    });
  }

  function parseRawLedger(rawLedger) {
    if (rawLedger === null || rawLedger === undefined || rawLedger === '') return { empty: true, value: null };
    if (typeof rawLedger !== 'string') return { empty: false, value: rawLedger };
    if (!rawLedger.trim()) return { empty: true, value: null };
    try {
      return { empty: false, value: JSON.parse(rawLedger) };
    } catch (_error) {
      return { empty: false, error: 'malformed-json' };
    }
  }

  function invalidResult(identity, reason) {
    return result('invalid', createEmptyLedger(identity), reason);
  }

  function sanitizeLedger(rawLedger, identity) {
    const emptyLedger = createEmptyLedger(identity);
    if (!emptyLedger) return result('invalid', null, 'invalid-assignment-identity');

    const parsed = parseRawLedger(rawLedger);
    if (parsed.empty) return result('empty', emptyLedger, null);
    if (parsed.error) return result('invalid', emptyLedger, parsed.error);

    const source = parsed.value;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return result('invalid', emptyLedger, 'invalid-ledger-shape');
    }
    if (source.schemaVersion !== SCHEMA_VERSION) return result('invalid', emptyLedger, 'schema-mismatch');
    if (source.assignmentCode !== emptyLedger.assignmentCode) {
      return result('invalid', emptyLedger, 'assignment-code-mismatch');
    }

    const submissionCount = nonNegativeInteger(source.submissionCount);
    if (submissionCount === null) return result('invalid', emptyLedger, 'invalid-submission-count');
    if (!Array.isArray(source.seenSubmissionIds)) {
      return result('invalid', emptyLedger, 'invalid-submission-ids');
    }
    if (!Array.isArray(source.history)) return result('invalid', emptyLedger, 'invalid-history');

    const seenSubmissionIds = [];
    const seenSubmissionIdSet = new Set();
    for (const value of source.seenSubmissionIds) {
      const submissionId = cleanSubmissionId(value);
      if (!submissionId || seenSubmissionIdSet.has(submissionId)) {
        return result('invalid', emptyLedger, 'invalid-submission-ids');
      }
      seenSubmissionIdSet.add(submissionId);
      seenSubmissionIds.push(submissionId);
    }
    if (seenSubmissionIds.length !== submissionCount) {
      return result('invalid', emptyLedger, 'invalid-submission-count');
    }

    const history = [];
    const submissionIds = new Set();
    const attemptNumbers = new Set();
    for (const entry of source.history) {
      const record = cleanRecord(entry, emptyLedger.assignmentCode, undefined, true);
      if (!record || submissionIds.has(record.submissionId) || attemptNumbers.has(record.attemptNumber)) {
        return result('invalid', emptyLedger, 'invalid-history');
      }
      submissionIds.add(record.submissionId);
      attemptNumbers.add(record.attemptNumber);
      history.push(record);
    }
    history.sort((first, second) => first.attemptNumber - second.attemptNumber);

    if ((submissionCount === 0) !== (history.length === 0)) {
      return result('invalid', emptyLedger, 'invalid-history-count');
    }
    if (history.length) {
      const firstExpected = submissionCount - history.length + 1;
      if (firstExpected < 1 || history.some((record, index) => record.attemptNumber !== firstExpected + index)) {
        return result('invalid', emptyLedger, 'invalid-history-sequence');
      }
      if (history.some((record) => seenSubmissionIds[record.attemptNumber - 1] !== record.submissionId)) {
        return result('invalid', emptyLedger, 'invalid-history-sequence');
      }
    }

    const recentHistory = Object.freeze(history.slice(-MAX_HISTORY));
    const ledger = Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      assignmentCode: emptyLedger.assignmentCode,
      submissionCount,
      seenSubmissionIds: Object.freeze(seenSubmissionIds),
      history: recentHistory,
    });
    return result('valid', ledger, null);
  }

  function submissionResult(status, ledger, record, reason) {
    return Object.freeze({
      status,
      recorded: status === 'recorded',
      duplicate: status === 'duplicate',
      reason: reason || null,
      record: record || null,
      ledger,
    });
  }

  function recordSubmission(rawLedger, identity, submission) {
    const sanitized = sanitizeLedger(rawLedger, identity);
    if (!sanitized.valid) {
      return submissionResult('invalid', sanitized.ledger, null, sanitized.reason);
    }

    const source = submission && typeof submission === 'object' ? submission : null;
    const candidateSubmissionId = source && cleanSubmissionId(source.submissionId);
    if (!candidateSubmissionId) {
      return submissionResult('invalid', sanitized.ledger, null, 'invalid-submission');
    }

    if (sanitized.ledger.seenSubmissionIds.includes(candidateSubmissionId)) {
      const duplicate = sanitized.ledger.history.find((record) => record.submissionId === candidateSubmissionId) || null;
      return submissionResult('duplicate', sanitized.ledger, duplicate, null);
    }

    const attemptNumber = sanitized.ledger.submissionCount + 1;
    const record = cleanRecord(source, sanitized.ledger.assignmentCode, attemptNumber, false);
    if (!record) return submissionResult('invalid', sanitized.ledger, null, 'invalid-submission');

    const history = Object.freeze([...sanitized.ledger.history, record].slice(-MAX_HISTORY));
    const ledger = Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      assignmentCode: sanitized.ledger.assignmentCode,
      submissionCount: attemptNumber,
      seenSubmissionIds: Object.freeze([...sanitized.ledger.seenSubmissionIds, record.submissionId]),
      history,
    });
    return submissionResult('recorded', ledger, record, null);
  }

  return Object.freeze({
    SCHEMA_VERSION,
    MAX_HISTORY,
    RECORD_FIELDS,
    assignmentCodeFromIdentity,
    formatAttemptMarker,
    createEmptyLedger,
    sanitizeLedger,
    recordSubmission,
  });
});

    