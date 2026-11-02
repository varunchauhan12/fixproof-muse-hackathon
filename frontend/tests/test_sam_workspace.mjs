import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../package.json',import.meta.url));
const ts=require('typescript');
const compile=path=>ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const candidate={candidate_id:'candidate-1',incident_id:'incident-1',frame_match_index:2,rank:1,status:'CONFIRMED_MATCH',confirmed:true,l2_distance:.2,reference:{asset_id:'ref',frame_id:17,filename:'ref.jpg',timestamp_sec:3},suspect:{asset_id:'suspect',frame_id:4,filename:'sus.jpg',timestamp_sec:8}};
const observation=(target)=>({association:{...candidate[target],incident_id:candidate.incident_id,candidate_id:candidate.candidate_id,frame_match_index:candidate.frame_match_index,target},status:'VALIDATED',objects:[],model_id:'sam-3.1',image_sha256:'00'.repeat(32)});
const result=()=>({candidate,targets:{reference:observation('reference'),suspect:observation('suspect')}});
function clientFixture(handler=async()=>new Response(JSON.stringify(result()),{status:200})) {
 const out={},calls=[];
 vm.runInNewContext(compile('../lib/sam-workspace.ts'),{exports:out,require:()=>({API_BASE:'http://offline.invalid'}),fetch:async(...args)=>{calls.push(args);return handler(...args);},Error});
 return {api:out,calls,client:new out.SAMWorkspaceClient('session-test')};
}
const nodes=tree=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...nodes(tree.props?.children)];
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function mountedWorkspace(items=[candidate], tabActive=true) {
 let active,cursor=0;const states=new Map(),effectQueue=[],calls=[];let failure=false;
 const hooks={useCallback(fn,deps){return hooks.useMemo(()=>fn,deps);},useState(initial){const i=cursor++;const slots=active;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},useRef(initial){const i=cursor++;if(!(i in active))active[i]={current:initial};return active[i];},useMemo(fn,deps){const i=cursor++;if(!active[i]||deps.some((d,j)=>!Object.is(d,active[i].deps[j])))active[i]={deps,value:fn()};return active[i].value;},useEffect(fn,deps){const i=cursor++;if(!active[i]||deps.some((d,j)=>!Object.is(d,active[i][j]))){active[i]=deps;effectQueue.push(fn);}}};
 const real=clientFixture().api;
 class Client {async automatic(c,retry){calls.push([c,retry]);if(failure)throw new Error('Safe failure');const data={...result(),candidate:c};for(const target of ['reference','suspect'])data.targets[target].association={...c[target],incident_id:c.incident_id,candidate_id:c.candidate_id,frame_match_index:c.frame_match_index,target};return data;}async queue(){return items;}async investigate(c,p){calls.push([c,p]);if(failure)throw new Error('Safe failure');return {...result(),candidate:c};}async frame(){return new Blob(['image']);}}
 const out={};vm.runInNewContext(compile('../components/dashboard/SAMInvestigationWorkspace.tsx'),{exports:out,require:name=>name==='react'?hooks:name==='react/jsx-runtime'?{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}:name==='@/lib/api'?{getClientSessionId:()=> 'session-test'}:name==='@/lib/forensic-evidence'?{evidenceTime:v=>`${v}s`}:{...real,SAMWorkspaceClient:Client},AbortController,crypto:{subtle:{digest:async()=>new ArrayBuffer(32)}},window:{addEventListener(){},removeEventListener(){}},Error,URL:{createObjectURL:()=> 'blob:offline',revokeObjectURL(){}},Image:class {set src(value){this.naturalWidth=640;this.naturalHeight=320;this.onload?.();}}});
 const render=(fn,props)=>{if(!states.has(fn))states.set(fn,[]);active=states.get(fn);cursor=0;const tree=fn(props);while(effectQueue.length)effectQueue.shift()();return tree;};
 const outer=render(out.SAMInvestigationWorkspace,{incidentId:'incident-1',active:tabActive});
 return {render:()=>render(outer.type,outer.props),renderFrame:(fn,props)=>render(fn,props),calls,setFailure:v=>failure=v};
}
test('coordinate validation rejects nonfinite, out-of-range, inverted and inconsistent boxes',()=>{
 const {api}=clientFixture();const b={x1:64,y1:32,x2:320,y2:160,w:640,h:320};assert.deepEqual(Array.from(api.validatedBox(b)),[.1,.1,.5,.5]);
 for(const change of [{x1:NaN},{x2:Infinity},{x1:-1},{x2:641},{x2:10},{w:0},{normalized_coords:[0,0,1,1]}])assert.equal(api.validatedBox({...b,...change}),null);
 assert.deepEqual(Array.from(api.validatedBox({normalized_coords:[.1,.2,.3,.4]})),[.1,.2,.3,.4]);assert.equal(api.validatedBox([.1,.2,.3,.4]),null);
});
test('unsupported masks are preserved as metadata, never decoded into invented shapes',()=>{const{api}=clientFixture();assert.match(api.maskState({encoding:'lossless_base85',raw_payload:'original',decoding_status:'RAW_PRESERVED'}),/rendering unavailable/);assert.equal(api.maskState(null),'No mask returned');});
test('result associations reject another candidate, target, frame or timestamp',()=>{const{api}=clientFixture();assert.ok(api.observationMatches(candidate,'reference',observation('reference')));for(const field of ['candidate_id','asset_id','filename','frame_id','timestamp_sec','frame_match_index','target']){const obs=observation('reference');obs.association[field]='wrong';assert.equal(api.observationMatches(candidate,'reference',obs),false);}});
test('double submission shares one promise and attaches the existing session header',async()=>{
 let release;const f=clientFixture(()=>new Promise(resolve=>release=()=>resolve(new Response(JSON.stringify(result())))));
 const a=f.client.investigate(candidate,'person'),b=f.client.investigate(candidate,'person');assert.equal(a,b);assert.equal(f.calls.length,1);assert.equal(f.calls[0][1].headers['X-Client-Session-ID'],'session-test');release();await a;
});
test('provider/HTTP failures are not automatically retried',async()=>{const f=clientFixture(async()=>new Response('private failure',{status:500}));await assert.rejects(f.client.investigate(candidate,'person'),/failed \(500\)/);assert.equal(f.calls.length,1);});
test('malformed association is rejected before display',async()=>{const data=result();data.targets.reference.association.asset_id='other';const f=clientFixture(async()=>new Response(JSON.stringify(data)));await assert.rejects(f.client.investigate(candidate,'person'),/association failed/);});
test('missing prompt makes no request',async()=>{const f=clientFixture();await assert.rejects(f.client.investigate(candidate,' '));assert.equal(f.calls.length,0);});
test('real SAM component loads a queue without inference and handles empty candidates',async()=>{const f=mountedWorkspace([]);assert.ok(nodes(f.render()).some(n=>n.props?.role==='status'));await tick();assert.ok(nodes(f.render()).some(n=>n.props?.children==='No CV candidate pairs are available for SAM investigation.'));assert.equal(f.calls.length,0);});
test('SAM preloads all matches and browsing uses the correct prepared result',async()=>{
 const alt={...candidate,candidate_id:'candidate-2',reference:{...candidate.reference,frame_id:18}};
 const f=mountedWorkspace([candidate,alt]);f.render();await tick();let tree=f.render();await tick();tree=f.render();
 assert.equal(f.calls.length,2);
 assert.equal(nodes(tree).filter(n=>n.type==='input'&&n.props.placeholder==='Describe the object to localize').length,0);
 nodes(tree).find(n=>n.type==='select').props.onChange({target:{value:'candidate-2'}});tree=f.render();
 assert.ok(nodes(tree).filter(n=>typeof n.type==='function').every(n=>n.props.observation.association.candidate_id==='candidate-2'));
 await tick();f.render();assert.equal(f.calls.length,2);
});
test('automatic failures do not loop; retry is explicit',async()=>{
 const f=mountedWorkspace();f.setFailure(true);f.render();await tick();f.render();await tick();let tree=f.render();
 assert.equal(f.calls.length,1);assert.ok(nodes(tree).some(n=>n.props?.role==='alert'));
 f.render();await tick();assert.equal(f.calls.length,1);
 f.setFailure(false);await nodes(tree).find(n=>n.type==='button'&&n.props.children==='Retry object investigation').props.onClick();assert.equal(f.calls.length,2);
});
test('actual overlay uses image-sized SVG viewBox and exact normalized coordinates',async()=>{
 const f=mountedWorkspace();f.render();await tick();const tree=f.render();const frame=nodes(tree).find(n=>typeof n.type==='function');const obs={...observation('reference'),original_dimensions:{width:640,height:320},objects:[{object_id:4,label:'prompt concept',box:{x1:64,y1:32,x2:320,y2:160,w:640,h:320}}]};
 f.renderFrame(frame.type,{...frame.props,observation:obs});await tick();const view=f.renderFrame(frame.type,{...frame.props,observation:obs});const svg=nodes(view).find(n=>n.type==='svg');assert.equal(svg.props.viewBox,'0 0 640 320');const box=nodes(view).find(n=>n.type==='rect');assert.equal(box.props.x,64);assert.equal(box.props.y,32);assert.equal(box.props.width,256);assert.equal(box.props.height,128);
});

