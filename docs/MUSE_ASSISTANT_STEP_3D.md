# Muse Assistant — Stage 3D: Natural-language backend orchestration

Implemented November 1, 2026. Builds on the actual Stage 3A audit,
MUSE_ASSISTANT_STEP_3B.md and MUSE_ASSISTANT_STEP_3C.md. No frontend added.

## Files created and modified in this step

Created:
- `backend/app/muse_orchestrator.py`: strict action plans, bounded model/tool loop,
  context preparation, source/citation validation and sanitized failures.
- `backend/tests/test_muse_orchestrator.py`: offline provider, API, grounding,
  concurrency and follow-up tests.
- `docs/MUSE_ASSISTANT_STEP_3D.md`: this implementation record.

Modified:
- `backend/app/muse_conversations.py`: turn reservations, internal bounded grounding
  context, retained-history client-message deduplication, assistant status/citations,
  report citations and structured tool receipts in the existing response contract.
- `backend/app/muse_conversation_api.py`: message route and injectable orchestration
  dependency; revision information on post-acceptance errors.
- `backend/tests/test_muse_conversation_api.py`: the obsolete assertion that the
  messages endpoint does not exist now verifies invalid-payload rejection instead.

All Stage 3A/3B/3C uncommitted work was preserved. No provider API/default, voice,
frontend, environment or credential file changed. main.py and registry.py still
contain their earlier Step 3B/3C changes; this step did not further edit them.

## Endpoint and contracts

`POST /api/muse/conversations/{conversation_id}/messages`

Required existing header: `X-Client-Session-ID`.

```json
{
  "client_message_id": "client-message-1",
  "text": "Show me the latest incident.",
  "expected_revision": 0
}
```

Uses the existing typed MessageRequest: bounded nonblank text, strict nonnegative
revision, bounded client identifier, no unknown fields/session/model overrides.

Illustrative response only (not a live model result):

```json
{
  "conversation_id": "11111111-1111-4111-8111-111111111111",
  "revision": 2,
  "message_id": "22222222-2222-4222-8222-222222222222",
  "status": "completed",
  "text": "The scan found candidate visual matches; this is not proof of infringement.",
  "citations": [
    {"incident_id": "incident-a", "evidence_id": null, "report_id": null, "timestamp_sec": null}
  ],
  "tool_results": [
    {
      "tool": "get_latest_incident",
      "status": "completed",
      "result_ref": "33333333-3333-4333-8333-333333333333",
      "summary": null,
      "data": {"incident_id": "incident-a", "overall_status": "CANDIDATE_MATCH"},
      "error_code": null
    }
  ],
  "pending_action": null,
  "provider": "muse",
  "model_id": "muse-wonder-1.0"
}
```

The example abbreviates tool data; actual data is the Step 3C projection, with
server-derived metrics and timestamps intact. Tool receipts add optional data and
error_code to the prepared ToolResult contract. result_ref is a server reference,
not an authorization token or a separately implemented download route. Citation
adds optional report_id and validates timestamp_sec as a finite, nonnegative strict
number. Assistant message metadata retains status, provenance, citations and up to
three lightweight tool receipts for history retrieval. Receipt data is omitted from
message metadata to avoid duplicating whole source bundles in every historical
message; full observations use the separate bounded source cache. No pending
actions can be created or executed in Stage 3D.

HTTP 200 statuses: completed, needs_clarification, failed. A real tool failure yields
failed with the tool's fixed error_code; it never becomes a successful lookup.
An empty successful incident list produces a deterministic truthful empty-state
sentence, without another model call. Missing reports/evidence do not generate data.

## Natural-language orchestration flow

1. Validate session/header and conversation ownership, expected revision and client
   message ID. Atomically reserve the conversation and append the user message.
   Session mismatches/stale revisions fail before any provider or tool initialization.
2. Reauthorize all incident parents in retained tool context; previously retrieved
   report IDs must still exist under the same incident. Clear an unresolvable or
   other-session selected-incident hint rather than treating it as authority.
3. Resolve the existing `get_reasoning_provider()` lazily. Require its provider_name
   to be muse. If another provider is selected, return MUSE_NOT_SELECTED without
   invoking it; no fallback, source-default change or rollback removal occurs.
4. Call its unchanged `create_text_completion(request)` signature, with configured
   model, system instructions, JSON-encoded dialogue/source context and max_tokens
   2048. Its existing return format is ChatCompletion-like: choices[0].message.content,
   choices[0].finish_reason and model. Require stop and matching returned model ID.
