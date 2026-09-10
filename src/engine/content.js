/* Public authoring boundary. No monthly catalog or original question bank required. */
(function (root) {
  'use strict';
  const core = root.IELTSTeacherComposerCore;
  const fail = (path, message) => { throw new Error(`${path}: ${message}`); };
  const array = (value, path) => Array.isArray(value) ? value : fail(path, '需要数组');
  const text = (value, path) => typeof value === 'string' && value.trim() ? value : fail(path, '需要非空字符串');
  const unique = (items, key, path) => {
    const map = new Map();
    items.forEach((item, i) => {
      if (!item || typeof item !== 'object') fail(`${path}[${i}]`, '需要对象');
      const id = text(item[key], `${path}[${i}].${key}`);
      if (map.has(id)) fail(path, `重复 ${key}: ${id}`);
      map.set(id, item);
    });
    return map;
  };
  const hash = value => core.sha256Hex(typeof value === 'string' ? value : core.canonicalJson(value));
  const normalize = value => value.replace(/\s+/gu, ' ').trim();

  function compile(input) {
    // Clone at the boundary: callers and file inputs remain unchanged.
    const source = JSON.parse(JSON.stringify(input));
    if (source?.schemaVersion !== 'reading-set.v1') fail('schemaVersion', '需要 reading-set.v1');
    text(source.title, 'title');
    const parts = array(source.parts, 'parts');
    if (!parts.length || parts.length > 3) fail('parts', '每份练习需要 1–3 篇文章');
    unique(parts, 'partId', 'parts');
    const passages = unique(parts.map(p => p.passage || {}), 'passageId', 'passages');
    const tasks = unique(parts.flatMap(p => array(p.tasks, 'part.tasks')), 'taskId', 'tasks');
    const responses = unique(array(source.responseSlots, 'responseSlots'), 'responseSlotId', 'responseSlots');
    const scores = unique(array(source.scoreSlots, 'scoreSlots'), 'scoreSlotId', 'scoreSlots');
    const reviews = unique(array(source.reviewEntries, 'reviewEntries'), 'scoreSlotId', 'reviewEntries');
    if (!responses.size || responses.size > 200) fail('responseSlots', '需要 1–200 个答题位置');
    const blocks = new Map();
    const taskParts = new Map();
    parts.forEach((part, i) => {
      part.ordinal = i + 1;
      part.label = `Part ${i + 1}`;
      text(part.passage.title, `parts[${i}].passage.title`);
      const ownBlocks = array(part.passage.blocks, `parts[${i}].passage.blocks`);
      if (!ownBlocks.length) fail('passage.blocks', '文章不能为空');
      unique(ownBlocks, 'blockId', 'passage.blocks');
      ownBlocks.forEach(block => {
        if (blocks.has(block.blockId)) fail('blocks', `跨文章重复 ID: ${block.blockId}`);
        text(block.text, `block.${block.blockId}.text`);
        blocks.set(block.blockId, { ...block, passageId: part.passage.passageId });
      });
      if (!part.tasks.length) fail(`parts[${i}].tasks`, '至少需要一个题型');
      part.tasks.forEach(t => taskParts.set(t.taskId, part));
    });
    const seen = new Set();
    let number = 0;
    tasks.forEach(task => {
      const path = `task.${task.taskId}`;
      const triple = [task.questionType, task.interactionVariant, task.layoutVariant].join('|');
      if (!core.RUNTIME_EXACT_TRIPLES.includes(triple)) fail(path, `不支持的题型组合 ${triple}`);
      array(task.instructions, `${path}.instructions`).forEach((v, i) => text(v, `${path}.instructions[${i}]`));
      if (!task.content || typeof task.content !== 'object') fail(path, '缺少 content');
      const requiredContent = { statement_list: 'items', option_list: task.interactionVariant === 'choice_set' ? 'options' : 'items',
        sentence_list: 'items', short_question_list: 'items', table: 'table', flow_chart: 'flowChart', diagram: 'diagram',
        passage_attached_targets: 'targets', matching_grid: 'items', sentence_ending_gaps: 'items' }[task.layoutVariant];
      if (requiredContent && (!task.content[requiredContent] || (Array.isArray(task.content[requiredContent]) && !task.content[requiredContent].length))) fail(path, `缺少 content.${requiredContent}`);
      if (['notes','prose'].includes(task.layoutVariant) && !(task.content.sections?.length || task.content.items?.length)) fail(path, '缺少 content.sections 或 content.items');
      const ids = array(task.responseSlotIds, `${path}.responseSlotIds`);
      if (!ids.length) fail(path, '题型没有答题位置');
      ids.forEach(id => {
        const response = responses.get(id);
        if (!response || response.taskId !== task.taskId || seen.has(id)) fail(path, `答题位置关联无效或重复: ${id}`);
        if (!['text', 'option'].includes(response.responseKind)) fail(`response.${id}`, 'responseKind 需要 text 或 option');
        seen.add(id);
        response.displayNumber = ++number;
      });
      task.heading = `Questions ${responses.get(ids[0]).displayNumber}–${number}`;
      const ownBlocks = new Set(taskParts.get(task.taskId).passage.blocks.map(b => b.blockId));
      function walk(value) {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value.responseSlotIds)) value.responseSlotIds.forEach(id => {
          if (!ids.includes(id)) fail(path, `content 引用了其他题型的答题位置: ${id}`);
        });
        if (value.responseSlotId && !ids.includes(value.responseSlotId)) fail(path, `引用了不存在的答题位置: ${value.responseSlotId}`);
        if (value.blockId && !ownBlocks.has(value.blockId)) fail(path, `content 引用了不存在的文章段落: ${value.blockId}`);
        Object.values(value).forEach(walk);
      }
      walk(task.content);
    });
    if (seen.size !== responses.size) fail('responseSlots', '存在未被题型引用的答题位置');
    const covered = new Set();
    scores.forEach(score => {
      const path = `score.${score.scoreSlotId}`;
      const task = tasks.get(score.taskId);
      if (!task) fail(path, 'taskId 不存在');
      if (!Number.isFinite(score.marks) || score.marks <= 0) fail(path, 'marks 必须为正数');
      if (!['exact-option', 'normalized-text', 'unordered-membership', 'atomic-unordered-text-set'].includes(score.evaluation)) fail(path, '不支持的评分方式');
      if (!array(score.responseSlotIds, path).length) fail(path, '没有评分位置');
      score.responseSlotIds.forEach(id => {
        if (!task.responseSlotIds.includes(id)) fail(path, `评分位置不属于题型: ${id}`);
        covered.add(id);
      });
      if (!array(score.accepted, `${path}.accepted`).length) fail(path, '缺少正确答案');
      const options = new Set([
        ...(task.content.options || []),
        ...(task.content.items || []).filter(item => (item.responseSlotIds || []).some(id => score.responseSlotIds.includes(id))).flatMap(item => item.options || []),
      ].map(option => option.optionId));
      score.accepted.forEach(answer => {
        text(answer.value, `${path}.accepted.value`);
        if (['exact-option', 'unordered-membership'].includes(score.evaluation) && !options.has(answer.value)) fail(path, `正确答案选项不存在: ${answer.value}`);
      });
      const review = reviews.get(score.scoreSlotId);
      if (!review) fail(path, '缺少解析');
      text(review.explanation, `${path}.explanation`);
      text(review.answerDisplay, `${path}.answerDisplay`);
      array(review.evidence || [], `${path}.evidence`).forEach(e => {
        const block = blocks.get(e.blockId);
        if (!block || block.passageId !== taskParts.get(score.taskId).passage.passageId) fail(path, '证据段落不属于当前文章');
        if (e.anchor !== false && e.quote && !block.text.includes(e.quote)) fail(path, '证据引文必须与原文完全一致');
        if (e.anchor !== false && e.quote && e.startOffset === undefined && block.text.indexOf(e.quote) !== block.text.lastIndexOf(e.quote)) fail(path, '引文在段落中重复，请提供 startOffset');
        if (e.startOffset !== undefined && (!Number.isInteger(e.startOffset) || e.startOffset < 0 || !e.quote || block.text.slice(e.startOffset, e.startOffset + e.quote.length) !== e.quote)) fail(path, 'startOffset 与证据引文不匹配');
      });
    });
    if (covered.size !== responses.size || reviews.size !== scores.size) fail('scoreSlots', '答题位置、评分和解析未完整对应');
    const timer = source.timerPolicy || { enabled: false, durationSeconds: 0, expiryAction: 'continue' };
    if (typeof timer.enabled !== 'boolean' || !Number.isInteger(timer.durationSeconds) ||
        (timer.enabled ? timer.durationSeconds < 60 || timer.durationSeconds > 10800 : timer.durationSeconds !== 0) ||
        !['continue', 'submit'].includes(timer.expiryAction)) fail('timerPolicy', '计时需为 60–10800 秒，关闭时为 0；结束动作为 continue 或 submit');
    const assets = array(source.assets || [], 'assets');
    unique(assets, 'assetId', 'assets');
    // The inherited diagram renderer supports embedded PNG; reject network resources.
    assets.forEach(asset => {
      if (asset.mediaType !== 'image/png' || asset.encoding !== 'base64' || !asset.data?.startsWith('iVBORw0KGgo') || asset.data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(asset.data)) fail('assets', '仅支持内嵌 PNG 图片');
    });
    const assetIds = new Set(assets.map(a => a.assetId));
    tasks.forEach(task => {
      if (task.content.diagram && !assetIds.has(task.content.diagram.assetId)) fail(`task.${task.taskId}`, '图示图片不存在');
    });
    const digest = hash(source);
    const pkg = {
      manifest: { schemaVersion: '2.0.0', packageId: `reading.own.${digest.slice(0, 24)}`, contentVersion: digest,
        title: source.title, language: 'en', extensions: { homeworkSnapshot: {
          title: source.title, mode: 'homework', reviewMode: 'full-review', snapshotHash: digest, timerPolicy: timer,
        } } },
      candidate: { assessmentId: `assessment.${digest}`, title: source.title, parts, responseSlots: [...responses.values()], assets },
      answerKey: { maxMarks: [...scores.values()].reduce((n, s) => n + s.marks, 0), scoreSlots: [...scores.values()] },
      review: { entries: [...reviews.values()] },
      readingContent: { translations: {}, evidence: { schemaVersion: 'reading-evidence.v1', entries: [], samplePassages: [] }, bilingual: { demoId: `reading.${digest}`, passages: [] } },
    };
    // Compile explicit translations and evidence into the runtime's existing overlay contracts.
    for (const [passageId, translations] of Object.entries(source.translations || {})) {
      const passage = passages.get(passageId);
      if (!passage) fail('translations', `文章不存在: ${passageId}`);
      const units = [];
      const linked = { passageId, headerUnits: [], blocks: [] };
      for (const [id, translation] of Object.entries(translations)) {
        text(translation, `translations.${passageId}.${id}`);
        const block = blocks.get(id);
        if (id !== 'title' && (!block || block.passageId !== passageId)) fail('translations', `段落不存在: ${id}`);
        const original = id === 'title' ? passage.title : block.text;
        const unitId = id === 'title' ? 'title' : `block:${id}`;
        units.push({ unitId, blockId: id === 'title' ? null : id, sourceText: original, translationZh: translation });
        const sourceText = normalize(original), targetText = normalize(translation);
        const unit = { unitId, blockId: id === 'title' ? null : id, sourceNormalizedText: sourceText, translationNormalizedText: targetText,
          pairs: [{ pairId: `own.${passageId}.${id}`, passagePairOrdinal: units.length,
            source: { normalizedStartOffset: 0, normalizedEndOffset: sourceText.length, text: sourceText },
            translation: { normalizedStartOffset: 0, normalizedEndOffset: targetText.length, text: targetText } }] };
        (id === 'title' ? linked.headerUnits : linked.blocks).push(unit);
      }
      pkg.readingContent.translations[passageId] = units;
      pkg.readingContent.bilingual.passages.push(linked);
    }
    reviews.forEach(review => {
      const score = scores.get(review.scoreSlotId), part = taskParts.get(score.taskId);
      const evidence = (review.evidence || []).map((e, index) => {
        const block = blocks.get(e.blockId), start = e.quote && e.anchor !== false ? (e.startOffset ?? block.text.indexOf(e.quote)) : -1;
        return { evidenceIndex: index, blockId: e.blockId, anchors: start < 0 ? [] : [{
          anchorId: `${score.scoreSlotId}.${index}`, blockId: e.blockId, startOffset: start, endOffset: start + e.quote.length,
          sourceTextSha256: hash(block.text), sourceText: e.quote, role: 'primary-evidence', relation: 'supports-answer',
        }] };
      });
      pkg.readingContent.evidence.entries.push({ passageId: part.passage.passageId, taskId: score.taskId,
        scoreSlotId: score.scoreSlotId, answerDisplay: review.answerDisplay, locatorKind: 'exact-evidence',
        questionNumbers: score.responseSlotIds.map(id => responses.get(id).displayNumber), evidence });
    });
    root.IELTSV2Core.indexPackage(pkg);
    return pkg;
  }

  function render(pkg, template) {
    const sentinel = '__IELTS_PACKAGE_JSON__';
    if (template.split(sentinel).length !== 2) throw new Error('运行时模板插入点无效');
    const json = JSON.stringify(pkg).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    const title = pkg.candidate.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return template.replace(sentinel, () => json).replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`);
  }
  root.ReadingContent = Object.freeze({ compile, render, supportedTypes: core.RUNTIME_EXACT_TRIPLES });
})(typeof window === 'undefined' ? globalThis : window);
