"""Local/admin HTTP service. SQLite stores immutable validated question sets."""
import hashlib
import hmac
import json
import os
import re
import sqlite3
import subprocess
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from build import ROOT


class ApiError(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message


class Service:
    def __init__(self, data_dir=None, api_token=None, admin_token=None):
        self.api_token = os.environ.get('READING_API_TOKEN', '') if api_token is None else api_token
        self.admin_token = os.environ.get('READING_ADMIN_TOKEN', '') if admin_token is None else admin_token
        if bool(self.api_token) != bool(self.admin_token):
            raise ValueError('Configure both READING_API_TOKEN and READING_ADMIN_TOKEN, or neither for loopback-only development.')
        if self.api_token and (len(self.api_token) < 24 or len(self.admin_token) < 24 or self.api_token == self.admin_token):
            raise ValueError('API and admin tokens must differ and each contain at least 24 characters.')
        self.max_body = 16 * 1024 * 1024
        self.workers = threading.BoundedSemaphore(4)
        folder = Path(data_dir or os.environ.get('READING_DATA_DIR', ROOT / '.local/service'))
        folder.mkdir(parents=True, exist_ok=True)
        self.db = folder / 'reading.sqlite3'
        with self.connection() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('''CREATE TABLE IF NOT EXISTS question_sets (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL,
                passage_count INTEGER NOT NULL, question_count INTEGER NOT NULL,
                task_count INTEGER NOT NULL, source TEXT NOT NULL, html TEXT NOT NULL,
                html_sha256 TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0)''')

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.db, timeout=5)
        try:
            with db:
                yield db
        finally:
            db.close()

    def compile(self, source, html=False):
        if not self.workers.acquire(blocking=False):
            raise ApiError(503, 'busy', '打包服务繁忙，请稍后重试。')
        try:
            args = ['node', '--max-old-space-size=256', str(ROOT / 'scripts/compile-worker.cjs')]
            if html:
                args.append('--html')
            result = subprocess.run(args, input=json.dumps(source, ensure_ascii=False), text=True,
                                    capture_output=True, timeout=20, cwd=ROOT)
            if result.returncode:
                raise ApiError(503, 'engine_unavailable', '题目引擎暂不可用，请确认服务已构建。')
            output = json.loads(result.stdout)
            if not output.get('ok'):
                raise ApiError(422, 'invalid_content', output.get('error', '题目格式无效'))
            return output
        except subprocess.TimeoutExpired:
            raise ApiError(503, 'compile_timeout', '题目处理超时。')
        finally:
            self.workers.release()


