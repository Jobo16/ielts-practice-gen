(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let source = null, pkg = null, generation = 0, saveTail = Promise.resolve();
  function error(message) { $('error').textContent = message; $('error').hidden = false; }
  function download(name, value, type) {
    const url = URL.createObjectURL(new Blob([value], { type }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function install(value, save = true) {
    const revision = ++generation;
    const compiled = ListeningContent.compile(value);
    if (save) { saveTail = saveTail.catch(() => {}).then(() => ListeningImportStore.save(value)); await saveTail; }
    if (revision !== generation) return;
    source = value; pkg = compiled;
    $('error').hidden = true;
    $('title').textContent = pkg.candidate.title;
    $('details').textContent = `${pkg.candidate.parts.length} 个 Part · ${pkg.candidate.responseSlots.length} 个答题位置 · 单文件音频 ${Math.round(source.audio.data.length * 0.75 / 1024 / 1024 * 10) / 10} MiB`;
    $('summary').hidden = false;
  }
  $('import-content').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    try { await install(JSON.parse(await file.text())); } catch (e) { error(`导入失败：${e.message}`); }
  });
  $('sample').onclick = async () => { try { await install(window.__LISTENING_SAMPLE__); } catch (e) { error(e.message); } };
  $('download-sample').onclick = () => download('listening-template.json', JSON.stringify(window.__LISTENING_SAMPLE__, null, 2), 'application/json');
  $('export-json').onclick = () => download('listening-questions.json', JSON.stringify(source, null, 2), 'application/json');
  $('export-html').onclick = () => download('listening-practice.html', ListeningContent.render(pkg, window.__LISTENING_TEMPLATE__), 'text/html');
  $('start').onclick = () => { $('frame').srcdoc = ListeningContent.render(pkg, window.__LISTENING_TEMPLATE__); $('library').hidden = true; $('runner').hidden = false; };
  $('back').onclick = () => { $('runner').hidden = true; $('library').hidden = false; };
  ListeningImportStore.load().then(saved => { if (saved && generation === 0) return install(saved, false); }).catch(e => error(`已保存题目暂时无法载入：${e.message}。可重新导入题目文件。`));
})();