test('overlays reject content-hash mismatch and dimension mismatch',async()=>{
 for(const change of [{image_sha256:'mismatch'},{original_dimensions:{width:320,height:320}}]) {
  const f=mountedWorkspace();f.render();await tick();const tree=f.render();const frame=nodes(tree).find(n=>typeof n.type==='function');
  const obs={...observation('reference'),original_dimensions:{width:640,height:320},objects:[{object_id:4,label:'concept',box:{x1:64,y1:32,x2:320,y2:160,w:640,h:320}}],...change};
  f.renderFrame(frame.type,{...frame.props,observation:obs});await tick();const view=f.renderFrame(frame.type,{...frame.props,observation:obs});assert.equal(nodes(view).filter(n=>n.type==='rect').length,0);
 }
});
test('overlay visibility control hides actual returned boxes',async()=>{
 const f=mountedWorkspace();f.render();await tick();const tree=f.render();const frame=nodes(tree).find(n=>typeof n.type==='function');
 const obs={...observation('reference'),original_dimensions:{width:640,height:320},objects:[{object_id:4,label:'concept',box:{x1:64,y1:32,x2:320,y2:160,w:640,h:320}}]};
 f.renderFrame(frame.type,{...frame.props,observation:obs});await tick();let view=f.renderFrame(frame.type,{...frame.props,observation:obs});assert.equal(nodes(view).filter(n=>n.type==='rect').length,1);nodes(view).find(n=>n.type==='input').props.onChange({target:{checked:false}});view=f.renderFrame(frame.type,{...frame.props,observation:obs});assert.equal(nodes(view).filter(n=>n.type==='rect').length,0);
});

