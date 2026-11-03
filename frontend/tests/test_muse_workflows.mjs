import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const require=createRequire(new URL('../package.json',import.meta.url));
const ts=require('typescript');
const compile=path=>ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const report={incident_id:'incident-a',report_id:'report-a',model_id:'offline',ai_synthesized:false,sections:{executive_summary:'Recorded evidence',methodology_scope:'Sampling',frame_correlations:[],risk_and_limitations:'Human review',recommended_actions:[]}};
const all=tree=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(all):[tree,...all(tree.props?.children)];
const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):'';
const button=(tree,label)=>all(tree).find(n=>n.type==='button'&&text(n)===label);
function mount() {
  let cursor=0;const slots=[],effects=[],calls=[];
  const api={getClientSessionId:()=> 'session-a',getEmailStatus:async()=>({configured:true}),
    getDetailedReportsForIncident:async()=>[{report_id:'report-a'}],getDetailedReport:async()=>report,
    generateDetailedReport:async p=>{calls.push(['generate',p]);return {success:true,report};},
    draftNemotronDocument:async p=>{calls.push(['draft',p]);return {body:'[To be proposed]',subject:'Proposal',missing_fields:['rights_holder_name']};},
    emailDetailedReport:async p=>{calls.push(['email',p]);return {success:true,status:'ACCEPTED'};},downloadDetailedReportPdf:async()=>new Blob(['%PDF-test'])};
  const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(fn){const i=cursor++;if(!(i in slots)){slots[i]=true;effects.push(fn);}}};
  const exports={};vm.runInNewContext(compile('../components/muse/MuseDocumentWorkspace.tsx'),{exports,require:name=>name==='react'?hooks:name==='react/jsx-runtime'?require(name):api,Blob,URL,setTimeout,window:{addEventListener(){},removeEventListener(){}},navigator:{clipboard:{writeText:async()=>{}}}});
  const render=(initial='report')=>{cursor=0;const tree=exports.DocumentBody({incidentId:'incident-a',session:'session-a',initial});effects.splice(0).forEach(fn=>fn());return tree;};
  return {render,calls,exports};
}
test('studio mount never generates or sends; report request omits recipient',async()=>{
  const f=mount();let tree=f.render();assert.deepEqual(f.calls,[]);
  await button(tree,'Generate report & PDF').props.onClick();
  tree=f.render();assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0])),['generate',{incident_id:'incident-a'}]);
  assert.ok(text(tree).includes('deterministic fallback'));
  assert.ok(button(tree,'Download saved PDF'));
});
test('licensing draft preserves unknown terms without requesting AI or sending',async()=>{
  const f=mount();let tree=f.render('licensing');await button(tree,'Prepare draft').props.onClick();tree=f.render('licensing');
  assert.equal(f.calls[0][1].use_ai_synthesis,false);
  assert.equal(f.calls[0][1].rev_share_pct,undefined);
  assert.equal(all(tree).find(n=>n.props?.['aria-label']==='Document body').props.value,'[To be proposed]');
  assert.equal(f.calls.some(c=>c[0]==='email'),false);
});
test('manual email studio edits invalidate confirmation and sending uses edited content',async()=>{
  const f=mount();let tree=f.render('email');await button(tree,'Load latest saved report').props.onClick();tree=f.render('email');
  const change=(label,value)=>{all(tree).find(n=>n.props?.['aria-label']===label).props.onChange({target:{value}});tree=f.render('email');};
  change('Email recipient','recipient@example.test');change('Document body','Edited cover note');
  assert.equal(button(tree,'Send reviewed email with PDF').props.disabled,true);
  all(tree).find(n=>n.props?.['aria-label']==='Confirm email review').props.onChange({target:{checked:true}});tree=f.render('email');
  assert.equal(button(tree,'Send reviewed email with PDF').props.disabled,false);
  change('Document subject','Reviewed subject');assert.equal(button(tree,'Send reviewed email with PDF').props.disabled,true);
  all(tree).find(n=>n.props?.['aria-label']==='Confirm email review').props.onChange({target:{checked:true}});tree=f.render('email');
  await button(tree,'Send reviewed email with PDF').props.onClick();tree=f.render('email');
  assert.equal(f.calls[0][1].body,'Edited cover note');assert.equal(f.calls[0][1].user_confirmed,true);
  assert.ok(text(tree).includes('delivery is not verified'));
});
test('conversation client preserves real artifact metadata and sends edited cover note only as typed parameters',async()=>{
  const exports={},artifact={artifact_id:'artifact-a',incident_id:'incident-a',kind:'email',report_id:'report-a',title:'Cover note',body:'Actual body',status:'DRAFT',truncated:false};
  const calls=[];
  vm.runInNewContext(compile('../lib/muse-assistant.ts'),{exports,require:()=>({API_BASE:'http://offline.invalid',getClientSessionId:()=> 'session-a'}),crypto:{randomUUID},Error,fetch:async(url,opts)=>{
    calls.push(JSON.parse(opts.body));return new Response(JSON.stringify(url.endsWith('/messages')?{conversation_id:'conversation-a',revision:2,message_id:'message-a',status:'completed',text:'PDF prepared',citations:[],tool_results:[],artifacts:[artifact]}:{conversation_id:'conversation-a',revision:0,messages:[]}));
  }});
  const client=new exports.MuseConversationClient('session-a','incident-a');await client.send('Prepare an email.','incident-a');
  assert.equal(client.conversation.messages[1].metadata.artifacts[0].report_id,'report-a');
  await client.send('Send the report to my email.','incident-a',{report_id:'report-a',subject:'Edited subject',body:'Edited body'});
  assert.deepEqual(calls[2].email_draft,{report_id:'report-a',subject:'Edited subject',body:'Edited body'});
});
