const assert = require('node:assert/strict');
const fs = require('node:fs');
const capabilities = JSON.parse(fs.readFileSync('docs/agent-capabilities.json', 'utf8'));
const layouts = JSON.parse(fs.readFileSync('docs/task-layouts.json', 'utf8'));
const catalog = fs.readFileSync('docs/agent-task-catalog.md', 'utf8');
const catalogIds = new Set([...catalog.matchAll(/`([^`]+)`/g)].map(match => match[1].replace(/\s*\|\s*/g, '|')));
assert.equal(capabilities.schemaVersion, 'ielts-content-agent.v1');
assert.equal(capabilities.taskTypes.length, Object.keys(layouts).length);
for (const entry of capabilities.taskTypes) {
  assert.ok(layouts[entry.id], `capability references an unknown task type: ${entry.id}`);
  assert.ok(catalogIds.has(entry.id), `catalog omits task type: ${entry.id}`);
}
for (const key of ['humanGuide', 'machineManifest', 'taskCatalog', 'readingFormat', 'listeningFormat', 'taskLayouts', 'examples']) {
  assert.equal(typeof capabilities.discovery[key], 'string', `discovery.${key} is required`);
}
assert.ok(capabilities.authoringRules.some(rule => rule.includes('responseSlot')));
console.log('PASS: Agent discovery contract covers every supported task type.');
