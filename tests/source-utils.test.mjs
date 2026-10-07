import assert from 'node:assert/strict';
import test from 'node:test';
import {csvToText, repairPdfText, selectPassages} from '../greenbot/static/source-utils.mjs';

test('CSV extraction preserves headers and quoted cells', () => {
  assert.equal(csvToText('field,crop,note\nNorth,wheat,"dry, sandy"\n'), 'Row 1 — field: North; crop: wheat; note: dry, sandy');
});

test('passage selection uses matching source text within API budget', () => {
  const source = `${'Unrelated field record.\n'.repeat(180)}Green Plot is in Sahiwal district.`;
  const result = selectPassages(source, 'Where is Green Plot?');
  assert.ok(result.some(item => item.text.includes('Sahiwal')));
  assert.ok(result.reduce((total, item) => total + item.text.length, 0) <= 3000);
});

test('no matching passage returns no facts for large documents', () => {
  assert.deepEqual(selectPassages('Soil record.\n'.repeat(300), 'Which tractor?'), []);
});

test('repairs the broken embedded font used by Zero to One PDF', () => {
  assert.equal(repairPdfText('3UHIDFH\u0003=(52\u000372\u000321(\u0003'), 'Preface ZERO TO ONE ');
  assert.equal(repairPdfText('Ordinary readable text stays intact.'), 'Ordinary readable text stays intact.');
});
