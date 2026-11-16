import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeNext } from '../../src/next.ts';

const O = 'https://kofferklar.example.org';

test('after sign-in only paths on this site, never another host', () => {
  assert.equal(safeNext('/#/r/abc', O), '/#/r/abc');
  assert.equal(safeNext('/?x=1#/dinge', O), '/?x=1#/dinge');
  for (const bad of [null, '', 'https://evil.example', '//evil.example', '/\\evil.example', '/\t/evil.example', '/\n/evil.example', '/login/', 'javascript:alert(1)', '/.//evil.example', '/..//evil.example/x', '/%2e//evil.example', '/a/..//evil.example']) {
    assert.equal(safeNext(bad, O), '/', String(bad));
  }
});
