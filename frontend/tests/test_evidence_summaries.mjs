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

function mountPanel(api) {
  let cursor=0;
  const slots=[],effects=[],exports={};
  const hooks={
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
    useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
    useEffect(fn,deps){const i=cursor++,previous=slots[i];if(!previous||deps.some((value,index)=>value!==previous.deps[index])){previous?.cleanup?.();const slot={deps};slots[i]=slot;slot.replay=()=>{slot.cleanup=fn();};effects.push(()=>{slot.replay();return slot;});}},
  };
  const source=readFileSync(new URL('../components/dashboard/EvidenceSummaryPanel.tsx',import.meta.url),'utf8')+'\nexport {SessionSummary};';
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports,AbortController,Promise,Date,Error,require:name=>name==='react'?hooks:name==='react/jsx-runtime'?{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}:name==='@/lib/evidence-summaries'?api:{getClientSessionId:()=> 'session-one'}});
  return {render(props={}){cursor=0;const tree=exports.SessionSummary({incidentId:'incident-one',kind:'sam',session:'session-one',ready:true,version:'one',...props});return tree;},runEffects(){return effects.splice(0).map(fn=>fn());}};
}
function nodes(tree){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(nodes);return [tree,...nodes(tree.props?.children)];}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const brief={summary_id:'a'.repeat(64),kind:'sam',body:'Previously saved measured evidence.',model_id:'muse-spark-1.3',provider:'muse',created_at:'2026-11-03T00:00:00Z'};
test('saved summary and PDF remain visible if refresh fails; render does not retry',async()=>{
  const calls=[];const panel=mountPanel({evidenceSummary:async(_id,_kind,_session,generate)=>{calls.push(generate?'POST':'GET');if(generate)throw Error('API_TIMEOUT');return brief;}});
  panel.render();panel.runEffects();await flush();
  const tree=panel.render();panel.runEffects();await flush();
  assert.ok(JSON.stringify(tree).includes(brief.body));assert.ok(JSON.stringify(tree).includes('API_TIMEOUT'));
  assert.ok(nodes(tree).some(n=>n.type==='button'&&n.props.children==='Download summary PDF'));
  assert.deepEqual(calls,['GET','POST']);
});
test('waiting SAM batch restores saved summary without starting inference',async()=>{
  const calls=[];const panel=mountPanel({evidenceSummary:async(_id,_kind,_session,generate)=>{calls.push(generate?'POST':'GET');return brief;}});
  panel.render({ready:false});panel.runEffects();await flush();
  assert.ok(JSON.stringify(panel.render({ready:false})).includes(brief.body));assert.deepEqual(calls,['GET']);
});
test('Strict Mode effect replay starts one summary request',async()=>{
  const calls=[];const panel=mountPanel({evidenceSummary:async(_id,_kind,_session,generate)=>{calls.push(generate?'POST':'GET');return brief;}});
  panel.render();const [effect]=panel.runEffects();effect.cleanup();
  // React replays the same effect with its refs retained.
  effect.replay();await flush();assert.deepEqual(calls,['GET','POST']);
});
