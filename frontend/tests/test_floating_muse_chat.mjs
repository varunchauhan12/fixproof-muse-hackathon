import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(new URL("../package.json", import.meta.url));
const ts = require("typescript");

const compile = (path) =>
  ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;

const apiCode = compile("../lib/muse-assistant.ts");
const widgetCode = compile("../components/muse/FloatingMuseChat.tsx");

const response = (data, status = 200) =>
  new Response(JSON.stringify(data), { status });
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function fixture(messageReply) {
  const calls = [];
  let session = "session-floating-test";
  let revision = 0;
  const history = {
    conversation_id: "conv-123",
    selected_incident_id: null,
    revision: 0,
    messages: [],
  };

  const fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const body =
      typeof options.body === "string" ? JSON.parse(options.body) : options.body;
    calls.push({ path, options, body });

    if (path === "/api/muse/incidents") {
      return response({
        status: "success",
        data: {
          incidents: [
            {
              incident_id: "inc-sample2",
              suspect_filename: "sample2.mp4",
              overall_status: "CLEAN",
              scanned_at: "2026-11-01T15:00:00Z",
            },
          ],
        },
      });
    }

    if (path === "/api/voice/transcribe") {
      return response({
        success: true,
        transcript: "Voice question for Muse",
        provider: "muse",
        model_id: "muse-voice-transcribe-1.0",
        language: null,
      });
    }

    if (path === "/api/muse/conversations") {
      history.selected_incident_id = body.selected_incident_id;
      return response(history, 201);
    }

    if (path.includes("/actions/")) {
      revision+=2;return response({conversation_id:history.conversation_id,revision,message_id:`decision-${revision}`,status:"completed",text:path.endsWith("/cancel")?"Proposal cancelled. Nothing sent.":"Resend accepted the approved email.",citations:[],tool_results:[],pending_action:null});
    }
    if (path.endsWith("/messages")) {
      revision += 2;
      if(messageReply)return response(messageReply(body,revision));
      return response({
        conversation_id: history.conversation_id,
        message_id: `asst-${revision}`,
        revision,
        status: "completed",
        text: "Response grounded in stored observations: CLEAN result.",
        provider: "muse",
        model_id: "muse-wonder-1.0",
        citations: [{ incident_id: "inc-sample2", evidence_id: "frame_0_t0s", timestamp_sec: 0.0 }],
        tool_results: [
          { tool: "get_evidence_bundle", status: "completed", data: { incident_id: "inc-sample2" } },
        ],
      });
    }

    return response(history);
  };

  const context = {
    exports: {},
    Error,
    require: (name) => {
      assert.equal(name, "./api");
      return {
        API_BASE: "http://offline.invalid",
        getClientSessionId: () => session,
      };
    },
    fetch,
    FormData,
    File,
    crypto: { randomUUID },
  };

  vm.runInNewContext(apiCode, context);
  return {
    api: context.exports,
    calls,
    history,
    getSession: () => session,
  };
}