def handler_for(service):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'ReadingService/1'

        def respond(self, status, body, content_type='application/json; charset=utf-8', headers=None):
            if isinstance(body, (dict, list)):
                body = json.dumps(body, ensure_ascii=False).encode()
            elif isinstance(body, str):
                body = body.encode()
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            for name, value in (headers or {}).items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(body)

        def authorize(self, admin=False):
            if not service.api_token:
                return
            supplied = self.headers.get('Authorization', '').removeprefix('Bearer ')
            candidates = [service.admin_token] if admin else [service.api_token, service.admin_token]
            if not any(hmac.compare_digest(supplied.encode(), token.encode()) for token in candidates):
                raise ApiError(401, 'unauthorized', '需要有效的后台密钥。' if admin else '需要有效的 API 密钥。')

        def read_json(self):
            if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
                raise ApiError(415, 'json_required', '请发送 application/json，PDF 请先由 Agent 转换。')
            try:
                size = int(self.headers.get('Content-Length', '-1'))
            except ValueError:
                size = -1
            if size < 0:
                raise ApiError(411, 'length_required', '需要 Content-Length。')
            if size > service.max_body:
                raise ApiError(413, 'too_large', 'JSON 文件不能超过 16 MiB。')
            self.connection.settimeout(30)
            try:
                return json.loads(self.rfile.read(size))
            except (ValueError, UnicodeError):
                raise ApiError(400, 'invalid_json', '请求内容不是有效 JSON。')

        def dispatch(self):
            path = urlsplit(self.path).path
            method = self.command
            if method == 'GET' and path == '/api/v1/health':
                return self.respond(200, {'ok': True, 'apiVersion': 'v1', 'authenticationRequired': bool(service.api_token), 'maxBytes': service.max_body})
            public_docs = {
                '/api/v1/agent-guide': ('docs/agent-guide.md', 'text/markdown; charset=utf-8'),
                '/api/v1/content-format': ('docs/content-format.md', 'text/markdown; charset=utf-8'),
                '/api/v1/task-layouts': ('docs/task-layouts.json', 'application/json; charset=utf-8'),
                '/api/v1/openapi.json': ('docs/openapi.json', 'application/json; charset=utf-8'),
            }
            if method == 'GET' and path in public_docs:
                file, mime = public_docs[path]
                return self.respond(200, (ROOT / file).read_bytes(), mime)
            if method == 'GET' and path == '/api/v1/examples':
                files = [ROOT / 'examples/community-garden.json', *sorted((ROOT / 'examples/types').glob('*.json'))]
                return self.respond(200, {'examples': [{'name': file.stem, 'url': f'/api/v1/examples/{file.stem}'} for file in files]})
            if method == 'GET' and path.startswith('/api/v1/examples/'):
                name = path.rsplit('/', 1)[-1]
                if not re.fullmatch(r'[a-z0-9-]+', name):
                    raise ApiError(404, 'not_found', '示例不存在。')
                file = ROOT / ('examples/community-garden.json' if name == 'community-garden' else f'examples/types/{name}.json')
                if not file.is_file():
                    raise ApiError(404, 'not_found', '示例不存在。')
                return self.respond(200, file.read_bytes())
            if method == 'POST' and path in ('/api/v1/validate', '/api/v1/build', '/api/v1/sets'):
                storing = path.endswith('/sets')
                self.authorize(admin=storing)
                source = self.read_json()
                result = service.compile(source, html=path != '/api/v1/validate')
                if path == '/api/v1/validate':
                    return self.respond(200, result)
                html = result.pop('html')
                digest = hashlib.sha256(html.encode()).hexdigest()
                if not storing:
                    return self.respond(200, html, 'text/html; charset=utf-8', {
                        'Content-Disposition': f'attachment; filename="reading-{result["id"][:12]}.html"',
                        'X-Artifact-SHA256': digest,
                    })
                with service.connection() as db:
                    existing = db.execute('SELECT archived FROM question_sets WHERE id=?', (result['id'],)).fetchone()
                    db.execute('''INSERT OR IGNORE INTO question_sets
                        (id,title,created_at,passage_count,question_count,task_count,source,html,html_sha256)
                        VALUES (?,?,?,?,?,?,?,?,?)''', (result['id'], result['title'], datetime.now(timezone.utc).isoformat(),
                        result['passageCount'], result['questionCount'], result['taskCount'], json.dumps(source, ensure_ascii=False), html, digest))
                    db.execute('UPDATE question_sets SET archived=0 WHERE id=?', (result['id'],))
                    stored_digest = db.execute('SELECT html_sha256 FROM question_sets WHERE id=?', (result['id'],)).fetchone()[0]
                return self.respond(200 if existing else 201, {**result, 'created': not bool(existing),
                    'htmlSha256': stored_digest, 'htmlUrl': f'/api/v1/sets/{result["id"]}/html'})
            if path == '/api/v1/sets' and method == 'GET':
                self.authorize(admin=True)
                with service.connection() as db:
                    rows = db.execute('SELECT id,title,created_at,passage_count,question_count,task_count FROM question_sets WHERE archived=0 ORDER BY created_at DESC,id').fetchall()
                return self.respond(200, {'sets': [dict(zip(('id','title','createdAt','passageCount','questionCount','taskCount'), row)) for row in rows]})
            match = re.fullmatch(r'/api/v1/sets/([a-f0-9]{64})(/html)?', path)
            if match and method in ('GET', 'DELETE'):
                self.authorize(admin=True)
                ident, artifact = match.groups()
                with service.connection() as db:
                    row = db.execute('SELECT source,html,html_sha256 FROM question_sets WHERE id=? AND archived=0', (ident,)).fetchone()
                    if row is None:
                        raise ApiError(404, 'not_found', '题目不存在或已归档。')
                    if method == 'DELETE':
                        if artifact:
                            raise ApiError(405, 'method_not_allowed', '请归档题目本身。')
                        db.execute('UPDATE question_sets SET archived=1 WHERE id=?', (ident,))
                if method == 'DELETE':
                    return self.respond(200, {'ok': True, 'archived': True})
                if artifact:
                    return self.respond(200, row[1], 'text/html; charset=utf-8', {
                        'Content-Disposition': f'attachment; filename="reading-{ident[:12]}.html"', 'X-Artifact-SHA256': row[2]})
                return self.respond(200, row[0])
            static = {'/': 'index.html', '/index.html': 'index.html', '/admin': 'admin.html', '/admin.html': 'admin.html',
                      '/reading-engine.js': 'reading-engine.js', '/reading-runtime.html': 'reading-runtime.html'}
            if method == 'GET' and path in static:
                name = static[path]
                mime = 'text/javascript; charset=utf-8' if name.endswith('.js') else 'text/html; charset=utf-8'
                return self.respond(200, (ROOT / 'dist' / name).read_bytes(), mime)
            raise ApiError(404, 'not_found', '接口不存在。')

        def handle_request(self):
            try:
                self.dispatch()
            except ApiError as error:
                self.respond(error.status, {'error': {'code': error.code, 'message': error.message}})
            except (BrokenPipeError, ConnectionResetError):
                pass
            except TimeoutError:
                self.close_connection = True
            except Exception as error:
                # Keep internal paths, SQL and process output out of public responses.
                print(f'Service error: {type(error).__name__}', flush=True)
                self.respond(500, {'error': {'code': 'internal_error', 'message': '服务内部错误，请稍后重试。'}})

        do_GET = do_POST = do_DELETE = handle_request
    return Handler


def create_server(host='127.0.0.1', port=4173, data_dir=None, api_token=None, admin_token=None):
    service = Service(data_dir, api_token, admin_token)
    if host not in ('127.0.0.1', 'localhost', '::1') and not service.api_token:
        raise ValueError('Binding a public interface requires separate API and admin tokens.')
    return ThreadingHTTPServer((host, port), handler_for(service))
