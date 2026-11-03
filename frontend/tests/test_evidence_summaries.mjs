import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
function load(fetch){const exports={};const source=readFileSync(new URL('../lib/evidence-summaries.ts',import.meta.url),'utf8');vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,fetch,encodeURIComponent,Error,require:()=>({API_BASE:'http://local-backend'})});return exports;}
test('GET uses existing backend and exact session without inference',async()=>{let call;const api=load(async(...args)=>{call=args;return {status:404,ok:false,json:async()=>({})};});assert.equal(await api.evidenceSummary('incident-one','sam','session-one'),null);assert.equal(call[1].method,'GET');assert.equal(call[1].headers['X-Client-Session-ID'],'session-one');assert.match(call[0],/^http:\/\/local-backend\/api\/incidents\/incident-one/);});
test('summary generation is explicit POST and propagates safe failure',async()=>{let method;const api=load(async(_,options)=>{method=options.method;return {status:502,ok:false,json:async()=>({detail:'Evidence summary unavailable (API_TIMEOUT).'})};});await assert.rejects(api.evidenceSummary('incident-one','sam','session-one',true),/API_TIMEOUT/);assert.equal(method,'POST');});
test('download reads saved PDF only with the session header',async()=>{let call;const blob={type:'application/pdf'};const api=load(async(...args)=>{call=args;return {ok:true,blob:async()=>blob};});assert.equal(await api.downloadEvidenceSummary('incident-one','temporal','session-one'),blob);assert.match(call[0],/temporal\/pdf$/);assert.equal(call[1].headers['X-Client-Session-ID'],'session-one');assert.equal(call[1].method,undefined);});
test('download fails honestly rather than returning an error page as PDF',async()=>{const api=load(async()=>({ok:false}));await assert.rejects(api.downloadEvidenceSummary('i','sam','s'),/unavailable/);});