function mountWidget(f) {
  let cursor = 0;
  const slots = [];
  const effects = [];
  const events = new Map();

  const capture = {
    file: null,
    error: "",
    recordState: "idle",
    seconds: 0,
    playback: "",
    captured: false,
    get recordingBusy() {
      return this.recordState !== "idle";
    },
    setFile(value) {
      capture.file = value;
    },
    setError(value) {
      capture.error = value;
    },
    setCaptured(value) {
      capture.captured = value;
    },
    discard() {
      capture.file = null;
      capture.recordState = "idle";
    },
    startRecording() {
      capture.recordState = "recording";
    },
    stopRecording() {
      capture.recordState = "idle";
      capture.captured = true;
      capture.file = new File(["wav-bytes"], "voice.wav", { type: "audio/wav" });
    },
  };

  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [
        slots[i],
        (value) => {
          slots[i] = typeof value === "function" ? value(slots[i]) : value;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!(i in slots)) {
        slots[i] = deps;
        effects.push(fn);
      } else if (deps && slots[i]) {
        const changed = deps.some((d, idx) => d !== slots[i][idx]);
        if (changed) {
          slots[i] = deps;
          effects.push(fn);
        }
      }
    },
    useCallback(fn) {
      return fn;
    },
    useMemo(fn) {
      return fn();
    },
  };

  const motionMock = (tag) => {
    const Component = (props) => ({ type: tag, props });
    return Component;
  };

  const context = {
    exports: {},
    Error,
    require: (name) => {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return require(name);
      if (name === "next/image") return (props) => ({ type: "img", props });
      if (name === "next/link") return (props) => ({ type: "a", props });
      if (name === "framer-motion") {
        return {
          motion: {
            div: motionMock("div"),
            button: motionMock("button"),
            section: motionMock("section"),
          },
          AnimatePresence: ({ children }) => children,
          useReducedMotion: () => false,
        };
      }
      if (name === "lucide-react") {
        return new Proxy({}, { get: (_, prop) => (props) => ({ type: "svg", icon: prop, props }) });
      }
      if (name === "@/lib/api") return { getClientSessionId: f.getSession };
      if (name === "@/lib/muse-assistant") return f.api;
      if (name === "./MuseApprovalCard") return {MuseApprovalCard:props=>({type:"approval-card",props})};
      if (name === "./MuseArtifactView") return {MuseArtifactView: props=>({type:"artifact-view",props})};
      if (name === "./MuseDocumentWorkspace") return {MuseDocumentWorkspace: props => ({type:"document-studio",props})};
      if (name === "@/hooks/useVoiceRecorder") return { useVoiceRecorder: () => capture };
      if (name === "@/components/kokonutui/ai-voice") {
        return {
          default: (props) => ({ type: "ai-voice", props }),
        };
      }
      if (name === "@/components/kokonutui/ai-input-search") {
        return {
          AI_Input_Search: (props) => ({
            type: "div",
            props: {
              ...props,
              children: [
                {
                  type: "textarea",
                  props: {
                    id: props.id,
                    value: props.value,
                    onChange: (e) => props.onChange?.(e.target.value),
                    onKeyDown: (e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        props.onSubmit?.(props.value);
                      }
                    },
                  },
                },
                {
                  type: "button",
                  props: {
                    children: "Send",
                    onClick: () => props.onSubmit?.(props.value),
                  },
                },
              ],
            },
          }),
        };
      }
      if (name === "@/components/kokonutui/ai-text-loading") {
        return {
          default: (props) => ({ type: "ai-text-loading", props }),
        };
      }
      if (name === "@/components/kokonutui/ai-citations") {
        return {
          default: (props) => ({
            type: "div",
            props: {
              ...props,
              children: [
                props.parts?.map((p) => p.text).join(" "),
                props.sources?.map((s) => ({ type: "cite", props: s })),
              ],
            },
          }),
        };
      }
      if (name === "@/context/ActivityContext") {
        return {
          useActivity: () => ({
            activeIncidentId: null,
            setActiveIncidentId: () => {},
          }),
        };
      }
      throw new Error(`Unexpected require: ${name}`);
    },
    window: {
      addEventListener: (name, cb) => events.set(name, cb),
      removeEventListener: (name) => events.delete(name),
    },
    console,
    AbortController,
    File,
    queueMicrotask,
    setTimeout: (fn) => {
      const id = globalThis.setTimeout?.(fn, 0) || 1;
      return id;
    },
    clearTimeout: (id) => globalThis.clearTimeout?.(id),
  };

  vm.runInNewContext(widgetCode, context);
  let tree;

  const render = () => {
    cursor = 0;
    tree = context.exports.FloatingMuseChat();
    return tree;
  };

  const triggerEffects = async () => {
    while (effects.length > 0) {
      const fn = effects.shift();
      fn();
    }
    await tick();
  };

  function find(predicate, node = tree, seen = new Set()) {
    if(Array.isArray(node)){for(const child of node){const match=find(predicate,child,seen);if(match)return match;}return null;}
    if (!node || seen.has(node)) return null;
    seen.add(node);
    if (predicate(node)) return node;
    let target = node;
    if (typeof node.type === "function") {
      try {
        target = node.type(node.props);
        if (predicate(target)) return target;
      } catch {}
    }
    const children = target?.props?.children;
    if (Array.isArray(children)) {
      for (const child of children) {
        const found = find(predicate, child, seen);
        if (found) return found;
      }
    } else if (children && typeof children === "object") {
      return find(predicate, children, seen);
    }
    return null;
  }

  function findAll(predicate, node = tree, results = [], seen = new Set()) {
    if(Array.isArray(node)){for(const child of node)findAll(predicate,child,results,seen);return results;}
    if (!node || seen.has(node)) return results;
    seen.add(node);
    if (predicate(node)) results.push(node);
    let target = node;
    if (typeof node.type === "function") {
      try {
        target = node.type(node.props);
        if (predicate(target)) results.push(target);
      } catch {}
    }
    const children = target?.props?.children;
    if (Array.isArray(children)) {
      for (const child of children) findAll(predicate, child, results, seen);
    } else if (children && typeof children === "object") {
      findAll(predicate, children, results, seen);
    }
    return results;
  }

  const nodes = (node) =>
    Array.isArray(node)
      ? node.flatMap((n) => nodes(n))
      : node && typeof node === "object"
      ? [node, ...nodes(node.props?.children)]
      : [];

  const text = (node) => {
    if (!node) return "";
    let target = node;
    if (typeof node.type === "function") {
      try {
        target = node.type(node.props);
      } catch {}
    }
    if (Array.isArray(target)) {
      return target.map(text).join("");
    }
    if (target && typeof target === "object") {
      return text(target.props?.children);
    }
    return typeof target === "string" ? target : "";
  };

  return {
    render,
    triggerEffects,
    find,
    findAll,
    nodes,
    text,
    capture,
    events,
  };
}

