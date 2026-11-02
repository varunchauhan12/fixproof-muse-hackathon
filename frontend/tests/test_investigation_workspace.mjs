import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../lib/forensic-evidence.ts', import.meta.url),'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText, {exports});
const candidate = {source_asset_id:'reference',source_frame_id:9,source_filename:'actual-ref.jpg',source_timestamp_sec:12.75,l2_distance:0.2,visual_similarity_score:83,match_confirmed:true};
const frame = {evidence_id:'recorded-evidence',submitted_frame:{frame_index:42,timestamp_sec:14.25,filename:'actual-suspect.jpg'},best_match:candidate,top_candidates:[candidate,{...candidate,source_asset_id:'alternative',source_filename:'alt.jpg',source_timestamp_sec:20}]};
const incident = {submitted_asset_id:'suspect',frame_matches:[frame]};
test('actual candidate deduplication, alternate rank and original timestamps',()=>{const p=exports.buildEvidencePairs(incident);assert.equal(p.length,2);assert.equal(p[1].rank,2);assert.equal(p[0].sourceTimestamp,12.75);assert.equal(p[0].suspectTimestamp,14.25);assert.equal(p[0].suspectFilename,'actual-suspect.jpg');assert.equal(p[1].referenceFilename,'alt.jpg');assert.equal(p[0].evidenceId,'recorded-evidence');assert.equal(p[0].frameIndex,0);assert.equal(p[0].suspectFrameId,42);assert.equal(p[0].referenceFrameId,9);});
test('missing data never synthesizes timestamps, scores or image filenames',()=>{const p=exports.buildEvidencePairs({submitted_asset_id:'x',frame_matches:[{submitted_frame:{},best_match:{source_asset_id:'unregistered'},top_candidates:[]}]})[0];assert.equal(p.sourceTimestamp,null);assert.equal(p.suspectTimestamp,null);assert.equal(p.visualSimilarity,null);assert.equal(p.referenceFilename,'');assert.equal(p.suspectFilename,'');assert.equal(p.evidenceId,'');});
test('zero values are retained and NaN/negative measurements rejected',()=>{assert.equal(exports.measured(0),0);for(const v of [undefined,null,NaN,Infinity,-1,'1']) assert.equal(exports.measured(v),null);});
test('chronological ordering preserves original frame association',()=>{const p=exports.buildEvidencePairs({...incident,frame_matches:[frame,{...frame,submitted_frame:{...frame.submitted_frame,timestamp_sec:0}}]});assert.equal(p[0].suspectTimestamp,0);assert.equal(p[0].frameIndex,1);assert.equal(p.at(-1).frameIndex,0);});
test('no reference candidates still allow suspect observation inspection',()=>{const p=exports.buildEvidencePairs({...incident,frame_matches:[{...frame,best_match:null,top_candidates:[]}]})[0];assert.equal(p.rank,null);assert.equal(p.sourceTimestamp,null);assert.equal(p.suspectFilename,'actual-suspect.jpg');});
test('reports are fallback only and use recorded image basenames',()=>{const report={sections:{frame_correlations:[{correlation_id:'stored',suspect_image_path:'/recorded/a.jpg',ref_image_path:'/recorded/b.jpg',source_asset_id:'ref'}]}};assert.equal(exports.buildEvidencePairs(incident,report)[0].origin,'Recorded CV candidate');const p=exports.buildEvidencePairs({frame_matches:[]},report)[0];assert.equal(p.suspectFilename,'a.jpg');assert.equal(p.referenceFilename,'b.jpg');assert.equal(p.sourceTimestamp,null);assert.equal(p.rank,null);});
// Execute real component handlers with isolated JSX/hook stubs; no HTTP or model requests.
function loadWorkspace(){const out={}; let cursor=0;const slots=[];const React={useState:(initial)=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../components/dashboard/InvestigationWorkspace.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:out,require:(name)=>name==='react'?React:name==='react/jsx-runtime'?{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}:name==='@/lib/api'?{getAssetFrameUrl:(a,f)=>`/frames/${a}/${f}`} : exports});out.render=(component,props)=>{cursor=0;return component(props);};return out;}
const nodes=(tree)=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...nodes(tree.props?.children)];
test('candidate selection, previous/next and timeline invoke same controlled selection',()=>{const pairs=exports.buildEvidencePairs(incident);let selected=0;const {InvestigationWorkspace}=loadWorkspace();const render=()=>InvestigationWorkspace({pairs,selectedIndex:selected,onSelect:i=>selected=i});let tree=render();const next=nodes(tree).find(n=>n.type==='button'&&n.props.children==='Next candidate →');next.props.onClick();assert.equal(selected,1);tree=render();nodes(tree).find(n=>n.type==='button'&&n.props.children==='← Previous candidate').props.onClick();assert.equal(selected,0);const timeline=nodes(tree).find(n=>n.props?.['aria-label']==='Chronological evidence timeline');nodes(timeline).filter(n=>n.type==='button')[1].props.onClick();assert.equal(selected,1);});
test('real viewer receives exact recorded asset, filename and timestamp',()=>{const pairs=exports.buildEvidencePairs(incident);const tree=loadWorkspace().InvestigationWorkspace({pairs,selectedIndex:1,onSelect:()=>{}});const frames=nodes(tree).filter(n=>typeof n.type==='function');assert.equal(frames[0].props.asset,'alternative');assert.equal(frames[0].props.filename,'alt.jpg');assert.equal(frames[0].props.timestamp,20);assert.equal(frames[1].props.asset,'suspect');assert.equal(frames[1].props.timestamp,14.25);const img=nodes(frames[0].type(frames[0].props)).find(n=>n.type==='img');assert.equal(img.props.src,'/frames/alternative/alt.jpg');assert.equal(typeof img.props.onError,'function');assert.equal(typeof img.props.onLoad,'function');});

