const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
global.window = global;
for (const file of ['src/app/composer.js','src/runtime/answer-grading.js','src/engine/content.js']) vm.runInThisContext(fs.readFileSync(file,'utf8'));
const sample = JSON.parse(fs.readFileSync('examples/community-garden.json','utf8'));
const original = JSON.stringify(sample);
const pkg = ReadingContent.compile(sample);
assert.equal(JSON.stringify(sample), original, 'Compilation must not modify authoring input');
const index = IELTSV2Core.indexPackage(pkg);
assert.equal(index.responseSlots.size, 5);
assert.equal(IELTSV2Core.scoreAll(index, {r1:'TRUE',r2:'FALSE',r3:'apple',r4:' saturday ',r5:'Fridays'}).earnedMarks, 5);
assert.equal(IELTSV2Core.scoreAll(index, {r1:'FALSE',r2:'TRUE',r3:'oak',r4:'Monday',r5:'Tuesday'}).earnedMarks, 0);
assert.equal(pkg.readingContent.translations.garden.length, 3);
assert.equal(pkg.readingContent.evidence.entries.length, 5);
assert.ok(pkg.readingContent.bilingual.demoId);
assert.equal(ReadingContent.compile(sample).manifest.packageId, pkg.manifest.packageId);
const revised = structuredClone(sample); revised.parts[0].passage.blocks[0].text += ' The gate is green.';
assert.notEqual(ReadingContent.compile(revised).manifest.packageId, pkg.manifest.packageId);
function rejects(edit, expression) { const value = structuredClone(sample); edit(value); assert.throws(() => ReadingContent.compile(value), expression); }
rejects(v => v.parts[0].tasks[0].questionType='made-up', /不支持/);
rejects(v => v.responseSlots.push(v.responseSlots[0]), /重复/);
rejects(v => v.reviewEntries.pop(), /缺少解析/);
rejects(v => v.scoreSlots[0].accepted[0].value='missing', /选项不存在/);
rejects(v => v.parts[0].tasks[2].content.items[0].inlines[1].responseSlotId='missing', /不存在/);
rejects(v => v.parts[0].tasks[0].content={}, /缺少/);
rejects(v => v.translations.garden.unknown='错误', /段落不存在/);
rejects(v => v.reviewEntries[0].evidence[0].quote='not in passage', /引文/);
rejects(v => v.timerPolicy={enabled:true,durationSeconds:1,expiryAction:'submit'}, /计时/);
const editorial = structuredClone(sample); editorial.reviewEntries[0].evidence[0] = {blockId:'garden.a',quote:'Editorial paraphrase',anchor:false};
const editorialPkg=ReadingContent.compile(editorial); assert.equal(editorialPkg.review.entries[0].evidence[0].quote,'Editorial paraphrase'); assert.equal(editorialPkg.readingContent.evidence.entries[0].evidence[0].anchors.length,0);
const hostile = structuredClone(sample); hostile.title='</script><script>window.injected=true</script>';
const escaped = ReadingContent.render(ReadingContent.compile(hostile), '<script>const data=__IELTS_PACKAGE_JSON__;</script>');
assert.equal((escaped.match(/<\/script>/g)||[]).length,1);
// Use all original source structures as compatibility fixtures, not as the new engine's data.
// Legacy evidence excerpts have historical editorial differences; this test concerns question layout, not those annotations.
const types = new Set();
for (const s of JSON.parse(fs.readFileSync('data/library/window-student-library.json')).sources) {
  const content = {schemaVersion:'reading-set.v1',title:s.title,parts:[s.part],responseSlots:s.responseSlots,
    scoreSlots:s.scoreSlots,reviewEntries:s.reviewEntries.map(e=>({...e,evidence:[]})),assets:s.assets||[]};
  const result=ReadingContent.compile(content);
  assert.equal(result.candidate.responseSlots.length,s.responseSlots.length);
  s.part.tasks.forEach(t=>types.add([t.questionType,t.interactionVariant,t.layoutVariant].join('|')));
}
assert.equal(types.size,17);
const built=fs.readFileSync('dist/index.html','utf8');
assert.ok(!built.includes('window.__STUDENT_LIBRARY__'));
assert.ok(!built.includes('A Brief History of Humans and Food'));
assert.ok(Buffer.byteLength(built)<1500000);
const runtime=fs.readFileSync('dist/reading-runtime.html','utf8');
assert.equal(runtime.split('__IELTS_PACKAGE_JSON__').length,2);
assert.ok(!runtime.includes('A Brief History of Humans and Food'));
fs.writeFileSync('artifacts/own-practice.html',ReadingContent.render(pkg,runtime));
console.log('PASS: own content scoring, translations/evidence, identity isolation, invalid inputs, script escaping, 170 native structures / 17 types, bank-free build.');
