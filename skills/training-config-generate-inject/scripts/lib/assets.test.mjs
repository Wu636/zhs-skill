import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAssetsManifest} from './assets.mjs';
test('rejects duplicate or missing stage bindings before writes',()=>{
 assert.throws(()=>validateAssetsManifest({stages:[{stepName:'a',backgroundPath:'/x'},{stepName:'a',backgroundPath:'/y'}]},['a','b']),/阶段/);
});
test('requires exact stage names and absolute source files',()=>{
 assert.throws(()=>validateAssetsManifest({stages:[{stepName:'a',backgroundPath:'x'}]},['a']),/绝对/);
 assert.equal(validateAssetsManifest({stages:[{stepName:'a',backgroundPath:'/x',resources:[]}]},['a']).length,1);
});
