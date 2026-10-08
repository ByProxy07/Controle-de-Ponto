import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
const code=ts.transpile(readFileSync(new URL('../src/lib/requestId.ts',import.meta.url),'utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022});
function factory(crypto){const context={exports:{},crypto};runInNewContext(code,context);return context.exports.createRequestId;}
test('usa UUID nativo com o objeto crypto como receptor',()=>{
 const source={randomUUID(){assert.equal(this,source);return 'native-id';}};
 assert.equal(factory(source)(),'native-id');
});
test('sem randomUUID: UUID v4 válido, aleatório e compatível com o PostgreSQL',()=>{
 const make=factory({getRandomValues:bytes=>webcrypto.getRandomValues(bytes)});
 const values=Array.from({length:1000},()=>make());
 assert.equal(new Set(values).size,1000);
 for(const id of values)assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test('sem fonte criptográfica falha claramente, sem usar Math.random',()=>{
 assert.throws(factory(undefined),/geração segura/);
 assert.throws(factory({}),/geração segura/);
});
