/* Listening authoring boundary. It compiles self-owned audio and structured tasks
 * into the same proven question, scoring, and review runtime used by reading. */
(function (root) {
  'use strict';
  const fail = (path, message) => { throw new Error(`${path}: ${message}`); };
  const asText = (value, path) => typeof value === 'string' && value.trim() ? value : fail(path, '需要非空字符串');
  const asArray = (value, path) => Array.isArray(value) ? value : fail(path, '需要数组');
  const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm']);
  const MAX_AUDIO_BASE64_BYTES = 84 * 1024 * 1024;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeAudio(value) {
    if (!value || typeof value !== 'object') fail('audio', '缺少音频');
    if (value.encoding !== 'base64') fail('audio.encoding', '单文件练习需要 base64');
    if (!AUDIO_TYPES.has(value.mediaType)) fail('audio.mediaType', '仅支持 MP3、M4A、WAV、OGG 或 WebM 音频');
    asText(value.data, 'audio.data');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value.data) || value.data.length % 4) fail('audio.data', '需要有效的 base64 音频内容');
    if (value.data.length > MAX_AUDIO_BASE64_BYTES) fail('audio.data', '单文件音频最多 64 MiB');
    return {
      mediaType: value.mediaType,
      encoding: 'base64',
      data: value.data,
      filename: typeof value.filename === 'string' ? value.filename : 'listening-audio',
    };
  }

  function makeReadingSource(source) {
    const parts = asArray(source.parts, 'parts');
    if (!parts.length || parts.length > 4) fail('parts', '每份听力练习需要 1–4 个 Part');
    return {
      schemaVersion: 'reading-set.v1',
      title: source.title,
      parts: parts.map((part, index) => {
        if (!part || typeof part !== 'object') fail(`parts[${index}]`, '需要对象');
        asText(part.partId, `parts[${index}].partId`);
        const transcript = part.transcript;
        let blocks;
        let title = `Listening Part ${index + 1}`;
        if (transcript !== undefined && transcript !== null) {
          if (!transcript || typeof transcript !== 'object') fail(`parts[${index}].transcript`, '需要对象或省略');
          title = typeof transcript.title === 'string' && transcript.title.trim() ? transcript.title : title;
          blocks = asArray(transcript.blocks, `parts[${index}].transcript.blocks`).map((block, blockIndex) => ({
            blockId: asText(block?.blockId, `parts[${index}].transcript.blocks[${blockIndex}].blockId`),
            type: block.type || 'paragraph',
            label: block.label,
            text: asText(block?.text, `parts[${index}].transcript.blocks[${blockIndex}].text`),
          }));
          if (!blocks.length) fail(`parts[${index}].transcript.blocks`, '至少需要一个段落');
        } else {
          blocks = [{ blockId: `listen-${part.partId}-notice`, type: 'paragraph', text: 'Listen to the audio and answer the questions.' }];
        }
        return {
          ...part,
          instruction: typeof part.instruction === 'string' && part.instruction.trim() ? part.instruction : 'Listen to the recording and answer the questions.',
          passage: { passageId: `listening-${part.partId}`, title, blocks },
        };
      }),
      responseSlots: source.responseSlots,
      scoreSlots: source.scoreSlots,
      reviewEntries: source.reviewEntries,
      translations: source.translations || {},
      assets: source.assets || [],
      timerPolicy: source.timerPolicy,
    };
  }

  function compile(input) {
    const source = clone(input);
    if (source?.schemaVersion !== 'listening-set.v1') fail('schemaVersion', '需要 listening-set.v1');
    asText(source.title, 'title');
    const audio = normalizeAudio(source.audio);
    const pkg = root.ReadingContent.compile(makeReadingSource(source));
    const digest = pkg.manifest.contentVersion;
    pkg.manifest = { ...pkg.manifest, packageId: `listening.own.${digest.slice(0, 24)}`, title: source.title };
    pkg.candidate = { ...pkg.candidate, mode: 'listening' };
    pkg.manifest.extensions.homeworkSnapshot.mode = 'listening';
    pkg.listeningContent = {
      audio,
      hasTranscript: source.parts.some(part => part.transcript != null),
    };
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

  root.ListeningContent = Object.freeze({ compile, render, supportedTypes: root.ReadingContent.supportedTypes });
})(typeof window === 'undefined' ? globalThis : window);
