const { test } = require('node:test');
const assert = require('node:assert/strict');
const jc = require('./job-categories');

test('slugify makes kebab-case ids', () => {
  assert.equal(jc.slugify('Box Drop off'), 'box-drop-off');
  assert.equal(jc.slugify('  House  Service! '), 'house-service');
});

test('slugify dedupes against existing ids', () => {
  assert.equal(jc.slugify('Survey', ['survey']), 'survey-2');
  assert.equal(jc.slugify('Survey', ['survey', 'survey-2']), 'survey-3');
});

test('slugify falls back when name has no alphanumerics', () => {
  assert.equal(jc.slugify('!!!'), 'category');
});

test('cleanHex normalizes and rejects bad values', () => {
  assert.equal(jc.cleanHex('#aabbcc'), '#AABBCC');
  assert.equal(jc.cleanHex('red'), null);
  assert.equal(jc.cleanHex(123), null);
});

test('colorMap maps name -> hex', () => {
  const map = jc.colorMap([{ name: 'Survey', color: '#06b6d4' }]);
  assert.equal(map['Survey'], '#06B6D4');
});

test('excludedPnlNames collects only includeInPnl:false', () => {
  const set = jc.excludedPnlNames([
    { name: 'Quick Job', includeInPnl: true },
    { name: 'House Service', includeInPnl: false },
  ]);
  assert.ok(set.has('House Service'));
  assert.ok(!set.has('Quick Job'));
});

test('diffCategories detects rename, delete, and skips system deletes', () => {
  const oldList = [
    { id: 'survey', name: 'Survey' },
    { id: 'house', name: 'House Service' },
    { id: 'unassigned', name: 'Unassigned' },
  ];
  const newList = [
    { id: 'survey', name: 'Site Survey' },     // rename
    { id: 'unassigned', name: 'Unassigned' },  // system, untouched
    // 'house' deleted
  ];
  const { renames, deletes } = jc.diffCategories(oldList, newList);
  assert.deepEqual(renames, [{ oldName: 'Survey', newName: 'Site Survey' }]);
  assert.deepEqual(deletes, ['House Service']);
});

test('validateList rejects empty names, dupes, bad colors', () => {
  const base = jc.buildDefaultList();
  assert.equal(jc.validateList(base, base), null);

  const emptyName = base.map(c => c.id === 'survey' ? { ...c, name: '' } : c);
  assert.match(jc.validateList(emptyName, base), /empty/);

  const dupe = base.concat([{ id: 'x', name: 'quick job', color: '#000000', includeInPnl: true, system: false }]);
  assert.match(jc.validateList(dupe, base), /Duplicate/);

  const badColor = base.map(c => c.id === 'survey' ? { ...c, color: 'blue' } : c);
  assert.match(jc.validateList(badColor, base), /Invalid color/);
});

test('validateList requires system categories present and unrenamed', () => {
  const base = jc.buildDefaultList();
  const missing = base.filter(c => c.id !== 'unassigned');
  assert.match(jc.validateList(missing, base), /Missing required system category/);

  const renamedSystem = base.map(c => c.id === 'unassigned' ? { ...c, name: 'Spare' } : c);
  assert.match(jc.validateList(renamedSystem, base), /Cannot rename system category/);
});

test('buildDefaultList overrides colors from legacy map', () => {
  const list = jc.buildDefaultList({ 'Quick Job': '#123456' });
  assert.equal(list.find(c => c.id === 'quick-job').color, '#123456');
  assert.equal(list.find(c => c.id === 'survey').color, '#06B6D4'); // untouched default
});