5. Parse one bounded JSON plan locally. Do not send tools, tool_choice,
   response_format, SDK client options or native tool messages. JSON-only output is
   requested in the prompt; API JSON-mode support is not assumed.
6. For tool_call, validate the real registry argument schema, reject duplicate
   canonical calls and dispatch only through the six Step 3C allowlisted tools,
   supplying session_id from server context. Feed sanitized observations back to
   Muse as data for its next plan/response.
7. For answer, validate citations and conservative text constraints before accepting
   it. For clarify, return a bounded clarification request without invented data.
8. Persist the assistant result with the turn token and expected revision. Store
   bounded authorized source observations and update selection only from successful
   single-incident tool results. Release the reservation in finally.

The system prompt describes ordinary-language intent: latest, matching timestamps,
report explanation, ordered-list references such as second one, two-incident
comparison and yesterday. The model interprets language; there is no keyword-to-tool
router or requirement that users know internal names. Yesterday is anchored to the
provided UTC clock; the model is instructed to clarify timezone ambiguity and list
window limits. These instructions are implemented, but real language quality was
not tested live in this step.

## Strict action-plan schema

Tool call:

```json
{"action":"tool_call","tool":"get_latest_incident","arguments":{}}
```

Answer:

```json
{
  "action":"answer",
  "text":"These are visual similarity candidates, not a legal conclusion.",
  "citations":[{"incident_id":"incident-a"}]
}
```

Clarification:

```json
{"action":"clarify","text":"Which incidents would you like to compare?"}
```

Discriminated Pydantic union: unknown actions/tools, extra fields, invalid
arguments, missing answer citations, empty text, oversized text, duplicate JSON
keys, NaN/Infinity and markdown-wrapped JSON are rejected. Tool argument schemas
come directly from the existing registry, including defaults/limits. There is no
code evaluation, arbitrary function dispatch, URL fetching, SQL, shell execution,
filesystem lookup, write registry or session selection by model output.

Available tools remain exactly:
- list_recent_incidents
- get_latest_incident
- get_incident_details
- get_matching_timestamps
- get_evidence_bundle
- get_investigation_reports

## Budgets, context and provenance

- At most three actual read-only tool calls per user turn.
- At most four model completions: up to three tool plans and one final plan.
- Duplicate normalized tool/argument requests fail before a second execution.
- Stop immediately on a tool failure with deterministic safe text and its receipt.
- No automatic model/API retries or invalid-JSON repair calls. Existing Muse SDK
  transport retains its retries-disabled behavior and configured provider timeout.
- Each model request: 2048 output tokens, at most 20,000 returned plan characters.
- Prompt: at most 96 KiB serialized UTF-8; last 12 dialogue messages, each at most
  1500 characters, plus the full bounded current message (up to 8000 characters).
- Source cache: at most four recent successful observations and 48 KiB total.
  Drop oldest observations to fit; a single oversized observation fails safely.
- Each observation records a server result_ref, observed_at, tool and sanitized data.
  Prior sources preserve ordered incident lists for follow-ups. They are historical
  observations, not an automatic refresh of current incident/evidence facts.
- Old assistant messages whose cited incidents are absent from available source
  context are omitted from the prompt. Dialogue alone is never citation authority.
- Provenance reflects the attempted selected Muse/model request; a returned model
  ID mismatch is rejected. If no model request was attempted, provenance stays null.

The default Meta timeout is configured by the existing provider (90 seconds unless
configured otherwise), per completion. There is no separate interruptible whole-turn
job/cancellation framework. In the worst case a turn makes four serial completions.
Ownership rechecks may perform additional bounded parent/report reads beyond the
three model-directed tool invocations. No new database persistence is introduced.

## Grounding and prompt-injection boundaries

Answer citations must reference incident records actually present in successful,
authorized source observations. Evidence/interval and report references must belong
to the cited incident. A cited timestamp requires an evidence/interval ID and must
match that specific record's suspect timestamp/start/end, not another frame or a
reference/source timestamp. No report ID is treated as proof of authorization.

Conservative output checks reject unknown recognizable IDs, numbers absent from
cited structured data, unrecorded status labels, credentials/paths/URLs caught by
existing sanitization, and direct first-person claims of write/email actions.
Structured receipt data is copied from tools, never reconstructed from model prose.
Actual values remain available independently of the natural-language explanation.

