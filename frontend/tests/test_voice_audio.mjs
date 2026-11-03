import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
const require = createRequire(new URL("../package.json", import.meta.url));
const ts = require("typescript");
const compiled = ts.transpileModule(fs.readFileSync(new URL("../lib/voice-audio.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exports = {};
const context = { exports, Float32Array, ArrayBuffer, DataView, File, Blob };
vm.runInNewContext(compiled, context);
const { encodeVoiceWav, recordingToWav } = exports;

test("RIFF header, exact 16kHz mono PCM and stereo average/clipping", () => {
  const bytes = encodeVoiceWav([new Float32Array([-2, 0, 2, .5]), new Float32Array([-2, 0, 2, -.5])]);
  const view = new DataView(bytes);
  assert.equal(Buffer.from(bytes).toString("ascii", 0, 4), "RIFF");
  assert.equal(Buffer.from(bytes).toString("ascii", 8, 12), "WAVE");
  assert.equal(view.getUint32(4, true), bytes.byteLength - 8);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(28, true), 32000);
  assert.equal(view.getUint16(32, true), 2);
  assert.equal(view.getUint16(34, true), 16);
  assert.deepEqual([0,1,2,3].map(i => view.getInt16(44+i*2, true)), [-32768,0,32767,0]);
});
test("one second size and exact duration", () => {
  const bytes = encodeVoiceWav([new Float32Array(16000)]);
  assert.equal(bytes.byteLength, 32044);
  assert.equal(new DataView(bytes).getUint32(40, true) / 32000, 1);
});
test("invalid samples, mismatched channels, and duration limit are rejected", () => {
  for (const channels of [[], [new Float32Array()], [new Float32Array(2), new Float32Array(3)], [new Float32Array([NaN])], [new Float32Array(9600001)]])
    assert.throws(() => encodeVoiceWav(channels));
});
test("maximum 10-minute output fits the backend limit", () => {
  const bytes = encodeVoiceWav([new Float32Array(9600000)]);
  assert.equal(bytes.byteLength, 19200044);
  assert.ok(bytes.byteLength < 25*1024*1024);
});
test("conversion uses native target-rate decoding and produces a real WAV file", async () => {
  context.OfflineAudioContext = class {
    constructor(channels, length, rate) { assert.deepEqual([channels,length,rate], [1,1,24000]); }
    async decodeAudioData(bytes) {
      assert.ok(bytes instanceof ArrayBuffer);
      return { sampleRate:24000, numberOfChannels:2, getChannelData: () => Float32Array.from({length:24000},(_,i)=>.1*Math.sin(i/12)) };
    }
  };
  const file = await recordingToWav(new Blob(["mock browser compressed recording"]));
  assert.equal(file.type, "audio/wav");
  assert.equal(file.name, "microphone-recording.wav");
  assert.equal(Buffer.from(await file.arrayBuffer()).toString("ascii",0,4), "RIFF");
});
test("generated WAV passes the actual backend validator without a model call", () => {
  const bytes = encodeVoiceWav([new Float32Array(16000)]);
  const code = `import sys\nfrom unittest.mock import patch\nfrom app.providers.voice import MetaVoiceProvider\nfrom app.providers.meta_client import MetaAPIError\nwith patch('app.providers.voice.get_meta_sdk_client',side_effect=MetaAPIError('CLIENT_INITIALIZATION_ERROR')) as sdk:\n try: MetaVoiceProvider().transcribe(sys.stdin.buffer.read())\n except MetaAPIError as e: assert e.category=='CLIENT_INITIALIZATION_ERROR',e.category\n sdk.assert_called_once()\nprint('WAV validation passed; transport blocked')`;
  const result = spawnSync("backend/.venv/bin/python", ["-c",code], {
    input: Buffer.from(bytes), encoding:"utf8", env:{...process.env,PYTHONPATH:"backend",PYTHONDONTWRITEBYTECODE:"1"},
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /WAV validation passed/);
});

test("native 24kHz encoder emits the supported rate without changing 16kHz compatibility",()=>{
 const bytes=encodeVoiceWav([new Float32Array(24000)],24000),view=new DataView(bytes);
 assert.equal(view.getUint32(24,true),24000);assert.equal(view.getUint32(28,true),48000);
 assert.throws(()=>encodeVoiceWav([new Float32Array(100)],48000));
});
test("microphone conversion rejects silent or DC-only input before upload",async()=>{
 for(const offset of [0,.1]){
  context.OfflineAudioContext=class{async decodeAudioData(){return {sampleRate:24000,numberOfChannels:1,getChannelData:()=>new Float32Array(24000).fill(offset)};}};
  await assert.rejects(recordingToWav(new Blob(['silent recording'])),/No microphone signal/);
 }
});
test("quiet real signal is amplified within bounds, not normalized into clipping",()=>{
 const bytes=encodeVoiceWav([Float32Array.from({length:1000},(_,i)=>.01*Math.sin(i/12))]);
 const view=new DataView(bytes);const peak=Math.max(...Array.from({length:1000},(_,i)=>Math.abs(view.getInt16(44+i*2,true))));
 assert.ok(peak>2000&&peak<32767);
});
