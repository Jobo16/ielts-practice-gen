"""Recover editable sources from the supplied single-file distribution.

Run only into an empty output directory. Never overwrites an existing recovery.
"""
import argparse
import base64
import hashlib
import json
import re
from pathlib import Path

BLOCK = re.compile(r'<(script|style)\b([^>]*)>(.*?)</\1\s*>', re.S | re.I)
ROOT = Path(__file__).resolve().parents[1]


def recover(source, target):
    if any((target / name).exists() for name in ('src', 'data', 'reference')):
        raise SystemExit('Output already contains recovered sources; use a new --output directory.')

    def write(path, value):
        dest = target / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(value, encoding='utf-8')

    def write_json(path, value):
        write(path, json.dumps(value, ensure_ascii=False, indent=2) + '\n')

    raw = source.read_bytes()
    archive = target / 'original' / source.name
    archive.parent.mkdir(parents=True, exist_ok=True)
    archive.write_bytes(raw)
    outer = raw.decode('utf-8')
    payload = re.search(r'<script id="zyz-integrity-payload"[^>]*>(.*?)</script>', outer, re.S)
    if not payload:
        raise SystemExit('Expected signed distribution payload not found.')
    decoded = base64.b64decode(payload[1], validate=True).decode('utf-8')
    blocks = list(BLOCK.finditer(decoded))
    scripts = [b for b in blocks if b[1] == 'script']
    if len(scripts) != 8:
        raise SystemExit(f'Unexpected application script count: {len(scripts)}')
    runtime = json.loads(scripts[4][3].split('=', 1)[1].strip().removesuffix(';'))
    write('reference/distribution-shell.html', outer[:payload.start()] +
          '<!-- Original payload omitted; see recovery.json for its digest. -->' + outer[payload.end():])
    write('reference/child-startup-gate.js', scripts[0][3])

    # Recover strict JSON assignments without executing code from the distribution.
    decoder = json.JSONDecoder()
    datasets = []

    def extract_json(code, module):
        pattern = re.compile(r'(?:(?:window\.[\w$]+|(?:const|let|var)\s+[\w$]+)\s*=\s*|freezeTrustedReplayData\()(?=[{\[])')
        changes = []
        for match in pattern.finditer(code):
            start = match.end()
            try:
                value, count = decoder.raw_decode(code[start:])
            except ValueError:
                continue
            if count < 1000:
                continue
            label = re.sub(r'[^a-z0-9]+', '-', match[0].lower()).strip('-')
            path = f'data/{module}/{label}.json'
            if path in datasets:
                raise ValueError(f'Duplicate dataset: {path}')
            datasets.append(path)
            write_json(path, value)
            changes.append((start, start + count, f'__ZYZ_JSON__("{path}")'))
        for start, end, replacement in reversed(changes):
            code = code[:start] + replacement + code[end:]
        return code

    app_names = ['startup-gate', 'library', 'manifest', 'edition', 'runtime-template',
                 'composer', 'record-store', 'app']

    def split_html(html, scope, names):
        script_index = 0
        style_index = 0

        def replace(match):
            nonlocal script_index, style_index
            tag, attrs, code = match.groups()
            if tag == 'style':
                style_index += 1
                path = f'src/{scope}/styles/{style_index:02d}.css'
                # Only the obsolete pending gate rule is removed; this block also
                # contains unrelated record/recovery styles which must be kept.
                code = code.replace('html[data-zyz-child-auth-status="pending"] body{visibility:hidden!important}', '')
                write(path, code)
            else:
                name = names[script_index]
                script_index += 1
                if scope == 'app' and name == 'startup-gate':
                    return '<!-- Reconstructed standalone entry: no original publisher signature. -->'
                path = f'src/{scope}/{name}.js'
                if scope == 'app' and name == 'runtime-template':
                    code = 'window.__IELTS_STUDENT_RUNTIME_TEMPLATE__ = __ZYZ_HTML_STRING__("src/runtime/index.html");\n'
                else:
                    code = extract_json(code, name)
                if scope == 'app' and name == 'app':
                    old = 'window.__ZYZ_INTEGRITY_CHILD_GATE__.run(init, (error) => {\n    console.error(error);\n  });'
                    if old not in code:
                        raise ValueError('Expected startup entry not found')
                    code = code.replace(old, 'init().catch((error) => {\n    console.error(error);\n    document.body.textContent = "重建版启动失败，请查看控制台错误。";\n  });')
                write(path, code)
            return f'<{tag}{attrs}><!-- @include {path} --></{tag}>'

        result = BLOCK.sub(replace, html)
        if script_index != len(names):
            raise ValueError(f'Unexpected {scope} script count: {script_index}')
        if scope == 'app':
            result = result.replace('<head>', '<head>\n  <meta name="zyz-reconstruction" content="unsigned-local-reconstruction">', 1)
            result = result.replace('Made with care by', '本地重建版 · Made with care by')
        write(f'src/{scope}/index.html', result)

    split_html(runtime, 'runtime', ['question-registry', 'question-renderers', 'answer-grading',
               'homework-report', 'attempt-ledger', 'ed25519-compat', 'package-slot',
               'translations', 'controller', 'bilingual-link'])
    split_html(decoded, 'app', app_names)
    library = json.loads(scripts[1][3].split('=', 1)[1].strip().removesuffix(';'))
    write_json('reference/recovery.json', {
        'sourceFilename': source.name,
        'sourceSha256': hashlib.sha256(raw).hexdigest(),
        'decodedPayloadSha256': hashlib.sha256(decoded.encode()).hexdigest(),
        'runtimeTemplateSha256': hashlib.sha256(runtime.encode()).hexdigest(),
        'passageCount': len(library['passages']),
        'questionCount': sum(p['questionCount'] for p in library['passages']),
        'datasets': datasets,
        'originalSignaturePreservedInBuild': False,
    })
    print(f'Recovered {len(library["passages"])} passages and {len(datasets)} datasets into {target}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT)
    args = parser.parse_args()
    recover(args.source, args.output.resolve())
