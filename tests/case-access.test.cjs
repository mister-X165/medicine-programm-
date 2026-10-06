const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const code = ts.transpileModule(fs.readFileSync('src/lib/case-access.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function load(role, owner, share, authenticated = true) {
  const exports = {};
  vm.runInNewContext(code, { exports, require(name) {
    if (name === 'next/server') return { NextResponse: { json: (body, options) => ({ body, ...options }) } };
    if (name === './auth') return { getSessionFromRequest: async () => authenticated ? { doctorId: 'viewer', role } : null };
    if (name === './db') return { db: { case: { findUnique: async () => owner ? { doctorId: owner } : null }, caseShare: { findFirst: async () => share } } };
    throw new Error(name);
  }});
  return exports.requireCaseAccess;
}
test('read and comment shares allow GET but deny every mutation', async () => {
  for (const accessLevel of ['read', 'comment']) {
    const check = load('doctor', 'owner', { accessLevel });
    assert.equal((await check('case', { method: 'GET' })).ok, true);
    for (const method of ['PATCH', 'DELETE', 'POST', 'PUT']) {
      const result = await check('case', { method });
      assert.equal(result.ok, false);
      assert.equal(result.response.status, 403);
    }
    assert.equal((await check('case', { method: 'GET' }, 'share')).ok, false);
  }
});
test('owner and admin can mutate, absent session/share cannot', async () => {
  assert.equal((await load('doctor', 'viewer', null)('case', { method: 'PATCH' })).ok, true);
  assert.equal((await load('admin', 'owner', null)('case', { method: 'DELETE' })).ok, true);
  assert.equal((await load('doctor', 'owner', null)('case', { method: 'GET' })).response.status, 403);
  assert.equal((await load('doctor', 'owner', null, false)('case', { method: 'GET' })).response.status, 401);
  assert.equal((await load('doctor', null, null)('case', { method: 'GET' })).response.status, 404);
});
