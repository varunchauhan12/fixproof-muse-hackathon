import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const require = createRequire(new URL("../package.json", import.meta.url));
const ts = require("typescript");
const compile = path => ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const apiCode = compile("../lib/muse-assistant.ts");
const pageCode = compile("../app/muse/page.tsx");
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
function fixture() {
  const calls = []; let session = "session-fixture"; let revision = 0;
  let messageHandler;
  const history = { conversation_id: "conversation-fixture", selected_incident_id: null, revision: 0, messages: [] };
  const fetch = async (url, options = {}) => {
    const path = new URL(url).pathname; const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
    calls.push({ path, options, body });
    if (path === "/api/muse/incidents") return response({ status: "success", data: { incidents: [{ incident_id: "incident-a", overall_status: "CLEAN", scanned_at: "2026-11-01T10:00:00Z" }] } });
    if (path === "/api/voice/transcribe") return response({ success: true, transcript: "Explain the latest incident", provider: "muse", model_id: "fixture-asr", language: null });
    if (path === "/api/muse/conversations") { history.selected_incident_id = body.selected_incident_id; return response(history, 201); }
    if (path.endsWith("/messages")) {
      if (messageHandler) return messageHandler(body);
      assert.equal(body.expected_revision, revision);
      revision += 2;
      return response({ conversation_id: history.conversation_id, message_id: `assistant-${revision}`, revision, status: "completed", text: "The stored observations are NO_MATCH; no candidate matches were found.", provider: "muse", model_id: "fixture-reasoning", citations: [{ incident_id: "incident-a" }], tool_results: [{ tool: "get_evidence_bundle", status: "completed", data: { incident_id: "incident-a" } }] });
    }
    return response(history);
  };
  const context = { exports: {}, Error, require: name => { assert.equal(name, "./api"); return { API_BASE: "http://offline.invalid", getClientSessionId: () => session }; }, fetch, FormData, File, crypto: { randomUUID } };
  vm.runInNewContext(apiCode, context);
  return { api: context.exports, calls, history, setHandler: fn => { messageHandler = fn; }, setSession: value => { session = value; }, getSession: () => session };
}
function ui(f) {
  let cursor = 0; const slots = []; const effects = []; const events = new Map();
  const capture = { file: null, error: "", recordState: "idle", seconds: 0, playback: "", captured: false,
    get recordingBusy() { return this.recordState !== "idle"; },
    setFile(value) { capture.file = value; }, setError(value) { capture.error = value; }, setCaptured(value) { capture.captured = value; },
    discard() { capture.file = null; capture.recordState = "idle"; },
    startRecording() { capture.recordState = "recording"; },
    stopRecording() { capture.recordState = "idle"; capture.file = new File(["offline-audio-fixture"], "question.wav", { type: "audio/wav" }); },
  };
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(fn, deps) { const i = cursor++; if (!(i in slots)) { slots[i] = deps; effects.push(fn); } },
  };
  const context = { exports: {}, Error, require: name => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { default: "a" };
    if (name === "lucide-react") return { Mic: "svg", Square: "svg", Send: "svg", RotateCcw: "svg" };
    if (name === "@/lib/api") return { getClientSessionId: f.getSession };
    if (name === "@/lib/muse-assistant") return f.api;
    if (name === "@/hooks/useVoiceRecorder") return { useVoiceRecorder: () => capture };
    throw new Error(`Unexpected module ${name}`);
  }, window: { addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name) }, AbortController, File };
  vm.runInNewContext(pageCode, context);
  let tree;
  const render = () => { cursor = 0; tree = context.exports.default(); return tree; };
  const nodes = node => Array.isArray(node) ? node.flatMap(n => nodes(n)) : node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : [];
  const text = node => Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text(node.props?.children) : typeof node === "string" ? node : "";
  render(); effects.forEach(fn => fn());
  return { capture, render, nodes, text, events, find: predicate => nodes(tree).find(predicate), button: label => nodes(tree).find(n => n.type === "button" && text(n).includes(label)), draft: () => nodes(tree).find(n => n.type === "textarea") };
}