test("launcher displays talk to the analyst and clicking opens chat panel", async () => {
  const f = fixture();
  const widget = mountWidget(f);
  widget.render();
  await widget.triggerEffects();
  widget.render();

  // Launcher button
  const launcher = widget.find((n) => n.props?.["aria-label"] === "talk to the analyst");
  assert.ok(launcher, "Launcher button should be visible");
  assert.equal(launcher.props?.title, "talk to the analyst");

  // Logo in launcher
  const logo = widget.find((n) => n.props?.src === "/muse-logo-64.png");
  assert.ok(logo, "Muse logo should be rendered in launcher");

  // Click launcher to open
  launcher.props.onClick();
  await widget.triggerEffects();
  widget.render();

  // Dialog should be open
  const dialog = widget.find((n) => n.props?.role === "dialog");
  assert.ok(dialog, "Chat dialog should be open after clicking launcher");
});

test("header controls minimize and close the chat panel", async () => {
  const f = fixture();
  const widget = mountWidget(f);
  widget.render();
  await widget.triggerEffects();
  widget.render();

  // Open panel
  widget.find((n) => n.props?.["aria-label"] === "talk to the analyst").props.onClick();
  widget.render();

  // Find minimize button
  const minBtn = widget.find((n) => n.props?.["aria-label"] === "Minimize chat");
  assert.ok(minBtn, "Minimize button should exist");
  minBtn.props.onClick();
  widget.render();

  // Dialog should now be closed
  assert.equal(widget.find((n) => n.props?.role === "dialog"), null, "Dialog should close on minimize");
});

