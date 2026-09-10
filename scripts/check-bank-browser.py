"""Compare every recovered passage DOM and all 17 native task screenshots.

Prerequisites: generate fixtures, serve artifacts/bank-roundtrip on loopback 4175,
then open a playwright-cli session named reading-bank. See bank-verification.md.
"""
import json,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent.parent
wrapper=str(Path.home()/'.codex/skills/playwright/scripts/playwright_cli.sh')
passed=[]
for start in range(1,171,10):
    nums=list(range(start,min(start+10,171)))
    code='''async (page) => {
      for(const n of NUMS){
        const file=String(n).padStart(3,'0');
        await page.goto('http://127.0.0.1:4175/'+file+'.html');
        await page.getByRole('main').waitFor();
        const first=await page.getByRole('main').innerHTML();
        await page.goto('http://127.0.0.1:4175/'+file+'-reference.html');
        await page.getByRole('main').waitFor();
        const second=await page.getByRole('main').innerHTML();
        if(first!==second)throw new Error('DOM mismatch '+file);
      }
    }'''.replace('NUMS',json.dumps(nums))
    result=subprocess.run([wrapper,'-s=reading-bank','run-code',code],cwd=root,text=True,capture_output=True)
    (root/'artifacts/bank-roundtrip'/f'browser-{start:03}.log').write_text(result.stdout+result.stderr)
    if result.returncode or '### Error' in result.stdout:raise RuntimeError(result.stdout+result.stderr)
    passed+=nums
    print(f'Browser DOM comparisons passed: {len(passed)}/170',flush=True)
(root/'artifacts/bank-roundtrip/browser-report.json').write_text(json.dumps({'passages':len(passed),'comparison':'complete main DOM with normalized part/question numbering; native task data vs JSON compiled data'},indent=2))

import json,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent.parent
sources=json.loads((root/'data/library/window-student-library.json').read_text())['sources']
seen=set();cases=[]
for n,s in enumerate(sources,1):
 for index,t in enumerate(s['part']['tasks']):
  key='|'.join(t[k] for k in ['questionType','interactionVariant','layoutVariant'])
  if key not in seen:seen.add(key);cases.append({'file':f'{n:03}','index':index,'type':key})
(root/'output/playwright').mkdir(parents=True,exist_ok=True)
for i,case in enumerate(cases):
 code='''async (page) => {
 const c=CASE;
 await page.goto('http://127.0.0.1:4175/'+c.file+'.html');
 await page.evaluate(()=>document.fonts.ready);
 const a=await page.locator('.question-group').nth(c.index).screenshot({animations:'disabled',path:'output/playwright/type-NUM-import.png'});
 await page.goto('http://127.0.0.1:4175/'+c.file+'-reference.html');
 await page.evaluate(()=>document.fonts.ready);
 const b=await page.locator('.question-group').nth(c.index).screenshot({animations:'disabled',path:'output/playwright/type-NUM-reference.png'});
 if(!a.equals(b))throw new Error('Pixel mismatch '+c.type);
 }'''.replace('CASE',json.dumps(case)).replace('NUM',str(i+1))
 r=subprocess.run([wrapper,'-s=reading-bank','run-code',code],cwd=root,capture_output=True,text=True)
 if r.returncode or '### Error' in r.stdout:raise RuntimeError(r.stdout+r.stderr)
 print(f'Pixel comparison passed: {i+1}/17 {case["type"]}',flush=True)
(root/'artifacts/bank-roundtrip/visual-report.json').write_text(json.dumps({'all17TypeScreenshotsIdentical':True,'cases':cases},indent=2))
