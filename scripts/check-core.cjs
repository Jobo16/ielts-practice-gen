// Exercise every recovered passage and task through the real composer and grader.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
global.window = global;
vm.runInThisContext(fs.readFileSync('src/app/composer.js', 'utf8'));
vm.runInThisContext(fs.readFileSync('src/runtime/answer-grading.js', 'utf8'));
const library = JSON.parse(fs.readFileSync('data/library/window-student-library.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('data/manifest/window-student-manifest.json', 'utf8'));
const runtime = fs.readFileSync(process.argv[2], 'utf8');
const core = global.IELTSTeacherComposerCore;
const grader = global.IELTSV2Core;
assert.equal(library.passages.length, 170);
assert.equal(new Set(library.passages.map(p => p.passageId)).size, 170);
assert.deepEqual(new Set(library.sources.map(p => p.passageId)), new Set(library.passages.map(p => p.passageId)));
assert.deepEqual(new Set(manifest.passages.map(p => p.passageId)), new Set(library.passages.map(p => p.passageId)));
let questionCount = 0;
let taskCount = 0;
function assemble(selections, compositionMode = 'full-passage') {
  return core.assembleHomework({
    schemaVersion: core.HOMEWORK_REQUEST_V1,
    mode: 'homework', title: 'Reconstruction verification', compositionMode,
    selections, reviewMode: 'full-review',
  }, library);
}
for (const passage of library.passages) {
  const pkg = assemble([{passageId: passage.passageId, scope: 'full'}]);
  core.assertPublicPackage(pkg);
  const index = grader.indexPackage(pkg);
  const blank = grader.scoreAll(index, {});
  assert.equal(index.responseSlots.size, passage.questionCount, passage.title);
  assert.equal(blank.earnedMarks, 0, passage.title);
  assert.equal(blank.availableMarks, passage.maxMarks, passage.title);
  assert.equal(blank.unanswered, index.scoreSlots.size, passage.title);
  assert.equal(index.reviews.size, index.scoreSlots.size, passage.title);
  questionCount += index.responseSlots.size;
  for (const task of passage.composition.taskGroups) {
    const drill = assemble([{passageId: passage.passageId, scope: 'task', taskIds: [task.taskId]}], 'task-drill');
    assert.equal(grader.indexPackage(drill).responseSlots.size, task.responseCount, task.taskId);
    taskCount += 1;
  }
}
assert.equal(questionCount, 2263);
const sample = [1, 2, 3].map(position => library.passages.find(p => p.passagePosition === position));
const mock = assemble(sample.map(p => ({passageId: p.passageId, scope: 'full'})));
assert.equal(grader.indexPackage(mock).responseSlots.size, 40);
const html = core.renderStudentHtml(mock, runtime);
assert.ok(!html.includes('__IELTS_PACKAGE_JSON__'));
assert.throws(() => core.renderStudentHtml(mock, runtime + '__IELTS_PACKAGE_JSON__'));
console.log(`PASS: 170 full passages, ${taskCount} task drills, ${questionCount} response slots, blank grading/review closure, 40-question composition.`);