test("composer sends message and displays grounded assistant response with citations", async () => {
  const f = fixture();
  const widget = mountWidget(f);
  widget.render();
  await widget.triggerEffects();
  widget.render();

  // Open panel
  widget.find((n) => n.props?.["aria-label"] === "talk to the analyst").props.onClick();
  widget.render();

  // Find composer textarea
  const textarea = widget.find((n) => n.props?.id === "floating-muse-composer");
  assert.ok(textarea, "Composer textarea must exist");
  textarea.props.onChange({ target: { value: "Show me the latest incident" } });
  widget.render();

  // Find send button
  const buttons = widget.findAll((n) => n.type === "button");
  const sendBtn = buttons.find((b) => {
    const text = JSON.stringify(b.props?.children);
    return text?.includes("Send");
  });
  assert.ok(sendBtn, "Send button must exist");

  // Click send
  await sendBtn.props.onClick();
  await widget.triggerEffects();
  await tick();
  widget.render();

  // Verify conversation request was made
  const convCall = f.calls.find((c) => c.path === "/api/muse/conversations");
  assert.ok(convCall, "Should create conversation");

  // Verify message request was made
  const msgCall = f.calls.find((c) => c.path.endsWith("/messages"));
  assert.equal(msgCall.body.text, "Show me the latest incident");

  // Verify assistant response text rendered
  const renderedText = widget.text(widget.render());
  assert.ok(
    renderedText.includes("Response grounded in stored observations"),
    "Assistant answer should render in chat"
  );
});

test("clicking to start/stop automatically transcribes and submits for review", async () => {
  const f = fixture();
  const widget = mountWidget(f);
  widget.render();
  await widget.triggerEffects();
  widget.render();

  // Open panel
  widget.find((n) => n.props?.["aria-label"] === "talk to the analyst").props.onClick();
  widget.render();

  // Find hold-to-speak voice bubble
  const voiceBtn = widget.find((n) => n.props?.["aria-label"] === "Start voice recording");
  assert.ok(voiceBtn, "Voice bubble button must exist");

  // Press and hold (start recording)
  await voiceBtn.props.onClick();
  widget.render();
  assert.equal(widget.capture.recordState, "recording");

  // Release hold (stops recording, triggers auto-transcribe & auto-send)
  await widget.find(n=>n.props?.["aria-label"]==="Stop recording and transcribe").props.onClick();
  widget.render();
  await widget.triggerEffects();
  await tick();
  widget.render();

  // Verify transcription was requested
  const transcribeCall = f.calls.find((c) => c.path === "/api/voice/transcribe");
  assert.ok(transcribeCall, "Audio should be automatically submitted for transcription");

  // Verify message was automatically sent without requiring manual command
  const msgCall = f.calls.find((c) => c.path.endsWith("/messages"));
  assert.ok(msgCall, "Transcribed text must be automatically sent to Muse");
  assert.equal(msgCall.body.text, "Voice question for Muse");
});

