# Muse Assistant — Stage 3, Step 3B

Implemented November 1, 2026, following MUSE_ASSISTANT_ARCHITECTURE_AUDIT.md.
This is a conversation backend foundation only. No AI orchestration, tools,
incident retrieval, report generation, email or frontend changes are included.

## Files and architecture

- `backend/app/muse_conversations.py`: typed Pydantic contracts and an isolated
  in-memory ConversationManager. No provider, database or application imports.
- `backend/app/muse_conversation_api.py`: dedicated lifecycle router, required
  existing session header, lazy per-process manager, sanitized lifecycle errors.
- `backend/app/main.py`: registers the router alongside the existing voice router.
- `backend/tests/test_muse_conversations.py`: offline service/contract tests.
- `backend/tests/test_muse_conversation_api.py`: standalone FastAPI/TestClient tests;
  never imports the full application or starts its database/storage services.
- This document. The pre-existing untracked Stage 3A audit document is preserved.

Conversations contain server-generated UUIDs, session_id, revision (initially 0),
UTC created_at/last_activity_at, bounded messages and optional selected_incident_id.
The incident ID is an unresolved context hint: it grants no access and is not looked
up. A future tool must authorize it before use.

Messages have server-generated UUIDs, user/assistant roles, UTC timestamps,
nonblank trimmed text (maximum 8,000 characters) and fixed optional metadata:
client_message_id, provider, model_id. Metadata values are bounded; arbitrary
metadata dictionaries and unknown request fields are rejected.

Manager create/get/append/delete operations are lock-protected. Objects are deeply
copied on return and message input is copied, preventing caller mutation of stored
history. Append requires expected_revision and rejects stale writes with a service
REVISION_CONFLICT (409) without mutation. Each append increments revision once;
trimming history does not reset it. Reads refresh idle activity, not revision.

## Lifecycle API and sessions

All endpoints require the existing `X-Client-Session-ID` header: 3–64 ASCII letters,
digits, underscores or hyphens. Missing/invalid headers return 400 INVALID_SESSION.
A different session returns 403 SESSION_MISMATCH, including in application demo
mode. No global fallback or session listing exists. Sessions are client-controlled
demo identifiers, not authentication; conversation IDs are not access tokens.

### Create

`POST /api/muse/conversations`

Header: `X-Client-Session-ID: demo-session`

Request (send `{}` when no incident is selected):

```json
{"selected_incident_id": null}
```

Response: HTTP 201. Illustrative shape (UUIDs/timestamps generated at runtime):

```json
{
  "conversation_id": "11111111-1111-4111-8111-111111111111",
  "session_id": "demo-session",
  "revision": 0,
  "created_at": "2026-11-01T10:00:00Z",
  "last_activity_at": "2026-11-01T10:00:00Z",
  "messages": [],
  "selected_incident_id": null
}
```

### Retrieve/delete/errors

- `GET /api/muse/conversations/{conversation_id}`: HTTP 200, same schema including
  bounded history; refreshes idle TTL.
- `DELETE /api/muse/conversations/{conversation_id}`: HTTP 204, empty body.
- Unknown, expired or already deleted IDs: identical HTTP 404 response.
- Invalid UUIDs/payloads/types, unknown fields or missing bodies: standard FastAPI
  HTTP 422 validation response. The new modules do not log submitted values. Standard
  validation errors can echo invalid input, so credentials must never be submitted.
- Active storage capacity reached: HTTP 503; no active history is silently evicted.

Lifecycle error example:

```json
{"error": "CONVERSATION_NOT_FOUND", "detail": "Conversation not found or expired."}
```

## Storage, TTL and limitations

Defaults: 40 retained messages per conversation; at most 256 active conversations
per process. Constructor overrides support isolated tests/demo configuration;
message limit must be 1–100. Each message and its metadata are size-bounded.

Optional runtime setting: `MUSE_CONVERSATION_TTL_SECONDS`, default 1800 (30 minutes),
range 1–86400 seconds. No environment file changed. Invalid settings fail manager
initialization rather than silently disabling expiration.

Idle age uses monotonic time; public timestamps use UTC wall time. Successful reads
and appends refresh TTL; rejected session access does not. Expiration is age >= TTL.
Expired entries are pruned lazily on manager operations, without a background job.
Expired inaccessible entries can remain in bounded memory until the next operation.
There are no expiry tombstones.

This is **single-process ephemeral demo storage**. Backend restarts lose all
conversations. Multiple workers/Cloud Run instances do not share history; routing
to another process may return 404. Use one local backend process for this step.
Durable/shared storage requires separately approved work. No database, schema,
authentication system or dependency was introduced. Session IDs can be supplied by
clients and are not secure ownership proof for public multi-user deployment.

## Future message contracts — not endpoints

`MessageRequest`:

```json
{
  "client_message_id": "client-message-1",
  "text": "Show matching timestamps",
  "expected_revision": 0
}
```

client_message_id: 1–128 ASCII letters/digits/underscores/hyphens. text: strict
nonblank string, maximum 8,000 characters. expected_revision: strict nonnegative
integer (boolean/string coercion rejected). Client message deduplication is not
implemented; no endpoint processes this request yet.

`MessageResponse` illustrative future shape, not an executed AI result:

```json
{
  "conversation_id": "11111111-1111-4111-8111-111111111111",
  "revision": 1,
  "message_id": "22222222-2222-4222-8222-222222222222",
  "status": "needs_clarification",
  "text": "Which incident do you mean?",
  "citations": [],
  "tool_results": [],
  "pending_action": null,
  "provider": null,
  "model_id": null
}
```

Allowed statuses: completed, needs_clarification, awaiting_confirmation, failed.
Citations: at most 20 typed entries with incident_id, optional evidence_id and
finite nonnegative timestamp_sec. Tool results: at most 10 typed tool/status
entries with optional result_ref/summary. Pending action: optional action_id,
action, summary, expires_at. Labels and summaries are bounded. Provenance is
nullable and must reflect actual execution in future steps. These contracts do
not implement tool execution, confirmation challenges or action authorization.

There is deliberately no POST messages endpoint, canned assistant reply, Muse/
Nebius request, Resend call or incident/report operation. Future contracts can be
extended deliberately when actual tools and confirmation behavior are introduced.

## Verification

Run explicitly named isolated modules from `backend/`:

```sh
.venv/bin/python -m unittest tests.test_muse_conversations tests.test_muse_conversation_api -v
```

Result: **23 tests passed**. Coverage: create/get/delete, generated IDs, session
mismatch/missing/invalid contexts, unknown/expired IDs, TTL boundary/refresh,
denied access not refreshing TTL, history bounds, revisions/conflicts, defensive
copies, restart loss, TTL configuration, capacity, message/metadata/response
validation, invalid payloads, HTTP schemas and absence of a message endpoint.

No full application startup, live API request, inference, report generation, email,
database access, environment edit, commit or push was performed. Frontend unchanged;
no frontend build required. Step 3C is not implemented.
