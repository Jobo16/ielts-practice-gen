// Full recovered-bank regression. Local artifacts only; never adds the bank to public examples.
const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict'), crypto=require('node:crypto');
global.window=global;
vm.runInThisContext(fs.readFileSync('dist/reading-engine.js','utf8'));
const sources=JSON.parse(fs.readFileSync('data/library/window-student-library.json')).sources;
const template=fs.readFileSync('dist/reading-runtime.html','utf8');
const folder='artifacts/bank-roundtrip';fs.mkdirSync(folder,{recursive:true});
const report={passages:0,tasks:0,responses:0,types:[],exactOriginalImports:0,evidenceDifferences:[],cases:[]};const types=new Set();
function clean(value){
 if(Array.isArray(value))return value.map(clean);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['displayNumber','heading','ordinal','label'].includes(k)).map(([k,v])=>[k,clean(v)]));
 return value;
}
for(const [position,s] of sources.entries()){
 const author={schemaVersion:'reading-set.v1',title:s.title,parts:[structuredClone(s.part)],responseSlots:structuredClone(s.responseSlots),scoreSlots:structuredClone(s.scoreSlots),reviewEntries:structuredClone(s.reviewEntries),assets:s.assets||[]};
 try{ReadingContent.compile(author);report.exactOriginalImports++;}catch(e){
   if(!/引文|startOffset/.test(e.message))throw e;
 }
 // Preserve the original review quotation and explanation. An editorial quotation can
 // remain visible as context without pretending it is an exact selectable substring.
 for(const entry of author.reviewEntries){
   for(const evidence of entry.evidence||[]){
     const block=s.part.passage.blocks.find(b=>b.blockId===evidence.blockId);
     if(evidence.quote && !block.text.includes(evidence.quote)){
       report.evidenceDifferences.push({passageId:s.passageId,scoreSlotId:entry.scoreSlotId,blockId:evidence.blockId,reason:'Editorial quote is not an exact source substring'});
       evidence.anchor=false;delete evidence.startOffset;
     }else if(evidence.quote && block.text.indexOf(evidence.quote)!==block.text.lastIndexOf(evidence.quote) && evidence.startOffset===undefined){
       report.evidenceDifferences.push({passageId:s.passageId,scoreSlotId:entry.scoreSlotId,blockId:evidence.blockId,reason:'Repeated quote; left as editorial context rather than guessing an anchor'});
       evidence.anchor=false;
     }
   }
 }
 const pkg=ReadingContent.compile(author);
 assert.deepEqual(pkg.candidate.parts[0].passage,s.part.passage,'Passage text/labels changed');
 assert.deepEqual(clean(pkg.candidate.parts[0].tasks),clean(s.part.tasks),'Task structure changed');
 assert.deepEqual(clean(pkg.candidate.responseSlots),clean(s.responseSlots));
 assert.deepEqual(pkg.answerKey.scoreSlots,s.scoreSlots,'Answers changed');
 assert.deepEqual(pkg.review.entries,author.reviewEntries,'Reviews changed');
 const baseline={manifest:pkg.manifest,candidate:{...pkg.candidate,parts:[s.part],responseSlots:s.responseSlots},answerKey:{maxMarks:pkg.answerKey.maxMarks,scoreSlots:s.scoreSlots},review:{entries:s.reviewEntries}};
 const before=IELTSV2Core.indexPackage(baseline),after=IELTSV2Core.indexPackage(pkg);
 const states=[{},Object.fromEntries(s.responseSlots.map(r=>[r.responseSlotId,'__wrong__']))];
 for(const score of s.scoreSlots){
   for(const accepted of score.accepted){
     const values={};
     if(score.evaluation==='atomic-unordered-text-set'){
       const members=[...new Map(score.accepted.map(a=>[a.setMemberId,a.value])).values()];
       score.responseSlotIds.forEach((id,i)=>values[id]=members[i]);
     }else score.responseSlotIds.forEach(id=>values[id]=accepted.value);
     states.push(values);
   }
 }
 for(const values of states)assert.deepEqual(IELTSV2Core.scoreAll(after,values),IELTSV2Core.scoreAll(before,values));
 const filename=String(position+1).padStart(3,'0');const html=ReadingContent.render(pkg,template);
 fs.writeFileSync(`${folder}/${filename}.json`,JSON.stringify(author));
 fs.writeFileSync(`${folder}/${filename}.html`,html);
 // Baseline uses unchanged native task/answer data and the same generic shell, so
 // browser comparison isolates JSON compilation from intentional original-shell changes.
 const visualBaseline=structuredClone(baseline);
 visualBaseline.candidate.parts[0].ordinal=pkg.candidate.parts[0].ordinal; visualBaseline.candidate.parts[0].label=pkg.candidate.parts[0].label;
 visualBaseline.candidate.parts[0].tasks.forEach((t,i)=>t.heading=pkg.candidate.parts[0].tasks[i].heading);
 visualBaseline.candidate.responseSlots.forEach((r,i)=>r.displayNumber=pkg.candidate.responseSlots[i].displayNumber);
 fs.writeFileSync(`${folder}/${filename}-reference.html`,ReadingContent.render({...visualBaseline,readingContent:pkg.readingContent},template));
 report.cases.push({file:filename,passageId:s.passageId,sha256:crypto.createHash('sha256').update(html).digest('hex'),scoringStates:states.length});
 s.part.tasks.forEach(t=>types.add([t.questionType,t.interactionVariant,t.layoutVariant].join('|')));
 report.passages++;report.tasks+=s.part.tasks.length;report.responses+=s.responseSlots.length;
}
report.types=[...types];assert.equal(types.size,17);assert.equal(report.responses,2263);
fs.writeFileSync(`${folder}/report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({passages:report.passages,tasks:report.tasks,responses:report.responses,types:types.size,exactOriginalImports:report.exactOriginalImports,evidenceDifferences:report.evidenceDifferences.length,scoringStates:report.cases.reduce((n,c)=>n+c.scoringStates,0)}));
