
(function (global) {
  'use strict';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeText(value, rules) {
    const config = rules || {};
    let result = String(value == null ? '' : value);
    if (config.unicode && config.unicode !== 'none') result = result.normalize(config.unicode);
    else result = result.normalize('NFKC');
    if (config.trim !== false) result = result.trim();
    if (config.caseSensitive !== true) result = result.toLowerCase();
    if (config.apostrophePolicy === 'equivalent') result = result.replace(/[\u2018\u2019]/g, "'");
    if (config.hyphenPolicy === 'equivalent') result = result.replace(/[\u2010-\u2015-]/g, ' ');
    else if (config.hyphenPolicy === 'remove') result = result.replace(/[\u2010-\u2015-]/g, '');
    if (config.collapseWhitespace !== false) result = result.replace(/\s+/g, ' ');
    return result;
  }

  function indexPackage(packageData) {
    if (!packageData || typeof packageData !== 'object') throw new Error('The v2 package must be an object.');
    const candidate = packageData.candidate;
    const answerKey = packageData.answerKey;
    const review = packageData.review;
    if (!candidate || !Array.isArray(candidate.parts) || !Array.isArray(candidate.responseSlots)) {
      throw new Error('The v2 package candidate must contain parts and responseSlots.');
    }
    if (!answerKey || !Array.isArray(answerKey.scoreSlots)) throw new Error('The v2 package answerKey must contain scoreSlots.');
    if (!review || !Array.isArray(review.entries)) throw new Error('The v2 package review must contain entries.');

    const responseSlots = new Map(candidate.responseSlots.map((slot) => [slot.responseSlotId, Object.freeze({ ...slot })]));
    const tasks = new Map();
    const parts = candidate.parts.map((part) => {
      const copiedTasks = (part.tasks || []).map((task) => {
        if (tasks.has(task.taskId)) throw new Error(`Duplicate taskId ${task.taskId}.`);
        const copy = Object.freeze({ ...task, partId: part.partId });
        tasks.set(task.taskId, copy);
        return copy;
      });
      return Object.freeze({ ...part, tasks: Object.freeze(copiedTasks) });
    });
    candidate.responseSlots.forEach((slot) => {
      if (!tasks.has(slot.taskId)) throw new Error(`Response slot ${slot.responseSlotId} references missing task ${slot.taskId}.`);
    });

    const scoreSlots = new Map();
    const scoreSlotsByResponse = new Map();
    answerKey.scoreSlots.forEach((slot) => {
      if (scoreSlots.has(slot.scoreSlotId)) throw new Error(`Duplicate scoreSlotId ${slot.scoreSlotId}.`);
      const copy = Object.freeze({ ...slot });
      scoreSlots.set(slot.scoreSlotId, copy);
      (slot.responseSlotIds || []).forEach((responseSlotId) => {
        if (!responseSlots.has(responseSlotId)) throw new Error(`Score slot ${slot.scoreSlotId} references missing response ${responseSlotId}.`);
        const list = scoreSlotsByResponse.get(responseSlotId) || [];
        list.push(copy);
        scoreSlotsByResponse.set(responseSlotId, list);
      });
    });
    const reviews = new Map(review.entries.map((entry) => [entry.scoreSlotId, Object.freeze({ ...entry })]));

    return Object.freeze({
      manifest: Object.freeze({ ...(packageData.manifest || {}) }),
      candidate: Object.freeze({ ...candidate, parts: Object.freeze(parts) }),
      responseSlots,
      tasks,
      scoreSlots,
      scoreSlotsByResponse,
      reviews,
      maxMarks: Number(answerKey.maxMarks) || [...scoreSlots.values()].reduce((sum, slot) => sum + Number(slot.marks || 0), 0),
    });
  }

  function createResponseState(index, savedValues) {
    const values = {};
    const source = savedValues && typeof savedValues === 'object' ? savedValues : {};
    index.responseSlots.forEach((slot, responseSlotId) => {
      const raw = source[responseSlotId];
      values[responseSlotId] = raw == null ? '' : String(raw);
    });
    return values;
  }

  function taskResponseIds(index, taskId) {
    const task = index.tasks.get(taskId);
    return task ? [...task.responseSlotIds] : [];
  }

  function optionIds(task, responseSlotId) {
    const shared = ((task && task.content && task.content.options) || []).map((option) => option.optionId);
    const itemScoped = ((task && task.content && task.content.items) || [])
      .filter((item) => !responseSlotId || (item.responseSlotIds || []).includes(responseSlotId))
      .flatMap((item) => (item.options || []).map((option) => option.optionId));
    return new Set([...shared, ...itemScoped]);
  }

  function reduceResponses(index, currentValues, action) {
    const values = createResponseState(index, currentValues);
    const responseSlot = action && index.responseSlots.get(action.responseSlotId);
    if (!action || !responseSlot) return values;
    const task = index.tasks.get(responseSlot.taskId);
    if (!task) return values;

    if (action.type === 'set-text') {
      if (responseSlot.responseKind !== 'text') return values;
      values[responseSlot.responseSlotId] = String(action.value == null ? '' : action.value);
      return values;
    }

    if (action.type === 'set-option') {
      if (responseSlot.responseKind !== 'option') return values;
      const valid = optionIds(task, responseSlot.responseSlotId);
      const optionId = String(action.optionId || '');
      if (!valid.has(optionId)) return values;
      if (task.interactionVariant === 'option_mapping' && task.rules && task.rules.optionReuse === 'forbidden') {
        taskResponseIds(index, task.taskId).forEach((id) => {
          if (id !== responseSlot.responseSlotId && values[id] === optionId) values[id] = '';
        });
      }
      values[responseSlot.responseSlotId] = optionId;
      return values;
    }

    if (action.type === 'toggle-choice') {
      if (task.interactionVariant !== 'choice_set') return values;
      const valid = optionIds(task);
      const optionId = String(action.optionId || '');
      if (!valid.has(optionId)) return values;
      const ids = taskResponseIds(index, task.taskId);
      const selected = ids.map((id) => values[id]).filter(Boolean);
      const existingIndex = selected.indexOf(optionId);
      if (existingIndex >= 0) selected.splice(existingIndex, 1);
      else if (selected.length < Number(task.rules && task.rules.maxSelections || ids.length)) selected.push(optionId);
      ids.forEach((id, index) => { values[id] = selected[index] || ''; });
      return values;
    }

    if (action.type === 'clear') {
      values[responseSlot.responseSlotId] = '';
      return values;
    }
    return values;
  }

  function acceptedValues(scoreSlot) {
    return (scoreSlot.accepted || []).map((entry) => String(entry.value));
  }

  function atomicTextMembers(scoreSlot, rules) {
    const groups = new Map();
    (scoreSlot.accepted || []).forEach((entry, index) => {
      const memberId = String(entry.setMemberId || `member-${index + 1}`);
      const values = groups.get(memberId) || [];
      const normalized = normalizeText(entry.value, rules);
      if (normalized && !values.includes(normalized)) values.push(normalized);
      groups.set(memberId, values);
    });
    return [...groups.values()];
  }

  function isAtomicUnorderedTextSetCorrect(rawResponses, memberGroups, rules) {
    const supplied = rawResponses.map((value) => normalizeText(value, rules));
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

  function scoreOne(index, values, scoreSlot) {
    const task = index.tasks.get(scoreSlot.taskId);
    const rawResponses = (scoreSlot.responseSlotIds || []).map((id) => String(values[id] || ''));
    const responses = rawResponses.filter(Boolean);
    const accepted = acceptedValues(scoreSlot);
    let correct = false;
    let answered = responses.length > 0;
    if (scoreSlot.evaluation === 'unordered-membership') {
      correct = accepted.some((value) => responses.includes(value));
    } else if (scoreSlot.evaluation === 'exact-option') {
      correct = accepted.includes(responses[0] || '');
    } else if (scoreSlot.evaluation === 'normalized-text') {
      const rules = scoreSlot.normalization || task && task.rules && task.rules.normalization || {};
      const supplied = normalizeText(responses[0] || '', rules);
      correct = Boolean(supplied) && accepted.some((value) => normalizeText(value, rules) === supplied);
    } else if (scoreSlot.evaluation === 'atomic-unordered-text-set') {
      const rules = scoreSlot.normalization || task && task.rules && task.rules.normalization || {};
      correct = isAtomicUnorderedTextSetCorrect(rawResponses, atomicTextMembers(scoreSlot, rules), rules);
    }
    return Object.freeze({
      scoreSlotId: scoreSlot.scoreSlotId,
      taskId: scoreSlot.taskId,
      responseSlotIds: [...scoreSlot.responseSlotIds],
      status: !answered ? 'unanswered' : correct ? 'correct' : 'incorrect',
      earnedMarks: correct ? Number(scoreSlot.marks || 0) : 0,
      availableMarks: Number(scoreSlot.marks || 0),
      accepted,
      supplied: scoreSlot.evaluation === 'atomic-unordered-text-set' ? rawResponses : responses,
    });
  }

  function scoreAll(index, currentValues) {
    const values = createResponseState(index, currentValues);
    const slots = [...index.scoreSlots.values()].map((slot) => scoreOne(index, values, slot));
    const earnedMarks = slots.reduce((sum, slot) => sum + slot.earnedMarks, 0);
    return Object.freeze({
      slots: Object.freeze(slots),
      byId: new Map(slots.map((slot) => [slot.scoreSlotId, slot])),
      earnedMarks,
      availableMarks: index.maxMarks,
      correct: slots.filter((slot) => slot.status === 'correct').length,
      incorrect: slots.filter((slot) => slot.status === 'incorrect').length,
      unanswered: slots.filter((slot) => slot.status === 'unanswered').length,
    });
  }

  global.IELTSV2Core = Object.freeze({
    clone,
    normalizeText,
    indexPackage,
    createResponseState,
    reduceResponses,
    scoreAll,
  });
})(window);

    