test('hidden SAM tab never initiates automatic inference',async()=>{
 const f=mountedWorkspace([candidate],false);f.render();await tick();f.render();await tick();assert.equal(f.calls.length,0);
});
test('automatic client deduplicates concurrent requests',async()=>{
 let release;const f=clientFixture(()=>new Promise(resolve=>release=()=>resolve(new Response(JSON.stringify(result())))));
 const first=f.client.automatic(candidate),second=f.client.automatic(candidate);assert.equal(first,second);assert.equal(f.calls.length,1);release();await first;
});

test('automatic failure exposes only allowlisted diagnostic category',async()=>{
 const f=clientFixture(async()=>new Response(JSON.stringify({detail:'private server content'}),{status:502,headers:{'X-SAM-Failure-Code':'TOKEN_BUDGET_EXHAUSTED'}}));
 await assert.rejects(f.client.automatic(candidate),error=>error.message.includes('TOKEN_BUDGET_EXHAUSTED')&&!error.message.includes('private server content'));
 assert.equal(f.calls.length,1);
});

test('batch prepares all pairs with two workers and keeps going after one failure',async()=>{
 const {api}=clientFixture();const queue=Array.from({length:5},(_,i)=>({...candidate,candidate_id:`candidate-${i}`}));
 const resolvers=[];let active=0,peak=0;const completed=[],errors=[],started=[];
 const client={automatic:async c=>{active++;peak=Math.max(peak,active);try{return await new Promise((resolve,reject)=>resolvers.push(()=>c.candidate_id==='candidate-2'?reject(new Error('test failure')):resolve(result())));}finally{active--;}}};
 const controller=new AbortController();
 const batch=api.processSAMQueue(client,queue,{signal:controller.signal,shouldStart:()=>true,onStart:c=>started.push(c.candidate_id),onResult:c=>completed.push(c.candidate_id),onError:c=>errors.push(c.candidate_id),onFinish:()=>{}});
 assert.equal(started.length,2);
 while(completed.length+errors.length<5){resolvers.shift()?.();await tick();}
 await batch;assert.equal(peak,2);assert.equal(started.length,5);assert.equal(completed.length,4);assert.deepEqual(errors,['candidate-2']);
});
test('pausing a batch drains active pairs without starting remaining work',async()=>{
 const {api}=clientFixture();const controller=new AbortController(),releases=[],started=[];
 const client={automatic:()=>new Promise(resolve=>releases.push(()=>resolve(result())))};
 const batch=api.processSAMQueue(client,Array.from({length:4},(_,i)=>({...candidate,candidate_id:`c-${i}`})),{signal:controller.signal,shouldStart:()=>true,onStart:c=>started.push(c.candidate_id),onResult:()=>{},onError:()=>{},onFinish:()=>{}});
 controller.abort();releases.forEach(release=>release());await batch;assert.equal(started.length,2);
});
