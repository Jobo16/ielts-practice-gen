(function attachStudentRecordStore(global) {
  "use strict";

  var SCHEMA_VERSION = "zyz-reading-student-records.v1";
  var DEFAULT_DB_NAME = "zyz-reading-t36-evidence-toggle-display-number-fix-demo-only-20260903-r3-records";
  var DEFAULT_STORE_NAME = "records";
  var DEFAULT_SNAPSHOT_STORE_NAME = "attemptSnapshots";
  var DEFAULT_FALLBACK_KEY = "zyz-reading-t36-evidence-toggle-display-number-fix-demo-only-20260903-r3:records-fallback";
  var DEFAULT_SNAPSHOT_FALLBACK_KEY = "zyz-reading-t36-evidence-toggle-display-number-fix-demo-only-20260903-r3:attempt-snapshots";
  var DEFAULT_PREFERENCES_KEY = "zyz-reading-t36-evidence-toggle-display-number-fix-demo-only-20260903-r3:preferences";
  var ATTEMPT_SNAPSHOT_SCHEMA_VERSION = "zyz-reading-private-attempt-snapshot.v1";
  var PERSONAL_BACKUP_SCHEMA_VERSION = "zyz-reading-personal-backup.v1";
  var REPLAY_BOOT_CONTEXT_SCHEMA_VERSION = "zyz-reading-replay-boot-context.v1";
  var ANNOTATION_OVERLAY_SCHEMA_VERSION = "zyz-reading-attempt-annotation-overlay.v1";
  var DB_VERSION = 2;
  var OPEN_TIMEOUT_MS = 2600;
  var MAX_RECORDS = 20000;
  var MAX_ATTEMPT_SNAPSHOTS = 250;
  var MAX_ATTEMPT_SNAPSHOT_BYTES = 1048576;
  var MAX_SNAPSHOT_DEPTH = 16;
  var MAX_SNAPSHOT_NODES = 25000;
  var MAX_SNAPSHOT_ARRAY_ITEMS = 10000;
  var MAX_TEXT_LENGTH = 500;
  var ALLOWED_RECORD_TYPES = ["visited", "started", "submitted"];
  var ALLOWED_OUTCOME_STATUSES = ["correct", "partial", "incorrect", "unanswered"];
  var FORBIDDEN_SNAPSHOT_KEYS = [
    "answerkey", "review", "generatedhtml", "packagedata",
    "correctanswer", "correctanswers", "answerdisplay", "reviewentries",
    "accepted", "acceptedvalues", "solution", "solutions", "correctoption", "correctoptions",
    "explanation", "explanations", "rationale", "rationales", "analysis", "feedback", "sourcequote",
    "passagetext", "passagehtml", "passagebody", "passagecontent",
    "articletext", "articlehtml", "articlebody", "articlecontent",
    "fulltext", "fullhtml", "sourcetext", "sourcehtml", "sourcecontent",
    "runtimehtml", "runtimetemplate", "studenthtml", "documenthtml", "bodyhtml",
    "questionbank", "questiondata", "questioncontent", "contentlibrary", "library",
    "__proto__", "prototype", "constructor"
  ];
  var FORBIDDEN_SNAPSHOT_KEY_PREFIXES = [
    "answerkey", "correctanswer", "acceptedvalue", "reviewentr", "explanation", "rationale",
    "sourcequote", "generatedhtml", "packagedata", "passagetext", "passagehtml", "passagebody",
    "passagecontent", "articletext", "articlehtml", "articlebody", "articlecontent", "fullpassage",
    "runtimehtml", "runtimetemplate", "studenthtml", "documenthtml", "questionbank", "questiondata"
  ];

  function nowIso() {
    return new Date().toISOString();
  }

  function toIso(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback || nowIso();
    var date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? (fallback || nowIso()) : date.toISOString();
  }

  function finiteNumber(value, fallback, minimum, maximum) {
    var number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    if (Number.isFinite(minimum)) number = Math.max(minimum, number);
    if (Number.isFinite(maximum)) number = Math.min(maximum, number);
    return number;
  }

  function integer(value, fallback, minimum, maximum) {
    var number = finiteNumber(value, fallback, minimum, maximum);
    return Number.isFinite(number) ? Math.round(number) : fallback;
  }

  function safeText(value, maximum) {
    if (value === undefined || value === null) return "";
    return String(value).trim().slice(0, maximum || MAX_TEXT_LENGTH);
  }

  function uniqueTextList(value, maximumItems) {
    if (!Array.isArray(value)) return [];
    var seen = Object.create(null);
    var output = [];
    value.forEach(function each(item) {
      var text = safeText(item, 180);
      if (!text || seen[text] || output.length >= (maximumItems || 200)) return;
      seen[text] = true;
      output.push(text);
    });
    return output;
  }

  function cloneJson(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function utf8ByteLength(value) {
    var text = String(value || "");
    var length = 0;
    for (var index = 0; index < text.length; index += 1) {
      var code = text.charCodeAt(index);
      if (code < 0x80) length += 1;
      else if (code < 0x800) length += 2;
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length &&
          text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
        length += 4;
        index += 1;
      } else length += 3;
    }
    return length;
  }

  function normalizedObjectKey(value) {
    return String(value).replace(/[\s_-]/g, "").toLowerCase();
  }

  function isForbiddenSnapshotKey(value) {
    var normalizedKey = normalizedObjectKey(value);
    if (FORBIDDEN_SNAPSHOT_KEYS.indexOf(normalizedKey) >= 0) return true;
    return FORBIDDEN_SNAPSHOT_KEY_PREFIXES.some(function matchesPrefix(prefix) {
      return normalizedKey.indexOf(prefix) === 0;
    });
  }

  function sanitizeAttemptSnapshotPayload(value, maximumBytes) {
    if (!value || Object.prototype.toString.call(value) !== "[object Object]") {
      throw new Error("Attempt snapshot payload must be a JSON object");
    }
    var seen = typeof WeakSet === "function" ? new WeakSet() : [];
    var nodes = 0;

    function hasSeen(node) {
      if (seen instanceof Array) {
        if (seen.indexOf(node) >= 0) return true;
        seen.push(node);
        return false;
      }
      if (seen.has(node)) return true;
      seen.add(node);
      return false;
    }

    function visit(node, depth) {
      nodes += 1;
      if (nodes > MAX_SNAPSHOT_NODES) throw new Error("Attempt snapshot contains too many values");
      if (depth > MAX_SNAPSHOT_DEPTH) throw new Error("Attempt snapshot is nested too deeply");
      if (node === null || typeof node === "boolean" || typeof node === "string") return node;
      if (typeof node === "number") {
        if (!Number.isFinite(node)) throw new Error("Attempt snapshot numbers must be finite");
        return node;
      }
      if (typeof node !== "object") throw new Error("Attempt snapshot must contain JSON values only");
      if (hasSeen(node)) throw new Error("Attempt snapshot must not contain circular references");
      if (Array.isArray(node)) {
        if (node.length > MAX_SNAPSHOT_ARRAY_ITEMS) throw new Error("Attempt snapshot array is too large");
        return node.map(function mapItem(item) { return visit(item, depth + 1); });
      }
      if (Object.prototype.toString.call(node) !== "[object Object]") {
        throw new Error("Attempt snapshot must contain plain JSON objects only");
      }
      var output = {};
      Object.keys(node).forEach(function copyKey(key) {
        if (isForbiddenSnapshotKey(key)) {
          throw new Error("Attempt snapshot contains forbidden field: " + key);
        }
        output[key] = visit(node[key], depth + 1);
      });
      return output;
    }

    var payload = visit(value, 0);
    var json = JSON.stringify(payload);
    var byteSize = utf8ByteLength(json);
    if (byteSize > maximumBytes) {
      throw new Error("Attempt snapshot exceeds the private storage size limit");
    }
    return { payload: JSON.parse(json), byteSize: byteSize };
  }

  function normalizeAttemptSnapshotId(value) {
    var original = value === undefined || value === null ? "" : String(value).trim();
    if (!original) throw new Error("Attempt snapshot id is required");
    if (original.length > 220) throw new Error("Attempt snapshot id is too long");
    return original;
  }

  function sanitizeAttemptSnapshotEntry(value, maximumBytes) {
    if (!value || typeof value !== "object") return null;
    var snapshotId;
    try {
      snapshotId = normalizeAttemptSnapshotId(value.snapshotId);
      var sanitized = sanitizeAttemptSnapshotPayload(value.payload, maximumBytes);
      return {
        schemaVersion: ATTEMPT_SNAPSHOT_SCHEMA_VERSION,
        snapshotId: snapshotId,
        updatedAt: toIso(value.updatedAt, nowIso()),
        byteSize: sanitized.byteSize,
        payload: sanitized.payload
      };
    } catch (error) {
      return null;
    }
  }

  function sanitizeAnnotationData(value) {
    var source = value && typeof value === "object" ? value : {};
    var highlights = source.highlights && Object.prototype.toString.call(source.highlights) === "[object Object]"
      ? source.highlights
      : {};
    var questionHighlights = source.questionHighlights && Object.prototype.toString.call(source.questionHighlights) === "[object Object]"
      ? source.questionHighlights
      : {};
    var notes = Array.isArray(source.notes) ? source.notes : [];
    var data = { highlights: highlights, questionHighlights: questionHighlights, notes: notes };
    if (Object.prototype.hasOwnProperty.call(source, "questionFlags")) {
      var rawFlags = source.questionFlags;
      var flags = {};
      if (rawFlags && Object.prototype.toString.call(rawFlags) === "[object Object]") {
        Object.keys(rawFlags).forEach(function(key) {
          if (key.length > 0 && key.length <= 220 && ["__proto__", "prototype", "constructor"].indexOf(key) < 0 && rawFlags[key] === true) flags[key] = true;
        });
      }
      data.questionFlags = flags;
    }
    return sanitizeAttemptSnapshotPayload(data, MAX_ATTEMPT_SNAPSHOT_BYTES).payload;
  }

  function annotationFailure(message, code) {
    var error = new Error(message);
    error.code = code || "annotation-overlay-invalid";
    return error;
  }

  function attemptAnnotationState(record, snapshot, guardOptions) {
    guardOptions = guardOptions && typeof guardOptions === "object" ? guardOptions : {};
    if (!record || record.type !== "submitted") {
      throw annotationFailure("The submission record no longer exists", "annotation-record-missing");
    }
    if (!snapshot || !snapshot.payload || typeof snapshot.payload !== "object") {
      throw annotationFailure("The replay snapshot no longer exists", "annotation-snapshot-missing");
    }
    var payload = snapshot.payload;
    var runtimeState = payload.runtimeState;
    var recordId = normalizeAttemptSnapshotId(record.recordId);
    var submissionId = safeText(runtimeState && runtimeState.submissionId, 220);
    var snapshotHash = safeText(payload.snapshotHash, 220);
    var contentVersion = safeText(payload.packageContentVersion, 220);
    if (!runtimeState || typeof runtimeState !== "object" || runtimeState.submitted !== true ||
        submissionId !== recordId || snapshot.snapshotId !== recordId) {
      throw annotationFailure("The replay snapshot submission identity is invalid", "annotation-identity-mismatch");
    }
    if (!snapshotHash || snapshotHash !== safeText(record.snapshotHash, 220)) {
      throw annotationFailure("The replay snapshot does not match the submission summary", "annotation-snapshot-mismatch");
    }
    if (safeText(record.packageContentVersion, 220) && contentVersion !== safeText(record.packageContentVersion, 220)) {
      throw annotationFailure("The replay snapshot content version is invalid", "annotation-content-version-mismatch");
    }
    if (guardOptions.expectedSubmissionId && submissionId !== safeText(guardOptions.expectedSubmissionId, 220)) {
      throw annotationFailure("The expected submission identity changed", "annotation-identity-mismatch");
    }
    if (guardOptions.expectedSnapshotHash && snapshotHash !== safeText(guardOptions.expectedSnapshotHash, 220)) {
      throw annotationFailure("The expected replay snapshot changed", "annotation-snapshot-mismatch");
    }
    if (guardOptions.expectedContentVersion && contentVersion !== safeText(guardOptions.expectedContentVersion, 220)) {
      throw annotationFailure("The expected content version changed", "annotation-content-version-mismatch");
    }
    var overlay = payload.annotationOverlay;
    var revision = 0;
    var annotationData;
    if (overlay !== undefined) {
      if (!overlay || typeof overlay !== "object" || overlay.schemaVersion !== ANNOTATION_OVERLAY_SCHEMA_VERSION ||
          safeText(overlay.submissionId, 220) !== submissionId ||
          safeText(overlay.snapshotHash, 220) !== snapshotHash ||
          safeText(overlay.packageContentVersion, 220) !== contentVersion) {
        throw annotationFailure("The replay annotation overlay identity is invalid", "annotation-overlay-invalid");
      }
      revision = integer(overlay.revision, null, 1, 1000000000);
      if (revision === null) {
        throw annotationFailure("The replay annotation overlay revision is invalid", "annotation-overlay-invalid");
      }
      annotationData = sanitizeAnnotationData(overlay);
      if (!Object.prototype.hasOwnProperty.call(annotationData, "questionFlags")) {
        annotationData.questionFlags = sanitizeAnnotationData(runtimeState).questionFlags || {};
      }
    } else {
      annotationData = sanitizeAnnotationData(runtimeState);
      if (!Object.prototype.hasOwnProperty.call(annotationData, "questionFlags")) annotationData.questionFlags = {};
    }
    return {
      recordId: recordId,
      submissionId: submissionId,
      snapshotHash: snapshotHash,
      packageContentVersion: contentVersion,
      revision: revision,
      hasOverlay: overlay !== undefined,
      overlay: overlay === undefined ? null : cloneJson(overlay),
      annotationData: annotationData,
      runtimeState: cloneJson(runtimeState),
      payload: cloneJson(payload)
    };
  }

  function sanitizePreferencesPayload(value) {
    var sanitized = sanitizeAttemptSnapshotPayload(value && typeof value === "object" ? value : {}, 200000).payload;
    var disallowed = ["answers", "highlights", "questionhighlights", "notes", "runtimestate", "attemptledger", "attemptsnapshots"];
    function inspect(node) {
      if (!node || typeof node !== "object") return;
      Object.keys(node).forEach(function inspectKey(key) {
        if (disallowed.indexOf(normalizedObjectKey(key)) >= 0) {
          throw new Error("Preferences contain private attempt data: " + key);
        }
        inspect(node[key]);
      });
    }
    inspect(sanitized);
    return sanitized;
  }

  function excelSafeCsvValue(value) {
    if (value === undefined || value === null) return "";
    var text = typeof value === "number" && Number.isFinite(value) ? String(value) : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    return "{" + Object.keys(value).sort().map(function mapKey(key) {
      return JSON.stringify(key) + ":" + stableStringify(value[key]);
    }).join(",") + "}";
  }

  function hashText(text) {
    var hashA = 2166136261;
    var hashB = 2246822519;
    for (var index = 0; index < text.length; index += 1) {
      var code = text.charCodeAt(index);
      hashA ^= code;
      hashA = Math.imul(hashA, 16777619);
      hashB ^= code + index;
      hashB = Math.imul(hashB, 3266489917);
    }
    return (hashA >>> 0).toString(36) + (hashB >>> 0).toString(36);
  }

  function attemptAssignmentCode(snapshotHash) {
    var compact = safeText(snapshotHash, 220).slice(0, 10).toUpperCase();
    return /^[0-9A-F]{10}$/.test(compact)
      ? compact.slice(0, 4) + "-" + compact.slice(4, 8) + "-" + compact.slice(8, 10)
      : "";
  }

  function syntheticReplayAttemptLedger(runtimeState, snapshotHash) {
    runtimeState = runtimeState && typeof runtimeState === "object" ? runtimeState : {};
    var submissionId = safeText(runtimeState.submissionId, 180);
    var attemptNumber = integer(runtimeState.attemptNumber, 1, 1, 1000);
    var assignmentCode = attemptAssignmentCode(snapshotHash);
    var expectedMarker = assignmentCode + "-A" + attemptNumber;
    if (!assignmentCode || !/^[A-Za-z0-9._:-]{8,180}$/.test(submissionId) ||
        runtimeState.attemptMarker !== expectedMarker) {
      throw new Error("Replay snapshot is missing a verifiable submission identity");
    }
    var seenSubmissionIds = [];
    for (var index = 0; index < attemptNumber; index += 1) {
      seenSubmissionIds.push(index === attemptNumber - 1
        ? submissionId
        : "replay.placeholder." + safeText(snapshotHash, 220).slice(0, 12) + "." + (index + 1));
    }
    var firstHistoryNumber = Math.max(1, attemptNumber - 19);
    var history = [];
    for (var number = firstHistoryNumber; number <= attemptNumber; number += 1) {
      var isCurrent = number === attemptNumber;
      history.push({
        submissionId: seenSubmissionIds[number - 1],
        attemptNumber: number,
        attemptMarker: assignmentCode + "-A" + number,
        submittedAt: isCurrent ? finiteNumber(runtimeState.submittedAt, null, 0) : null,
        elapsedSeconds: isCurrent ? finiteNumber(runtimeState.elapsedSeconds, null, 0) : null,
        earnedMarks: isCurrent ? finiteNumber(runtimeState.result && runtimeState.result.earnedMarks, null, 0) : null,
        availableMarks: isCurrent ? finiteNumber(runtimeState.result && runtimeState.result.availableMarks, null, 0) : null,
        answered: isCurrent ? finiteNumber(runtimeState.result && runtimeState.result.answered, null, 0) : null,
        total: isCurrent ? finiteNumber(runtimeState.result && runtimeState.result.total, null, 0) : null,
        migrated: false
      });
    }
    return JSON.stringify({
      schemaVersion: "ielts-reading-attempt-ledger.v1",
      assignmentCode: assignmentCode,
      submissionCount: attemptNumber,
      seenSubmissionIds: seenSubmissionIds,
      history: history
    });
  }

  function validatedReplayAttemptLedger(rawLedger, runtimeState, snapshotHash) {
    var expectedAttemptNumber = integer(runtimeState && runtimeState.attemptNumber, 1, 1, 1000);
    var expectedAttemptMarker = attemptAssignmentCode(snapshotHash) + "-A" + expectedAttemptNumber;
    if (!attemptAssignmentCode(snapshotHash) || !runtimeState || runtimeState.attemptMarker !== expectedAttemptMarker) {
      throw new Error("Replay snapshot is missing a verifiable submission identity");
    }
    if (typeof rawLedger === "string" && rawLedger.length > 0 && rawLedger.length <= 65536) {
      try {
        var parsed = JSON.parse(rawLedger);
        if (parsed && parsed.schemaVersion === "ielts-reading-attempt-ledger.v1" &&
            parsed.assignmentCode === attemptAssignmentCode(snapshotHash) &&
            Array.isArray(parsed.seenSubmissionIds) && parsed.seenSubmissionIds.length <= 1000 &&
            safeText(parsed.seenSubmissionIds[expectedAttemptNumber - 1], 180) === safeText(runtimeState && runtimeState.submissionId, 180)) {
          return rawLedger;
        }
      } catch (error) { /* synthesize a private replay ledger below */ }
    }
    return syntheticReplayAttemptLedger(runtimeState, snapshotHash);
  }

  function stableRecordId(prefix, identity) {
    return prefix + ":" + hashText(stableStringify(identity));
  }

  function compareIso(left, right) {
    var leftTime = Date.parse(left || "") || 0;
    var rightTime = Date.parse(right || "") || 0;
    return leftTime === rightTime ? 0 : (leftTime > rightTime ? 1 : -1);
  }

  function safeLocalStorage() {
    try {
      if (!global.localStorage) return null;
      var key = "__zyz_record_store_probe__";
      global.localStorage.setItem(key, "1");
      global.localStorage.removeItem(key);
      return global.localStorage;
    } catch (error) {
      return null;
    }
  }

  function sanitizeContentRef(value) {
    if (!value || typeof value !== "object") return null;
    var passageId = safeText(value.passageId, 180);
    var taskId = safeText(value.taskId, 180);
    if (!passageId && !taskId) return null;
    return {
      passageId: passageId,
      taskId: taskId,
      titleEn: safeText(value.titleEn || value.englishTitle, 300),
      titleZh: safeText(value.titleZh || value.chineseTitle, 300),
      part: integer(value.part || value.passagePosition, null, 1, 3),
      contentRevision: safeText(value.contentRevision || value.revision, 100),
      frequency: safeText(value.frequency || value.frequencyLabel, 80),
      difficultyLabel: safeText(value.difficultyLabel || value.difficulty, 80),
      difficultyScore: finiteNumber(value.difficultyScore, null, 0, 10),
      questionTypes: uniqueTextList(value.questionTypes || value.taskTypes, 40)
    };
  }

  function sanitizeContentRefs(input) {
    var refs = Array.isArray(input.contentRefs) ? input.contentRefs : [];
    if (!refs.length && (input.passageId || input.taskId)) refs = [input];
    var seen = Object.create(null);
    var output = [];
    refs.forEach(function each(value) {
      var ref = sanitizeContentRef(value);
      if (!ref) return;
      var key = ref.passageId + "|" + ref.taskId + "|" + ref.contentRevision;
      if (seen[key] || output.length >= 200) return;
      seen[key] = true;
      output.push(ref);
    });
    return output;
  }

  function sanitizeScore(input) {
    var source = input && typeof input === "object" ? input : {};
    var earned = finiteNumber(source.earnedMarks !== undefined ? source.earnedMarks : source.earned, null, 0, 10000);
    var available = finiteNumber(source.availableMarks !== undefined ? source.availableMarks : source.available, null, 0, 10000);
    var total = integer(source.total, available === null ? null : Math.round(available), 0, 10000);
    var correct = integer(source.correct, null, 0, 10000);
    var partial = integer(source.partial, 0, 0, 10000);
    var incorrect = integer(source.incorrect, null, 0, 10000);
    var unanswered = integer(source.unanswered, null, 0, 10000);
    var answered = integer(source.answered, null, 0, 10000);
    var percent = finiteNumber(source.percent, null, 0, 100);
    if (percent === null && earned !== null && available) percent = Math.round((earned / available) * 1000) / 10;
    var rawBand = source.band !== undefined ? source.band : source.referenceBand;
    var band = null;
    if (typeof rawBand === "number") {
      band = finiteNumber(rawBand, null, 0, 9);
    } else if (typeof rawBand === "string" && rawBand.trim()) {
      band = finiteNumber(rawBand, null, 0, 9);
    }
    return {
      earnedMarks: earned,
      availableMarks: available,
      total: total,
      answered: answered,
      correct: correct,
      partial: partial,
      incorrect: incorrect,
      unanswered: unanswered,
      percent: percent,
      band: band
    };
  }

  function sanitizeOutcomes(input) {
    var outcomes = Array.isArray(input) ? input : [];
    var seen = Object.create(null);
    var output = [];
    outcomes.forEach(function each(value) {
      if (!value || typeof value !== "object" || output.length >= 1000) return;
      var status = safeText(value.status, 30).toLowerCase();
      if (ALLOWED_OUTCOME_STATUSES.indexOf(status) === -1) return;
      var questionId = safeText(value.questionId || value.scoreSlotId, 180);
      var questionNumber = safeText(value.questionNumber !== undefined ? value.questionNumber : value.number, 40);
      if (!questionId && !questionNumber) return;
      var identity = questionId || (safeText(value.passageId, 180) + "|" + questionNumber);
      if (seen[identity]) return;
      seen[identity] = true;
      output.push({
        questionId: questionId,
        questionNumber: questionNumber,
        passageId: safeText(value.passageId, 180),
        taskId: safeText(value.taskId, 180),
        part: integer(value.part, null, 1, 3),
        questionType: safeText(value.questionType || value.taskType, 120),
        taskLabel: safeText(value.taskLabel || value.questionTypeLabel || value.taskTypeLabel, 180),
        status: status,
        earnedMarks: finiteNumber(value.earnedMarks, status === "correct" ? 1 : status === "partial" ? 0.5 : 0, 0, 100),
        availableMarks: finiteNumber(value.availableMarks, 1, 0, 100)
      });
    });
    return output;
  }

  function sanitizePassageResults(input) {
    var rows = Array.isArray(input) ? input : [];
    var seen = Object.create(null);
    var output = [];
    rows.forEach(function each(value) {
      if (!value || typeof value !== "object" || output.length >= 3) return;
      var passageId = safeText(value.passageId, 180);
      if (!passageId || seen[passageId]) return;
      seen[passageId] = true;
      var earned = finiteNumber(value.earnedMarks, null, 0, 1000);
      var available = finiteNumber(value.availableMarks, null, 0, 1000);
      var percent = available ? Math.round(((earned || 0) / available) * 1000) / 10 : null;
      var elapsedSeconds = value.elapsedSeconds;
      if (elapsedSeconds === undefined && value.elapsedMilliseconds !== undefined) {
        elapsedSeconds = Math.round(Number(value.elapsedMilliseconds || 0) / 1000);
      }
      output.push({
        passageId: passageId,
        part: integer(value.part, null, 1, 3),
        frequency: safeText(value.frequency || value.frequencyLabel, 80),
        difficultyLabel: safeText(value.difficultyLabel || value.difficulty, 80),
        difficultyScore: finiteNumber(value.difficultyScore, null, 0, 10),
        questionTypes: uniqueTextList(value.questionTypes || value.taskTypes, 40),
        earnedMarks: earned,
        availableMarks: available,
        answered: integer(value.answered, null, 0, 1000),
        total: integer(value.total, available === null ? null : Math.round(available), 0, 1000),
        correct: integer(value.correct, null, 0, 1000),
        partial: integer(value.partial, 0, 0, 1000),
        incorrect: integer(value.incorrect, null, 0, 1000),
        unanswered: integer(value.unanswered, null, 0, 1000),
        percent: percent,
        elapsedSeconds: integer(elapsedSeconds, 0, 0, 31536000)
      });
    });
    return output;
  }

  function commonRecordFields(input, type, recordId, createdAt, updatedAt) {
    var contentRefs = sanitizeContentRefs(input);
    var passageIds = uniqueTextList(input.passageIds, 200);
    var taskIds = uniqueTextList(input.taskIds, 500);
    contentRefs.forEach(function addRefIds(ref) {
      if (ref.passageId && passageIds.indexOf(ref.passageId) === -1) passageIds.push(ref.passageId);
      if (ref.taskId && taskIds.indexOf(ref.taskId) === -1) taskIds.push(ref.taskId);
    });
    if (input.passageId && passageIds.indexOf(safeText(input.passageId, 180)) === -1) passageIds.push(safeText(input.passageId, 180));
    if (input.taskId && taskIds.indexOf(safeText(input.taskId, 180)) === -1) taskIds.push(safeText(input.taskId, 180));
    return {
      schemaVersion: SCHEMA_VERSION,
      recordId: safeText(recordId, 220),
      type: type,
      releaseId: safeText(input.releaseId, 180),
      month: safeText(input.month, 20),
      contentRevision: safeText(input.contentRevision, 100),
      mode: safeText(input.mode, 50),
      scope: safeText(input.scope, 50),
      sessionId: safeText(input.sessionId, 220),
      snapshotHash: safeText(input.snapshotHash, 220),
      passageIds: passageIds,
      taskIds: taskIds,
      contentRefs: contentRefs,
      createdAt: createdAt,
      updatedAt: updatedAt
    };
  }

  function sanitizeImportedRecord(value) {
    if (!value || typeof value !== "object") return null;
    var type = safeText(value.type, 30);
    if (ALLOWED_RECORD_TYPES.indexOf(type) === -1) return null;
    var recordId = safeText(value.recordId, 220);
    if (!recordId) return null;
    var createdAt = toIso(value.createdAt, nowIso());
    var updatedAt = toIso(value.updatedAt, createdAt);
    var base = commonRecordFields(value, type, recordId, createdAt, updatedAt);
    if (type === "visited") {
      base.firstVisitedAt = toIso(value.firstVisitedAt, createdAt);
      base.lastVisitedAt = toIso(value.lastVisitedAt, updatedAt);
      base.visitCount = integer(value.visitCount, 1, 1, 1000000);
    } else if (type === "started") {
      base.startedAt = toIso(value.startedAt, createdAt);
      base.lastSeenAt = toIso(value.lastSeenAt, updatedAt);
      base.startCount = integer(value.startCount, 1, 1, 1000000);
    } else {
      base.attemptId = safeText(value.attemptId, 220);
      base.attemptNumber = integer(value.attemptNumber, 1, 1, 1000000);
      base.submittedAt = toIso(value.submittedAt, createdAt);
      base.elapsedSeconds = integer(value.elapsedSeconds, 0, 0, 31536000);
      base.submissionReason = safeText(value.submissionReason, 80);
      base.score = sanitizeScore(value.score || value);
      base.passageResults = sanitizePassageResults(value.passageResults);
      base.questionOutcomes = sanitizeOutcomes(value.questionOutcomes || value.outcomes);
    }
    return base;
  }

  function createRecordStore(options) {
    options = options || {};
    var dbName = safeText(options.dbName, 180) || DEFAULT_DB_NAME;
    var storeName = safeText(options.storeName, 180) || DEFAULT_STORE_NAME;
    var snapshotStoreName = safeText(options.snapshotStoreName, 180) || DEFAULT_SNAPSHOT_STORE_NAME;
    var fallbackKey = safeText(options.fallbackKey, 220) || DEFAULT_FALLBACK_KEY;
    var snapshotFallbackKey = safeText(options.snapshotFallbackKey, 220) || DEFAULT_SNAPSHOT_FALLBACK_KEY;
    var preferencesKey = safeText(options.preferencesKey, 220) || DEFAULT_PREFERENCES_KEY;
    var openTimeout = integer(options.openTimeoutMs, OPEN_TIMEOUT_MS, 100, 30000);
    var maxAttemptSnapshotBytes = integer(
      options.maxAttemptSnapshotBytes,
      MAX_ATTEMPT_SNAPSHOT_BYTES,
      256,
      5242880
    );
    var local = safeLocalStorage();
    var memoryRecords = [];
    var memoryAttemptSnapshots = [];
    var memoryPreferences = {};
    var snapshotFallbackUsesMemory = false;
    var db = null;
    var initPromise = null;
    var storageMode = "uninitialized";
    var storageError = "";
    var mutationTail = Promise.resolve();
    var mutationLockName = "passage-by-zyz-record-store.v1:" + dbName;

    function withMutationLock(callback) {
      function run() {
        var locks = global.navigator && global.navigator.locks;
        if (locks && typeof locks.request === "function") {
          return locks.request(mutationLockName, { mode: "exclusive" }, callback);
        }
        return callback();
      }
      var result = mutationTail.then(run, run);
      mutationTail = result.then(function release() {}, function releaseAfterFailure() {});
      return result;
    }

    function readLocalJson(key, fallback) {
      if (!local) return cloneJson(fallback);
      try {
        var text = local.getItem(key);
        return text ? JSON.parse(text) : cloneJson(fallback);
      } catch (error) {
        return cloneJson(fallback);
      }
    }

    function writeLocalJson(key, value) {
      if (!local) return false;
      try {
        local.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        return false;
      }
    }

    function fallbackReadRecords() {
      var records = local ? readLocalJson(fallbackKey, []) : cloneJson(memoryRecords);
      return Array.isArray(records) ? records.map(sanitizeImportedRecord).filter(Boolean) : [];
    }

    function fallbackWriteRecords(records) {
      var sanitized = records.map(sanitizeImportedRecord).filter(Boolean).slice(-MAX_RECORDS);
      if (local && writeLocalJson(fallbackKey, sanitized)) return;
      memoryRecords = cloneJson(sanitized);
      if (local) {
        storageMode = "memory";
        storageError = storageError || "localStorage write failed";
      }
    }

    function fallbackReadAttemptSnapshots() {
      var snapshots = local && !snapshotFallbackUsesMemory
        ? readLocalJson(snapshotFallbackKey, [])
        : cloneJson(memoryAttemptSnapshots);
      return Array.isArray(snapshots)
        ? snapshots.map(function sanitizeSnapshot(value) {
          return sanitizeAttemptSnapshotEntry(value, maxAttemptSnapshotBytes);
        }).filter(Boolean)
        : [];
    }

    function fallbackWriteAttemptSnapshots(snapshots) {
      var sanitized = snapshots.map(function sanitizeSnapshot(value) {
        return sanitizeAttemptSnapshotEntry(value, maxAttemptSnapshotBytes);
      }).filter(Boolean).sort(function sortSnapshots(left, right) {
        return compareIso(left.updatedAt, right.updatedAt);
      }).slice(-MAX_ATTEMPT_SNAPSHOTS);
      if (local && writeLocalJson(snapshotFallbackKey, sanitized)) {
        snapshotFallbackUsesMemory = false;
        return;
      }
      memoryAttemptSnapshots = cloneJson(sanitized);
      snapshotFallbackUsesMemory = true;
      if (local) {
        storageError = storageError || "localStorage snapshot write failed";
      }
    }

    function openIndexedDb() {
      return new Promise(function executor(resolve, reject) {
        if (!global.indexedDB || typeof global.indexedDB.open !== "function") {
          reject(new Error("IndexedDB is unavailable"));
          return;
        }
        var settled = false;
        var timer = global.setTimeout(function timeoutOpen() {
          if (settled) return;
          settled = true;
          reject(new Error("IndexedDB open timed out"));
        }, openTimeout);
        var request;
        try {
          request = global.indexedDB.open(dbName, DB_VERSION);
        } catch (error) {
          global.clearTimeout(timer);
          reject(error);
          return;
        }
        request.onupgradeneeded = function onUpgrade() {
          var opened = request.result;
          if (!opened.objectStoreNames.contains(storeName)) {
            var objectStore = opened.createObjectStore(storeName, { keyPath: "recordId" });
            objectStore.createIndex("type", "type", { unique: false });
            objectStore.createIndex("releaseId", "releaseId", { unique: false });
            objectStore.createIndex("updatedAt", "updatedAt", { unique: false });
          }
          if (!opened.objectStoreNames.contains(snapshotStoreName)) {
            var snapshotStore = opened.createObjectStore(snapshotStoreName, { keyPath: "snapshotId" });
            snapshotStore.createIndex("updatedAt", "updatedAt", { unique: false });
          }
        };
        request.onsuccess = function onSuccess() {
          if (settled) {
            request.result.close();
            return;
          }
          settled = true;
          global.clearTimeout(timer);
          resolve(request.result);
        };
        request.onerror = function onError() {
          if (settled) return;
          settled = true;
          global.clearTimeout(timer);
          reject(request.error || new Error("IndexedDB open failed"));
        };
        request.onblocked = function onBlocked() {
          if (settled) return;
          settled = true;
          global.clearTimeout(timer);
          reject(new Error("IndexedDB open was blocked"));
        };
      });
    }

    function init() {
      if (initPromise) return initPromise;
      initPromise = openIndexedDb().then(function opened(openedDb) {
        db = openedDb;
        storageMode = "indexeddb";
        db.onversionchange = function onVersionChange() {
          db.close();
          db = null;
          initPromise = null;
          storageMode = local ? "localstorage-fallback" : "memory";
        };
        return { schemaVersion: SCHEMA_VERSION, storageMode: storageMode, storageError: "" };
      }).catch(function failed(error) {
        storageError = safeText(error && error.message ? error.message : error, 500);
        storageMode = local ? "localstorage-fallback" : "memory";
        return { schemaVersion: SCHEMA_VERSION, storageMode: storageMode, storageError: storageError };
      });
      return initPromise;
    }

    function idbGetAll() {
      return new Promise(function executor(resolve, reject) {
        try {
          var transaction = db.transaction(storeName, "readonly");
          var request = transaction.objectStore(storeName).getAll();
          request.onsuccess = function success() { resolve(request.result || []); };
          request.onerror = function failure() { reject(request.error || new Error("IndexedDB read failed")); };
        } catch (error) {
          reject(error);
        }
      });
    }

    function idbGet(recordId) {
      return new Promise(function executor(resolve, reject) {
        try {
          var transaction = db.transaction(storeName, "readonly");
          var request = transaction.objectStore(storeName).get(recordId);
          request.onsuccess = function success() { resolve(request.result || null); };
          request.onerror = function failure() { reject(request.error || new Error("IndexedDB read failed")); };
        } catch (error) {
          reject(error);
        }
      });
    }

    function idbPut(record) {
      return new Promise(function executor(resolve, reject) {
        try {
          var transaction = db.transaction(storeName, "readwrite");
          transaction.objectStore(storeName).put(record);
          transaction.oncomplete = function complete() { resolve(record); };
          transaction.onerror = function failure() { reject(transaction.error || new Error("IndexedDB write failed")); };
          transaction.onabort = function aborted() { reject(transaction.error || new Error("IndexedDB write aborted")); };
        } catch (error) {
          reject(error);
        }
      });
    }

    function idbGetAttemptSnapshot(snapshotId) {
      return new Promise(function executor(resolve, reject) {
        try {
          var transaction = db.transaction(snapshotStoreName, "readonly");
          var request = transaction.objectStore(snapshotStoreName).get(snapshotId);
          request.onsuccess = function success() { resolve(request.result || null); };
          request.onerror = function failure() { reject(request.error || new Error("IndexedDB snapshot read failed")); };
        } catch (error) {
          reject(error);
        }
      });
    }

    function idbGetAllAttemptSnapshots() {
      return new Promise(function executor(resolve, reject) {
        try {
          var transaction = db.transaction(snapshotStoreName, "readonly");
          var request = transaction.objectStore(snapshotStoreName).getAll();
          request.onsuccess = function success() { resolve(request.result || []); };
          request.onerror = function failure() { reject(request.error || new Error("IndexedDB snapshot read failed")); };
        } catch (error) {
          reject(error);
        }
      });
    }

    function idbPutAttemptSnapshot(snapshot) {
      return new Promise(function executor(resolve, reject) {
        try {
          var transaction = db.transaction(snapshotStoreName, "readwrite");
          transaction.objectStore(snapshotStoreName).put(snapshot);
          transaction.oncomplete = function complete() { resolve(snapshot); };
          transaction.onerror = function failure() { reject(transaction.error || new Error("IndexedDB snapshot write failed")); };
          transaction.onabort = function aborted() { reject(transaction.error || new Error("IndexedDB snapshot write aborted")); };
        } catch (error) {
          reject(error);
        }
      });
    }

    function idbDeleteAttemptSnapshot(snapshotId) {
      return new Promise(function executor(resolve, reject) {
        try {
          var transaction = db.transaction(snapshotStoreName, "readwrite");
          transaction.objectStore(snapshotStoreName).delete(snapshotId);
          transaction.oncomplete = function complete() { resolve(); };
          transaction.onerror = function failure() { reject(transaction.error || new Error("IndexedDB snapshot delete failed")); };
          transaction.onabort = function aborted() { reject(transaction.error || new Error("IndexedDB snapshot delete aborted")); };
        } catch (error) {
          reject(error);
        }
      });
    }

    function idbUpdateAttemptAnnotationOverlay(recordId, annotationData, guardOptions) {
      return new Promise(function executor(resolve, reject) {
        var failure = null;
        var result = null;
        try {
          var transaction = db.transaction([storeName, snapshotStoreName], "readwrite");
          var recordStore = transaction.objectStore(storeName);
          var snapshotStore = transaction.objectStore(snapshotStoreName);
          var recordRequest = recordStore.get(recordId);
          var snapshotRequest = snapshotStore.get(recordId);
          var recordReady = false;
          var snapshotReady = false;
          var record = null;
          var snapshot = null;
          var queued = false;

          function fail(error) {
            failure = error;
            try { transaction.abort(); } catch (abortError) { /* transaction may already be closing */ }
          }

          function updateWhenReady() {
            if (queued || !recordReady || !snapshotReady) return;
            queued = true;
            try {
              var sanitizedRecord = sanitizeImportedRecord(record);
              var sanitizedSnapshot = sanitizeAttemptSnapshotEntry(snapshot, maxAttemptSnapshotBytes);
              var current = attemptAnnotationState(sanitizedRecord, sanitizedSnapshot, guardOptions);
              if (!Object.prototype.hasOwnProperty.call(annotationData, "questionFlags")) {
                annotationData = Object.assign({}, annotationData, { questionFlags: cloneJson(current.annotationData.questionFlags) });
              }
              var expectedRevision = integer(guardOptions.expectedRevision, null, 0, 1000000000);
              if (expectedRevision === null || expectedRevision !== current.revision) {
                throw annotationFailure("The replay annotations changed in another page", "annotation-revision-conflict");
              }
              var nextRevision = current.revision + 1;
              var updatedAt = nowIso();
              var overlay = Object.assign(current.hasOverlay ? cloneJson(current.overlay) : {}, {
                schemaVersion: ANNOTATION_OVERLAY_SCHEMA_VERSION,
                revision: nextRevision,
                updatedAt: updatedAt,
                submissionId: current.submissionId,
                snapshotHash: current.snapshotHash,
                packageContentVersion: current.packageContentVersion
              }, sanitizeAnnotationData(annotationData));
              var nextPayload = cloneJson(current.payload);
              nextPayload.annotationOverlay = overlay;
              var sanitizedPayload = sanitizeAttemptSnapshotPayload(nextPayload, maxAttemptSnapshotBytes);
              var nextSnapshot = {
                schemaVersion: ATTEMPT_SNAPSHOT_SCHEMA_VERSION,
                snapshotId: recordId,
                updatedAt: updatedAt,
                byteSize: sanitizedPayload.byteSize,
                payload: sanitizedPayload.payload
              };
              snapshotStore.put(nextSnapshot);
              result = {
                recordId: recordId,
                submissionId: current.submissionId,
                snapshotHash: current.snapshotHash,
                packageContentVersion: current.packageContentVersion,
                previousRevision: current.revision,
                revision: nextRevision,
                hasOverlay: true,
                annotationData: cloneJson(sanitizeAnnotationData(annotationData)),
                updatedAt: updatedAt,
                storageMode: "indexeddb"
              };
            } catch (error) {
              fail(error);
            }
          }

          recordRequest.onsuccess = function recordSuccess() {
            record = recordRequest.result || null;
            recordReady = true;
            updateWhenReady();
          };
          snapshotRequest.onsuccess = function snapshotSuccess() {
            snapshot = snapshotRequest.result || null;
            snapshotReady = true;
            updateWhenReady();
          };
          recordRequest.onerror = function recordFailure() { fail(recordRequest.error || new Error("IndexedDB submission read failed")); };
          snapshotRequest.onerror = function snapshotFailure() { fail(snapshotRequest.error || new Error("IndexedDB snapshot read failed")); };
          transaction.oncomplete = function complete() { resolve(result); };
          transaction.onerror = function transactionFailure() {
            reject(failure || transaction.error || new Error("IndexedDB annotation overlay update failed"));
          };
          transaction.onabort = function aborted() {
            reject(failure || transaction.error || new Error("IndexedDB annotation overlay update aborted"));
          };
        } catch (error) {
          reject(error);
        }
      });
    }

    function idbDeleteSubmission(recordId) {
      return new Promise(function executor(resolve, reject) {
        try {
          var transaction = db.transaction([storeName, snapshotStoreName], "readwrite");
          var recordStore = transaction.objectStore(storeName);
          var snapshotStore = transaction.objectStore(snapshotStoreName);
          var recordRequest = recordStore.get(recordId);
          var snapshotRequest = snapshotStore.get(recordId);
          var recordRead = false;
          var snapshotRead = false;
          var record = null;
          var snapshot = null;
          var queued = false;
          var result = {
            recordId: recordId,
            deleted: false,
            recordDeleted: false,
            attemptSnapshotDeleted: false,
            reason: "not-found"
          };

          function queueDeleteWhenReady() {
            if (queued || !recordRead || !snapshotRead) return;
            queued = true;
            if (!record) return;
            if (record.type !== "submitted") {
              result.reason = "not-submitted";
              return;
            }
            recordStore.delete(recordId);
            snapshotStore.delete(recordId);
            result.deleted = true;
            result.recordDeleted = true;
            result.attemptSnapshotDeleted = Boolean(snapshot);
            result.reason = "deleted";
          }

          recordRequest.onsuccess = function recordSuccess() {
            record = recordRequest.result || null;
            recordRead = true;
            queueDeleteWhenReady();
          };
          snapshotRequest.onsuccess = function snapshotSuccess() {
            snapshot = snapshotRequest.result || null;
            snapshotRead = true;
            queueDeleteWhenReady();
          };
          transaction.oncomplete = function complete() { resolve(result); };
          transaction.onerror = function failure() { reject(transaction.error || new Error("IndexedDB submission delete failed")); };
          transaction.onabort = function aborted() { reject(transaction.error || new Error("IndexedDB submission delete aborted")); };
        } catch (error) {
          reject(error);
        }
      });
    }

    function idbClearAllStores() {
      return new Promise(function executor(resolve, reject) {
        try {
          var transaction = db.transaction([storeName, snapshotStoreName], "readwrite");
          transaction.objectStore(storeName).clear();
          transaction.objectStore(snapshotStoreName).clear();
          transaction.oncomplete = function complete() { resolve(); };
          transaction.onerror = function failure() { reject(transaction.error || new Error("IndexedDB clear failed")); };
          transaction.onabort = function aborted() { reject(transaction.error || new Error("IndexedDB clear aborted")); };
        } catch (error) {
          reject(error);
        }
      });
    }

    function idbRestoreAllStores(records, snapshots) {
      return new Promise(function executor(resolve, reject) {
        try {
          var transaction = db.transaction([storeName, snapshotStoreName], "readwrite");
          var recordStore = transaction.objectStore(storeName);
          var snapshotStore = transaction.objectStore(snapshotStoreName);
          recordStore.clear();
          snapshotStore.clear();
          records.forEach(function restoreRecord(record) { recordStore.put(record); });
          snapshots.forEach(function restoreSnapshot(snapshot) { snapshotStore.put(snapshot); });
          transaction.oncomplete = function complete() { resolve(); };
          transaction.onerror = function failure() { reject(transaction.error || new Error("IndexedDB clear rollback failed")); };
          transaction.onabort = function aborted() { reject(transaction.error || new Error("IndexedDB clear rollback aborted")); };
        } catch (error) {
          reject(error);
        }
      });
    }

    function degradeToFallback(error) {
      storageError = safeText(error && error.message ? error.message : error, 500);
      if (db) {
        try { db.close(); } catch (closeError) { /* no-op */ }
      }
      db = null;
      storageMode = local ? "localstorage-fallback" : "memory";
      return storageMode;
    }

    async function allRecords(readObservation) {
      readObservation = readObservation || {};
      Object.assign(readObservation, { completed: false, success: false, mode: storageMode, rawCount: null, validCount: null, rejectedCount: null });
      await init();
      if (storageMode === "indexeddb" && db) {
        try {
          var rawRows = await idbGetAll();
          var validRows = rawRows.map(sanitizeImportedRecord).filter(Boolean);
          Object.assign(readObservation, { completed: true, success: true, mode: "indexeddb", rawCount: rawRows.length, validCount: validRows.length, rejectedCount: rawRows.length - validRows.length });
          return validRows;
        } catch (error) {
          degradeToFallback(error);
        }
      }
      Object.assign(readObservation, { completed: true, success: false, mode: storageMode, rawCount: null, validCount: null, rejectedCount: null });
      return fallbackReadRecords();
    }

    async function getRecord(recordId) {
      await init();
      if (storageMode === "indexeddb" && db) {
        try {
          return sanitizeImportedRecord(await idbGet(recordId));
        } catch (error) {
          degradeToFallback(error);
        }
      }
      var records = fallbackReadRecords();
      return records.find(function find(item) { return item.recordId === recordId; }) || null;
    }

    async function putRecord(record) {
      return withMutationLock(function lockedPutRecord() { return putRecordUnlocked(record); });
    }

    async function putRecordUnlocked(record) {
      var sanitized = sanitizeImportedRecord(record);
      if (!sanitized) throw new Error("Invalid student record");
      await init();
      if (storageMode === "indexeddb" && db) {
        try {
          await idbPut(sanitized);
          return cloneJson(sanitized);
        } catch (error) {
          degradeToFallback(error);
        }
      }
      var records = fallbackReadRecords();
      var index = records.findIndex(function find(item) { return item.recordId === sanitized.recordId; });
      if (index === -1) records.push(sanitized);
      else records[index] = sanitized;
      fallbackWriteRecords(records);
      return cloneJson(sanitized);
    }

    async function putAttemptSnapshot(snapshotId, payload, snapshotOptions) {
      var args = [snapshotId, payload, snapshotOptions];
      return withMutationLock(function lockedPutAttemptSnapshot() {
        return putAttemptSnapshotUnlocked(args[0], args[1], args[2]);
      });
    }

    async function putAttemptSnapshotUnlocked(snapshotId, payload, snapshotOptions) {
      if (snapshotId && typeof snapshotId === "object" && payload === undefined) {
        snapshotOptions = snapshotId;
        payload = snapshotOptions.payload;
        snapshotId = snapshotOptions.snapshotId;
      }
      snapshotOptions = snapshotOptions && typeof snapshotOptions === "object" ? snapshotOptions : {};
      var normalizedId = normalizeAttemptSnapshotId(snapshotId);
      var sanitized = sanitizeAttemptSnapshotPayload(payload, maxAttemptSnapshotBytes);
      var snapshot = {
        schemaVersion: ATTEMPT_SNAPSHOT_SCHEMA_VERSION,
        snapshotId: normalizedId,
        updatedAt: toIso(snapshotOptions.updatedAt || snapshotOptions.at, nowIso()),
        byteSize: sanitized.byteSize,
        payload: sanitized.payload
      };
      await init();
      if (storageMode === "indexeddb" && db) {
        try {
          await idbPutAttemptSnapshot(snapshot);
          return cloneJson(snapshot);
        } catch (error) {
          degradeToFallback(error);
        }
      }
      var snapshots = fallbackReadAttemptSnapshots();
      var index = snapshots.findIndex(function find(item) { return item.snapshotId === normalizedId; });
      if (index === -1) snapshots.push(snapshot);
      else snapshots[index] = snapshot;
      fallbackWriteAttemptSnapshots(snapshots);
      return cloneJson(snapshot);
    }

    async function getAttemptSnapshot(snapshotId) {
      var normalizedId = normalizeAttemptSnapshotId(snapshotId);
      await init();
      if (storageMode === "indexeddb" && db) {
        try {
          var indexedSnapshot = sanitizeAttemptSnapshotEntry(
            await idbGetAttemptSnapshot(normalizedId),
            maxAttemptSnapshotBytes
          );
          return indexedSnapshot ? cloneJson(indexedSnapshot) : null;
        } catch (error) {
          degradeToFallback(error);
        }
      }
      var snapshots = fallbackReadAttemptSnapshots();
      var snapshot = snapshots.find(function find(item) { return item.snapshotId === normalizedId; });
      return snapshot ? cloneJson(snapshot) : null;
    }

    async function allAttemptSnapshots() {
      await init();
      if (storageMode === "indexeddb" && db) {
        try {
          return (await idbGetAllAttemptSnapshots()).map(function sanitizeSnapshot(value) {
            return sanitizeAttemptSnapshotEntry(value, maxAttemptSnapshotBytes);
          }).filter(Boolean);
        } catch (error) {
          degradeToFallback(error);
        }
      }
      return fallbackReadAttemptSnapshots();
    }

    async function listAttemptSnapshots() {
      var snapshots = await allAttemptSnapshots();
      snapshots.sort(function sortSnapshots(left, right) {
        var compared = compareIso(right.updatedAt, left.updatedAt);
        return compared || left.snapshotId.localeCompare(right.snapshotId);
      });
      return cloneJson(snapshots);
    }

    async function deleteAttemptSnapshot(snapshotId) {
      var normalizedId = normalizeAttemptSnapshotId(snapshotId);
      await init();
      if (storageMode === "indexeddb" && db) {
        try {
          var indexedSnapshot = await idbGetAttemptSnapshot(normalizedId);
          if (!indexedSnapshot) return { snapshotId: normalizedId, deleted: false };
          await idbDeleteAttemptSnapshot(normalizedId);
          return { snapshotId: normalizedId, deleted: true };
        } catch (error) {
          degradeToFallback(error);
        }
      }
      var snapshots = fallbackReadAttemptSnapshots();
      var retained = snapshots.filter(function retain(item) { return item.snapshotId !== normalizedId; });
      var deleted = retained.length !== snapshots.length;
      if (deleted) fallbackWriteAttemptSnapshots(retained);
      return { snapshotId: normalizedId, deleted: deleted };
    }

    async function readAttemptAnnotationOverlay(recordId, guardOptions) {
      return withMutationLock(async function lockedReadAttemptAnnotationOverlay() {
        var normalizedId = normalizeAttemptSnapshotId(recordId);
        var record = await getRecord(normalizedId);
        var snapshot = await getAttemptSnapshot(normalizedId);
        var current = attemptAnnotationState(record, snapshot, guardOptions);
        return {
          schemaVersion: ANNOTATION_OVERLAY_SCHEMA_VERSION,
          recordId: current.recordId,
          submissionId: current.submissionId,
          snapshotHash: current.snapshotHash,
          packageContentVersion: current.packageContentVersion,
          revision: current.revision,
          hasOverlay: current.hasOverlay,
          annotationData: cloneJson(current.annotationData),
          updatedAt: current.hasOverlay
            ? toIso(current.payload.annotationOverlay.updatedAt, snapshot.updatedAt)
            : snapshot.updatedAt,
          storageMode: storageMode
        };
      });
    }

    async function updateAttemptAnnotationOverlay(recordId, annotationData, guardOptions) {
      return withMutationLock(function lockedUpdateAttemptAnnotationOverlay() {
        return updateAttemptAnnotationOverlayUnlocked(recordId, annotationData, guardOptions);
      });
    }

    async function updateAttemptAnnotationOverlayUnlocked(recordId, annotationData, guardOptions) {
      guardOptions = guardOptions && typeof guardOptions === "object" ? guardOptions : {};
      var normalizedId = normalizeAttemptSnapshotId(recordId);
      var normalizedData = sanitizeAnnotationData(annotationData);
      await init();
      if (storageMode === "indexeddb" && db) {
        try {
          return cloneJson(await idbUpdateAttemptAnnotationOverlay(normalizedId, normalizedData, guardOptions));
        } catch (error) {
          if (error && /^annotation-/u.test(String(error.code || ""))) throw error;
          storageError = safeText(error && error.message ? error.message : error, 500);
          throw error;
        }
      }
      if (!local || snapshotFallbackUsesMemory || storageMode === "memory") {
        throw annotationFailure("Durable storage is unavailable for replay annotations", "annotation-storage-unavailable");
      }
      var records = fallbackReadRecords();
      var record = records.find(function find(item) { return item.recordId === normalizedId; }) || null;
      var snapshots = fallbackReadAttemptSnapshots();
      var snapshotIndex = snapshots.findIndex(function find(item) { return item.snapshotId === normalizedId; });
      var snapshot = snapshotIndex >= 0 ? snapshots[snapshotIndex] : null;
      var current = attemptAnnotationState(record, snapshot, guardOptions);
      if (!Object.prototype.hasOwnProperty.call(normalizedData, "questionFlags")) normalizedData.questionFlags = cloneJson(current.annotationData.questionFlags);
      var expectedRevision = integer(guardOptions.expectedRevision, null, 0, 1000000000);
      if (expectedRevision === null || expectedRevision !== current.revision) {
        throw annotationFailure("The replay annotations changed in another page", "annotation-revision-conflict");
      }
      var nextRevision = current.revision + 1;
      var updatedAt = nowIso();
      var overlay = Object.assign(current.hasOverlay ? cloneJson(current.overlay) : {}, {
        schemaVersion: ANNOTATION_OVERLAY_SCHEMA_VERSION,
        revision: nextRevision,
        updatedAt: updatedAt,
        submissionId: current.submissionId,
        snapshotHash: current.snapshotHash,
        packageContentVersion: current.packageContentVersion
      }, normalizedData);
      var nextPayload = cloneJson(current.payload);
      nextPayload.annotationOverlay = overlay;
      var sanitizedPayload = sanitizeAttemptSnapshotPayload(nextPayload, maxAttemptSnapshotBytes);
      var nextSnapshot = {
        schemaVersion: ATTEMPT_SNAPSHOT_SCHEMA_VERSION,
        snapshotId: normalizedId,
        updatedAt: updatedAt,
        byteSize: sanitizedPayload.byteSize,
        payload: sanitizedPayload.payload
      };
      var nextSnapshots = snapshots.slice();
      nextSnapshots[snapshotIndex] = nextSnapshot;
      var originalRaw = local.getItem(snapshotFallbackKey);
      try {
        var encoded = JSON.stringify(nextSnapshots);
        local.setItem(snapshotFallbackKey, encoded);
        if (local.getItem(snapshotFallbackKey) !== encoded) throw new Error("annotation overlay write read-back mismatch");
        snapshotFallbackUsesMemory = false;
        var verified = fallbackReadAttemptSnapshots().find(function find(item) { return item.snapshotId === normalizedId; });
        var verifiedState = attemptAnnotationState(record, verified, guardOptions);
        if (verifiedState.revision !== nextRevision ||
            stableStringify(verifiedState.annotationData) !== stableStringify(normalizedData)) {
          throw new Error("annotation overlay final read-back mismatch");
        }
      } catch (error) {
        try {
          if (originalRaw === null) local.removeItem(snapshotFallbackKey);
          else local.setItem(snapshotFallbackKey, originalRaw);
        } catch (rollbackError) {
          var rollbackFailure = annotationFailure("Replay annotation write failed and rollback could not be verified", "annotation-rollback-unverified");
          rollbackFailure.cause = rollbackError;
          throw rollbackFailure;
        }
        throw annotationFailure("Replay annotation write failed; the previous snapshot was restored", "annotation-write-failed");
      }
      memoryAttemptSnapshots = cloneJson(nextSnapshots);
      return {
        recordId: normalizedId,
        submissionId: current.submissionId,
        snapshotHash: current.snapshotHash,
        packageContentVersion: current.packageContentVersion,
        previousRevision: current.revision,
        revision: nextRevision,
        hasOverlay: true,
        annotationData: cloneJson(normalizedData),
        updatedAt: updatedAt,
        storageMode: storageMode
      };
    }

    function fallbackDeleteSubmission(recordId) {
      var records = fallbackReadRecords();
      var record = records.find(function find(item) { return item.recordId === recordId; }) || null;
      if (!record) {
        return {
          recordId: recordId,
          deleted: false,
          recordDeleted: false,
          attemptSnapshotDeleted: false,
          reason: "not-found",
          verified: true,
          storageMode: storageMode
        };
      }
      if (record.type !== "submitted") {
        return {
          recordId: recordId,
          deleted: false,
          recordDeleted: false,
          attemptSnapshotDeleted: false,
          reason: "not-submitted",
          verified: true,
          storageMode: storageMode
        };
      }

      var snapshots = fallbackReadAttemptSnapshots();
      var retainedRecords = records.filter(function retain(item) { return item.recordId !== recordId; });
      var retainedSnapshots = snapshots.filter(function retain(item) { return item.snapshotId !== recordId; });
      var snapshotDeleted = retainedSnapshots.length !== snapshots.length;
      var originalSnapshotFallbackUsesMemory = snapshotFallbackUsesMemory;
      var rollbackFallbackPair = null;

      if (local) {
        var originalRecordsRaw;
        var originalSnapshotsRaw;
        try {
          originalRecordsRaw = local.getItem(fallbackKey);
          originalSnapshotsRaw = local.getItem(snapshotFallbackKey);
        } catch (readError) {
          throw new Error("Could not safely read paired fallback storage before deleting the submission: " + safeText(readError && readError.message ? readError.message : readError, 500));
        }

        function restoreLocalValue(key, value) {
          if (value === null) local.removeItem(key);
          else local.setItem(key, value);
          if (local.getItem(key) !== value) throw new Error("paired fallback rollback read-back mismatch for " + key);
        }

        rollbackFallbackPair = function rollbackPair(error) {
          var rollbackError = null;
          try { restoreLocalValue(fallbackKey, originalRecordsRaw); } catch (recordRollbackError) { rollbackError = recordRollbackError; }
          try { restoreLocalValue(snapshotFallbackKey, originalSnapshotsRaw); } catch (snapshotRollbackError) { rollbackError = rollbackError || snapshotRollbackError; }
          snapshotFallbackUsesMemory = originalSnapshotFallbackUsesMemory;
          memoryRecords = cloneJson(records);
          memoryAttemptSnapshots = cloneJson(snapshots);
          var message = "Could not safely delete the submission from paired fallback storage: "
            + safeText(error && error.message ? error.message : error, 500);
          if (rollbackError) message += "; rollback also failed: " + safeText(rollbackError && rollbackError.message ? rollbackError.message : rollbackError, 500);
          var failure = new Error(message);
          failure.deleteRollbackVerified = !rollbackError;
          throw failure;
        };

        try {
          local.setItem(fallbackKey, JSON.stringify(retainedRecords));
          local.setItem(snapshotFallbackKey, JSON.stringify(retainedSnapshots));
          snapshotFallbackUsesMemory = false;
          if (stableStringify(fallbackReadRecords()) !== stableStringify(retainedRecords) ||
              stableStringify(fallbackReadAttemptSnapshots()) !== stableStringify(retainedSnapshots)) {
            throw new Error("paired fallback delete did not pass read-back verification");
          }
        } catch (writeError) {
          rollbackFallbackPair(writeError);
        }
      } else {
        memoryRecords = cloneJson(retainedRecords);
        memoryAttemptSnapshots = cloneJson(retainedSnapshots);
        snapshotFallbackUsesMemory = false;
      }

      memoryRecords = cloneJson(retainedRecords);
      memoryAttemptSnapshots = cloneJson(retainedSnapshots);
      var verifiedRecords = fallbackReadRecords();
      var verifiedSnapshots = fallbackReadAttemptSnapshots();
      var verified = stableStringify(verifiedRecords) === stableStringify(retainedRecords)
        && stableStringify(verifiedSnapshots) === stableStringify(retainedSnapshots);
      if (!verified) {
        if (rollbackFallbackPair) rollbackFallbackPair(new Error("Submission delete did not pass fallback read-back verification"));
        memoryRecords = cloneJson(records);
        memoryAttemptSnapshots = cloneJson(snapshots);
        var verificationFailure = new Error("Submission delete did not pass fallback read-back verification");
        verificationFailure.deleteRollbackVerified = true;
        throw verificationFailure;
      }
      return {
        recordId: recordId,
        deleted: true,
        recordDeleted: true,
        attemptSnapshotDeleted: snapshotDeleted,
        reason: "deleted",
        verified: true,
        storageMode: storageMode
      };
    }

    async function deleteSubmission(recordId) {
      return withMutationLock(function lockedDeleteSubmission() { return deleteSubmissionUnlocked(recordId); });
    }

    async function deleteSubmissionUnlocked(recordId) {
      var normalizedId = normalizeAttemptSnapshotId(recordId);
      await init();
      if (storageMode === "indexeddb" && db) {
        try {
          var indexedResult = await idbDeleteSubmission(normalizedId);
          return Object.assign({}, indexedResult, { verified: true, storageMode: storageMode });
        } catch (error) {
          storageError = safeText(error && error.message ? error.message : error, 500);
          throw error;
        }
      }
      return fallbackDeleteSubmission(normalizedId);
    }

    async function prepareReplayBootContext(recordId, replayOptions) {
      replayOptions = replayOptions && typeof replayOptions === "object" ? replayOptions : {};
      var normalizedRecordId = normalizeAttemptSnapshotId(recordId);
      var record = await getRecord(normalizedRecordId);
      if (!record || record.type !== "submitted") throw new Error("Replay submission record was not found");
      var snapshot = await getAttemptSnapshot(normalizedRecordId);
      if (!snapshot || !snapshot.payload || typeof snapshot.payload !== "object") {
        throw new Error("Replay snapshot was not found");
      }
      var payload = snapshot.payload;
      var runtimeState = payload.runtimeState;
      if (!runtimeState || typeof runtimeState !== "object" || !runtimeState.submitted) {
        throw new Error("Replay snapshot is not a submitted attempt");
      }
      var snapshotHash = safeText(payload.snapshotHash, 220);
      if (!snapshotHash || snapshotHash !== safeText(record.snapshotHash, 220)) {
        throw new Error("Replay snapshot does not match the submission summary");
      }
      if (replayOptions.expectedSnapshotHash && snapshotHash !== safeText(replayOptions.expectedSnapshotHash, 220)) {
        throw new Error("Replay snapshot does not match the current content version");
      }
      if (safeText(runtimeState.submissionId, 220) !== normalizedRecordId) {
        throw new Error("Replay snapshot submission identity is invalid");
      }
      var baseStoragePrefix = safeText(replayOptions.baseStoragePrefix, 220);
      var packageId = safeText(replayOptions.packageId, 220);
      var contentVersion = safeText(replayOptions.contentVersion || payload.packageContentVersion, 220);
      if (!baseStoragePrefix || !packageId || !contentVersion) {
        throw new Error("Replay storage prefix, package id and content version are required");
      }
      if (![baseStoragePrefix, packageId, contentVersion].every(function validStorageComponent(value) {
        return /^[A-Za-z0-9._:-]{1,220}$/.test(value);
      })) {
        throw new Error("Replay storage identifiers contain unsupported characters");
      }
      if (payload.packageContentVersion && contentVersion !== safeText(payload.packageContentVersion, 220)) {
        throw new Error("Replay package content version is invalid");
      }
      var annotationState = attemptAnnotationState(record, snapshot, {
        expectedSubmissionId: normalizedRecordId,
        expectedSnapshotHash: snapshotHash,
        expectedContentVersion: contentVersion
      });
      var effectiveRuntimeState = cloneJson(runtimeState);
      effectiveRuntimeState.highlights = cloneJson(annotationState.annotationData.highlights);
      effectiveRuntimeState.questionHighlights = cloneJson(annotationState.annotationData.questionHighlights);
      effectiveRuntimeState.notes = cloneJson(annotationState.annotationData.notes);
      effectiveRuntimeState.reviewQuestionFlags = cloneJson(annotationState.annotationData.questionFlags);
      var replayToken = hashText(normalizedRecordId + "|" + snapshotHash + "|" + contentVersion);
      var isolatedPrefix = baseStoragePrefix + ".replay." + replayToken;
      var ordinaryStateKey = baseStoragePrefix + "." + packageId + "." + contentVersion;
      var ordinaryLedgerKey = baseStoragePrefix + ".attempt-ledger.v1." + snapshotHash.toLowerCase();
      var replayStateKey = isolatedPrefix + "." + packageId + "." + contentVersion;
      var replayLedgerKey = isolatedPrefix + ".attempt-ledger.v1." + snapshotHash.toLowerCase();
      if (replayStateKey === ordinaryStateKey || replayLedgerKey === ordinaryLedgerKey) {
        throw new Error("Replay storage namespace is not isolated");
      }
      var attemptLedger = validatedReplayAttemptLedger(payload.attemptLedger, runtimeState, snapshotHash);
      var runtimeStateJson = JSON.stringify(effectiveRuntimeState);
      return {
        schemaVersion: REPLAY_BOOT_CONTEXT_SCHEMA_VERSION,
        recordId: normalizedRecordId,
        snapshotHash: snapshotHash,
        packageContentVersion: contentVersion,
        storagePolicy: "ephemeral-isolated",
        storagePrefix: isolatedPrefix,
        stateStorageKey: replayStateKey,
        attemptLedgerKey: replayLedgerKey,
        guardedOrdinaryKeys: [ordinaryStateKey, ordinaryLedgerKey],
        storageWrites: [
          { key: replayStateKey, value: runtimeStateJson },
          { key: replayLedgerKey, value: attemptLedger }
        ],
        cleanupKeys: [replayStateKey, replayLedgerKey],
        runtimeState: cloneJson(effectiveRuntimeState),
        annotationOverlaySchemaVersion: ANNOTATION_OVERLAY_SCHEMA_VERSION,
        annotationOverlayRevision: annotationState.revision,
        annotationOverlayPresent: annotationState.hasOverlay,
        annotationData: cloneJson(annotationState.annotationData),
        attemptLedger: attemptLedger,
        selections: cloneJson(Array.isArray(payload.selections) ? payload.selections : []),
        compositionMode: safeText(payload.compositionMode, 80),
        mode: safeText(payload.mode || record.mode, 50),
        requestTitle: safeText(payload.requestTitle, 500)
      };
    }

    async function markVisited(payload) {
      payload = payload && typeof payload === "object" ? payload : {};
      var at = toIso(payload.visitedAt || payload.at, nowIso());
      var identity = {
        releaseId: safeText(payload.releaseId, 180),
        contentRevision: safeText(payload.contentRevision, 100),
        passageId: safeText(payload.passageId, 180),
        taskId: safeText(payload.taskId, 180)
      };
      if (!identity.passageId && !identity.taskId) throw new Error("markVisited requires passageId or taskId");
      var recordId = safeText(payload.recordId, 220) || stableRecordId("visited", identity);
      var existing = await getRecord(recordId);
      var createdAt = existing ? existing.createdAt : at;
      var base = commonRecordFields(Object.assign({}, existing || {}, payload), "visited", recordId, createdAt, at);
      base.firstVisitedAt = existing ? existing.firstVisitedAt : at;
      base.lastVisitedAt = at;
      base.visitCount = integer(existing && existing.visitCount, 0, 0, 1000000) + 1;
      if (existing) {
        base.contentRefs = base.contentRefs.length ? base.contentRefs : existing.contentRefs;
        base.passageIds = base.passageIds.length ? base.passageIds : existing.passageIds;
        base.taskIds = base.taskIds.length ? base.taskIds : existing.taskIds;
      }
      return putRecord(base);
    }

    async function markStarted(payload) {
      payload = payload && typeof payload === "object" ? payload : {};
      var at = toIso(payload.startedAt || payload.at, nowIso());
      var identity = {
        releaseId: safeText(payload.releaseId, 180),
        sessionId: safeText(payload.sessionId || payload.snapshotHash, 220),
        passageIds: uniqueTextList(payload.passageIds, 200),
        taskIds: uniqueTextList(payload.taskIds, 500),
        startedAt: safeText(payload.sessionId || payload.snapshotHash, 220) ? "" : at
      };
      var recordId = safeText(payload.recordId, 220) || stableRecordId("started", identity);
      var existing = await getRecord(recordId);
      var createdAt = existing ? existing.createdAt : at;
      var base = commonRecordFields(Object.assign({}, existing || {}, payload), "started", recordId, createdAt, at);
      base.startedAt = existing ? existing.startedAt : at;
      base.lastSeenAt = at;
      base.startCount = integer(existing && existing.startCount, 0, 0, 1000000) + 1;
      if (existing) {
        base.contentRefs = base.contentRefs.length ? base.contentRefs : existing.contentRefs;
        base.passageIds = base.passageIds.length ? base.passageIds : existing.passageIds;
        base.taskIds = base.taskIds.length ? base.taskIds : existing.taskIds;
      }
      return putRecord(base);
    }

    async function recordSubmission(payload) {
      payload = payload && typeof payload === "object" ? payload : {};
      var submittedAt = toIso(payload.submittedAt || payload.at, nowIso());
      var attemptNumber = integer(payload.attemptNumber, 1, 1, 1000000);
      var attemptId = safeText(payload.attemptId, 220);
      var identity = {
        releaseId: safeText(payload.releaseId, 180),
        attemptId: attemptId,
        sessionId: safeText(payload.sessionId, 220),
        snapshotHash: safeText(payload.snapshotHash, 220),
        attemptNumber: attemptNumber,
        submittedAt: attemptId || payload.sessionId || payload.snapshotHash ? "" : submittedAt
      };
      var recordId = safeText(payload.recordId, 220) || stableRecordId("submitted", identity);
      var existing = await getRecord(recordId);
      var updatedAt = toIso(payload.updatedAt, submittedAt);
      if (existing && compareIso(existing.updatedAt, updatedAt) > 0) return cloneJson(existing);
      var base = commonRecordFields(payload, "submitted", recordId, existing ? existing.createdAt : submittedAt, updatedAt);
      base.attemptId = attemptId;
      base.attemptNumber = attemptNumber;
      base.submittedAt = submittedAt;
      base.elapsedSeconds = integer(payload.elapsedSeconds, 0, 0, 31536000);
      base.submissionReason = safeText(payload.submissionReason || payload.reason, 80);
      base.score = sanitizeScore(payload.score || payload.result || payload);
      base.passageResults = sanitizePassageResults(payload.passageResults);
      base.questionOutcomes = sanitizeOutcomes(payload.questionOutcomes || payload.outcomes);
      return putRecord(base);
    }

    function matchesFilter(record, filter) {
      if (!filter) return true;
      if (filter.type && record.type !== filter.type) return false;
      if (filter.releaseId && record.releaseId !== filter.releaseId) return false;
      if (filter.mode && record.mode !== filter.mode) return false;
      if (filter.scope && record.scope !== filter.scope) return false;
      if (filter.passageId && record.passageIds.indexOf(filter.passageId) === -1) return false;
      if (filter.taskId && record.taskIds.indexOf(filter.taskId) === -1) return false;
      if (filter.from && compareIso(record.updatedAt, toIso(filter.from, filter.from)) < 0) return false;
      if (filter.to && compareIso(record.updatedAt, toIso(filter.to, filter.to)) > 0) return false;
      return true;
    }

    async function listRecords(filter, readObservation) {
      var records = (await allRecords(readObservation)).filter(function filterRecords(record) {
        return matchesFilter(record, filter);
      });
      records.sort(function sortRecords(left, right) {
        var compared = compareIso(right.updatedAt, left.updatedAt);
        return compared || left.recordId.localeCompare(right.recordId);
      });
      return cloneJson(records);
    }

    async function listRecordsWithReadHealth(filter) {
      var health = {};
      var rows = await listRecords(filter, health);
      return { rows: rows, health: Object.assign({}, health) };
    }

    async function getSummary(filter) {
      var records = await listRecords(filter);
      var visitedPassages = Object.create(null);
      var startedSessions = Object.create(null);
      var perPassage = Object.create(null);
      var submissions = 0;
      var totalEarned = 0;
      var totalAvailable = 0;
      var bestPercent = null;
      var latestActivityAt = "";

      records.forEach(function each(record) {
        if (!latestActivityAt || compareIso(record.updatedAt, latestActivityAt) > 0) latestActivityAt = record.updatedAt;
        if (record.type === "visited") record.passageIds.forEach(function addVisited(id) { visitedPassages[id] = true; });
        if (record.type === "started") startedSessions[record.sessionId || record.recordId] = true;
        if (record.type === "submitted") {
          submissions += 1;
          if (record.score && Number.isFinite(record.score.earnedMarks)) totalEarned += record.score.earnedMarks;
          if (record.score && Number.isFinite(record.score.availableMarks)) totalAvailable += record.score.availableMarks;
          if (record.score && Number.isFinite(record.score.percent)) bestPercent = bestPercent === null ? record.score.percent : Math.max(bestPercent, record.score.percent);
        }
        record.passageIds.forEach(function addPassage(passageId) {
          if (!perPassage[passageId]) {
            perPassage[passageId] = { passageId: passageId, visited: false, starts: 0, submissions: 0, bestPercent: null, latestActivityAt: "" };
          }
          var row = perPassage[passageId];
          if (record.type === "visited") row.visited = true;
          if (record.type === "started") row.starts += 1;
          if (record.type === "submitted") {
            row.submissions += 1;
            var passageResult = (record.passageResults || []).find(function findPassageResult(result) { return result.passageId === passageId; });
            var passagePercent = passageResult && Number.isFinite(passageResult.percent)
              ? passageResult.percent
              : record.passageIds.length === 1 && record.score && Number.isFinite(record.score.percent)
                ? record.score.percent
                : null;
            if (Number.isFinite(passagePercent)) row.bestPercent = row.bestPercent === null ? passagePercent : Math.max(row.bestPercent, passagePercent);
          }
          if (!row.latestActivityAt || compareIso(record.updatedAt, row.latestActivityAt) > 0) row.latestActivityAt = record.updatedAt;
        });
      });

      return {
        schemaVersion: SCHEMA_VERSION,
        storageMode: storageMode,
        recordCount: records.length,
        visitedPassageCount: Object.keys(visitedPassages).length,
        startedSessionCount: Object.keys(startedSessions).length,
        submissionCount: submissions,
        aggregateScore: {
          earnedMarks: totalEarned,
          availableMarks: totalAvailable,
          percent: totalAvailable ? Math.round((totalEarned / totalAvailable) * 1000) / 10 : null,
          bestPercent: bestPercent
        },
        latestActivityAt: latestActivityAt || null,
        perPassage: Object.keys(perPassage).sort().map(function mapPassage(id) { return perPassage[id]; })
      };
    }

    async function exportData(options) {
      options = options || {};
      var records = await listRecords(options.filter);
      var output = {
        schemaVersion: SCHEMA_VERSION,
        exportedAt: nowIso(),
        recordCount: records.length,
        records: records
      };
      if (options.includePreferences) output.preferences = getPreferences();
      return output;
    }

    async function exportJSON(options) {
      var spacing = options && options.pretty === false ? 0 : 2;
      return JSON.stringify(await exportData(options), null, spacing);
    }

    async function exportSubmissionsCSV(options) {
      options = options || {};
      var filter = Object.assign({}, options.filter || {}, { type: "submitted" });
      var records = await listRecords(filter);
      records.sort(function oldestFirst(left, right) {
        var compared = compareIso(left.submittedAt, right.submittedAt);
        return compared || left.recordId.localeCompare(right.recordId);
      });
      var headers = [
        "submitted_at", "mode", "scope", "release_id", "month", "attempt_number", "record_id",
        "passage_ids", "passage_titles_en", "passage_titles_zh", "task_ids", "question_types",
        "frequencies", "difficulty_labels", "difficulty_scores", "earned_marks", "available_marks",
        "percent", "reference_band", "answered", "correct", "partial", "incorrect", "unanswered",
        "elapsed_seconds", "submission_reason"
      ];
      var rows = records.map(function mapSubmission(record) {
        var refs = Array.isArray(record.contentRefs) ? record.contentRefs : [];
        var questionTypes = [];
        refs.forEach(function addRefTypes(ref) {
          (ref.questionTypes || []).forEach(function addType(type) {
            if (questionTypes.indexOf(type) === -1) questionTypes.push(type);
          });
        });
        (record.questionOutcomes || []).forEach(function addOutcomeType(outcome) {
          if (outcome.questionType && questionTypes.indexOf(outcome.questionType) === -1) questionTypes.push(outcome.questionType);
        });
        var values = [
          record.submittedAt, record.mode, record.scope, record.releaseId, record.month, record.attemptNumber, record.recordId,
          (record.passageIds || []).join(" | "), refs.map(function title(ref) { return ref.titleEn; }).filter(Boolean).join(" | "),
          refs.map(function title(ref) { return ref.titleZh; }).filter(Boolean).join(" | "), (record.taskIds || []).join(" | "),
          questionTypes.join(" | "), refs.map(function frequency(ref) { return ref.frequency; }).filter(Boolean).join(" | "),
          refs.map(function difficulty(ref) { return ref.difficultyLabel; }).filter(Boolean).join(" | "),
          refs.map(function difficulty(ref) { return ref.difficultyScore; }).filter(Number.isFinite).join(" | "),
          record.score && record.score.earnedMarks, record.score && record.score.availableMarks,
          record.score && record.score.percent, record.score && record.score.band, record.score && record.score.answered,
          record.score && record.score.correct, record.score && record.score.partial, record.score && record.score.incorrect,
          record.score && record.score.unanswered, record.elapsedSeconds, record.submissionReason
        ];
        return values.map(excelSafeCsvValue).join(",");
      });
      return "\ufeff" + headers.join(",") + "\r\n" + rows.join("\r\n") + (rows.length ? "\r\n" : "");
    }

    async function exportQuestionOutcomesCSV(options) {
      options = options || {};
      var filter = Object.assign({}, options.filter || {}, { type: "submitted" });
      var records = await listRecords(filter);
      records.sort(function oldestFirst(left, right) {
        var compared = compareIso(left.submittedAt, right.submittedAt);
        return compared || left.recordId.localeCompare(right.recordId);
      });
      var headers = [
        "submitted_at", "record_id", "attempt_number", "mode", "scope", "release_id", "month",
        "passage_id", "passage_title_en", "passage_title_zh", "task_id", "task_label",
        "question_number", "question_type", "status", "earned_marks", "available_marks",
        "elapsed_seconds", "submission_reason"
      ];
      var rows = [];
      records.forEach(function addSubmissionOutcomes(record) {
        var refs = Array.isArray(record.contentRefs) ? record.contentRefs : [];
        var refsByPassage = Object.create(null);
        refs.forEach(function indexRef(ref) {
          if (!ref || !ref.passageId || refsByPassage[ref.passageId]) return;
          refsByPassage[ref.passageId] = ref;
        });
        (record.questionOutcomes || []).forEach(function addOutcome(outcome) {
          var ref = refsByPassage[outcome.passageId] || {};
          var values = [
            record.submittedAt, record.recordId, record.attemptNumber, record.mode, record.scope,
            record.releaseId, record.month, outcome.passageId, ref.titleEn, ref.titleZh,
            outcome.taskId, outcome.taskLabel || outcome.questionType, outcome.questionNumber,
            outcome.questionType, outcome.status, outcome.earnedMarks, outcome.availableMarks,
            record.elapsedSeconds, record.submissionReason
          ];
          rows.push(values.map(excelSafeCsvValue).join(","));
        });
      });
      return "\ufeff" + headers.join(",") + "\r\n" + rows.join("\r\n") + (rows.length ? "\r\n" : "");
    }

    async function exportPersonalBackup(options) {
      options = options || {};
      var records = await listRecords(options.filter);
      var allowedSnapshotIds = Object.create(null);
      records.forEach(function allowSubmittedSnapshot(record) {
        if (record.type === "submitted") allowedSnapshotIds[record.recordId] = true;
      });
      var snapshots = (await listAttemptSnapshots()).filter(function includeSnapshot(snapshot) {
        return !options.filter || allowedSnapshotIds[snapshot.snapshotId];
      });
      var output = {
        schemaVersion: PERSONAL_BACKUP_SCHEMA_VERSION,
        recordSchemaVersion: SCHEMA_VERSION,
        attemptSnapshotSchemaVersion: ATTEMPT_SNAPSHOT_SCHEMA_VERSION,
        exportedAt: nowIso(),
        recordCount: records.length,
        attemptSnapshotCount: snapshots.length,
        records: records,
        attemptSnapshots: snapshots
      };
      if (options.includePreferences !== false) output.preferences = sanitizePreferencesPayload(getPreferences());
      // Re-run the private snapshot sanitizer before anything leaves this API.
      output.attemptSnapshots = output.attemptSnapshots.map(function sanitizeExportedSnapshot(snapshot) {
        var sanitized = sanitizeAttemptSnapshotPayload(snapshot.payload, maxAttemptSnapshotBytes);
        return {
          schemaVersion: ATTEMPT_SNAPSHOT_SCHEMA_VERSION,
          snapshotId: normalizeAttemptSnapshotId(snapshot.snapshotId),
          updatedAt: toIso(snapshot.updatedAt, nowIso()),
          byteSize: sanitized.byteSize,
          payload: sanitized.payload
        };
      });
      return cloneJson(output);
    }

    async function exportPersonalBackupJSON(options) {
      var spacing = options && options.pretty === false ? 0 : 2;
      return JSON.stringify(await exportPersonalBackup(options), null, spacing);
    }

    async function importPersonalBackup(jsonOrObject, options) {
      return withMutationLock(function lockedPersonalBackupImport() {
        return importPersonalBackupUnlocked(jsonOrObject, options);
      });
    }

    async function importPersonalBackupUnlocked(jsonOrObject, options) {
      options = options && typeof options === "object" ? options : {};
      var input;
      if (typeof jsonOrObject === "string") {
        try { input = JSON.parse(jsonOrObject); } catch (error) { throw new Error("Personal backup is not valid JSON"); }
      } else {
        input = cloneJson(jsonOrObject);
      }
      if (!input || input.schemaVersion !== PERSONAL_BACKUP_SCHEMA_VERSION ||
          input.recordSchemaVersion !== SCHEMA_VERSION || !Array.isArray(input.records) ||
          !Array.isArray(input.attemptSnapshots)) {
        throw new Error("Unsupported personal backup schema");
      }
      if (input.records.length > MAX_RECORDS || input.attemptSnapshots.length > MAX_ATTEMPT_SNAPSHOTS) {
        throw new Error("Personal backup exceeds the item limit");
      }

      // Validate the entire backup before mutating either store.
      var normalizedRecords = input.records.map(function normalizeBackupRecord(raw) {
        var record = sanitizeImportedRecord(raw);
        if (!record) throw new Error("Personal backup contains an invalid record");
        return record;
      });
      var incomingSnapshotIds = Object.create(null);
      var normalizedSnapshots = input.attemptSnapshots.map(function normalizeBackupSnapshot(raw) {
        if (!raw || raw.schemaVersion !== ATTEMPT_SNAPSHOT_SCHEMA_VERSION) {
          throw new Error("Personal backup contains an unsupported attempt snapshot");
        }
        var snapshotId = normalizeAttemptSnapshotId(raw.snapshotId);
        if (incomingSnapshotIds[snapshotId]) throw new Error("Personal backup contains a duplicate attempt snapshot id");
        incomingSnapshotIds[snapshotId] = true;
        var sanitized = sanitizeAttemptSnapshotPayload(raw.payload, maxAttemptSnapshotBytes);
        return {
          schemaVersion: ATTEMPT_SNAPSHOT_SCHEMA_VERSION,
          snapshotId: snapshotId,
          updatedAt: toIso(raw.updatedAt, input.exportedAt || nowIso()),
          byteSize: sanitized.byteSize,
          payload: sanitized.payload
        };
      });
      var normalizedPreferences = Object.prototype.hasOwnProperty.call(input, "preferences")
        ? sanitizePreferencesPayload(input.preferences)
        : null;

      await init();
      var indexedAtStart = storageMode === "indexeddb" && db;
      var recordsBefore;
      var snapshotsBefore;
      try {
        recordsBefore = indexedAtStart
          ? (await idbGetAll()).map(sanitizeImportedRecord).filter(Boolean)
          : fallbackReadRecords();
        snapshotsBefore = indexedAtStart
          ? (await idbGetAllAttemptSnapshots()).map(function sanitizeSnapshot(value) {
            return sanitizeAttemptSnapshotEntry(value, maxAttemptSnapshotBytes);
          }).filter(Boolean)
          : fallbackReadAttemptSnapshots();
      } catch (readError) {
        throw new Error("Could not safely read current learning data before restoring the personal backup: "
          + safeText(readError && readError.message ? readError.message : readError, 500));
      }
      var preferencesBefore = cloneJson(getPreferences());
      var memoryRecordsBefore = cloneJson(memoryRecords);
      var memorySnapshotsBefore = cloneJson(memoryAttemptSnapshots);
      var memoryPreferencesBefore = cloneJson(memoryPreferences);
      var snapshotFallbackUsesMemoryBefore = snapshotFallbackUsesMemory;
      var fallbackBackup = local ? [
        { key: fallbackKey, value: local.getItem(fallbackKey) },
        { key: snapshotFallbackKey, value: local.getItem(snapshotFallbackKey) },
        { key: preferencesKey, value: local.getItem(preferencesKey) }
      ] : null;

      var incomingRecordsById = Object.create(null);
      var recordResult = {
        schemaVersion: SCHEMA_VERSION,
        added: 0,
        updated: 0,
        skippedOlder: 0,
        skippedDuplicate: 0,
        conflicts: 0,
        invalid: 0
      };
      normalizedRecords.forEach(function indexIncomingRecord(record) {
        var duplicate = incomingRecordsById[record.recordId];
        if (!duplicate || compareIso(record.updatedAt, duplicate.updatedAt) > 0) {
          if (duplicate) recordResult.skippedDuplicate += 1;
          incomingRecordsById[record.recordId] = record;
        } else {
          recordResult.skippedDuplicate += 1;
        }
      });
      var nextRecordsById = Object.create(null);
      recordsBefore.forEach(function indexCurrentRecord(record) { nextRecordsById[record.recordId] = record; });
      Object.keys(incomingRecordsById).forEach(function mergeRecord(recordId) {
        var incoming = incomingRecordsById[recordId];
        var existing = nextRecordsById[recordId];
        if (!existing) {
          nextRecordsById[recordId] = incoming;
          recordResult.added += 1;
          return;
        }
        var comparison = compareIso(incoming.updatedAt, existing.updatedAt);
        if (comparison > 0) {
          nextRecordsById[recordId] = incoming;
          recordResult.updated += 1;
        } else if (comparison < 0) {
          recordResult.skippedOlder += 1;
        } else if (stableStringify(incoming) === stableStringify(existing)) {
          recordResult.skippedDuplicate += 1;
        } else {
          recordResult.conflicts += 1;
        }
      });
      var nextRecords = Object.keys(nextRecordsById).map(function recordById(recordId) {
        return nextRecordsById[recordId];
      });
      recordResult.totalAfterImport = nextRecords.length;

      var nextSnapshotsById = Object.create(null);
      snapshotsBefore.forEach(function indexCurrentSnapshot(snapshot) {
        nextSnapshotsById[snapshot.snapshotId] = snapshot;
      });
      var snapshotResult = { added: 0, updated: 0, skippedOlder: 0, skippedDuplicate: 0, conflicts: 0 };
      normalizedSnapshots.forEach(function mergeSnapshot(incoming) {
        var existing = nextSnapshotsById[incoming.snapshotId];
        if (!existing) {
          nextSnapshotsById[incoming.snapshotId] = incoming;
          snapshotResult.added += 1;
          return;
        }
        var comparison = compareIso(incoming.updatedAt, existing.updatedAt);
        if (comparison > 0) {
          nextSnapshotsById[incoming.snapshotId] = incoming;
          snapshotResult.updated += 1;
        } else if (comparison < 0) {
          snapshotResult.skippedOlder += 1;
        } else if (stableStringify(incoming.payload) === stableStringify(existing.payload)) {
          snapshotResult.skippedDuplicate += 1;
        } else {
          snapshotResult.conflicts += 1;
        }
      });
      var nextSnapshots = Object.keys(nextSnapshotsById).map(function snapshotById(snapshotId) {
        return nextSnapshotsById[snapshotId];
      });
      if (nextRecords.length > MAX_RECORDS || nextSnapshots.length > MAX_ATTEMPT_SNAPSHOTS) {
        throw new Error("Personal backup would exceed the local item limit");
      }
      nextSnapshots.forEach(function verifySummaryReplayPair(snapshot) {
        var record = nextRecordsById[snapshot.snapshotId];
        var payload = snapshot.payload && typeof snapshot.payload === "object" ? snapshot.payload : {};
        var runtimeState = payload.runtimeState && typeof payload.runtimeState === "object" ? payload.runtimeState : payload;
        if (!record || record.type !== "submitted" || runtimeState.submitted !== true ||
            safeText(runtimeState.submissionId, 220) !== snapshot.snapshotId) {
          throw new Error("Personal backup contains an unmatched submission summary and replay snapshot");
        }
        var recordHash = safeText(record.snapshotHash, 220);
        var replayHash = safeText(payload.snapshotHash, 220);
        var recordVersion = safeText(record.packageContentVersion, 220);
        var replayVersion = safeText(payload.packageContentVersion, 220);
        var recordMode = safeText(record.mode, 40);
        var replayMode = safeText(payload.mode, 40);
        if ((recordHash && replayHash && recordHash !== replayHash) ||
            (recordVersion && replayVersion && recordVersion !== replayVersion) ||
            (recordMode && replayMode && recordMode !== replayMode)) {
          throw new Error("Personal backup would create a mismatched submission summary and replay snapshot");
        }
        attemptAnnotationState(record, snapshot, {
          expectedSubmissionId: snapshot.snapshotId,
          expectedSnapshotHash: replayHash,
          expectedContentVersion: replayVersion
        });
      });
      var preferencesRestored = Boolean(normalizedPreferences && options.preferencesMode !== "ignore");
      var nextPreferences = preferencesRestored
        ? (options.preferencesMode === "replace"
          ? normalizedPreferences
          : Object.assign({}, preferencesBefore, normalizedPreferences))
        : preferencesBefore;

      function orderedRecords(records) {
        return records.slice().sort(function sortRecords(left, right) {
          return left.recordId.localeCompare(right.recordId);
        });
      }
      function orderedSnapshots(snapshots) {
        return snapshots.slice().sort(function sortSnapshots(left, right) {
          return left.snapshotId.localeCompare(right.snapshotId);
        });
      }
      function restoreFallbackBackup() {
        var restoreError = null;
        if (!local || !fallbackBackup) return restoreError;
        fallbackBackup.forEach(function restore(entry) {
          try {
            if (entry.value === null) local.removeItem(entry.key);
            else local.setItem(entry.key, entry.value);
            if (local.getItem(entry.key) !== entry.value) throw new Error("backup rollback read-back mismatch for " + entry.key);
          } catch (error) { restoreError = restoreError || error; }
        });
        return restoreError;
      }
      async function rollbackPersonalImport(reason) {
        var rollbackError = null;
        if (indexedAtStart) {
          try { await idbRestoreAllStores(recordsBefore, snapshotsBefore); }
          catch (error) { rollbackError = error; }
        }
        rollbackError = restoreFallbackBackup() || rollbackError;
        memoryRecords = cloneJson(memoryRecordsBefore);
        memoryAttemptSnapshots = cloneJson(memorySnapshotsBefore);
        memoryPreferences = cloneJson(memoryPreferencesBefore);
        snapshotFallbackUsesMemory = snapshotFallbackUsesMemoryBefore;
        var failure = new Error(safeText(reason && reason.message ? reason.message : reason, 500)
          + (rollbackError
            ? "; personal backup rollback also failed: " + safeText(rollbackError && rollbackError.message ? rollbackError.message : rollbackError, 500)
            : "; previous learning data was restored"));
        failure.importRollbackVerified = !rollbackError;
        throw failure;
      }

      try {
        if (indexedAtStart) {
          await idbRestoreAllStores(nextRecords, nextSnapshots);
        } else if (local) {
          var encodedRecords = JSON.stringify(nextRecords);
          var encodedSnapshots = JSON.stringify(nextSnapshots);
          local.setItem(fallbackKey, encodedRecords);
          local.setItem(snapshotFallbackKey, encodedSnapshots);
          if (local.getItem(fallbackKey) !== encodedRecords || local.getItem(snapshotFallbackKey) !== encodedSnapshots) {
            throw new Error("Personal backup stores did not pass write verification");
          }
          snapshotFallbackUsesMemory = false;
        } else {
          memoryRecords = cloneJson(nextRecords);
          memoryAttemptSnapshots = cloneJson(nextSnapshots);
          snapshotFallbackUsesMemory = true;
        }
        if (preferencesRestored) {
          if (local) {
            var encodedPreferences = JSON.stringify(sanitizePreferencesPayload(nextPreferences));
            if (encodedPreferences.length > 200000) throw new Error("Preferences exceed the storage limit");
            local.setItem(preferencesKey, encodedPreferences);
            if (local.getItem(preferencesKey) !== encodedPreferences) {
              throw new Error("Personal backup preferences did not pass write verification");
            }
          } else {
            memoryPreferences = cloneJson(nextPreferences);
          }
        }

        var verifiedRecords = indexedAtStart
          ? (await idbGetAll()).map(sanitizeImportedRecord).filter(Boolean)
          : fallbackReadRecords();
        var verifiedSnapshots = indexedAtStart
          ? (await idbGetAllAttemptSnapshots()).map(function sanitizeSnapshot(value) {
            return sanitizeAttemptSnapshotEntry(value, maxAttemptSnapshotBytes);
          }).filter(Boolean)
          : fallbackReadAttemptSnapshots();
        var verifiedPreferences = cloneJson(getPreferences());
        if (stableStringify(orderedRecords(verifiedRecords)) !== stableStringify(orderedRecords(nextRecords)) ||
            stableStringify(orderedSnapshots(verifiedSnapshots)) !== stableStringify(orderedSnapshots(nextSnapshots)) ||
            stableStringify(verifiedPreferences) !== stableStringify(nextPreferences)) {
          throw new Error("Personal backup restore did not pass final read-back verification");
        }
      } catch (error) {
        await rollbackPersonalImport(error);
      }

      return {
        schemaVersion: PERSONAL_BACKUP_SCHEMA_VERSION,
        records: recordResult,
        attemptSnapshots: snapshotResult,
        preferencesRestored: preferencesRestored
      };
    }

    async function importData(jsonOrObject) {
      var input;
      if (typeof jsonOrObject === "string") {
        try { input = JSON.parse(jsonOrObject); } catch (error) { throw new Error("Import data is not valid JSON"); }
      } else {
        input = cloneJson(jsonOrObject);
      }
      if (!input || input.schemaVersion !== SCHEMA_VERSION || !Array.isArray(input.records)) {
        throw new Error("Unsupported student record schema");
      }
      if (input.records.length > MAX_RECORDS) throw new Error("Import contains too many records");

      var current = await listRecords();
      var currentById = Object.create(null);
      current.forEach(function indexRecord(record) { currentById[record.recordId] = record; });
      var incomingById = Object.create(null);
      var result = { schemaVersion: SCHEMA_VERSION, added: 0, updated: 0, skippedOlder: 0, skippedDuplicate: 0, conflicts: 0, invalid: 0 };

      input.records.forEach(function normalizeIncoming(raw) {
        var record = sanitizeImportedRecord(raw);
        if (!record) {
          result.invalid += 1;
          return;
        }
        var duplicate = incomingById[record.recordId];
        if (!duplicate || compareIso(record.updatedAt, duplicate.updatedAt) > 0) incomingById[record.recordId] = record;
        else result.skippedDuplicate += 1;
      });

      var ids = Object.keys(incomingById);
      for (var index = 0; index < ids.length; index += 1) {
        var id = ids[index];
        var incoming = incomingById[id];
        var existing = currentById[id];
        if (!existing) {
          await putRecord(incoming);
          result.added += 1;
          continue;
        }
        var comparison = compareIso(incoming.updatedAt, existing.updatedAt);
        if (comparison > 0) {
          await putRecord(incoming);
          result.updated += 1;
        } else if (comparison < 0) {
          result.skippedOlder += 1;
        } else if (stableStringify(incoming) === stableStringify(existing)) {
          result.skippedDuplicate += 1;
        } else {
          // Equal timestamps with divergent content are left untouched and surfaced.
          result.conflicts += 1;
        }
      }
      result.totalAfterImport = (await listRecords()).length;
      return result;
    }

    function getPreferences() {
      var value = local ? readLocalJson(preferencesKey, {}) : cloneJson(memoryPreferences);
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    }

    function writePreferences(value) {
      var preferences = sanitizePreferencesPayload(value && typeof value === "object" ? value : {});
      var encoded = JSON.stringify(preferences);
      if (encoded.length > 200000) throw new Error("Preferences exceed the storage limit");
      if (local && writeLocalJson(preferencesKey, preferences)) return cloneJson(preferences);
      memoryPreferences = preferences;
      return cloneJson(preferences);
    }

    function setPreference(key, value) {
      key = safeText(key, 120);
      if (!key) throw new Error("Preference key is required");
      var preferences = getPreferences();
      preferences[key] = cloneJson(value);
      writePreferences(preferences);
      return cloneJson(value);
    }

    function getPreference(key, fallback) {
      var preferences = getPreferences();
      return Object.prototype.hasOwnProperty.call(preferences, key) ? cloneJson(preferences[key]) : fallback;
    }

    function removePreference(key) {
      var preferences = getPreferences();
      delete preferences[key];
      writePreferences(preferences);
    }

    async function clearAll(options) {
      return withMutationLock(function lockedClearAll() { return clearAllUnlocked(options); });
    }

    async function clearAllUnlocked(options) {
      options = options || {};
      function clearFailure(message, rollbackVerified) {
        var error = new Error(message);
        error.clearRollbackVerified = rollbackVerified !== false;
        return error;
      }
      await init();
      var includePreferences = options.includePreferences !== false;
      var indexedAtStart = storageMode === "indexeddb" && db;
      var recordsBefore;
      var snapshotsBefore;
      if (indexedAtStart) {
        try {
          recordsBefore = (await idbGetAll()).map(sanitizeImportedRecord).filter(Boolean);
          snapshotsBefore = (await idbGetAllAttemptSnapshots()).map(function sanitizeSnapshot(value) {
            return sanitizeAttemptSnapshotEntry(value, maxAttemptSnapshotBytes);
          }).filter(Boolean);
        } catch (readError) {
          storageError = safeText(readError && readError.message ? readError.message : readError, 500);
          throw new Error("Could not safely read IndexedDB before clearing local learning data: " + storageError);
        }
      } else {
        recordsBefore = fallbackReadRecords();
        snapshotsBefore = fallbackReadAttemptSnapshots();
      }
      var preferencesBefore = cloneJson(getPreferences());

      var fallbackBackup = null;
      function restoreFallbackBackup() {
        var restoreError = null;
        if (!local || !fallbackBackup) return restoreError;
        fallbackBackup.forEach(function restore(entry) {
          try {
            if (entry.value === null) local.removeItem(entry.key);
            else local.setItem(entry.key, entry.value);
            if (local.getItem(entry.key) !== entry.value) {
              throw new Error("fallback rollback read-back mismatch for " + entry.key);
            }
          } catch (error) { restoreError = restoreError || error; }
        });
        return restoreError;
      }
      if (local) {
        try {
          fallbackBackup = [
            { key: fallbackKey, value: local.getItem(fallbackKey) },
            { key: snapshotFallbackKey, value: local.getItem(snapshotFallbackKey) }
          ];
          if (includePreferences) fallbackBackup.push({ key: preferencesKey, value: local.getItem(preferencesKey) });
          fallbackBackup.forEach(function remove(entry) { local.removeItem(entry.key); });
          if (fallbackBackup.some(function remains(entry) { return local.getItem(entry.key) !== null; })) {
            throw new Error("fallback keys remained after removal");
          }
        } catch (fallbackError) {
          var fallbackRestoreError = restoreFallbackBackup();
          throw clearFailure("Could not safely clear fallback learning data: "
            + safeText(fallbackError && fallbackError.message ? fallbackError.message : fallbackError, 500)
            + (fallbackRestoreError ? "; fallback rollback also failed" : ""), !fallbackRestoreError);
        }
      }

      if (indexedAtStart) {
        try {
          await idbClearAllStores();
        } catch (clearError) {
          var restoreError = restoreFallbackBackup();
          storageError = safeText(clearError && clearError.message ? clearError.message : clearError, 500);
          throw clearFailure("Could not safely clear IndexedDB learning data: " + storageError
            + (restoreError ? "; fallback rollback also failed" : ""), !restoreError);
        }
      }

      memoryRecords = [];
      memoryAttemptSnapshots = [];
      snapshotFallbackUsesMemory = false;
      if (includePreferences) {
        memoryPreferences = {};
      }

      async function rollbackVerifiedClear(reason) {
        var rollbackError = null;
        if (indexedAtStart) {
          try { await idbRestoreAllStores(recordsBefore, snapshotsBefore); }
          catch (error) { rollbackError = error; }
        }
        rollbackError = restoreFallbackBackup() || rollbackError;
        memoryRecords = cloneJson(recordsBefore);
        memoryAttemptSnapshots = cloneJson(snapshotsBefore);
        memoryPreferences = cloneJson(preferencesBefore);
        snapshotFallbackUsesMemory = false;
        var message = safeText(reason && reason.message ? reason.message : reason, 500);
        throw clearFailure(message + (rollbackError
          ? "; clear rollback also failed: " + safeText(rollbackError && rollbackError.message ? rollbackError.message : rollbackError, 500)
          : "; previous learning data was restored"), !rollbackError);
      }

      var recordsAfter;
      var snapshotsAfter;
      if (indexedAtStart) {
        try {
          recordsAfter = (await idbGetAll()).map(sanitizeImportedRecord).filter(Boolean);
          snapshotsAfter = (await idbGetAllAttemptSnapshots()).map(function sanitizeSnapshot(value) {
            return sanitizeAttemptSnapshotEntry(value, maxAttemptSnapshotBytes);
          }).filter(Boolean);
        } catch (verifyError) {
          storageError = safeText(verifyError && verifyError.message ? verifyError.message : verifyError, 500);
          await rollbackVerifiedClear(new Error("Could not verify IndexedDB after clearing local learning data: " + storageError));
        }
      } else {
        recordsAfter = fallbackReadRecords();
        snapshotsAfter = fallbackReadAttemptSnapshots();
      }
      var preferencesAfter = cloneJson(getPreferences());
      var recordsCleared = recordsAfter.length === 0;
      var snapshotsCleared = snapshotsAfter.length === 0;
      var preferencesCleared = includePreferences && Object.keys(preferencesAfter).length === 0;
      var preferencesPreserved = !includePreferences && stableStringify(preferencesAfter) === stableStringify(preferencesBefore);
      var verified = recordsCleared && snapshotsCleared && (includePreferences ? preferencesCleared : preferencesPreserved);
      if (!verified) await rollbackVerifiedClear(new Error("Cleared learning data did not pass read-back verification"));
      return {
        cleared: true,
        verified: true,
        primaryStoreCleared: recordsCleared && snapshotsCleared,
        includePreferences: includePreferences,
        deletedRecordCount: Math.max(0, recordsBefore.length - recordsAfter.length),
        deletedAttemptSnapshotCount: Math.max(0, snapshotsBefore.length - snapshotsAfter.length),
        remainingRecordCount: recordsAfter.length,
        remainingAttemptSnapshotCount: snapshotsAfter.length,
        preferencesCleared: preferencesCleared,
        preferencesPreserved: preferencesPreserved,
        storageMode: storageMode
      };
    }

    function getStorageStatus() {
      return { schemaVersion: SCHEMA_VERSION, storageMode: storageMode, storageError: storageError };
    }

    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      attemptSnapshotSchemaVersion: ATTEMPT_SNAPSHOT_SCHEMA_VERSION,
      personalBackupSchemaVersion: PERSONAL_BACKUP_SCHEMA_VERSION,
      replayBootContextSchemaVersion: REPLAY_BOOT_CONTEXT_SCHEMA_VERSION,
      annotationOverlaySchemaVersion: ANNOTATION_OVERLAY_SCHEMA_VERSION,
      init: init,
      markVisited: markVisited,
      markStarted: markStarted,
      recordSubmission: recordSubmission,
      putAttemptSnapshot: putAttemptSnapshot,
      getAttemptSnapshot: getAttemptSnapshot,
      listAttemptSnapshots: listAttemptSnapshots,
      deleteAttemptSnapshot: deleteAttemptSnapshot,
      deleteSubmission: deleteSubmission,
      readAttemptAnnotationOverlay: readAttemptAnnotationOverlay,
      updateAttemptAnnotationOverlay: updateAttemptAnnotationOverlay,
      prepareReplayBootContext: prepareReplayBootContext,
      listRecords: listRecords,
      getSummary: getSummary,
      exportData: exportData,
      exportJSON: exportJSON,
      exportSubmissionsCSV: exportSubmissionsCSV,
      exportQuestionOutcomesCSV: exportQuestionOutcomesCSV,
      exportPersonalBackup: exportPersonalBackup,
      exportPersonalBackupJSON: exportPersonalBackupJSON,
      importData: importData,
      importPersonalBackup: importPersonalBackup,
      clearAll: clearAll,
      getPreference: getPreference,
      setPreference: setPreference,
      removePreference: removePreference,
      getPreferences: getPreferences,
      listRecordsWithReadHealth: listRecordsWithReadHealth,
      getStorageStatus: getStorageStatus
    });
  }

  var defaultStore = createRecordStore();
  var publicApi = Object.assign({
    schemaVersion: SCHEMA_VERSION,
    attemptSnapshotSchemaVersion: ATTEMPT_SNAPSHOT_SCHEMA_VERSION,
    personalBackupSchemaVersion: PERSONAL_BACKUP_SCHEMA_VERSION,
    replayBootContextSchemaVersion: REPLAY_BOOT_CONTEXT_SCHEMA_VERSION,
    annotationOverlaySchemaVersion: ANNOTATION_OVERLAY_SCHEMA_VERSION,
    create: createRecordStore
  }, defaultStore);

  global.ZYZStudentRecordStore = Object.freeze(publicApi);
})(typeof window !== "undefined" ? window : globalThis);