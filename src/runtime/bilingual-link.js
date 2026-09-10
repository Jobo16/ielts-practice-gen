
(function zyzBilingualSentenceLinkDemo() {
  'use strict';

  const sidecar = window.__IELTS_V2_PACKAGE__?.readingContent?.bilingual || __ZYZ_JSON__("data/bilingual-link/const-sidecar.json");
  const LINK_CLASS = 'bilingual-link-fragment';
  const PREVIEW_CLASS = 'is-bilingual-preview';
  const PINNED_CLASS = 'is-bilingual-pinned';
  const BLOCKED_INTERACTION_SELECTOR = [
    '.annotation-highlight',
    '.annotation-note-anchor',
    '[data-note-id]',
    '.t36-evidence-highlight',
    '[data-t36-evidence-range]',
    '[data-t36-evidence-marker]',
    'button',
    'input',
    'textarea',
    'select',
    'option',
    'a',
  ].join(',');

  const passages = new Map();
  const blocks = new Map();
  for (const passage of sidecar.passages || []) {
    passages.set(passage.passageId, passage);
    for (const block of passage.blocks || []) {
      blocks.set(block.blockId, { ...block, passageId: passage.passageId });
    }
  }

  let previewPairId = '';
  let pinnedPairId = '';
  let keyboardPairId = '';
  let scheduled = false;
  let decorating = false;
  let gesture = null;
  let suppressNextClick = false;
  let suppressTimer = 0;
  let observer = null;

  function passageRoot() {
    return document.getElementById('passage-content');
  }

  function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/gu, ' ').trim();
  }

  function textNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.nodeValue && node.nodeValue.length
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function normalizedDomMap(root) {
    const positions = [];
    let text = '';
    let pendingSpace = null;
    for (const node of textNodes(root)) {
      const value = node.nodeValue;
      for (let offset = 0; offset < value.length; offset += 1) {
        const character = value[offset];
        if (/\s/u.test(character)) {
          if (text && !pendingSpace) pendingSpace = { node, start: offset, end: offset + 1 };
          continue;
        }
        if (pendingSpace) {
          text += ' ';
          positions.push(pendingSpace);
          pendingSpace = null;
        }
        text += character;
        positions.push({ node, start: offset, end: offset + 1 });
      }
    }
    return { text, positions };
  }

  function rangesValid(map, pairs, side) {
    if (!pairs.length || map.positions.length !== map.text.length) return false;
    for (const pair of pairs) {
      const range = pair[side];
      if (!range || !Number.isInteger(range.normalizedStartOffset) ||
          !Number.isInteger(range.normalizedEndOffset) ||
          range.normalizedStartOffset < 0 ||
          range.normalizedEndOffset <= range.normalizedStartOffset ||
          range.normalizedEndOffset > map.text.length ||
          map.text.slice(range.normalizedStartOffset, range.normalizedEndOffset) !== normalizeWhitespace(range.text)) {
        return false;
      }
    }
    return true;
  }

  function wrapNormalizedRange(map, start, end, pairId, side) {
    const perNode = new Map();
    for (let index = start; index < end; index += 1) {
      const position = map.positions[index];
      if (!position || !position.node?.parentNode) return false;
      const ranges = perNode.get(position.node) || [];
      const previous = ranges[ranges.length - 1];
      if (previous && previous.end === position.start) previous.end = position.end;
      else ranges.push({ start: position.start, end: position.end });
      perNode.set(position.node, ranges);
    }
    for (const [node, ranges] of perNode) {
      for (const range of [...ranges].sort((left, right) => right.start - left.start)) {
        if (!node.parentNode || range.end > node.nodeValue.length) return false;
        let selected = node;
        if (range.end < selected.nodeValue.length) selected.splitText(range.end);
        if (range.start > 0) selected = selected.splitText(range.start);
        const span = document.createElement('span');
        span.className = LINK_CLASS;
        span.dataset.bilingualPairId = pairId;
        span.dataset.bilingualSide = side;
        selected.parentNode.insertBefore(span, selected);
        span.appendChild(selected);
      }
    }
    return true;
  }

  function sourceTarget(sourceElement) {
    return sourceElement.querySelector('.passage-paragraph-text') || sourceElement;
  }

  function translationFor(root, unitId) {
    return [...root.querySelectorAll('[data-review-translation-for]')]
      .find((element) => element.dataset.reviewTranslationFor === unitId) || null;
  }

  function decorateUnit(root, sourceElement, unit) {
    const unitId = unit.unitId;
    const translationElement = translationFor(root, unitId);
    if (!translationElement) return false;
    if (sourceElement.dataset.bilingualLinkStatus === 'wrap-failed' ||
        translationElement.dataset.bilingualLinkStatus === 'wrap-failed') return false;
    if (sourceElement.dataset.bilingualLinkedVersion === sidecar.demoId &&
        translationElement.dataset.bilingualLinkedVersion === sidecar.demoId) return true;

    const source = sourceTarget(sourceElement);
    const sourceMap = normalizedDomMap(source);
    const translationMap = normalizedDomMap(translationElement);
    if (sourceMap.text !== unit.sourceNormalizedText ||
        translationMap.text !== unit.translationNormalizedText ||
        !rangesValid(sourceMap, unit.pairs, 'source') ||
        !rangesValid(translationMap, unit.pairs, 'translation')) {
      sourceElement.dataset.bilingualLinkStatus = 'binding-mismatch';
      translationElement.dataset.bilingualLinkStatus = 'binding-mismatch';
      return false;
    }

    let wrapped = true;
    for (const pair of [...unit.pairs].reverse()) {
      if (!wrapNormalizedRange(
        sourceMap,
        pair.source.normalizedStartOffset,
        pair.source.normalizedEndOffset,
        pair.pairId,
        'source',
      )) {
        wrapped = false;
        break;
      }
      if (!wrapNormalizedRange(
        translationMap,
        pair.translation.normalizedStartOffset,
        pair.translation.normalizedEndOffset,
        pair.pairId,
        'translation',
      )) {
        wrapped = false;
        break;
      }
    }
    if (!wrapped) {
      for (const fragment of [...source.querySelectorAll(`.${LINK_CLASS}`), ...translationElement.querySelectorAll(`.${LINK_CLASS}`)]) {
        fragment.replaceWith(...fragment.childNodes);
      }
      sourceElement.dataset.bilingualLinkStatus = 'wrap-failed';
      translationElement.dataset.bilingualLinkStatus = 'wrap-failed';
      return false;
    }
    sourceElement.dataset.bilingualLinkedVersion = sidecar.demoId;
    translationElement.dataset.bilingualLinkedVersion = sidecar.demoId;
    sourceElement.dataset.bilingualLinkStatus = 'linked';
    translationElement.dataset.bilingualLinkStatus = 'linked';
    return true;
  }

  function fragments(pairId) {
    if (!pairId) return [];
    return [...document.querySelectorAll('[data-bilingual-pair-id]')]
      .filter((element) => element.dataset.bilingualPairId === pairId);
  }

  function pairIdsInOrder(root) {
    const result = [];
    const seen = new Set();
    for (const element of root.querySelectorAll('[data-bilingual-pair-id][data-bilingual-side="source"]')) {
      const pairId = element.dataset.bilingualPairId || '';
      if (pairId && !seen.has(pairId)) {
        seen.add(pairId);
        result.push(pairId);
      }
    }
    return result;
  }

  function intersectsT36Priority(element) {
    if (typeof CSS === 'undefined' || !CSS.highlights) return false;
    for (const name of [
      'zyz-t36-evidence-cue',
      'zyz-t36-evidence-overview',
      'zyz-t36-evidence-overview-student-overlap',
    ]) {
      const highlight = CSS.highlights.get(name);
      if (!highlight || typeof highlight[Symbol.iterator] !== 'function') continue;
      for (const range of highlight) {
        try {
          if (range.intersectsNode(element)) return true;
        } catch (_error) {
          return true;
        }
      }
    }
    return false;
  }

  function renderActiveState() {
    const root = passageRoot();
    if (!root) return;
    const visiblePinned = pinnedPairId && (!previewPairId || previewPairId === pinnedPairId)
      ? pinnedPairId
      : '';
    for (const element of root.querySelectorAll('[data-bilingual-pair-id]')) {
      const pairId = element.dataset.bilingualPairId || '';
      const prioritySuppressed = intersectsT36Priority(element);
      element.classList.toggle(PREVIEW_CLASS, Boolean(!prioritySuppressed && previewPairId && pairId === previewPairId));
      element.classList.toggle(PINNED_CLASS, Boolean(!prioritySuppressed && visiblePinned && pairId === visiblePinned));
    }
  }

  function setPreview(pairId) {
    previewPairId = pairId || '';
    renderActiveState();
  }

  function setPinned(pairId) {
    pinnedPairId = pairId || '';
    renderActiveState();
  }

  function announce(message) {
    let node = document.getElementById('zyz-bilingual-link-announcer');
    if (!node) {
      node = document.createElement('div');
      node.id = 'zyz-bilingual-link-announcer';
      node.className = 'sr-only';
      node.dataset.annotationExclude = 'true';
      node.setAttribute('aria-live', 'polite');
      document.body.appendChild(node);
    }
    node.textContent = '';
    window.setTimeout(() => { node.textContent = message; }, 0);
  }

  function decorate() {
    const root = passageRoot();
    if (!root || decorating) return;
    decorating = true;
    let linkedUnits = 0;
    let mismatchUnits = 0;
    let activePassageId = '';
    try {
      for (const sourceElement of root.querySelectorAll('[data-review-translation-block-id]')) {
        const block = blocks.get(sourceElement.dataset.reviewTranslationBlockId || '');
        if (!block) continue;
        activePassageId = activePassageId || block.passageId;
        if (decorateUnit(root, sourceElement, block)) linkedUnits += 1;
        else if (['binding-mismatch', 'wrap-failed'].includes(sourceElement.dataset.bilingualLinkStatus)) mismatchUnits += 1;
      }
      const activePassage = passages.get(activePassageId);
      if (activePassage) {
        for (const unit of activePassage.headerUnits || []) {
          const sourceElement = [...root.querySelectorAll('[data-review-translation-source-unit]')]
            .find((element) => element.dataset.reviewTranslationSourceUnit === unit.unitId) || null;
          if (!sourceElement) continue;
          if (decorateUnit(root, sourceElement, unit)) linkedUnits += 1;
          else if (['binding-mismatch', 'wrap-failed'].includes(sourceElement.dataset.bilingualLinkStatus)) mismatchUnits += 1;
        }
      }
      if (linkedUnits > 0) {
        root.dataset.bilingualKeyboard = 'true';
        if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '0');
        root.setAttribute('aria-label', '原文译文联动阅读区。方向键切换句组，回车固定，Escape 取消。');
        root.dataset.bilingualLinkStatus = mismatchUnits ? 'partial' : 'active';
      } else {
        delete root.dataset.bilingualKeyboard;
        delete root.dataset.bilingualLinkStatus;
        if (root.getAttribute('tabindex') === '0') root.removeAttribute('tabindex');
        root.removeAttribute('aria-label');
        previewPairId = '';
        pinnedPairId = '';
        keyboardPairId = '';
      }
      if (pinnedPairId && !fragments(pinnedPairId).length) pinnedPairId = '';
      if (previewPairId && !fragments(previewPairId).length) previewPairId = '';
      if (keyboardPairId && !fragments(keyboardPairId).length) keyboardPairId = '';
      renderActiveState();
      window.__ZYZ_BILINGUAL_LINK_QA__ = Object.freeze({
        schemaVersion: 'zyz-reading-bilingual-sentence-link-runtime-qa.v1',
        status: linkedUnits ? (mismatchUnits ? 'partial' : 'active') : 'inactive',
        demoId: sidecar.demoId,
        linkedUnits,
        mismatchUnits,
        persistentStateWrites: false,
        automaticScrollingOnPointerInteraction: false,
      });
    } finally {
      decorating = false;
    }
  }

  function scheduleDecorate() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      decorate();
    });
  }

  function linkedFragment(target) {
    return target instanceof Element ? target.closest('[data-bilingual-pair-id]') : null;
  }

  function hasTextSelection() {
    const selection = window.getSelection?.();
    return Boolean(selection && !selection.isCollapsed && String(selection).trim());
  }

  function interactionBlocked(target) {
    return target instanceof Element && Boolean(target.closest(BLOCKED_INTERACTION_SELECTOR));
  }

  document.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const fragment = linkedFragment(event.target);
    if (!fragment) return;
    const related = linkedFragment(event.relatedTarget);
    if (related?.dataset.bilingualPairId === fragment.dataset.bilingualPairId) return;
    setPreview(fragment.dataset.bilingualPairId || '');
  });

  document.addEventListener('pointerout', (event) => {
    if (event.pointerType === 'touch') return;
    const fragment = linkedFragment(event.target);
    if (!fragment) return;
    const related = linkedFragment(event.relatedTarget);
    if (related?.dataset.bilingualPairId === fragment.dataset.bilingualPairId) return;
    if (previewPairId === fragment.dataset.bilingualPairId) setPreview('');
  });

  document.addEventListener('pointerdown', (event) => {
    const fragment = linkedFragment(event.target);
    if (!fragment || interactionBlocked(event.target)) {
      gesture = null;
      return;
    }
    gesture = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startedAt: performance.now(),
      moved: false,
    };
  });

  document.addEventListener('pointermove', (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8) gesture.moved = true;
  });

  document.addEventListener('pointerup', (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const held = performance.now() - gesture.startedAt > 560;
    if (gesture.moved || held) {
      suppressNextClick = true;
      window.clearTimeout(suppressTimer);
      suppressTimer = window.setTimeout(() => { suppressNextClick = false; }, 800);
    }
    gesture = null;
  });

  document.addEventListener('pointercancel', (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture = null;
    suppressNextClick = true;
    window.clearTimeout(suppressTimer);
    suppressTimer = window.setTimeout(() => { suppressNextClick = false; }, 800);
  });

  document.addEventListener('click', (event) => {
    const fragment = linkedFragment(event.target);
    if (fragment && !interactionBlocked(event.target)) {
      if (suppressNextClick || hasTextSelection()) {
        suppressNextClick = false;
        return;
      }
      const pairId = fragment.dataset.bilingualPairId || '';
      keyboardPairId = pairId;
      setPreview('');
      setPinned(pinnedPairId === pairId ? '' : pairId);
      announce(pinnedPairId ? '已固定对应的原文与译文。' : '已取消原文译文联动固定。');
      return;
    }
    if (!interactionBlocked(event.target) && !hasTextSelection() && pinnedPairId) {
      setPinned('');
      announce('已取消原文译文联动固定。');
    }
  });

  document.addEventListener('keydown', (event) => {
    const root = passageRoot();
    if (!root || event.target !== root || root.dataset.bilingualKeyboard !== 'true') return;
    const pairIds = pairIdsInOrder(root);
    if (!pairIds.length) return;
    let index = pairIds.indexOf(keyboardPairId);
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') index = Math.min(pairIds.length - 1, index + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') index = index < 0 ? 0 : Math.max(0, index - 1);
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = pairIds.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      keyboardPairId = keyboardPairId || pairIds[0];
      setPreview('');
      setPinned(pinnedPairId === keyboardPairId ? '' : keyboardPairId);
      announce(pinnedPairId ? '已固定对应的原文与译文。' : '已取消原文译文联动固定。');
      return;
    } else if (event.key === 'Escape') {
      event.preventDefault();
      keyboardPairId = '';
      setPreview('');
      setPinned('');
      announce('已取消原文译文联动。');
      return;
    } else return;
    event.preventDefault();
    keyboardPairId = pairIds[index];
    setPreview(keyboardPairId);
    fragments(keyboardPairId).find((element) => element.dataset.bilingualSide === 'source')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    announce(`已定位第 ${index + 1} 组原文与译文。`);
  });

  document.addEventListener('focusout', (event) => {
    const root = passageRoot();
    if (root && event.target === root) setPreview('');
  });

  function start() {
    observer = new MutationObserver(scheduleDecorate);
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleDecorate();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