test("ASR upload validates WAV and uses existing session without creating a conversation", async () => {
  const f = fixture();
  const result = await f.api.transcribeRecording(new File(["fixture"], "question.wav"), f.getSession());
  assert.equal(result.transcript, "Explain the latest incident");
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].path, "/api/voice/transcribe");
  assert.equal(f.calls[0].options.headers["X-Client-Session-ID"], "session-fixture");
  await assert.rejects(f.api.transcribeRecording(new File([], "bad.webm"), f.getSession()));
  assert.equal(f.calls.length, 1);
});
test("explicit sends create one conversation, preserve revision and same session for follow-up", async () => {
  const f = fixture(); const client = new f.api.MuseConversationClient();
  await client.send("Explain my incident"); await client.send("Explain those observations");
  assert.equal(f.calls.filter(c => c.path === "/api/muse/conversations").length, 1);
  assert.deepEqual(f.calls.filter(c => c.path.endsWith("/messages")).map(c => c.body.expected_revision), [0, 2]);
  assert.ok(f.calls.every(c => c.options.headers["X-Client-Session-ID"] === "session-fixture"));
  assert.equal(client.conversation.revision, 4); assert.equal(client.selectedIncident, "incident-a");
});
test("synchronous duplicate send guard and visible processing state", async () => {
  const f = fixture(); let release;
  f.setHandler(() => new Promise(resolve => { release = resolve; }));
  const client = new f.api.MuseConversationClient(); const pending = client.send("Explain this");
  await tick(); assert.equal(client.busy, true);
  await assert.rejects(client.send("Duplicate"), /already processing/);
  release(response({ revision: 2, text: "Stored result", status: "completed", citations: [], tool_results: [], message_id: "reply" }));
  await pending; assert.equal(client.busy, false);
  assert.equal(f.calls.filter(c => c.path.endsWith("/messages")).length, 1);
});
test("conflicts recover server revision with GET, never retry inference", async () => {
  const f = fixture(); f.history.revision = 4;
  f.setHandler(() => response({ error: "REVISION_CONFLICT", detail: "Conversation changed." }, 409));
  const client = new f.api.MuseConversationClient();
  await assert.rejects(client.send("Explain this"), /Conversation changed/);
  assert.equal(client.conversation.revision, 4);
  assert.equal(f.calls.filter(c => c.path.endsWith("/messages")).length, 1);
  assert.equal(f.calls.at(-1).options.method, "GET");
});
test("provider errors surface and recover failed history without automatic resend", async () => {
  const f = fixture(); f.history.revision = 2; f.history.messages = [{ message_id: "failure", role: "assistant", text: "Muse timed out.", metadata: { status: "failed" } }];
  f.setHandler(() => response({ error: "PROVIDER_TIMEOUT", detail: "Muse timed out." }, 504));
  const client = new f.api.MuseConversationClient();
  await assert.rejects(client.send("Explain this"), /timed out/);
  assert.equal(client.conversation.messages[0].metadata.status, "failed");
  assert.equal(f.calls.filter(c => c.path.endsWith("/messages")).length, 1);
});
test("microphone, editable transcript and explicit Send are separate UI actions", async () => {
  const f = fixture(); const page = ui(f); await tick(); page.render();
  page.button("Record question").props.onClick(); page.render();
  assert.equal(page.button("Send to Muse").props.disabled, true);
  page.button("Stop recording").props.onClick(); page.render();
  assert.equal(f.calls.filter(c => c.path === "/api/voice/transcribe").length, 0);
  page.button("Transcribe recording").props.onClick(); await tick(); page.render();
  assert.equal(page.draft().props.value, "Explain the latest incident");
  assert.equal(f.calls.filter(c => c.path.includes("/conversations")).length, 0);
  page.draft().props.onChange({ target: { value: "My edited question" } }); page.render();
  page.button("Send to Muse").props.onClick(); await tick(); page.render();
  assert.equal(f.calls.find(c => c.path.endsWith("/messages")).body.text, "My edited question");
  assert.ok(page.text(page.render()).includes("The stored observations are NO_MATCH"));
});
test("UI shows loading, blocks duplicate sends and retains context for a follow-up", async () => {
  const f = fixture(); const page = ui(f); await tick(); page.render();
  page.draft().props.onChange({ target: { value: "My incident" } }); page.render();
  let release; f.setHandler(() => new Promise(resolve => { release = resolve; }));
  page.button("Send to Muse").props.onClick(); await tick(); page.render();
  assert.equal(page.button("Working…").props.disabled, true);
  assert.ok(page.text(page.render()).includes("Muse is reading the investigation"));
  page.button("Working…").props.onClick();
  release(response({ revision: 2, text: "Actual fixture evidence", status: "completed", citations: [{ incident_id: "incident-a" }], tool_results: [], message_id: "reply" }));
  await tick(); page.render();
  assert.ok(page.text(page.render()).includes("Discussing: Incident · incident"));
  assert.equal(f.calls.filter(c => c.path.endsWith("/messages")).length, 1);
});
test("incident selection starts a conversation scoped to that hint", async () => {
  const f = fixture(); const page = ui(f); await tick(); page.render();
  page.find(n => n.type === "select").props.onChange({ target: { value: "incident-a" } }); page.render();
  page.draft().props.onChange({ target: { value: "Explain this incident" } }); page.render();
  page.button("Send to Muse").props.onClick(); await tick();
  assert.equal(f.calls.find(c => c.path === "/api/muse/conversations").body.selected_incident_id, "incident-a");
});
test("UI preserves draft and displays backend error with safe failed history", async () => {
  const f = fixture(); const page = ui(f); await tick(); page.render();
  f.setHandler(() => response({ error: "PROVIDER_ERROR", detail: "Muse is unavailable." }, 502));
  page.draft().props.onChange({ target: { value: "Keep this question" } }); page.render();
  page.button("Send to Muse").props.onClick(); await tick(); page.render();
  assert.equal(page.draft().props.value, "Keep this question");
  assert.ok(page.text(page.find(n => n.props?.role === "alert")).includes("Muse is unavailable"));
});
test("session changes clear old conversation and use the new session", async () => {
  const f = fixture(); const page = ui(f); await tick(); page.render();
  page.draft().props.onChange({ target: { value: "Old session question" } });
  f.setSession("session-new"); page.events.get("fixproof_session_changed")(); await tick(); page.render();
  assert.equal(page.draft().props.value, "");
  assert.equal(f.calls.at(-1).options.headers["X-Client-Session-ID"], "session-new");
});

