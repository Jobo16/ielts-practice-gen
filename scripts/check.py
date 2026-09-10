"""Check source syntax, reconstruction, dataset references, and deterministic builds."""
import subprocess
import tempfile
from html.parser import HTMLParser
from pathlib import Path
from build import ROOT, build, render


class Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            self.current = []
            self.scripts.append(self.current)

    def handle_endtag(self, tag):
        if tag == 'script':
            self.current = None

    def handle_data(self, data):
        if self.current is not None:
            self.current.append(data)


def main():
    build()
    first = (ROOT / 'dist/index.html').read_bytes()
    build()
    assert (ROOT / 'dist/index.html').read_bytes() == first, 'Build is not deterministic'
    count = 0
    with tempfile.TemporaryDirectory(prefix='zyz-check-') as temp:
        for entry in ('src/app/index.html', 'src/runtime/index.html'):
            parser = Scripts()
            html = render(entry)
            assert '__ZYZ_JSON__(' not in html
            parser.feed(html)
            for parts in parser.scripts:
                code = ''.join(parts)
                target = Path(temp) / f'{count}.js'
                target.write_text(code, encoding='utf-8')
                subprocess.run(['node', '--check', str(target)], check=True, capture_output=True)
                count += 1
        # Runtime template must retain exactly one package insertion point.
        runtime = render('src/runtime/index.html')
        assert runtime.count('__IELTS_PACKAGE_JSON__') == 1
        (Path(temp) / 'runtime.html').write_text(runtime)
        subprocess.run(['node', str(ROOT / 'scripts/check-core.cjs'), str(Path(temp) / 'runtime.html')], check=True, cwd=ROOT)
    print(f'PASS: {count} built scripts parse; deterministic HTML; runtime package slot preserved.')


if __name__ == '__main__':
    main()
