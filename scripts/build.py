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


def render(path):
    content = (ROOT / path).read_text(encoding='utf-8')

    def value(match):
        kind, name = match.groups()
        obj = json.loads((ROOT / name).read_text(encoding='utf-8')) if kind == 'JSON' else render(name)
        return script_json(obj)

    content = VALUE.sub(value, content)
    return INCLUDE.sub(lambda match: render(match[1]), content)


def build():
    output = ROOT / 'dist'
    output.mkdir(exist_ok=True)
    html = render('src/app/index.html')
    if '<!-- @include ' in html or '__ZYZ_JSON__(' in html or '__ZYZ_HTML_STRING__(' in html:
        raise ValueError('Unexpanded build placeholder')
    data = html.encode('utf-8')
    (output / 'index.html').write_bytes(data)
    receipt = {
        'type': 'unsigned-local-reconstruction',
        'sha256': hashlib.sha256(data).hexdigest(),
        'bytes': len(data),
        'sourceDistributionSha256': json.loads((ROOT / 'reference/recovery.json').read_text())['sourceSha256'],
    }
    (output / 'build.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'Built dist/index.html ({len(data):,} bytes); SHA-256 {receipt["sha256"]}')


if __name__ == '__main__':
    build()