test('a report from another incident is never used as fallback',()=>{assert.equal(exports.buildEvidencePairs({incident_id:'current',frame_matches:[]},{incident_id:'other',sections:{frame_correlations:[{}]}}).length,0);});

test('real frame component transitions loading to error and manual retry',()=>{
 const workspace=loadWorkspace();const pairs=exports.buildEvidencePairs(incident);
 const view=workspace.InvestigationWorkspace({pairs,selectedIndex:0,onSelect:()=>{}});
 const frame=nodes(view).find(n=>typeof n.type==='function');
 let tree=workspace.render(frame.type,frame.props);
 assert.ok(nodes(tree).some(n=>n.props?.role==='status'));
 nodes(tree).find(n=>n.type==='img').props.onError();
 tree=workspace.render(frame.type,frame.props);
 assert.equal(nodes(tree).filter(n=>n.type==='img').length,0);
 nodes(tree).find(n=>n.type==='button'&&n.props.children==='Retry image').props.onClick();
 tree=workspace.render(frame.type,frame.props);
 const img=nodes(tree).find(n=>n.type==='img'); assert.ok(img);img.props.onLoad();
 tree=workspace.render(frame.type,frame.props);
 assert.equal(nodes(tree).filter(n=>n.props?.role==='status').length,0);
});
test('real frame component renders unavailable state without requesting an image',()=>{
 const workspace=loadWorkspace();const pairs=exports.buildEvidencePairs({...incident,frame_matches:[{...frame,best_match:null,top_candidates:[]}]});
 const view=workspace.InvestigationWorkspace({pairs,selectedIndex:0,onSelect:()=>{}});
 const ref=nodes(view).find(n=>typeof n.type==='function');
 const tree=workspace.render(ref.type,ref.props);
 assert.equal(nodes(tree).filter(n=>n.type==='img').length,0);
 assert.ok(nodes(tree).some(n=>n.props?.children==='No recorded frame location available.'));
});

test('white confirmed highlight requires backend boolean true, never a similarity threshold',()=>{
 const {InvestigationWorkspace}=loadWorkspace();
 for(const [confirmed,expected] of [[true,true],[false,false],[undefined,false]]) {
  const pairs=exports.buildEvidencePairs({...incident,frame_matches:[{...frame,best_match:{...candidate,match_confirmed:confirmed,confidence_score:100,visual_similarity_score:100},top_candidates:[]}]});
  const tree=InvestigationWorkspace({pairs,selectedIndex:0,onSelect:()=>{}});
  const viewer=nodes(tree).find(n=>n.props?.['aria-label']==='Side-by-side recorded frames');
  assert.equal(viewer.props['data-backend-confirmed'],expected);
  assert.equal(viewer.props.className.includes('shadow-['),expected);
 }
});
