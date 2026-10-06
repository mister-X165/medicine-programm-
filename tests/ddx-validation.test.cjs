const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const exportsForTest = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/ddx-validation.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: exportsForTest, require });
const schema = exportsForTest.ddxAuditSchema;
const valid = { diagnoses: ['A', 'B', 'C'].map(diagnosis => ({ diagnosis })), workupPlan: [], therapyOptions: [] };
test('accepts valid audit and reordered hypotheses', () => {
  assert.equal(schema.safeParse(valid).success, true);
  assert.equal(schema.safeParse({ ...valid, diagnoses: [...valid.diagnoses].reverse() }).success, true);
});
test('rejects missing sections, invalid field types and incomplete diagnoses', () => {
  for (const value of [null, {}, { diagnoses: valid.diagnoses }, { ...valid, diagnoses: [null, {}, 42] }, { ...valid, diagnoses: [{ diagnosis: 'A', icd10: 42 }, ...valid.diagnoses] }, { ...valid, therapyOptions: [null] }, { ...valid, workupPlan: [{ name: 'test', purpose: 42 }] }]) {
    assert.equal(schema.safeParse(value).success, false);
  }
});
