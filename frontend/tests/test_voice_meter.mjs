import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../package.json',import.meta.url));
const ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync(new URL('../lib/voice-meter.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function load(extra={}){const exports={};vm.runInNewContext(code,{exports,Float32Array,Uint8Array,...extra});return exports;}
const signal=amplitude=>Float32Array.from({length:1024},(_,i)=>Math.sin(2*Math.PI*i/32)*amplitude);

test('silence, constant DC offset and quiet background noise leave all bars still',()=>{
  const {measureVoiceAudio}=load();
  for(const samples of [new Float32Array(1024),new Float32Array(1024).fill(.2),signal(.0005)]){
    const result=measureVoiceAudio(samples,new Uint8Array(512).fill(200),48000);
    assert.equal(result.level,0);assert.ok(result.bars.every(value=>value===0));
  }
});
test('audible samples drive measured frequency bands and silence resets immediately',()=>{
  const {measureVoiceAudio}=load();
  const frequencies=new Uint8Array(512);frequencies.fill(180,3,20);
  const result=measureVoiceAudio(signal(.15),frequencies,48000);
  assert.ok(result.level>0);assert.equal(result.bars.length,10);
  assert.ok(result.bars.some(value=>value>0));assert.ok(result.bars.some(value=>value===0));
  assert.ok(result.bars.every(value=>value>=0&&value<=1));
  assert.ok(measureVoiceAudio(signal(0),frequencies,48000).bars.every(value=>value===0));
});
test('meter reads only existing microphone stream and closes analyser/context on stop',()=>{
  let callback,reads=0,closed=0,cancelled=0,disconnects=0;
  const silent={gain:{value:1},connect(node){assert.equal(node,"speakers");},disconnect(){disconnects++;}};
  const input={};
  const analyser={fftSize:1024,frequencyBinCount:512,connect(node){assert.equal(node,silent);},getFloatTimeDomainData(a){a.set(signal(.1));reads++;},getByteFrequencyData(a){a.fill(128);},disconnect(){disconnects++;}};
  class Audio {
    state='running';sampleRate=48000;destination='speakers';
    createGain(){return silent;}
    createMediaStreamSource(stream){assert.equal(stream,input);return {connect(node){assert.equal(node,analyser);},disconnect(){disconnects++;}};}
    createAnalyser(){return analyser;}
    resume(){return Promise.resolve();}close(){closed++;this.state='closed';return Promise.resolve();}
  }
  const values=[];
  const {startVoiceMeter}=load({window:{AudioContext:Audio},requestAnimationFrame(fn){callback=fn;return 1;},cancelAnimationFrame(){cancelled++;}});
  const stop=startVoiceMeter(input,value=>values.push(value));
  callback(0);callback(10);assert.equal(reads,1);callback(50);assert.equal(reads,2);
  assert.equal(values.length,2);stop();stop();callback(100);
  assert.equal(reads,2);assert.equal(closed,1);assert.equal(cancelled,1);assert.equal(disconnects,3);assert.equal(silent.gain.value,0);
});
test('unavailable analyser support never fabricates activity or blocks recording',()=>{
  const {startVoiceMeter}=load({window:{}});
  const stop=startVoiceMeter({},()=>assert.fail('No fake meter activity'));
  assert.doesNotThrow(stop);
});

test('chat bars have no autonomous animation and heights follow measured levels',()=>{
  const widget=ts.transpileModule(fs.readFileSync(new URL('../components/muse/FloatingMuseChat.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={};
  vm.runInNewContext(widget,{exports,require:name=>name==='react/jsx-runtime'?require(name):{}});
  const quiet=exports.AudioEqualizerBars({levels:Array(10).fill(0)});
  assert.ok(quiet.props.children.every(bar=>bar.type==='span'&&bar.props.style.height===4&&!bar.props.animate));
  const audible=exports.AudioEqualizerBars({levels:[.8,...Array(9).fill(0)]});
  assert.ok(audible.props.children[0].props.style.height>4);
  assert.equal(audible.props.children[1].props.style.height,4);
});

test('quiet microphone speech remains visible without animating zero input',()=>{
 const {measureVoiceAudio}=load();const spectrum=new Uint8Array(512).fill(100);
 assert.ok(measureVoiceAudio(signal(.005),spectrum,48000).level>0);
 assert.ok(measureVoiceAudio(signal(0),spectrum,48000).bars.every(v=>v===0));
});

test('Safari audio interruption clears stale bars and resumes the existing context',async()=>{
 let resumes=0,callback;
 const context={state:'running',sampleRate:48000,destination:{},onstatechange:null,
  createMediaStreamSource:()=>({connect(){},disconnect(){}}),
  createAnalyser:()=>({fftSize:1024,frequencyBinCount:512,connect(){},disconnect(){},getFloatTimeDomainData(a){a.set(signal(.1));},getByteFrequencyData(a){a.fill(100);}}),
  createGain:()=>({gain:{value:1},connect(){},disconnect(){}}),
  resume(){resumes++;return Promise.resolve();},close(){this.state='closed';return Promise.resolve();}};
 const levels=[],availability=[];
 const {startVoiceMeter}=load({window:{},requestAnimationFrame(fn){callback=fn;return 1;},cancelAnimationFrame(){}});
 const stop=startVoiceMeter({},v=>levels.push(v),v=>availability.push(v),context);
 callback(0);assert.ok(levels.at(-1).level>0);
 context.state='interrupted';context.onstatechange();await Promise.resolve();
 assert.equal(resumes,2);assert.equal(availability.at(-1),false);assert.equal(levels.at(-1).level,0);
 context.state='running';context.onstatechange();callback(100);assert.ok(levels.at(-1).level>0);
 stop();assert.equal(context.onstatechange,null);
});