function recorderFixture(getMedia) {
  let cursor = 0; const slots = []; const effects = []; const revoked = []; const recorders=[],order=[],permissionTimeouts=[]; let captures = 0;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback(fn, deps) { const i = cursor++; const previous = slots[i]; if (!previous || deps.some((v, j) => v !== previous.deps[j])) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn) { const i = cursor++; if (!(i in slots)) { slots[i] = true; effects.push(fn); } },
  };
  class Recorder {
    static isTypeSupported() { return true; }
    constructor(){recorders.push(this);}
    state = "inactive"; mimeType = "audio/webm";
    requestData(){order.push("flush");}
    start() { this.state = "recording"; }
    stop() {order.push("stop");this.state = "inactive";queueMicrotask(()=>{this.ondataavailable?.({ data: new Blob(["recorded audio fixture"]) }); this.onstop?.();});}
  }
  let inputExports={};
  const context = { exports: {}, Error, window:{}, require: name => name === "react" ? hooks : name === "@/lib/voice-input" ? inputExports : name === "@/lib/voice-meter" ? {VOICE_METER_BARS:10,startVoiceMeter:()=>()=>{}} : { VOICE_MAX_BYTES: 25*1024*1024, VOICE_MAX_SECONDS: 600,
      recordingToWav: async () => new File(["converted WAV fixture"], "recording.wav", { type: "audio/wav" }) },
    navigator: { mediaDevices: { getUserMedia: (...args) => { captures++; return getMedia(...args); } } },
    MediaRecorder: Recorder, OfflineAudioContext: class {}, Blob, File, DOMException,
    URL: { createObjectURL: () => "blob:offline-preview", revokeObjectURL: value => revoked.push(value) },
    performance: { now: () => 0 }, setInterval: () => 1, clearInterval() {}, setTimeout(fn){permissionTimeouts.push(fn);return permissionTimeouts.length;},clearTimeout(){},
    fetch: () => { throw new Error("Recorder must not upload anything"); },
  };
  vm.runInNewContext(compile("../lib/voice-input.ts"),{exports:inputExports,navigator:context.navigator});
  vm.runInNewContext(compile("../hooks/useVoiceRecorder.ts"), context);
  const render = () => { cursor = 0; return context.exports.useVoiceRecorder(false); };
  render(); const cleanup = effects.map(fn => fn());
  return { render, revoked, recorders, order, permissionTimeouts, captures: () => captures, cleanup: () => cleanup.forEach(fn => fn?.()) };
}
test("shared recorder captures, converts, previews and releases tracks without any upload", async () => {
  let stopped = 0;
  const track={label:"Headset microphone",readyState:"live",muted:false,stop:()=>{stopped++;}};
  const f = recorderFixture(async () => ({ getTracks:()=>[track],getAudioTracks:()=>[track] }));
  let capture = f.render(); await capture.startRecording(); capture = f.render();
  assert.equal(capture.recordState, "recording");
  capture.stopRecording(); await tick(); capture = f.render();
  assert.equal(capture.file.type, "audio/wav"); assert.equal(capture.playback, "blob:offline-preview");
  assert.equal(capture.recordState, "idle"); assert.ok(stopped > 0);
  capture.discard(); capture = f.render(); assert.equal(capture.file, null); assert.equal(capture.playback, "");
  assert.ok(f.revoked.includes("blob:offline-preview")); f.cleanup();
});
test("shared recorder blocks duplicate permission requests and cleans late permission after unmount", async () => {
  let resolve; let stopped = 0;
  const f = recorderFixture(() => new Promise(done => { resolve = done; }));
  const capture = f.render(); const pending = capture.startRecording(); await capture.startRecording();
  assert.equal(f.captures(), 1); f.cleanup();
  resolve({ getTracks: () => [{ stop: () => { stopped++; } }] }); await pending;
  assert.equal(stopped, 1); assert.equal(f.render().file, null);
});

