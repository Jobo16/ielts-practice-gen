"""Integration checks for authentication, packaging, persistence and the CLI."""
import hashlib
import json
import os
import subprocess
import tempfile
import threading
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from service import create_server
from build import ROOT


def main():
    api, admin = 'api-test-' + 'a'*32, 'admin-test-' + 'b'*32
    sample = json.loads((ROOT/'examples/community-garden.json').read_text())
    with tempfile.TemporaryDirectory() as folder:
        server = create_server(port=0, data_dir=folder, api_token=api, admin_token=admin)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{server.server_port}'
        def call(path, method='GET', data=None, token=api, expected=200, raw=None, mime='application/json'):
            payload = raw if raw is not None else (json.dumps(data).encode() if data is not None else None)
            req = Request(base+path, data=payload, method=method, headers={'Authorization':'Bearer '+token,'Content-Type':mime})
            try:
                response = urlopen(req)
            except HTTPError as error:
                response = error
            with response:
                body=response.read()
                assert response.status == expected, (path, response.status, body[:300])
                return body, response.headers
        try:
            for path in ('health','agent-guide','content-format','task-layouts','openapi.json','examples'):
                call('/api/v1/'+path,token='')
            call('/admin',token='')
            for path in ('/data/packages.json','/.local/service/reading.sqlite3','/legacy.html'):
                call(path,expected=404)
            call('/api/v1/sets',expected=401)
            call('/api/v1/validate','POST',sample,token='',expected=401)
            value=json.loads(call('/api/v1/validate','POST',sample)[0]);assert value['questionCount']==5 and value['maxMarks']==5
            for file in (ROOT/'examples/types').glob('*.json'):
                call('/api/v1/validate','POST',json.loads(file.read_text()))
            call('/api/v1/validate','POST',{},expected=422)
            call('/api/v1/build','POST',raw=b'{',expected=400)
            call('/api/v1/build','POST',raw=b'PDF',mime='application/pdf',expected=415)
            html,headers=call('/api/v1/build','POST',sample)
            assert hashlib.sha256(html).hexdigest()==headers['X-Artifact-SHA256']
            assert b'__IELTS_PACKAGE_JSON__' not in html
            assert json.loads(call('/api/v1/sets',token=admin)[0])['sets']==[]
            call('/api/v1/sets','POST',sample,expected=401)
            saved=json.loads(call('/api/v1/sets','POST',sample,admin,201)[0]);ident=saved['id']
            assert json.loads(call('/api/v1/sets','POST',sample,admin)[0])['created'] is False
            assert json.loads(call('/api/v1/sets/'+ident,token=admin)[0])==sample
            assert call(saved['htmlUrl'],token=admin)[0]==html
            call('/api/v1/sets/'+ident,'DELETE',token=admin)
            call('/api/v1/sets/'+ident,token=admin,expected=404)
            call('/api/v1/sets','POST',sample,admin)
            env={**os.environ,'READING_SERVER':base,'READING_API_TOKEN':api,'READING_ADMIN_TOKEN':admin}
            cli=['python3',str(ROOT/'scripts/reading_cli.py')]
            outfile=Path(folder)/'practice.html'
            for args in (['guide','--output-dir',str(Path(folder)/'guide')],['validate',str(ROOT/'examples/community-garden.json')],['build',str(ROOT/'examples/community-garden.json'),'-o',str(outfile)],['upload',str(ROOT/'examples/community-garden.json')]):
                subprocess.run(cli+args,env=env,check=True,capture_output=True)
            assert outfile.read_bytes()==html
            bad=Path(folder)/'bad.json';bad.write_text('{}')
            result=subprocess.run(cli+['build',str(bad),'-o',str(outfile)],env=env,capture_output=True)
            assert result.returncode==1 and outfile.read_bytes()==html
        finally:
            server.shutdown();server.server_close()
        restarted=create_server(port=0,data_dir=folder,api_token=api,admin_token=admin)
        threading.Thread(target=restarted.serve_forever,daemon=True).start()
        base=f'http://127.0.0.1:{restarted.server_port}'
        try:
            assert len(json.loads(call('/api/v1/sets',token=admin)[0])['sets'])==1
            assert call(saved['htmlUrl'],token=admin)[0]==html
        finally:
            restarted.shutdown();restarted.server_close()
    print('PASS: HTTP/CLI, key isolation, validation, immutable HTML, idempotency, archive/restore and restart persistence.')

if __name__=='__main__':
    main()
