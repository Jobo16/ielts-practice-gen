(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let source = null, pkg = null;
  function error(message) { $('error').textContent = message; $('error').hidden = false; }
  let generation = 0;
  let saveTail = Promise.resolve();
  async function install(value, save = true) {
    const revision = ++generation;
    const compiled = ReadingContent.compile(value);
    // Commit only after validation. A failed import retains the current exercise.
    if (save) {
      saveTail = saveTail.catch(() => {}).then(() => ReadingImportStore.save(value));
      await saveTail;
    }
    if (revision !== generation) return;
    source = value; pkg = compiled;
    $('error').hidden = true;
    $('title').textContent = pkg.candidate.title;
    $('details').textContent = `${pkg.candidate.parts.length} 篇文章 · ${pkg.candidate.responseSlots.length} 道题 · ${pkg.candidate.parts.reduce((n,p) => n+p.tasks.length,0)} 个题型任务`;
    $('summary').hidden = false;
  }
  function download(name, value, type) {
    const url = URL.createObjectURL(new Blob([value], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('import-content').addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try { await install(JSON.parse(await file.text())); }
    catch (e) { error(`导入失败：${e.message}`); }
  });
  $('sample').onclick = async () => { try { await install(window.__READING_SAMPLE__); } catch(e) { error(e.message); } };
  $('download-sample').onclick = () => download('community-garden.json', JSON.stringify(window.__READING_SAMPLE__, null, 2), 'application/json');
  $('export-json').onclick = () => download('reading-questions.json', JSON.stringify(source, null, 2), 'application/json');
  $('export-html').onclick = () => download('reading-practice.html', ReadingContent.render(pkg, window.__READING_TEMPLATE__), 'text/html');
  $('start').onclick = () => {
    $('frame').srcdoc = ReadingContent.render(pkg, window.__READING_TEMPLATE__);
    $('library').hidden = true; $('runner').hidden = false;
  };
  // Keep the live iframe mounted, so leaving never races the runtime's save debounce.
  $('back').onclick = () => { $('runner').hidden = true; $('library').hidden = false; };
  window.addEventListener('message', event => {
    if (event.source === $('frame').contentWindow && event.data?.type === 'reading-engine.return') $('back').click();
  });
  ReadingImportStore.load().then(saved => { if (saved && generation === 0) return install(saved, false); })
    .catch(e => error(`已保存题目暂时无法载入：${e.message}。可重新导入题目文件。`));
})();
