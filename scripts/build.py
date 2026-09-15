"""Build the reconstructed application into a self-contained, unsigned HTML."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INCLUDE = re.compile(r'<!-- @include ([\w./-]+) -->')
VALUE = re.compile(r'__ZYZ_(JSON|HTML_STRING)__\("([\w./-]+)"\)')


def script_json(value):
    # Embedded scripts must not be terminated by strings containing </script>.
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')


def render(path, overrides=None):
    overrides = overrides or {}
    content = (ROOT / path).read_text(encoding='utf-8')

    def value(match):
        kind, name = match.groups()
        obj = overrides.get(name) if name in overrides else (json.loads((ROOT / name).read_text(encoding='utf-8')) if kind == 'JSON' else render(name, overrides))
        return script_json(obj)

    content = VALUE.sub(value, content)
    return INCLUDE.sub(lambda match: render(match[1], overrides), content)


def engine_runtime():
    return render('src/runtime/index.html', {
        'data/translations/window-ielts-review-translations.json': None,
        'data/translations/window-ielts-review-translation-source-binding.json': None,
        'data/controller/const-t36-evidence-anchor-sidecar.json': {'entries': [], 'samplePassages': [], 'schemaVersion': 'reading-evidence.v1'},
        'data/bilingual-link/const-sidecar.json': {'passages': []},
    })


def build(include_legacy=False):
    output = ROOT / 'dist'
    output.mkdir(exist_ok=True)
    if include_legacy:
        legacy = render('src/app/index.html')
        (output / 'legacy.html').write_text(legacy, encoding='utf-8')
    runtime = engine_runtime()
    (output / 'reading-runtime.html').write_text(runtime, encoding='utf-8')
    sdk = '\n'.join(render(path) for path in ['src/app/composer.js', 'src/runtime/answer-grading.js', 'src/engine/content.js'])
    (output / 'reading-engine.js').write_text(sdk, encoding='utf-8')
    listening_sdk = '\n'.join(render(path) for path in ['src/app/composer.js', 'src/runtime/answer-grading.js', 'src/engine/content.js', 'src/engine/listening-content.js'])
    (output / 'listening-engine.js').write_text(listening_sdk, encoding='utf-8')
    (output / 'listening-runtime.html').write_text(runtime, encoding='utf-8')
    html = render('src/engine/index.html', {'src/runtime/index.html': runtime})
    if '<!-- @include ' in html or '__ZYZ_JSON__(' in html or '__ZYZ_HTML_STRING__(' in html:
        raise ValueError('Unexpanded build placeholder')
    data = html.encode('utf-8')
    (output / 'index.html').write_bytes(data)
    (output / 'listening.html').write_text(render('src/engine/listening-index.html', {'src/runtime/index.html': runtime}), encoding='utf-8')
    (output / 'admin.html').write_text(render('src/admin/index.html'), encoding='utf-8')
    receipt = {
        'type': 'unsigned-local-reconstruction',
        'sha256': hashlib.sha256(data).hexdigest(),
        'bytes': len(data),
    }
    (output / 'build.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'Built dist/index.html ({len(data):,} bytes); SHA-256 {receipt["sha256"]}')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--with-legacy', action='store_true', help='Also build the original bank reference app.')
    build(parser.parse_args().with_legacy)
