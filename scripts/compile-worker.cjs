// JSON in, validated result out. Used by HTTP and CLI; never executes uploaded code.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
global.window = global;
try {
  vm.runInThisContext(fs.readFileSync(path.join(root, 'dist/reading-engine.js'), 'utf8'));
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const pkg = ReadingContent.compile(input);
  const result = {
    id: pkg.manifest.contentVersion,
    title: pkg.candidate.title,
    passageCount: pkg.candidate.parts.length,
    questionCount: pkg.candidate.responseSlots.length,
    taskCount: pkg.candidate.parts.reduce((n, p) => n + p.tasks.length, 0),
    maxMarks: pkg.answerKey.maxMarks,
  };
  if (process.argv.includes('--html')) result.html = ReadingContent.render(pkg, fs.readFileSync(path.join(root, 'dist/reading-runtime.html'), 'utf8'));
  process.stdout.write(JSON.stringify({ ok: true, ...result }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(error.message).slice(0, 4000) }));
}