const proposed=(body,revision)=>({conversation_id:'conv-123',revision,message_id:`proposal-${revision}`,status:'awaiting_confirmation',text:'Review the proposed email.',citations:[],tool_results:[],pending_action:{action_id:'approval-a',action:'send_registered',summary:'Approval sends the exact PDF.',incident_id:'inc-sample2',report_id:'report-a',recipient_email:'student@example.test',subject:'Report',body_preview:'Review attached evidence.',expires_at:'2099-01-01T00:00:00Z'}});
async function openWidget(f) {
  const widget=mountWidget(f);widget.render();await widget.triggerEffects();widget.render();
  widget.find(n=>n.props?.['aria-label']==='talk to the analyst').props.onClick();widget.render();return widget;
}
async function typeMessage(widget,text) {
  const composer=widget.find(n=>n.props?.id==='floating-muse-composer');
  composer.props.onChange({target:{value:text}});widget.render();
  widget.find(n=>n.props?.id==='floating-muse-composer').props.onKeyDown({key:'Enter',shiftKey:false,preventDefault(){}});
  await tick();widget.render();
}
test('email intent renders a proposal and only explicit approval calls the decision endpoint',async()=>{
  const f=fixture(proposed),widget=await openWidget(f);
  await typeMessage(widget,'I need a copy in my inbox.');
  const card=widget.find(n=>n.type==='approval-card');assert.ok(card);assert.equal(card.props.active,true);
  assert.equal(f.calls.filter(c=>c.path.includes('/actions/')).length,0);
  const first=card.props.onApprove();card.props.onApprove();await first;widget.render();
  assert.equal(f.calls.filter(c=>c.path.endsWith('/approve')).length,1);
  assert.equal(widget.find(n=>n.type==='approval-card').props.active,false);
});
test('cancelled proposals cannot send and scroll-up reading position is preserved',async()=>{
  const f=fixture(proposed),widget=await openWidget(f);
  const scroller=widget.find(n=>n.props?.onScroll);
  const dom={scrollHeight:900,clientHeight:200,scrollTop:0};scroller.props.ref.current=dom;scroller.props.onScroll();
  await typeMessage(widget,'Email me the findings.');await widget.triggerEffects();widget.render();
  assert.equal(dom.scrollTop,0);
  assert.ok(widget.text(widget.render()).includes('New reply'));
  await widget.find(n=>n.type==='approval-card').props.onCancel();widget.render();
  assert.equal(f.calls.filter(c=>c.path.endsWith('/approve')).length,0);
  assert.equal(f.calls.filter(c=>c.path.endsWith('/cancel')).length,1);
});
test('closing chat during transcription aborts late results and never submits a message',async()=>{
  const f=fixture();let resolve;
  f.api.transcribeRecording=()=>new Promise(r=>{resolve=r;});
  const widget=await openWidget(f);
  await widget.find(n=>n.props?.['aria-label']==='Start voice recording').props.onClick();widget.render();
  await widget.find(n=>n.props?.['aria-label']==='Stop recording and transcribe').props.onClick();widget.render();await widget.triggerEffects();
  widget.find(n=>n.props?.['aria-label']==='Minimize chat').props.onClick();widget.render();
  resolve({transcript:'Send a report to my email.'});await tick();widget.render();
  assert.equal(f.calls.filter(c=>c.path.endsWith('/messages')).length,0);
  assert.equal(widget.capture.recordState,'idle');
});
test('permission failure returns microphone to idle without transcription',async()=>{
  const f=fixture(),widget=await openWidget(f);
  widget.capture.startRecording=async()=>{widget.capture.error='Microphone permission was denied.';};
  await widget.find(n=>n.props?.['aria-label']==='Start voice recording').props.onClick();widget.render();await widget.triggerEffects();widget.render();
  assert.ok(widget.find(n=>n.props?.['aria-label']==='Start voice recording'));
  assert.equal(f.calls.filter(c=>c.path==='/api/voice/transcribe').length,0);
});

test('empty transcription reports no speech and makes no classification request',async()=>{
  const f=fixture();f.api.transcribeRecording=async()=>({transcript:''});
  const widget=await openWidget(f);
  await widget.find(n=>n.props?.['aria-label']==='Start voice recording').props.onClick();widget.render();
  await widget.find(n=>n.props?.['aria-label']==='Stop recording and transcribe').props.onClick();widget.render();await widget.triggerEffects();widget.render();
  assert.ok(widget.text(widget.render()).includes('No speech was detected'));
  assert.equal(f.calls.filter(c=>c.path.endsWith('/messages')).length,0);
});
test('incident switch suppresses an old asynchronous response and its artifacts',async()=>{
  const f=fixture();let complete;
  f.api.MuseConversationClient.prototype.send=function(){return new Promise(resolve=>{complete=()=>{this.conversation={messages:[{message_id:'old',role:'assistant',text:'OLD RESPONSE',metadata:{artifacts:[{artifact_id:'old-artifact',kind:'report',body:'OLD ARTIFACT'}]}}]};resolve({citations:[]});};});};
  const widget=await openWidget(f);
  await typeMessage(widget,'Explain this investigation.');
  widget.events.get('fixproof_muse_select_incident')({detail:'different-incident'});widget.render();
  complete();await tick();widget.render();
  const rendered=widget.text(widget.render());
  assert.ok(!rendered.includes('OLD RESPONSE'));assert.ok(!rendered.includes('OLD ARTIFACT'));
});