All dialogue, filenames, metadata, transcripts and report text are supplied as
untrusted JSON data beneath server system rules. They cannot authorize an action,
change session/provider/model, enable an arbitrary tool or add write capabilities.
Tool registry validation and ownership checks remain the enforcement boundary even
if a prompt injection convinces the model to propose an unauthorized action.

Limits of verification are explicit: citation and lexical checks are not a formal
semantic proof of every sentence. A correctly cited but misleading qualitative
interpretation, number expressed in words, or incorrect meaning/unit attached to an
otherwise recorded number cannot be comprehensively detected by these checks.
The prompt requires cautious grounded language, but live human evaluation remains
necessary before claiming reliable natural-language factual quality. No external
semantic verifier or hidden additional model call was added. Unsupported structured
references/values fail safely; the implementation does not claim universal protection
against every possible hallucination or prompt injection.

## Revisions, failures and conversation lifecycle

- One active turn per conversation; ordinary append/delete and competing turns
  return 409 TURN_IN_PROGRESS. Different conversations remain independent.
- The user append increments revision once; assistant append increments again.
  A first successful turn therefore moves revision 0 → 1 → 2.
- Post-acceptance provider/planning failures store a fixed failed assistant message,
  not raw model output/exceptions. Their HTTP error includes the resulting revision;
  retrieve history and use the current revision with a new client_message_id.
- Errors before acceptance do not append messages or make a model call.
- Reusing a client_message_id found in retained message metadata returns 409
  DUPLICATE_MESSAGE without inference. This is bounded replay protection, not durable
  idempotency/cached response replay after history pruning or process restart.
- Turn completion checks both token and expected revision; it cannot overwrite a
  competing update. Expiry during inference returns 404 and never resurrects history.
- A process crash/client disconnect does not provide distributed cancellation or
  guaranteed assistant completion. The accepted user message can remain alone if
  expiry/unexpected completion conflict occurs; stale content is never overwritten.
- Existing idle TTL, history limit, restart loss and single-process limitations apply.
  Source cache and reservations are also cleared when conversations expire/delete.

Errors use fixed categories/messages: INVALID_PLAN, UNGROUNDED_RESPONSE,
PROVIDER_TIMEOUT (504), PROVIDER_ERROR (502), MUSE_NOT_SELECTED (503),
DUPLICATE_TOOL_CALL, TOOL_BUDGET_EXHAUSTED, CONTEXT_LIMIT (413),
CONTEXT_UNAVAILABLE (409), ASSISTANT_ERROR (500), plus existing session/revision/
lifecycle validation errors. No stack traces or raw upstream payloads are returned.

Example post-acceptance error:

```json
{
  "error":"PROVIDER_TIMEOUT",
  "detail":"Muse timed out. No automatic retry was made.",
  "revision":2
}
```

## Offline verification

From backend/:

```sh
.venv/bin/python -m unittest tests.test_muse_orchestrator tests.test_muse_tools tests.test_muse_conversations tests.test_muse_conversation_api
```

Final result: **91 tests passed** (36 Stage 3D tests plus 55 Step 3B/3C regression tests).

Coverage includes natural-language inputs with scripted intent plans, ambiguity,
follow-ups, ordered second-incident context, comparison, UTC date context, measured
timestamp/report citations, actual Meta adapter with mocked transport, malformed
plans/JSON, extra/unknown tools/arguments, invented IDs, injection data, duplicate
calls, budgets, missing/failed lookups, spoofed/cross-frame citations, unsupported
numbers/statuses, empty/truncated/mismatched-model responses, timeouts, session
mismatch, revisions, simultaneous requests, failed/successful message persistence,
bounded context/history, orphaned/reassigned history and TTL expiry during inference.

The provider is mocked in every orchestration test. One compatibility test uses the
real MetaReasoningProvider with MuseClient.complete mocked. Filesystem and socket
access are guarded during tool/orchestration test execution. No full application
startup, live credentials, database connections or external model/email requests are
used. Scripted plans test wiring and safety behavior; they do not establish that the
live model consistently chooses the right plan or produces correct explanations.

No live AI calls, reports/PDF generation, emails, database writes/migrations,
environment edits, dependency installation, commits, pushes or deployments occurred.
The frontend and voice implementation remain untouched. Stop before the frontend.
