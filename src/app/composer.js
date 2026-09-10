(function attachTeacherComposerCore(root) {
  'use strict';

  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const API_VERSION = 'ielts-teacher-composer-browser-core.v0.3';
  const HOMEWORK_REQUEST_V0 = 'ielts-reading-homework-request.v0';
  const HOMEWORK_REQUEST_V1 = 'ielts-reading-homework-request.v1';
  const COMPOSITION_MODES = Object.freeze(['full-passage', 'task-drill']);
  const REVIEW_MODES = Object.freeze(['full-review', 'score-only']);
  const TIMER_EXPIRY_ACTIONS = Object.freeze(['continue', 'submit']);
  const PASSAGE_SORT_MODES = Object.freeze([
    'title-en',
    'title-zh',
    'passage-position',
    'catalog-id',
    'import-order',
  ]);
  const PASSAGE_SORT_MODE_SET = new Set(PASSAGE_SORT_MODES);
  const PASSAGE_DIFFICULTY_BASELINES = Object.freeze({ 1: 2.5, 2: 3.5, 3: 4.5 });
  const ENGLISH_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  const CHINESE_COLLATOR = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  const DISTRIBUTION_POLICY_SCHEMA_VERSION = 'ielts-reading-distribution-policy.v1';
  const PUBLISHER_AUTHORIZATION_SCHEMA = 'zyz-reading-walks-publisher-authorization.v1';
  const PUBLISHER_SIGNATURE_SCHEMA = 'zyz-reading-walks-publisher-signature.v1';
  const PUBLISHER_NOTICE = '© 2026 ZYZ READING WALKS';
  const ALLOWED_PRESENTATION_VARIANTS = new Set([
    'official-inline-summary-bank',
  ]);
  const RUNTIME_EXACT_TRIPLES = Object.freeze([
    'true_false_not_given|single_choice|statement_list',
    'yes_no_not_given|single_choice|statement_list',
    'multiple_choice|single_choice|option_list',
    'multiple_choice|choice_set|option_list',
    'note_completion|text_entry|notes',
    'summary_completion|text_entry|prose',
    'sentence_completion|text_entry|sentence_list',
    'short_answer|text_entry|short_question_list',
    'table_completion|text_entry|table',
    'flowchart_completion|text_entry|flow_chart',
    'diagram_labelling|text_entry|diagram',
    'summary_completion|option_mapping|prose',
    'matching_headings|option_mapping|passage_attached_targets',
    'matching_information|option_mapping|matching_grid',
    'matching_features|option_mapping|matching_grid',
    'classification|option_mapping|matching_grid',
    'matching_sentence_endings|option_mapping|sentence_ending_gaps',
  ]);
  const RUNTIME_EXACT_TRIPLE_SET = new Set(RUNTIME_EXACT_TRIPLES);
  const SHA256_CONSTANTS = Object.freeze([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const PRIVATE_EXACT_KEYS = new Set([
    'privateCatalog',
    'authoringProvenance',
    'sourceArtifact',
  ]);
  const PRIVATE_NORMALIZED_KEYS = new Set([
    'privatekey',
    'privatekeys',
    'privatesigningkey',
    'signingkey',
    'signingkeys',
    'secret',
    'secretkey',
    'clientsecret',
    'apikey',
    'accesstoken',
    'seed',
    'passphrase',
    'password',
    'privatedistributionmetadata',
    'privatedistributionpolicy',
  ]);

  const DEFAULT_DISTRIBUTION_POLICY = deepFreeze({
    schemaVersion: DISTRIBUTION_POLICY_SCHEMA_VERSION,
    mode: 'internal',
    branding: {
      publisherDisplayName: null,
      attributionText: null,
    },
    watermark: {
      enabled: false,
      visibility: 'disabled',
      textTemplate: null,
      surfaces: [],
      personalization: 'none',
    },
    integrity: {
      mode: 'artifact-receipt',
      algorithm: 'none',
    },
    hardening: {
      profile: 'development',
      minify: false,
      sourceMaps: false,
      obfuscation: 'none',
      stripPrivateMetadata: false,
      externalNetwork: 'deny',
    },
    answerDelivery: 'embedded-after-submit',
  });

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function cleanSortText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function compareOptionalText(leftValue, rightValue, collator) {
    const left = cleanSortText(leftValue);
    const right = cleanSortText(rightValue);
    if (left && !right) return -1;
    if (!left && right) return 1;
    if (!left && !right) return 0;
    return collator.compare(left, right);
  }

  function sortPassageMetadata(passages, requestedMode = 'title-en') {
    if (!Array.isArray(passages)) throw new Error('sortPassageMetadata requires an array.');
    const mode = PASSAGE_SORT_MODE_SET.has(requestedMode) ? requestedMode : 'title-en';
    const decorated = passages.map((passage, importIndex) => ({ passage, importIndex }));
    decorated.sort((leftRecord, rightRecord) => {
      const left = leftRecord.passage || {};
      const right = rightRecord.passage || {};
      let compared = 0;
      if (mode === 'title-en') {
        compared = ENGLISH_COLLATOR.compare(cleanSortText(left.title), cleanSortText(right.title));
      } else if (mode === 'title-zh') {
        compared = compareOptionalText(left.titleZh, right.titleZh, CHINESE_COLLATOR);
      } else if (mode === 'passage-position') {
        compared = Number(left.passagePosition || Number.POSITIVE_INFINITY)
          - Number(right.passagePosition || Number.POSITIVE_INFINITY);
      } else if (mode === 'catalog-id') {
        compared = compareOptionalText(left.catalogPassageId, right.catalogPassageId, ENGLISH_COLLATOR);
      }
      return compared || leftRecord.importIndex - rightRecord.importIndex;
    });
    return decorated.map(({ passage }) => passage);
  }

  function relativeDifficultyTier(passage, baselines = PASSAGE_DIFFICULTY_BASELINES) {
    const rawValue = passage?.difficulty_current;
    if (rawValue === null || rawValue === undefined || rawValue === '') return '待补';
    const value = Number(rawValue);
    const baseline = Number(baselines?.[Number(passage?.passagePosition)]);
    if (!Number.isFinite(value) || !Number.isFinite(baseline)) return '待补';
    const difference = value - baseline;
    if (difference <= -0.5) return '偏易';
    if (difference >= 0.5) return '偏难';
    return '标准';
  }

  function normalizeFacetValues(values) {
    if (!Array.isArray(values)) return [];
    return values
      .filter((value) => value !== null && value !== undefined && value !== '')
      .map((value) => String(value));
  }

  function passageMatchesFacetFilters(passage, filters = {}, baselines = PASSAGE_DIFFICULTY_BASELINES) {
    const passagePositions = normalizeFacetValues(filters?.passagePositions);
    const difficulties = normalizeFacetValues(filters?.difficulties);
    const frequencies = normalizeFacetValues(filters?.frequencies);
    const passagePosition = String(passage?.passagePosition ?? '');
    const difficulty = relativeDifficultyTier(passage, baselines);
    const frequency = passage?.monthlyFrequency?.frequency_tier || '未标注';
    return (!passagePositions.length || passagePositions.includes(passagePosition))
      && (!difficulties.length || difficulties.includes(difficulty))
      && (!frequencies.length || frequencies.includes(frequency));
  }

  function paginationItems(pageCount, requestedPage) {
    const total = Math.max(1, Math.floor(Number(pageCount) || 1));
    const current = Math.min(Math.max(Math.floor(Number(requestedPage) || 1), 1), total);
    if (total <= 7) {
      return Array.from({ length: total }, (_, index) => ({
        type: 'page',
        page: index + 1,
        current: index + 1 === current,
      }));
    }
    const pages = new Set([1, total, current - 1, current, current + 1]);
    if (current <= 4) {
      for (let page = 1; page <= Math.min(5, total); page += 1) pages.add(page);
    }
    if (current >= total - 3) {
      for (let page = Math.max(1, total - 4); page <= total; page += 1) pages.add(page);
    }
    const visiblePages = [...pages]
      .filter((page) => page >= 1 && page <= total)
      .sort((left, right) => left - right);
    const items = [];
    visiblePages.forEach((page, index) => {
      if (index > 0 && page - visiblePages[index - 1] > 1) items.push({ type: 'ellipsis' });
      items.push({ type: 'page', page, current: page === current });
    });
    return items;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function assertExactKeys(value, allowedKeys, label) {
    const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
    if (unknown.length) throw new Error(`${label} contains unsupported field(s): ${unknown.join(', ')}.`);
  }

  function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (isObject(value)) {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('Canonical JSON does not support undefined, functions, or symbols.');
    return encoded;
  }

  function utf8Bytes(value) {
    const text = String(value);
    const bytes = [];
    for (let index = 0; index < text.length; index += 1) {
      let codePoint = text.charCodeAt(index);
      if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
          index += 1;
        } else {
          codePoint = 0xfffd;
        }
      } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
        codePoint = 0xfffd;
      }
      if (codePoint < 0x80) {
        bytes.push(codePoint);
      } else if (codePoint < 0x800) {
        bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
      } else if (codePoint < 0x10000) {
        bytes.push(
          0xe0 | (codePoint >>> 12),
          0x80 | ((codePoint >>> 6) & 0x3f),
          0x80 | (codePoint & 0x3f),
        );
      } else {
        bytes.push(
          0xf0 | (codePoint >>> 18),
          0x80 | ((codePoint >>> 12) & 0x3f),
          0x80 | ((codePoint >>> 6) & 0x3f),
          0x80 | (codePoint & 0x3f),
        );
      }
    }
    return new Uint8Array(bytes);
  }

  function rotateRight(value, count) {
    return (value >>> count) | (value << (32 - count));
  }

  function sha256Bytes(inputBytes) {
    const bytes = inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes);
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const bitLength = bytes.length * 8;
    const bitLengthHigh = Math.floor(bitLength / 0x100000000);
    const bitLengthLow = bitLength >>> 0;
    const tail = paddedLength - 8;
    padded[tail] = (bitLengthHigh >>> 24) & 0xff;
    padded[tail + 1] = (bitLengthHigh >>> 16) & 0xff;
    padded[tail + 2] = (bitLengthHigh >>> 8) & 0xff;
    padded[tail + 3] = bitLengthHigh & 0xff;
    padded[tail + 4] = (bitLengthLow >>> 24) & 0xff;
    padded[tail + 5] = (bitLengthLow >>> 16) & 0xff;
    padded[tail + 6] = (bitLengthLow >>> 8) & 0xff;
    padded[tail + 7] = bitLengthLow & 0xff;

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;
    const words = new Uint32Array(64);

    for (let offset = 0; offset < padded.length; offset += 64) {
      for (let wordIndex = 0; wordIndex < 16; wordIndex += 1) {
        const cursor = offset + wordIndex * 4;
        words[wordIndex] = (
          (padded[cursor] << 24) |
          (padded[cursor + 1] << 16) |
          (padded[cursor + 2] << 8) |
          padded[cursor + 3]
        ) >>> 0;
      }
      for (let wordIndex = 16; wordIndex < 64; wordIndex += 1) {
        const previous15 = words[wordIndex - 15];
        const previous2 = words[wordIndex - 2];
        const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
        const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
        words[wordIndex] = (words[wordIndex - 16] + sigma0 + words[wordIndex - 7] + sigma1) >>> 0;
      }

      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      let f = h5;
      let g = h6;
      let h = h7;
      for (let round = 0; round < 64; round += 1) {
        const upper1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choose = (e & f) ^ (~e & g);
        const temporary1 = (h + upper1 + choose + SHA256_CONSTANTS[round] + words[round]) >>> 0;
        const upper0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temporary2 = (upper0 + majority) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temporary1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temporary1 + temporary2) >>> 0;
      }

      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + h) >>> 0;
    }

    return [h0, h1, h2, h3, h4, h5, h6, h7]
      .map((word) => word.toString(16).padStart(8, '0'))
      .join('');
  }

  function sha256Hex(value) {
    const source = typeof value === 'string' ? value : canonicalJson(value);
    return sha256Bytes(utf8Bytes(source));
  }

  function base64ToBytes(value) {
    if (typeof value !== 'string' || !value || value.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      throw new Error('PNG asset data must use canonical base64.');
    }
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    const output = new Uint8Array((value.length / 4) * 3 - padding);
    let outputIndex = 0;
    for (let index = 0; index < value.length; index += 4) {
      const a = BASE64_ALPHABET.indexOf(value[index]);
      const b = BASE64_ALPHABET.indexOf(value[index + 1]);
      const c = value[index + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[index + 2]);
      const d = value[index + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[index + 3]);
      const combined = (a << 18) | (b << 12) | (c << 6) | d;
      if (outputIndex < output.length) output[outputIndex++] = (combined >>> 16) & 0xff;
      if (outputIndex < output.length) output[outputIndex++] = (combined >>> 8) & 0xff;
      if (outputIndex < output.length) output[outputIndex++] = combined & 0xff;
    }
    if (bytesToBase64(output) !== value) throw new Error('PNG asset data has non-canonical base64 padding bits.');
    return output;
  }

  function bytesToBase64(bytes) {
    let output = '';
    for (let index = 0; index < bytes.length; index += 3) {
      const a = bytes[index];
      const hasB = index + 1 < bytes.length;
      const hasC = index + 2 < bytes.length;
      const b = hasB ? bytes[index + 1] : 0;
      const c = hasC ? bytes[index + 2] : 0;
      output += BASE64_ALPHABET[a >>> 2];
      output += BASE64_ALPHABET[((a & 3) << 4) | (b >>> 4)];
      output += hasB ? BASE64_ALPHABET[((b & 15) << 2) | (c >>> 6)] : '=';
      output += hasC ? BASE64_ALPHABET[c & 63] : '=';
    }
    return output;
  }

  function uint32BigEndian(bytes, offset) {
    return (
      bytes[offset] * 0x1000000 +
      (bytes[offset + 1] << 16) +
      (bytes[offset + 2] << 8) +
      bytes[offset + 3]
    ) >>> 0;
  }

  function validatePngAsset(asset) {
    if (!isObject(asset) || typeof asset.assetId !== 'string' || !asset.assetId.trim()) {
      throw new Error('Each asset requires a non-empty assetId.');
    }
    if (asset.mediaType !== 'image/png' || asset.encoding !== 'base64') {
      throw new Error(`Asset ${asset.assetId} must be an inline base64 image/png.`);
    }
    const bytes = base64ToBytes(asset.data);
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 33 || signature.some((byte, index) => bytes[index] !== byte) ||
        uint32BigEndian(bytes, 8) !== 13 ||
        String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR') {
      throw new Error(`Asset ${asset.assetId} is not an identifiable PNG with an IHDR header.`);
    }
    const width = uint32BigEndian(bytes, 16);
    const height = uint32BigEndian(bytes, 20);
    if (!Number.isInteger(asset.width) || !Number.isInteger(asset.height) ||
        asset.width !== width || asset.height !== height || width < 1 || height < 1) {
      throw new Error(`Asset ${asset.assetId} width/height does not match its PNG IHDR.`);
    }
    if (!/^[a-f0-9]{64}$/i.test(asset.sha256 || '') || asset.sha256.toLowerCase() !== sha256Bytes(bytes)) {
      throw new Error(`Asset ${asset.assetId} sha256 does not match its decoded PNG bytes.`);
    }
    if (typeof asset.alt !== 'string' || !asset.alt.trim() ||
        typeof asset.longDescription !== 'string' || !asset.longDescription.trim()) {
      throw new Error(`Asset ${asset.assetId} requires alt and longDescription text.`);
    }
    return { assetId: asset.assetId, sha256: asset.sha256.toLowerCase() };
  }

  function taskTriple(task) {
    return [task && task.questionType, task && task.interactionVariant, task && task.layoutVariant].join('|');
  }

  function questionHeading(numbers) {
    if (!numbers.length) throw new Error('A task cannot be assembled without response slots.');
    if (numbers.length === 1) return `Question ${numbers[0]}`;
    return `Questions ${numbers[0]}–${numbers[numbers.length - 1]}`;
  }

  function passageInstruction(numbers) {
    if (!numbers.length) throw new Error('A passage cannot be assembled without response slots.');
    if (numbers.length === 1) return `Read the passage and answer Question ${numbers[0]}.`;
    return `Read the passage and answer Questions ${numbers[0]}–${numbers[numbers.length - 1]}.`;
  }

  function normalizedPublisherAuthorization(value) {
    if (!isObject(value)) throw new Error('Publisher authorization is missing.');
    assertExactKeys(value, ['payload', 'signature'], 'publisherAuthorization');
    assertExactKeys(value.payload, ['schemaVersion', 'publisherId', 'publicNotice', 'product'], 'publisherAuthorization.payload');
    assertExactKeys(
      value.signature,
      ['schemaVersion', 'algorithm', 'canonicalization', 'payloadSha256', 'publicKeyFingerprintSha256', 'signatureBase64'],
      'publisherAuthorization.signature',
    );
    if (value.payload.schemaVersion !== PUBLISHER_AUTHORIZATION_SCHEMA ||
        value.payload.publisherId !== 'zyz-reading-walks' || value.payload.publicNotice !== PUBLISHER_NOTICE ||
        value.payload.product !== 'ielts-reading-student-runtime' ||
        value.signature.schemaVersion !== PUBLISHER_SIGNATURE_SCHEMA || value.signature.algorithm !== 'Ed25519' ||
        value.signature.canonicalization !== 'recursive-key-sort-json.v1' ||
        !/^[0-9a-f]{64}$/u.test(value.signature.payloadSha256 || '') ||
        !/^[0-9a-f]{64}$/u.test(value.signature.publicKeyFingerprintSha256 || '') ||
        typeof value.signature.signatureBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value.signature.signatureBase64)) {
      throw new Error('Publisher authorization is invalid.');
    }
    return clone(value);
  }

  function normalizedLicenseProvenance(value) {
    if (value === undefined || value === null) return null;
    if (!isObject(value) || value.schemaVersion !== 'zyz-reading-walks-origin.v2' ||
        value.issuerDisplayName !== 'ZYZ READING WALKS' ||
        typeof value.licenseId !== 'string' || !value.licenseId.trim() ||
        typeof value.fingerprintId !== 'string' || !/^[A-Z0-9-]{8,64}$/u.test(value.fingerprintId) ||
        typeof value.composerVersion !== 'string' || !value.composerVersion.trim() ||
        !/^[0-9a-f]{64}$/u.test(value.licenseManifestSha256 || '') ||
        !/^[0-9a-f]{64}$/u.test(value.issuerKeyFingerprintSha256 || '')) {
      throw new Error('Teacher library licenseProvenance is invalid.');
    }
    assertExactKeys(value, [
      'schemaVersion', 'issuerDisplayName', 'licenseId', 'licenseManifestSha256',
      'issuerKeyFingerprintSha256', 'fingerprintId', 'composerVersion', 'publisherAuthorization',
    ], 'licenseProvenance');
    return { ...clone(value), publisherAuthorization: normalizedPublisherAuthorization(value.publisherAuthorization) };
  }

  function createDistributionPolicy(watermarkText, licenseProvenance) {
    if (watermarkText !== undefined && watermarkText !== null && typeof watermarkText !== 'string') {
      throw new Error('watermarkText must be a string when provided.');
    }
    const text = typeof watermarkText === 'string' ? watermarkText.trim() : '';
    if (/\r|\n/.test(text)) throw new Error('watermarkText must be one line.');
    const provenance = normalizedLicenseProvenance(licenseProvenance);
    if (provenance) {
      const policy = clone(DEFAULT_DISTRIBUTION_POLICY);
      policy.branding = {
        publisherDisplayName: provenance.issuerDisplayName,
        attributionText: text || null,
      };
      policy.watermark = {
        enabled: true,
        visibility: 'after-submit',
        textTemplate: PUBLISHER_NOTICE,
        surfaces: ['review', 'print'],
        personalization: 'none',
      };
      return policy;
    }
    if (!text) return clone(DEFAULT_DISTRIBUTION_POLICY);
    const policy = clone(DEFAULT_DISTRIBUTION_POLICY);
    policy.watermark = {
      enabled: true,
      visibility: 'after-submit',
      textTemplate: text,
      surfaces: ['review', 'print'],
      personalization: 'none',
    };
    return policy;
  }

  function normalizeHomeworkRequest(request) {
    if (!isObject(request)) throw new Error('The teacher request must be an object.');
    if (typeof request.title !== 'string' || !request.title.trim()) throw new Error('A non-empty homework title is required.');
    if (request.schemaVersion !== undefined && request.schemaVersion !== HOMEWORK_REQUEST_V0 && request.schemaVersion !== HOMEWORK_REQUEST_V1) {
      throw new Error(`Unsupported request schemaVersion: ${request.schemaVersion}.`);
    }
    if (request.mode !== undefined && request.mode !== 'homework') {
      throw new Error(`Only mode=homework is supported; found ${request.mode}.`);
    }
    if (request.schemaVersion !== HOMEWORK_REQUEST_V1) {
      if (!Array.isArray(request.passageIds) || request.passageIds.length < 1 || request.passageIds.length > 3) {
        throw new Error('Teacher composition requires 1–3 passageIds.');
      }
      if (request.passageIds.some((passageId) => typeof passageId !== 'string' || !passageId.trim())) {
        throw new Error('Every passageId must be a non-empty string.');
      }
      if (new Set(request.passageIds).size !== request.passageIds.length) {
        throw new Error('A passage may be selected only once.');
      }
      return {
        schemaVersion: HOMEWORK_REQUEST_V0,
        legacy: true,
        mode: 'homework',
        title: request.title.trim(),
        compositionMode: 'full-passage',
        selections: request.passageIds.map((passageId) => ({ passageId, scope: 'full' })),
        reviewMode: 'full-review',
        timerPolicy: { enabled: false, durationSeconds: 0, expiryAction: 'continue' },
        watermarkText: request.watermarkText,
      };
    }

    assertExactKeys(
      request,
      ['schemaVersion', 'mode', 'title', 'compositionMode', 'selections', 'reviewMode', 'timerPolicy', 'watermarkText'],
      'request.v1',
    );
    if (request.mode !== 'homework') throw new Error('request.v1 requires mode=homework.');
    if (!COMPOSITION_MODES.includes(request.compositionMode)) {
      throw new Error('request.v1 compositionMode must be full-passage or task-drill.');
    }
    const reviewMode = request.reviewMode === undefined ? 'full-review' : request.reviewMode;
    if (!REVIEW_MODES.includes(reviewMode)) {
      throw new Error('request.v1 reviewMode must be full-review or score-only.');
    }
    const rawTimerPolicy = request.timerPolicy === undefined
      ? { enabled: false, durationSeconds: 0, expiryAction: 'continue' }
      : request.timerPolicy;
    if (!isObject(rawTimerPolicy)) throw new Error('request.v1 timerPolicy must be an object.');
    assertExactKeys(rawTimerPolicy, ['enabled', 'durationSeconds', 'expiryAction'], 'request.v1 timerPolicy');
    if (typeof rawTimerPolicy.enabled !== 'boolean') {
      throw new Error('request.v1 timerPolicy.enabled must be boolean.');
    }
    const durationSeconds = Number(rawTimerPolicy.durationSeconds);
    if (!Number.isInteger(durationSeconds) || durationSeconds < 0 || durationSeconds > 3 * 60 * 60 ||
        (rawTimerPolicy.enabled ? durationSeconds < 60 : durationSeconds !== 0)) {
      throw new Error('request.v1 timerPolicy.durationSeconds must be 0 when disabled or 60–10800 when enabled.');
    }
    if (!TIMER_EXPIRY_ACTIONS.includes(rawTimerPolicy.expiryAction)) {
      throw new Error('request.v1 timerPolicy.expiryAction must be continue or submit.');
    }
    const timerPolicy = {
      enabled: rawTimerPolicy.enabled,
      durationSeconds: rawTimerPolicy.enabled ? durationSeconds : 0,
      expiryAction: rawTimerPolicy.enabled ? rawTimerPolicy.expiryAction : 'continue',
    };
    if (!Array.isArray(request.selections) || request.selections.length < 1 || request.selections.length > 3) {
      throw new Error('Teacher request.v1 requires 1–3 selections.');
    }
    const expectedScope = request.compositionMode === 'full-passage' ? 'full' : 'task';
    const selections = request.selections.map((selection, index) => {
      if (!isObject(selection)) throw new Error(`request.v1 selections[${index}] must be an object.`);
      assertExactKeys(selection, ['passageId', 'scope', 'taskId', 'taskIds'], `request.v1 selections[${index}]`);
      if (typeof selection.passageId !== 'string' || !selection.passageId.trim()) {
        throw new Error(`request.v1 selections[${index}].passageId must be non-empty.`);
      }
      if (selection.scope !== expectedScope) {
        throw new Error('The first request.v1 release does not allow mixing full-passage and task-drill selections.');
      }
      if (expectedScope === 'full') {
        if (hasOwn(selection, 'taskId') || hasOwn(selection, 'taskIds')) {
          throw new Error(`request.v1 selections[${index}] full scope must not contain taskId or taskIds.`);
        }
        return { passageId: selection.passageId, scope: 'full' };
      }
      const legacyTaskId = typeof selection.taskId === 'string' && selection.taskId.trim()
        ? selection.taskId.trim()
        : '';
      if (hasOwn(selection, 'taskId') && !legacyTaskId) {
        throw new Error(`request.v1 selections[${index}].taskId must be a non-empty string when present.`);
      }
      if (hasOwn(selection, 'taskIds') && !Array.isArray(selection.taskIds)) {
        throw new Error(`request.v1 selections[${index}].taskIds must be an array.`);
      }
      const taskIds = Array.isArray(selection.taskIds)
        ? selection.taskIds.map((taskId) => typeof taskId === 'string' ? taskId.trim() : '')
        : (legacyTaskId ? [legacyTaskId] : []);
      if (!taskIds.length || taskIds.some((taskId) => !taskId) || new Set(taskIds).size !== taskIds.length) {
        throw new Error(`request.v1 selections[${index}] task scope requires one or more unique complete taskIds.`);
      }
      if (legacyTaskId && !taskIds.includes(legacyTaskId)) {
        throw new Error(`request.v1 selections[${index}].taskId must also appear in taskIds when both are provided.`);
      }
      return { passageId: selection.passageId, scope: 'task', taskIds };
    });
    const passageIds = selections.map((selection) => selection.passageId);
    if (new Set(passageIds).size !== passageIds.length) {
      throw new Error('request.v1 permits only one selection object per passage; combine task groups in taskIds.');
    }
    return {
      schemaVersion: HOMEWORK_REQUEST_V1,
      legacy: false,
      mode: 'homework',
      title: request.title.trim(),
      compositionMode: request.compositionMode,
      selections,
      reviewMode,
      timerPolicy,
      watermarkText: request.watermarkText,
    };
  }

  function assertLibrary(library) {
    if (!isObject(library) || !Array.isArray(library.passages)) {
      throw new Error('library.passages must be an array.');
    }
    const ids = library.passages.map((passage) => passage && passage.passageId);
    if (ids.some((passageId) => typeof passageId !== 'string' || !passageId)) {
      throw new Error('Every library passage requires a passageId.');
    }
    if (new Set(ids).size !== ids.length) throw new Error('The teacher library contains duplicate passageIds.');
    if (library.sources !== undefined) {
      if (!Array.isArray(library.sources)) throw new Error('library.sources must be an array when present.');
      const sourceIds = library.sources.map((passage) => passage && passage.passageId);
      if (sourceIds.some((passageId) => typeof passageId !== 'string' || !passageId)) {
        throw new Error('Every teacher library source requires a passageId.');
      }
      if (new Set(sourceIds).size !== sourceIds.length) throw new Error('The teacher library contains duplicate source passageIds.');
      if (sourceIds.some((passageId) => !ids.includes(passageId))) {
        throw new Error('Every teacher library source must have matching public passage metadata.');
      }
    }
  }

  function assertPortableSourceFile(sourceFile) {
    const filename = sourceFile && sourceFile.filename;
    if (typeof filename !== 'string' || !filename || filename.trim() !== filename ||
        filename === '.' || filename === '..' || /[\\/\u0000-\u001f]/.test(filename) ||
        /^[A-Za-z][A-Za-z0-9+.-]*:/.test(filename) || /^[A-Za-z]:/.test(filename)) {
      throw new Error('sourceFiles[].filename must be a portable basename.');
    }
  }

  function isPrivateKey(key) {
    const normalized = String(key).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    return PRIVATE_EXACT_KEYS.has(key) || PRIVATE_NORMALIZED_KEYS.has(normalized);
  }

  function publicPresentationExtensions(owner, extensions) {
    const output = {};
    if (typeof owner.taskId === 'string' && ALLOWED_PRESENTATION_VARIANTS.has(extensions.presentationVariant)) {
      output.presentationVariant = extensions.presentationVariant;
    }
    if (typeof owner.passageId === 'string') {
      const formatting = extensions.sourceFormatting;
      if (isObject(formatting) && formatting.sourceTitleVisible === false) {
        output.sourceFormatting = { sourceTitleVisible: false };
      }
    }
    if (typeof owner.itemId === 'string' || typeof owner.blockId === 'string') {
      const formatting = extensions.sourceFormatting;
      if (isObject(formatting)) {
        const safeFormatting = {};
        ['italicText', 'boldText'].forEach((key) => {
          if (Array.isArray(formatting[key]) && formatting[key].every((value) => typeof value === 'string')) {
            safeFormatting[key] = [...formatting[key]];
          }
        });
        if (typeof owner.blockId === 'string' && formatting.paragraphBreaks === 'preserve') {
          safeFormatting.paragraphBreaks = 'preserve';
        }
        const dialogue = formatting.dialogue;
        if (typeof owner.blockId === 'string' && isObject(dialogue) &&
            typeof dialogue.label === 'string' && dialogue.label.trim() &&
            typeof dialogue.introduction === 'string' && Array.isArray(dialogue.lines) && dialogue.lines.length) {
          const lines = dialogue.lines.map((line) => isObject(line) &&
            typeof line.speaker === 'string' && line.speaker.trim() &&
            Array.isArray(line.utteranceLines) && line.utteranceLines.length &&
            line.utteranceLines.every((value) => typeof value === 'string' && value)
            ? { speaker: line.speaker, utteranceLines: [...line.utteranceLines] }
            : null);
          const reconstructed = lines.every(Boolean) ? [
            dialogue.introduction,
            ...lines.flatMap(({ speaker, utteranceLines }) => [`${speaker} ${utteranceLines[0]}`, ...utteranceLines.slice(1)]),
          ].join('\n') : null;
          if (reconstructed === owner.text) {
            safeFormatting.dialogue = {
              label: dialogue.label.trim(),
              introduction: dialogue.introduction,
              lines,
            };
          }
        }
        if (Object.keys(safeFormatting).length) output.sourceFormatting = safeFormatting;
      }
    }
    if (typeof owner.itemId === 'string') {
      const note = extensions.notePresentation;
      if (isObject(note) && [0, 1, 2].includes(Number(note.level)) &&
          ['none', 'bullet', 'dash'].includes(note.marker) &&
          (note.emphasis === undefined || ['normal', 'strong'].includes(note.emphasis))) {
        output.notePresentation = {
          level: Number(note.level),
          marker: note.marker,
          ...(note.emphasis ? { emphasis: note.emphasis } : {}),
        };
      }
    }
    if (typeof owner.rowId === 'string') {
      const table = extensions.tablePresentation;
      if (isObject(table) && ['default', 'none'].includes(table.topBorder)) {
        output.tablePresentation = { topBorder: table.topBorder };
      }
    }
    if (typeof owner.scoreSlotId === 'string') {
      const matchingHeading = extensions.zhReviewV01?.matchingHeading;
      if (isObject(matchingHeading) &&
          matchingHeading.schemaVersion === 'ielts-reading-matching-heading-review.zh-CN.v1' &&
          typeof matchingHeading.canonicalHeadingText === 'string' && matchingHeading.canonicalHeadingText.trim() &&
          typeof matchingHeading.headingTranslation === 'string' && matchingHeading.headingTranslation.trim()) {
        output.zhReviewV01 = {
          matchingHeading: {
            schemaVersion: matchingHeading.schemaVersion,
            canonicalHeadingText: matchingHeading.canonicalHeadingText,
            headingTranslation: matchingHeading.headingTranslation,
          },
        };
      }
    }
    return output;
  }

  function publicClone(value) {
    if (Array.isArray(value)) return value.map((entry) => publicClone(entry));
    if (!isObject(value)) return value;
    const output = {};
    Object.entries(value).forEach(([key, child]) => {
      if (isPrivateKey(key)) return;
      if (key === 'extensions') {
        if (isObject(child)) {
          const publicExtensions = publicPresentationExtensions(value, child);
          if (Object.keys(publicExtensions).length) output.extensions = publicExtensions;
        }
        return;
      }
      output[key] = publicClone(child);
    });
    return output;
  }

  function assertNoPrivateMaterial(value, path) {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => assertNoPrivateMaterial(entry, `${path}[${index}]`));
      return;
    }
    if (!isObject(value)) return;
    Object.entries(value).forEach(([key, child]) => {
      if (isPrivateKey(key)) throw new Error(`Public projection contains private field ${path}.${key}.`);
      assertNoPrivateMaterial(child, `${path}.${key}`);
    });
  }

  function createAssetAccumulator() {
    const assets = [];
    const byId = new Map();
    const idBySha256 = new Map();
    return {
      add(sourceAsset) {
        const asset = publicClone(sourceAsset);
        const identity = validatePngAsset(asset);
        const existingById = byId.get(identity.assetId);
        if (existingById && existingById.sha256 !== identity.sha256) {
          throw new Error(`Selected passages collide on assetId ${identity.assetId}.`);
        }
        let canonicalAssetId = idBySha256.get(identity.sha256);
        if (!canonicalAssetId) {
          canonicalAssetId = identity.assetId;
          assets.push(asset);
          idBySha256.set(identity.sha256, canonicalAssetId);
        }
        byId.set(identity.assetId, identity);
        return canonicalAssetId;
      },
      values() {
        return clone(assets);
      },
    };
  }

  function assertUniqueIds(parts, responseSlots, scoreSlots) {
    const buckets = [
      ['partId', parts.map((part) => part.partId)],
      ['passageId', parts.map((part) => part.passage && part.passage.passageId)],
      ['taskId', parts.flatMap((part) => part.tasks.map((task) => task.taskId))],
      ['responseSlotId', responseSlots.map((slot) => slot.responseSlotId)],
      ['scoreSlotId', scoreSlots.map((slot) => slot.scoreSlotId)],
    ];
    buckets.forEach(([label, ids]) => {
      if (ids.some((id) => typeof id !== 'string' || !id)) throw new Error(`Assembled ${label} values must be non-empty.`);
      if (new Set(ids).size !== ids.length) throw new Error(`Selected passages collide on ${label}.`);
    });
  }

  function validateLibraryPassage(entry) {
    if (!isObject(entry.source) || typeof entry.source.packageId !== 'string' || !entry.source.packageId ||
        typeof entry.source.contentVersion !== 'string' || !entry.source.contentVersion ||
        typeof entry.source.partId !== 'string' || !entry.source.partId ||
        !/^[a-f0-9]{64}$/i.test(entry.source.sourcePackageSha256 || '')) {
      throw new Error(`Passage ${entry.passageId} has an incomplete pinned source identity.`);
    }
    if (!isObject(entry.part) || entry.part.partId !== entry.source.partId ||
        !isObject(entry.part.passage) || entry.part.passage.passageId !== entry.passageId ||
        !Array.isArray(entry.part.tasks) || !entry.part.tasks.length) {
      throw new Error(`Passage ${entry.passageId} does not match its pinned Part.`);
    }
    if (!Array.isArray(entry.responseSlots) || !Array.isArray(entry.scoreSlots) || !Array.isArray(entry.reviewEntries)) {
      throw new Error(`Passage ${entry.passageId} requires responseSlots, scoreSlots, and reviewEntries arrays.`);
    }
    (entry.sourceFiles || []).forEach(assertPortableSourceFile);
  }

  function taskResponseIds(tasks, context) {
    const responseIds = tasks.flatMap((task) => {
      if (!Array.isArray(task.responseSlotIds) || !task.responseSlotIds.length) {
        throw new Error(`Task ${task.taskId || '(missing)'} in ${context} has no responseSlotIds.`);
      }
      return task.responseSlotIds;
    });
    if (responseIds.some((responseSlotId) => typeof responseSlotId !== 'string' || !responseSlotId) ||
        new Set(responseIds).size !== responseIds.length) {
      throw new Error(`${context} contains missing or multiply referenced responseSlotIds.`);
    }
    return responseIds;
  }

  function selectionTasks(entry, selection, normalizedRequest) {
    const taskById = new Map(entry.part.tasks.map((task) => [task.taskId, task]));
    if (taskById.size !== entry.part.tasks.length || taskById.has(undefined)) {
      throw new Error(`Passage ${entry.passageId} contains duplicate or missing taskId values.`);
    }
    const requestedTaskIds = selection.scope === 'task'
      ? (Array.isArray(selection.taskIds) ? selection.taskIds : [selection.taskId]).filter(Boolean)
      : entry.part.tasks.map((task) => task.taskId);
    const requestedTaskIdSet = new Set(requestedTaskIds);
    const missingTaskIds = requestedTaskIds.filter((taskId) => !taskById.has(taskId));
    if (missingTaskIds.length) {
      throw new Error(`Passage ${entry.passageId} does not contain selected taskId(s): ${missingTaskIds.join(', ')}.`);
    }
    // Canonical order always follows the source Part, never click/request order.
    const tasks = entry.part.tasks.filter((task) => requestedTaskIdSet.has(task.taskId));
    if (!tasks.length) throw new Error(`Passage ${entry.passageId} contains no selected tasks.`);
    const responseIds = taskResponseIds(tasks, `Passage ${entry.passageId} selected task scope`);
    if (!normalizedRequest.legacy && selection.scope === 'full' && ![13, 14].includes(responseIds.length)) {
      throw new Error(`Passage ${entry.passageId} is not a complete 13/14-response passage (${responseIds.length} responses found); use task-drill for a partial fixture.`);
    }
    const unsupported = [...new Set(tasks.map(taskTriple).filter((triple) => !RUNTIME_EXACT_TRIPLE_SET.has(triple)))];
    if (unsupported.length) throw new Error(`Passage ${entry.passageId} requires unsupported runtime triple(s): ${unsupported.join(', ')}.`);

    const composition = entry.composition || {};
    const scopedGates = selection.scope === 'full'
      ? [composition.fullPassage].filter(Boolean)
      : tasks.map((task) => (composition.taskGroups || []).find((group) => group && group.taskId === task.taskId));
    if (entry.reviewLanguage?.status !== 'zh-CN-primary') {
      throw new Error(`Passage ${entry.passageId} is blocked because reviewLanguage.status is not zh-CN-primary.`);
    }
    scopedGates.forEach((scopedGate, gateIndex) => {
      const taskId = selection.scope === 'full' ? 'full-passage' : (tasks[gateIndex]?.taskId || 'selected-task');
      if (scopedGate) {
        const blockers = Array.isArray(scopedGate.blockers) ? scopedGate.blockers : [];
        if (scopedGate.selectable !== true || blockers.length) {
          throw new Error(`Passage ${entry.passageId} task ${taskId} is blocked: ${blockers.join(' | ') || 'scope is not selectable'}.`);
        }
      }
      if (scopedGate?.reviewLanguage && scopedGate.reviewLanguage.status !== 'zh-CN-primary') {
        throw new Error(`Passage ${entry.passageId} task ${taskId} is blocked because reviewLanguage.status is not zh-CN-primary.`);
      }
    });
    return { tasks, responseIds };
  }

  function assembleHomeworkDetailed(library, request) {
    assertLibrary(library);
    const normalizedRequest = normalizeHomeworkRequest(request);
    const sourcePassages = Array.isArray(library.sources) ? library.sources : library.passages;
    const libraryById = new Map(sourcePassages.map((passage) => [passage.passageId, passage]));
    const selected = normalizedRequest.selections.map((selection) => {
      const entry = libraryById.get(selection.passageId);
      if (!entry) throw new Error(`Passage ${selection.passageId} is not in the teacher library.`);
      validateLibraryPassage(entry);
      const selectedScope = selectionTasks(entry, selection, normalizedRequest);
      return { entry, selection, selectedTasks: selectedScope.tasks, selectedTaskResponseIds: selectedScope.responseIds };
    });
    const canonicalSelections = selected.map(({ entry, selection, selectedTasks }) => selection.scope === 'full'
      ? { passageId: entry.passageId, scope: 'full' }
      : {
        passageId: entry.passageId,
        scope: 'task',
        taskIds: selectedTasks.map((task) => task.taskId),
      });
    const canonicalNormalizedRequest = { ...normalizedRequest, selections: clone(canonicalSelections) };
    const licenseProvenance = normalizedLicenseProvenance(library.licenseProvenance);
    const publisherAuthorization = licenseProvenance
      ? normalizedPublisherAuthorization(licenseProvenance.publisherAuthorization)
      : null;
    const distributionPolicy = createDistributionPolicy(normalizedRequest.watermarkText, licenseProvenance);
    const sourceReference = ({ entry, selection, selectedTasks }) => ({
      passageId: entry.passageId,
      ...(normalizedRequest.legacy ? {} : {
        scope: selection.scope,
        selectedTaskIds: selectedTasks.map((task) => task.taskId),
      }),
      sourcePackageId: entry.source.packageId,
      sourceContentVersion: entry.source.contentVersion,
      sourcePartId: entry.source.partId,
      sourcePackageSha256: entry.source.sourcePackageSha256.toLowerCase(),
    });
    const snapshotSeed = normalizedRequest.legacy ? {
      schemaVersion: 'ielts-reading-homework-snapshot.v0',
      mode: 'homework',
      title: normalizedRequest.title,
      distributionPolicy,
      passages: selected.map(sourceReference),
    } : {
      schemaVersion: 'ielts-reading-homework-snapshot.v1',
      mode: 'homework',
      compositionMode: normalizedRequest.compositionMode,
      title: normalizedRequest.title,
      reviewMode: normalizedRequest.reviewMode,
      timerPolicy: normalizedRequest.timerPolicy,
      distributionPolicy,
      selections: selected.map(sourceReference),
    };
    const snapshotHash = sha256Hex(snapshotSeed);
    const snapshotId = `homework.snapshot.${snapshotHash.slice(0, 24)}`;
    const parts = [];
    const responseSlots = [];
    const scoreSlots = [];
    const reviewEntries = [];
    const sourceFiles = [];
    const sourceFileKeys = new Set();
    const assetAccumulator = createAssetAccumulator();
    let nextDisplayNumber = 1;

    selected.forEach(({ entry, selectedTasks }, partIndex) => {
      const responseById = new Map();
      entry.responseSlots.forEach((slot) => {
        if (!isObject(slot) || typeof slot.responseSlotId !== 'string' || !slot.responseSlotId) {
          throw new Error(`Passage ${entry.passageId} contains an invalid response slot.`);
        }
        if (responseById.has(slot.responseSlotId)) throw new Error(`Passage ${entry.passageId} duplicates response slot ${slot.responseSlotId}.`);
        responseById.set(slot.responseSlotId, slot);
      });
      const taskIds = new Set(selectedTasks.map((task) => task.taskId));
      const selectedResponseIds = new Set();
      const assetsById = new Map((entry.assets || []).map((asset) => [asset.assetId, asset]));
      const clonedTasks = selectedTasks.map((task) => {
        if (!Array.isArray(task.responseSlotIds) || !task.responseSlotIds.length) {
          throw new Error(`Task ${task.taskId || '(missing)'} has no responseSlotIds.`);
        }
        const taskSlots = [];
        const displayNumbers = task.responseSlotIds.map((responseSlotId) => {
          const sourceSlot = responseById.get(responseSlotId);
          if (!sourceSlot) throw new Error(`Task ${task.taskId} references missing response slot ${responseSlotId}.`);
          if (sourceSlot.taskId !== task.taskId) {
            throw new Error(`Response slot ${responseSlotId} does not belong to selected task ${task.taskId}.`);
          }
          if (selectedResponseIds.has(responseSlotId)) throw new Error(`Response slot ${responseSlotId} is referenced more than once.`);
          selectedResponseIds.add(responseSlotId);
          const clonedSlot = { ...publicClone(sourceSlot), displayNumber: nextDisplayNumber++ };
          responseSlots.push(clonedSlot);
          taskSlots.push(clonedSlot);
          return clonedSlot.displayNumber;
        });
        const clonedTask = { ...publicClone(task), heading: questionHeading(displayNumbers) };
        const diagramAssetId = clonedTask.content && clonedTask.content.diagram && clonedTask.content.diagram.assetId;
        if (diagramAssetId) {
          const sourceAsset = assetsById.get(diagramAssetId);
          if (!sourceAsset) throw new Error(`Task ${task.taskId} references missing asset ${diagramAssetId}.`);
          const canonicalAssetId = assetAccumulator.add(sourceAsset);
          clonedTask.content.diagram.assetId = canonicalAssetId;
          (clonedTask.content.targets || []).forEach((target) => {
            if (target.assetId === diagramAssetId) target.assetId = canonicalAssetId;
          });
        }
        const numberByTarget = new Map(taskSlots
          .filter((slot) => slot.targetId)
          .map((slot) => [slot.targetId, slot.displayNumber]));
        (clonedTask.content && clonedTask.content.targets || []).forEach((target) => {
          const displayNumber = numberByTarget.get(target.targetId);
          if (displayNumber && target.targetType !== 'diagram-anchor') target.label = `Question ${displayNumber}`;
        });
        return clonedTask;
      });
      const scopedResponseIds = [...responseById.values()]
        .filter((slot) => taskIds.has(slot.taskId))
        .map((slot) => slot.responseSlotId);
      if (selectedResponseIds.size !== scopedResponseIds.length ||
          scopedResponseIds.some((responseSlotId) => !selectedResponseIds.has(responseSlotId))) {
        const unused = scopedResponseIds.filter((responseSlotId) => !selectedResponseIds.has(responseSlotId));
        throw new Error(`Passage ${entry.passageId} contains unused response slot(s): ${unused.join(', ')}.`);
      }

      const partNumbers = responseSlots
        .filter((slot) => selectedResponseIds.has(slot.responseSlotId))
        .map((slot) => slot.displayNumber);
      const clonedPart = publicClone(entry.part);
      clonedPart.ordinal = partIndex + 1;
      clonedPart.label = `Part ${partIndex + 1}`;
      clonedPart.instruction = passageInstruction(partNumbers);
      clonedPart.passage.label = `Part ${partIndex + 1}`;
      clonedPart.tasks = clonedTasks;
      const sourcePassagePosition = Number(entry.passagePosition);
      const difficultyTier = {
        '偏易': 'easy',
        '标准': 'standard',
        '偏难': 'hard',
      }[relativeDifficultyTier(entry)];
      if ([1, 2, 3].includes(sourcePassagePosition) && difficultyTier) {
        clonedPart.extensions = {
          ...(isObject(clonedPart.extensions) ? clonedPart.extensions : {}),
          reportPresentation: {
            schemaVersion: 'ielts-reading-report-presentation.v1',
            sourcePassagePosition,
            difficultyTier,
          },
        };
      }
      parts.push(clonedPart);

      const reviewByScoreId = new Map();
      entry.reviewEntries.forEach((reviewEntry) => {
        if (!isObject(reviewEntry) || typeof reviewEntry.scoreSlotId !== 'string' || !reviewEntry.scoreSlotId) {
          throw new Error(`Passage ${entry.passageId} contains an invalid review entry.`);
        }
        if (reviewByScoreId.has(reviewEntry.scoreSlotId)) throw new Error(`Review ${reviewEntry.scoreSlotId} is duplicated.`);
        reviewByScoreId.set(reviewEntry.scoreSlotId, reviewEntry);
      });
      const selectedScoreIds = new Set();
      entry.scoreSlots.filter((scoreSlot) => taskIds.has(scoreSlot.taskId)).forEach((scoreSlot) => {
        if (!isObject(scoreSlot) || typeof scoreSlot.scoreSlotId !== 'string' || !scoreSlot.scoreSlotId) {
          throw new Error(`Passage ${entry.passageId} contains an invalid score slot.`);
        }
        if (!taskIds.has(scoreSlot.taskId)) throw new Error(`Score slot ${scoreSlot.scoreSlotId} references an unselected task.`);
        if (selectedScoreIds.has(scoreSlot.scoreSlotId)) throw new Error(`Score slot ${scoreSlot.scoreSlotId} is duplicated.`);
        if (!Array.isArray(scoreSlot.responseSlotIds) || !scoreSlot.responseSlotIds.length ||
            scoreSlot.responseSlotIds.some((responseSlotId) => !selectedResponseIds.has(responseSlotId))) {
          throw new Error(`Score slot ${scoreSlot.scoreSlotId} crosses outside passage ${entry.passageId}.`);
        }
        const reviewEntry = reviewByScoreId.get(scoreSlot.scoreSlotId);
        if (!reviewEntry) throw new Error(`Score slot ${scoreSlot.scoreSlotId} has no review entry.`);
        selectedScoreIds.add(scoreSlot.scoreSlotId);
        scoreSlots.push(publicClone(scoreSlot));
        reviewEntries.push(publicClone(reviewEntry));
      });
      if (normalizedRequest.legacy || normalizedRequest.compositionMode === 'full-passage') {
        const orphanReviews = [...reviewByScoreId.keys()].filter((scoreSlotId) => !selectedScoreIds.has(scoreSlotId));
        if (orphanReviews.length) throw new Error(`Passage ${entry.passageId} contains orphan review(s): ${orphanReviews.join(', ')}.`);
      }

      (entry.sourceFiles || []).forEach((sourceFile) => {
        const publicSourceFile = publicClone(sourceFile);
        const identity = canonicalJson(publicSourceFile);
        if (!sourceFileKeys.has(identity)) {
          sourceFileKeys.add(identity);
          sourceFiles.push(publicSourceFile);
        }
      });
    });

    assertUniqueIds(parts, responseSlots, scoreSlots);
    if (reviewEntries.length !== scoreSlots.length) throw new Error('Every score slot must have exactly one review entry.');
    const assets = assetAccumulator.values();
    const candidate = {
      assessmentId: `assessment.${snapshotId}`,
      title: normalizedRequest.title,
      parts,
      responseSlots,
      ...(assets.length ? { assets } : {}),
    };
    const answerKey = {
      maxMarks: scoreSlots.reduce((sum, scoreSlot) => sum + Number(scoreSlot.marks || 0), 0),
      scoreSlots,
    };
    const review = { entries: reviewEntries };
    const packageData = {
      manifest: {
        schemaVersion: '2.0.0',
        packageId: `package.${snapshotId}`,
        contentVersion: `1.0.0-homework.${snapshotHash.slice(0, 12)}`,
        adapterVersion: normalizedRequest.legacy ? 'whole-passage-homework-composer.0' : 'scoped-homework-composer.1',
        title: normalizedRequest.title,
        language: 'en',
        sourceFiles,
        distributionPolicy,
        integrity: {
          candidateSha256: sha256Hex(candidate),
          answerKeySha256: sha256Hex(answerKey),
          reviewSha256: sha256Hex(review),
        },
        extensions: {
          homeworkSnapshot: { ...snapshotSeed, snapshotId, snapshotHash },
          ...(publisherAuthorization ? { publisherAuthorization } : {}),
        },
      },
      candidate,
      answerKey,
      review,
    };
    assertPublicPackage(packageData);
    const summary = {
      snapshotId,
      snapshotHash,
      packageId: packageData.manifest.packageId,
      contentVersion: packageData.manifest.contentVersion,
      title: packageData.candidate.title,
      parts: parts.length,
      tasks: parts.reduce((sum, part) => sum + part.tasks.length, 0),
      responseSlots: responseSlots.length,
      scoreSlots: scoreSlots.length,
      maxMarks: answerKey.maxMarks,
      requestSchemaVersion: normalizedRequest.schemaVersion,
      compositionMode: normalizedRequest.compositionMode,
      // Keep report/replay metadata stable even if the UI click order differs.
      selections: clone(canonicalSelections),
      distributionPolicy: clone(distributionPolicy),
      passages: parts.map((part) => ({
        ordinal: part.ordinal,
        passageId: part.passage.passageId,
        title: part.passage.title,
      })),
    };
    return { packageData, snapshotSeed, snapshotId, snapshotHash, summary, normalizedRequest: canonicalNormalizedRequest };
  }

  function assembleHomework(request, library) {
    return assembleHomeworkDetailed(library, request).packageData;
  }

  function assertSupportedPolicy(policy) {
    if (!isObject(policy) || policy.schemaVersion !== DISTRIBUTION_POLICY_SCHEMA_VERSION ||
        policy.mode !== 'internal' || policy.answerDelivery !== 'embedded-after-submit' ||
        !isObject(policy.branding) ||
        !isObject(policy.integrity) || policy.integrity.mode !== 'artifact-receipt' || policy.integrity.algorithm !== 'none' ||
        !isObject(policy.hardening) || policy.hardening.profile !== 'development' || policy.hardening.externalNetwork !== 'deny' ||
        !isObject(policy.watermark)) {
      throw new Error('Only the internal/development/embedded-after-submit distribution policy is supported.');
    }
    assertExactKeys(policy, ['schemaVersion', 'mode', 'branding', 'watermark', 'integrity', 'hardening', 'answerDelivery'], 'distributionPolicy');
    assertExactKeys(policy.branding, ['publisherDisplayName', 'attributionText'], 'distributionPolicy.branding');
    assertExactKeys(policy.watermark, ['enabled', 'visibility', 'textTemplate', 'surfaces', 'personalization'], 'distributionPolicy.watermark');
    assertExactKeys(policy.integrity, ['mode', 'algorithm'], 'distributionPolicy.integrity');
    assertExactKeys(policy.hardening, ['profile', 'minify', 'sourceMaps', 'obfuscation', 'stripPrivateMetadata', 'externalNetwork'], 'distributionPolicy.hardening');
    const watermark = policy.watermark;
    if (watermark.enabled === false) {
      if (watermark.visibility !== 'disabled' || watermark.textTemplate !== null ||
          !Array.isArray(watermark.surfaces) || watermark.surfaces.length || watermark.personalization !== 'none') {
        throw new Error('Disabled watermark policy is inconsistent.');
      }
    } else if (watermark.enabled === true) {
      if (watermark.visibility !== 'after-submit' || typeof watermark.textTemplate !== 'string' ||
          !watermark.textTemplate.trim() || /\r|\n/.test(watermark.textTemplate) ||
          canonicalJson(watermark.surfaces) !== canonicalJson(['review', 'print']) || watermark.personalization !== 'none') {
        throw new Error('Enabled watermark policy is inconsistent.');
      }
    } else {
      throw new Error('watermark.enabled must be boolean.');
    }
  }

  function snapshotSeedForValidation(snapshot, packageData) {
    if (!isObject(snapshot) || snapshot.mode !== 'homework') {
      throw new Error('Student package is missing its homework snapshot.');
    }
    if (snapshot.schemaVersion === 'ielts-reading-homework-snapshot.v0') {
      assertExactKeys(snapshot, ['schemaVersion', 'mode', 'title', 'distributionPolicy', 'passages', 'snapshotId', 'snapshotHash'], 'homeworkSnapshot');
      if (!Array.isArray(snapshot.passages) || snapshot.passages.length < 1 || snapshot.passages.length > 3) {
        throw new Error('homeworkSnapshot.passages must contain 1–3 frozen source references.');
      }
      snapshot.passages.forEach((passage, index) => {
        if (!isObject(passage)) throw new Error(`homeworkSnapshot.passages[${index}] must be an object.`);
        assertExactKeys(
          passage,
          ['passageId', 'sourcePackageId', 'sourceContentVersion', 'sourcePartId', 'sourcePackageSha256'],
          `homeworkSnapshot.passages[${index}]`,
        );
        if (!/^[a-f0-9]{64}$/i.test(passage.sourcePackageSha256 || '')) {
          throw new Error(`homeworkSnapshot.passages[${index}] requires a sourcePackageSha256.`);
        }
      });
      return {
        schemaVersion: snapshot.schemaVersion,
        mode: snapshot.mode,
        title: snapshot.title,
        distributionPolicy: snapshot.distributionPolicy,
        passages: snapshot.passages,
      };
    }
    if (snapshot.schemaVersion !== 'ielts-reading-homework-snapshot.v1') {
      throw new Error(`Unsupported homeworkSnapshot schemaVersion: ${snapshot.schemaVersion || '(missing)'}.`);
    }
    const hasReviewMode = hasOwn(snapshot, 'reviewMode');
    const hasTimerPolicy = hasOwn(snapshot, 'timerPolicy');
    assertExactKeys(snapshot, [
      'schemaVersion', 'mode', 'compositionMode', 'title',
      ...(hasReviewMode ? ['reviewMode'] : []),
      ...(hasTimerPolicy ? ['timerPolicy'] : []),
      'distributionPolicy', 'selections', 'snapshotId', 'snapshotHash',
    ], 'homeworkSnapshot');
    if (!COMPOSITION_MODES.includes(snapshot.compositionMode)) {
      throw new Error('homeworkSnapshot.compositionMode must be full-passage or task-drill.');
    }
    if (hasReviewMode && !REVIEW_MODES.includes(snapshot.reviewMode)) {
      throw new Error('homeworkSnapshot.reviewMode must be full-review or score-only.');
    }
    if (hasTimerPolicy) {
      const timer = snapshot.timerPolicy;
      if (!isObject(timer)) throw new Error('homeworkSnapshot.timerPolicy must be an object.');
      assertExactKeys(timer, ['enabled', 'durationSeconds', 'expiryAction'], 'homeworkSnapshot.timerPolicy');
      if (typeof timer.enabled !== 'boolean' || !Number.isInteger(Number(timer.durationSeconds)) ||
          Number(timer.durationSeconds) < 0 || Number(timer.durationSeconds) > 3 * 60 * 60 ||
          (timer.enabled ? Number(timer.durationSeconds) < 60 : Number(timer.durationSeconds) !== 0) ||
          !TIMER_EXPIRY_ACTIONS.includes(timer.expiryAction)) {
        throw new Error('homeworkSnapshot.timerPolicy is invalid.');
      }
    }
    if (!Array.isArray(snapshot.selections) || snapshot.selections.length < 1 || snapshot.selections.length > 3 ||
        packageData.candidate.parts.length !== snapshot.selections.length) {
      throw new Error('homeworkSnapshot.selections must contain 1–3 source selections matching candidate Parts.');
    }
    const expectedScope = snapshot.compositionMode === 'full-passage' ? 'full' : 'task';
    snapshot.selections.forEach((selection, index) => {
      if (!isObject(selection)) throw new Error(`homeworkSnapshot.selections[${index}] must be an object.`);
      assertExactKeys(
        selection,
        ['passageId', 'scope', 'selectedTaskIds', 'sourcePackageId', 'sourceContentVersion', 'sourcePartId', 'sourcePackageSha256'],
        `homeworkSnapshot.selections[${index}]`,
      );
      if (selection.scope !== expectedScope) {
        throw new Error('homeworkSnapshot v1 does not allow mixed full/task scopes.');
      }
      if (!Array.isArray(selection.selectedTaskIds) || !selection.selectedTaskIds.length ||
          selection.selectedTaskIds.some((taskId) => typeof taskId !== 'string' || !taskId) ||
          new Set(selection.selectedTaskIds).size !== selection.selectedTaskIds.length ||
          (selection.scope === 'task' && selection.selectedTaskIds.length < 1)) {
        throw new Error(`homeworkSnapshot.selections[${index}] has an invalid complete-task selection.`);
      }
      if (!/^[a-f0-9]{64}$/i.test(selection.sourcePackageSha256 || '')) {
        throw new Error(`homeworkSnapshot.selections[${index}] requires a sourcePackageSha256.`);
      }
      const part = packageData.candidate.parts[index];
      const actualTaskIds = (part.tasks || []).map((task) => task.taskId);
      if (part.passage?.passageId !== selection.passageId ||
          canonicalJson(actualTaskIds) !== canonicalJson(selection.selectedTaskIds)) {
        throw new Error(`homeworkSnapshot.selections[${index}] does not match its candidate Part task closure.`);
      }
      const responseIds = taskResponseIds(part.tasks || [], `homeworkSnapshot.selections[${index}] candidate Part`);
      if (selection.scope === 'full' && ![13, 14].includes(responseIds.length)) {
        throw new Error(`homeworkSnapshot.selections[${index}] full passage must contain 13 or 14 responses.`);
      }
    });
    const passageIds = snapshot.selections.map((selection) => selection.passageId);
    if (new Set(passageIds).size !== passageIds.length) {
      throw new Error('homeworkSnapshot v1 permits only one selection object per passage.');
    }
    return {
      schemaVersion: snapshot.schemaVersion,
      mode: snapshot.mode,
      compositionMode: snapshot.compositionMode,
      title: snapshot.title,
      ...(hasReviewMode ? { reviewMode: snapshot.reviewMode } : {}),
      ...(hasTimerPolicy ? { timerPolicy: snapshot.timerPolicy } : {}),
      distributionPolicy: snapshot.distributionPolicy,
      selections: snapshot.selections,
    };
  }

  function assertPublicPackage(packageData) {
    if (!isObject(packageData) || !isObject(packageData.manifest) || !isObject(packageData.candidate) ||
        !isObject(packageData.answerKey) || !isObject(packageData.review)) {
      throw new Error('Student package requires manifest, candidate, answerKey, and review objects.');
    }
    assertExactKeys(packageData, ['manifest', 'candidate', 'answerKey', 'review'], 'student package');
    assertNoPrivateMaterial(packageData, '$');
    assertSupportedPolicy(packageData.manifest.distributionPolicy);
    const integrity = packageData.manifest.integrity || {};
    if (integrity.candidateSha256 !== sha256Hex(packageData.candidate) ||
        integrity.answerKeySha256 !== sha256Hex(packageData.answerKey) ||
        integrity.reviewSha256 !== sha256Hex(packageData.review)) {
      throw new Error('Student package integrity digest is stale or inconsistent.');
    }
    const snapshot = packageData.manifest.extensions && packageData.manifest.extensions.homeworkSnapshot;
    const publisherAuthorization = packageData.manifest.extensions && packageData.manifest.extensions.publisherAuthorization;
    if (publisherAuthorization !== undefined) normalizedPublisherAuthorization(publisherAuthorization);
    if (publisherAuthorization !== undefined) {
      const policy = packageData.manifest.distributionPolicy;
      if (policy.branding.publisherDisplayName !== 'ZYZ READING WALKS' ||
          (policy.branding.attributionText !== null &&
            (typeof policy.branding.attributionText !== 'string' || !policy.branding.attributionText.trim() ||
              /\r|\n/u.test(policy.branding.attributionText) || policy.branding.attributionText.length > 160)) ||
          policy.watermark.enabled !== true || policy.watermark.visibility !== 'after-submit' ||
          policy.watermark.textTemplate !== PUBLISHER_NOTICE ||
          canonicalJson(policy.watermark.surfaces) !== canonicalJson(['review', 'print']) ||
          policy.watermark.personalization !== 'none') {
        throw new Error('Licensed student package brand policy is inconsistent.');
      }
    }
    const seed = snapshotSeedForValidation(snapshot, packageData);
    const expectedHash = sha256Hex(seed);
    const expectedId = `homework.snapshot.${expectedHash.slice(0, 24)}`;
    if (snapshot.snapshotHash !== expectedHash || snapshot.snapshotId !== expectedId ||
        canonicalJson(snapshot.distributionPolicy) !== canonicalJson(packageData.manifest.distributionPolicy) ||
        packageData.manifest.packageId !== `package.${expectedId}` ||
        packageData.manifest.contentVersion !== `1.0.0-homework.${expectedHash.slice(0, 12)}` ||
        packageData.candidate.assessmentId !== `assessment.${expectedId}` ||
        packageData.manifest.title !== snapshot.title || packageData.candidate.title !== snapshot.title) {
      throw new Error('Student package snapshot or storage identity is inconsistent.');
    }
    (packageData.manifest.sourceFiles || []).forEach(assertPortableSourceFile);
    return true;
  }

  function safeInlineJson(value) {
    return JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  function renderStudentHtml(packageData, runtimeTemplate) {
    if (typeof runtimeTemplate !== 'string') throw new Error('runtimeTemplate must be a string.');
    assertPublicPackage(packageData);
    const sentinel = '__IELTS_PACKAGE_JSON__';
    const first = runtimeTemplate.indexOf(sentinel);
    const last = runtimeTemplate.lastIndexOf(sentinel);
    if (first < 0 || first !== last) {
      throw new Error('runtimeTemplate must contain exactly one __IELTS_PACKAGE_JSON__ sentinel.');
    }
    return runtimeTemplate.slice(0, first) + safeInlineJson(packageData) + runtimeTemplate.slice(first + sentinel.length);
  }

  root.IELTSTeacherComposerCore = Object.freeze({
    API_VERSION,
    HOMEWORK_REQUEST_V0,
    HOMEWORK_REQUEST_V1,
    COMPOSITION_MODES,
    REVIEW_MODES,
    TIMER_EXPIRY_ACTIONS,
    PASSAGE_SORT_MODES,
    PASSAGE_DIFFICULTY_BASELINES,
    DEFAULT_DISTRIBUTION_POLICY,
    RUNTIME_EXACT_TRIPLES,
    canonicalJson,
    sortPassageMetadata,
    relativeDifficultyTier,
    passageMatchesFacetFilters,
    paginationItems,
    sha256: sha256Hex,
    sha256Hex,
    createDistributionPolicy,
    normalizeHomeworkRequest,
    assembleHomework,
    assembleHomeworkDetailed,
    assertPublicPackage,
    renderStudentHtml,
  });
})(typeof window !== 'undefined' ? window : globalThis);