test('recorder flushes final data before releasing microphone tracks',async()=>{
 let stopped=0;const track={label:'Headset',readyState:'live',muted:false,stop(){stopped++;}};
 const f=recorderFixture(async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]}));
 await f.render().startRecording();assert.equal(f.render().inputLabel,'Headset');
 f.render().stopRecording();assert.deepEqual(f.order,['flush','stop']);assert.equal(stopped,0);
 await tick();assert.ok(stopped>0);assert.ok(f.render().file);f.cleanup();
});
test('permission denial is actionable and never prompts a second time',async()=>{
 const f=recorderFixture(async()=>{throw new DOMException('denied','NotAllowedError');});
 await f.render().startRecording();assert.equal(f.captures(),1);
 assert.equal(f.render().recordState,'idle');assert.match(f.render().error,/browser settings/);f.cleanup();
});
test('late stop callback cannot release a newer microphone capture',async()=>{
 const stopped=[0,0];let index=0;
 const f=recorderFixture(async()=>{const id=index++;const track={label:'Input',readyState:'live',muted:false,stop(){stopped[id]++;}};return {getTracks:()=>[track],getAudioTracks:()=>[track]};});
 await f.render().startRecording();const oldStop=f.recorders[0].onstop;
 f.render().discard();await f.render().startRecording();await oldStop();
 assert.equal(stopped[1],0);assert.equal(f.render().recordState,'recording');f.cleanup();
});

test('ASR sends the selected language hint once and leaves automatic mode unforced',async()=>{
 const f=fixture();const file=new File(['fixture audio'],'question.wav');
 await f.api.transcribeRecording(file,f.getSession(),undefined,'en-hi');
 assert.equal(f.calls[0].body.get('language'),'en-hi');
 await f.api.transcribeRecording(file,f.getSession());
 assert.equal(f.calls[1].body.get('language'),null);assert.equal(f.calls.length,2);
});

test('unanswered permission times out clearly and a late stream is stopped',async()=>{
 let resolve,stopped=0;const f=recorderFixture(()=>new Promise(done=>{resolve=done;}));
 const pending=f.render().startRecording();assert.equal(f.render().recordState,'permission');
 f.permissionTimeouts[0]();assert.equal(f.render().recordState,'idle');assert.match(f.render().error,/Still waiting for microphone permission/);
 resolve({getTracks:()=>[{stop(){stopped++;}}]});await pending;
 assert.equal(stopped,1);assert.equal(f.render().file,null);f.cleanup();
});
