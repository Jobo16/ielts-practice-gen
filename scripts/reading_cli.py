"""Agent client: submit structured JSON and receive a standalone HTML artifact."""
import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


def main():
    parser = argparse.ArgumentParser(description='JSON → IELTS reading or listening HTML. Convert source material with your Agent first.')
    parser.add_argument('--server', default=os.getenv('READING_SERVER', 'http://127.0.0.1:4173'))
    commands = parser.add_subparsers(dest='command', required=True)
    guide = commands.add_parser('guide', help='Download Agent guide, field reference and examples')
    guide.add_argument('--output-dir', default='reading-guide')
    for command in ('validate', 'build', 'upload'):
        sub = commands.add_parser(command)
        sub.add_argument('input', type=Path)
        if command == 'build':
            sub.add_argument('-o', '--output', type=Path, required=True)
    args = parser.parse_args()
    token = os.getenv('READING_ADMIN_TOKEN' if args.command == 'upload' else 'READING_API_TOKEN', '')

    def request(path, data=None):
        headers = {'Content-Type': 'application/json'} if data is not None else {}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        # Do not follow redirects with credentials to another host.
        import urllib.request
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *unused, **kwargs):
                return None
        return urllib.request.build_opener(NoRedirect).open(Request(args.server.rstrip('/') + '/api/v1/' + path, data=data, headers=headers), timeout=60).read()

    def write(path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as out:
            temp = Path(out.name)
            out.write(data)
        try:
            temp.replace(path)
        finally:
            temp.unlink(missing_ok=True)

    try:
        if args.command == 'guide':
            folder = Path(args.output_dir)
            for endpoint, name in [('agent-guide','AGENT-GUIDE.md'), ('capabilities','capabilities.json'), ('task-catalog','task-catalog.md'), ('content-format','content-format.md'), ('listening-content-format','listening-content-format.md'), ('task-layouts','task-layouts.json'), ('openapi.json','openapi.json')]:
                write(folder / name, request(endpoint))
            for example in json.loads(request('examples'))['examples']:
                write(folder / 'examples' / (example['name'] + '.json'), request('examples/' + example['name']))
            print(f'Guide saved: {folder}')
            return
        source = json.loads(args.input.read_text(encoding='utf-8'))
        result = request('sets' if args.command == 'upload' else args.command, json.dumps(source, ensure_ascii=False).encode())
        if args.command == 'build':
            write(args.output, result)
            print(f'HTML saved: {args.output}')
        else:
            print(result.decode())
    except HTTPError as error:
        try:
            message = json.loads(error.read())['error']['message']
        except (ValueError, KeyError, TypeError):
            message = error.reason
        print(f'HTTP {error.code}: {message}', file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError, URLError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
