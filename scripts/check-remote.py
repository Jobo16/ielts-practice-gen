"""Verify every prepared JSON fixture through the deployed API; never stores bank entries."""
import concurrent.futures
import hashlib
import gzip
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

root=Path(__file__).resolve().parent.parent
server=os.environ['READING_SERVER'].rstrip('/')
token=os.environ['READING_API_TOKEN']
folder=root/'artifacts/bank-roundtrip'
report=json.loads((folder/'report.json').read_text())

def call(path, data=None, auth=True):
    headers={'Content-Type':'application/json','Accept-Encoding':'gzip'}
    if auth:headers['Authorization']='Bearer '+token
    with urlopen(Request(server+path,data=data,headers=headers),timeout=90) as response:
        body=response.read()
        if response.headers.get('Content-Encoding')=='gzip': body=gzip.decompress(body)
        return body,response.headers

health=json.loads(call('/api/v1/health',auth=False)[0]);assert health['authenticationRequired']
for path in ('/api/v1/sets','/api/v1/build'):
    try:
        call(path,b'{}' if path.endswith('build') else None,auth=False)
        raise AssertionError('Unauthenticated request accepted')
    except HTTPError as e:assert e.code==401
try:
    call('/api/v1/sets')
    raise AssertionError('API key can read admin library')
except HTTPError as e:assert e.code==401

def verify(case):
    source=(folder/(case['file']+'.json')).read_bytes()
    validation=json.loads(call('/api/v1/validate',source)[0]);assert validation['ok']
    html,headers=call('/api/v1/build',source)
    digest=hashlib.sha256(html).hexdigest()
    assert digest==case['sha256']==headers['X-Artifact-SHA256'],case['file']
    assert html==(folder/(case['file']+'.html')).read_bytes(),case['file']
    return {'file':case['file'],'sha256':digest,'questions':validation['questionCount']}

results=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    for result in pool.map(verify,report['cases']):
        results.append(result)
        if len(results)%10==0:print(f'Public JSON → HTML byte equality: {len(results)}/170',flush=True)
output={'server':server,'passages':len(results),'questions':sum(c['questions'] for c in results),'allHtmlBytesEqual':True,'authenticationChecksPassed':True,'cases':results}
(folder/'remote-report.json').write_text(json.dumps(output,indent=2)+'\n')
print('PASS: all public artifacts exactly match local HTML.')
