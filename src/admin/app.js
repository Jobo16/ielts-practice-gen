(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let token = '', sets = [], selected = null, pending = false;
  function status(message, bad = false) { $('status').textContent = message; $('status').classList.toggle('error', bad); $('status').hidden = false; }
  async function request(path, options = {}) {
    const headers = { ...(options.body ? {'Content-Type':'application/json'} : {}), ...(token ? {Authorization:`Bearer ${token}`} : {}) };
    const response = await fetch(`/api/v1/${path}`, {...options, headers});
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error?.message || `请求失败：${response.status}`);
    }
    return response;
  }
  function content() { return JSON.stringify(JSON.parse($('json').value)); }
  async function action(run) {
    if (pending) return;
    pending = true;
    const controls = [...document.querySelectorAll('.editor button,.editor input,.editor select,.editor textarea,#sets button')];
    controls.forEach(control => control.disabled = true);
    try { await run(); } catch (e) { status(e.message, true); }
    finally { pending = false; controls.forEach(control => control.disabled = false); }
  }
  function saveBlob(name, blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function replaceEditor(value, id = null) {
    $('json').value = JSON.stringify(value, null, 2); selected = id;
    $('archive').hidden = !id;
    $('selection').textContent = id ? `已保存版本 ${id.slice(0,12)} · 编辑后保存为新版本，原题目保留。` : '未保存 · 校验通过后可保存到题库或直接下载 HTML。';
    renderList();
  }
  function renderList() {
    const query = $('search').value.toLowerCase(); $('sets').replaceChildren();
    const visible = sets.filter(item => item.title.toLowerCase().includes(query));
    if (!visible.length) { const p = document.createElement('p'); p.textContent = '暂无匹配题目'; $('sets').append(p); }
    visible.forEach(item => {
      const button = document.createElement('button'); button.className = `set${selected === item.id ? ' active' : ''}`;
      const title = document.createElement('strong'); title.textContent = item.title;
      const detail = document.createElement('small'); detail.textContent = `${item.passageCount} 篇 · ${item.questionCount} 题 · ${item.id.slice(0,8)}`;
      button.append(title, detail); button.onclick = () => action(async () => {
        replaceEditor(await (await request(`sets/${item.id}`)).json(), item.id);
        status('题目已载入。');
      }); $('sets').append(button);
    });
  }
  async function refresh() { sets = (await (await request('sets')).json()).sets; renderList(); $('connection').textContent = `已连接 · ${sets.length} 份题目`; }
  $('connect').onsubmit = event => { event.preventDefault(); token = $('token').value.trim(); action(refresh); };
  $('refresh').onclick = () => action(refresh); $('search').oninput = renderList;
  $('new').onclick = () => { $('json').value = ''; selected = null; $('archive').hidden = true; $('selection').textContent = '粘贴题目 JSON，或载入一个题型示例。'; renderList(); };
  $('file').onchange = event => { const file = event.target.files[0]; event.target.value = ''; if (file) action(async () => { replaceEditor(JSON.parse(await file.text())); status('文件已载入，尚未保存。'); }); };
  $('examples').onchange = event => { const name = event.target.value; if (name) action(async () => { replaceEditor(await (await request(`examples/${name}`)).json()); status('示例已载入，可直接修改。'); }); };
  $('validate').onclick = () => action(async () => { const result = await (await request('validate',{method:'POST',body:content()})).json(); status(`校验通过：${result.passageCount} 篇、${result.questionCount} 题，满分 ${result.maxMarks}。`); });
  $('save').onclick = () => action(async () => {
    const result = await (await request('sets',{method:'POST',body:content()})).json(); selected = result.id; $('archive').hidden = false;
    $('selection').textContent = `已保存版本 ${result.id.slice(0,12)} · 编辑后保存为新版本，原题目保留。`;
    await refresh(); status(result.created ? '题目已保存，HTML 练习包已生成。' : '相同内容已存在，已打开对应版本。');
  });
  $('download').onclick = () => action(async () => { const response = await request('build',{method:'POST',body:content()}); saveBlob('reading-practice.html',await response.blob()); status('HTML 已下载，本次打包未新增题库记录。'); });
  $('source').onclick = () => action(async () => saveBlob('reading-questions.json',new Blob([JSON.stringify(JSON.parse(content()),null,2)],{type:'application/json'})));
  $('preview').onclick = () => action(async () => { const response = await request('build',{method:'POST',body:content()}); $('preview-frame').srcdoc = await response.text(); $('preview-dialog').showModal(); });
  $('close-preview').onclick = () => $('preview-dialog').close();
  $('archive').onclick = () => action(async () => { await request(`sets/${selected}`,{method:'DELETE'}); selected = null; $('archive').hidden = true; await refresh(); status('当前版本已归档。JSON 仍保留在编辑区，重新保存可恢复。'); });
  $('guide').onclick = () => action(async () => { $('guide-text').textContent = await (await request('agent-guide')).text(); $('guide-dialog').showModal(); });
  $('close-guide').onclick = () => $('guide-dialog').close();
  document.querySelectorAll('[data-doc]').forEach(button => button.onclick = () => action(async () => { $('documentation').textContent = await (await request(button.dataset.doc)).text(); }));
  window.addEventListener('message', event => { if (event.source === $('preview-frame').contentWindow && event.data?.type === 'reading-engine.return') $('preview-dialog').close(); });
  (async () => {
    const examples = await (await request('examples')).json();
    examples.examples.forEach(example => { const option = document.createElement('option'); option.value = example.name; option.textContent = example.name; $('examples').append(option); });
    const health = await (await request('health')).json();
    if (!health.authenticationRequired) await refresh(); else $('connection').textContent = '输入后台密钥后连接。';
  })().catch(e => status(e.message, true));
})();
