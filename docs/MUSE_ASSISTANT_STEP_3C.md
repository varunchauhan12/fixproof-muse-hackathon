# Muse Assistant — Stage 3, Step 3C: Read-only tools

Implemented November 1, 2026. Follows the Stage 3A architecture audit and Stage 3B
conversation foundation. This layer is not connected to messages, models, routes
or the frontend yet. Stage 3D remains unimplemented.

## Changed files and preserved work

Created:
- `backend/app/muse_tools.py`: fixed tool registry, argument/result contracts,
  read adapter, bounded allowlisted projections and sanitized failures.
- `backend/tests/test_muse_tools.py`: isolated offline tools and strict-read tests.
- `docs/MUSE_ASSISTANT_STEP_3C.md`: this document.

Modified:
- `backend/app/registry.py`: opt-in `exact_session` incident lists and `strict_read`
  detail/report reads. Defaults preserve existing callers' behavior. Strict cloud
  incident lists filter ownership BEFORE the existing 200-row limit and use a
  stable timestamp/ID ordering. Strict detail reads never use global listing
  fallbacks. Strict local list/report reads propagate errors rather than pretending
  damaged/unreadable storage is an empty collection.

Pre-existing Stage 3A/3B uncommitted files and main.py changes were preserved.
No voice, frontend, configuration, environment or provider files changed.

## Tools implemented

| Tool | Arguments | Stored output |
|---|---|---|
| list_recent_incidents | optional limit, default 10, range 1–25 | IDs, scan timestamps, recorded status/type, metrics, frame/report indicators |
| get_latest_incident | none | Deterministically selected owned incident's details; empty list is NOT_FOUND |
| get_incident_details | incident_id | Recorded metadata/status, scan timestamp, metrics, limitations, disclaimer, evidence/report indicators |
| get_matching_timestamps | incident_id | Exact stored suspect/reference frame timestamps and deterministic measured timeline intervals |
| get_evidence_bundle | incident_id | Sanitized incident summary, matching evidence/timeline, recorded limitations |
| get_investigation_reports | incident_id | Existing report IDs, dates, provenance, validation, retrieval persistence status, summaries and review flags |

Incident IDs must match `[a-zA-Z0-9_-]{1,128}`; malformed paths/IDs and unknown fields
are rejected. Limits use strict integers; booleans do not count as integers.

Latest ordering is descending normalized UTC scan timestamp, then descending
incident ID. ISO timestamps with offsets compare as instants; legacy naive
values are interpreted as UTC. Missing/invalid dates remain null in projections.
If a candidate lacks a usable date, latest returns DATA_UNAVAILABLE instead of
inventing its chronological position. Cloud reads have the existing latest-200
session-owned window; local reads sort actual stored session records. SQL ordering
matches timestamp/ID tie breaking before its limit. No model participates.

`investigation_status` is returned only when explicitly stored; otherwise null.
The recorded scan overall_status and report availability remain separate facts.
No running-job state or completed synthesis is inferred from a similarity score.

## Existing functions reused and side effects avoided

`RegistryReadStore` calls only:

- `registry.load_incidents(session_id=..., exact_session=True)`.
- `registry.get_incident_by_id(..., strict_read=True)`.
- `registry.get_nemotron_reports_for_incident(..., strict_read=True)`.

Evidence preparation reuses `evidence_models.build_frame_evidence_from_matches`
and `timeline.cluster_frame_matches`. These are pure transformations. The wrapper
first rejects missing, nonnumeric, negative or nonfinite timestamps, preserving
real zero timestamps. It excludes absent source timestamps, invalid source IDs,
NO_MATCH/low-entropy records and noncandidate observations from matching output.
Evidence IDs use the existing normalization helper; they are normalized frame
references, not newly created/persisted evidence. Singleton intervals retain zero
duration; sample continuity does not establish unsampled footage correspondence.

The existing `detailed_report.build_evidence_bundle()` was inspected and deliberately
not called here: its module initializes providers/directories; the function imports
the default vault, enumerates reference assets, resolves image paths, supplies
missing timestamps/defaults, and includes report/vision reasoning fields. Vault
initialization may reconcile/checkpoint state. Those dependencies are inappropriate
for this isolated strict read layer. Reusing its underlying pure evidence/timeline
helpers provides the required safe subset without changing existing report behavior.
The tool bundle does not claim to be the full PDF forensic bundle.

`registry.get_nemotron_report_history()` is also avoided: it resolves the current
reasoning provider and defaults missing historical model/validation fields. The new
projection uses recorded fields only; missing provider/model/validation values are
null. It never infers that an old report ran on today's configured provider.

No PDF GET, report generation, export, email, signed URL generation, model inference,
vault initialization or arbitrary file access is invoked. Raw metadata, paths,
image bytes, private reasoning, model payloads and operational error strings are
not projected. Free text is length-bounded and sanitized using existing credential
redaction plus URL/absolute-path/credential-assignment filtering. Tool errors are
fixed text, not exception contents.

## Integration and session ownership

The registry is intentionally independent of orchestration. Future application
wiring can bind the already-loaded registry module:

```python
from app import registry  # Existing application's startup owns initialization.
from app.muse_tools import MuseToolRegistry, RegistryReadStore

tools = MuseToolRegistry(RegistryReadStore(registry))
result = tools.execute(
    "get_incident_details",
    session_id=validated_server_session,
    arguments={"incident_id": requested_incident_id},
)
```

This is a future wiring example, not code executed by this step. Explicit adapter
injection prevents tool-module import/execution from initializing registry's legacy
module-level directories/dotenv configuration. Offline tests inject fixture stores.
No new endpoint or automatic registration/execution on user messages exists.

The future caller must obtain session_id from the existing X-Client-Session-ID
request context/conversation, never from model arguments. All six tools validate
its existing 3–64-character pattern before any store read. Argument models forbid
session_id and all extra fields. Lists filter exact ownership even if an adapter
returns extra records. Detail/evidence/report operations load the requested parent
and require exact session equality. Null-session and demo-showcase incidents are
not implicitly shared. Demo mode never bypasses these checks.

Every returned report must match the authorized incident ID. Any mismatched or
unbound report in the retrieved set fails closed, including beyond the output
limit. An orphaned report cannot be fetched without an existing authorized parent;
missing parent returns NOT_FOUND before reports are read. No report-ID lookup,
session discovery or arbitrary function dispatch is exposed.

Sessions remain client-controlled demo identifiers, not authentication. This step
does not claim secure public multi-user identity or alter the rest of the app's
legacy demo visibility policy.

## Result contract

`execute()` returns the typed `MuseToolResult`; serialize with `.model_dump(mode="json")`.
All results contain tool, status, data, error. Status is success or error.

Success example:

```json
{
  "tool": "list_recent_incidents",
  "status": "success",
  "data": {
    "incidents": [],
    "returned_count": 0,
    "truncated": false,
    "source_limit_note": "Cloud reads cover at most the latest 200 session-owned incidents; local reads cover stored session records."
  },
  "error": null
}
```

Failure example:

```json
{
  "tool": "get_investigation_reports",
  "status": "error",
  "data": null,
  "error": {
    "code": "NOT_FOUND",
    "detail": "The requested stored data was not found."
  }
}
```

Fixed codes: NOT_FOUND, ACCESS_DENIED, INVALID_ARGUMENT, DATA_UNAVAILABLE,
INTERNAL_ERROR. Missing reports never trigger synthesis. Empty/unusable matching
or bundle evidence returns DATA_UNAVAILABLE. Invalid/missing session is
INVALID_ARGUMENT; other-session ownership is ACCESS_DENIED. Unknown tool names
are represented as `unknown`, avoiding reflection of untrusted content.

## Bounds and limitations

- Incident list: maximum 25 outputs; cloud source window maximum 200 per session.
- Frame processing: first 50 stored frame entries, then valid matching subset;
  bounds report examined/input counts, invalid timestamps omitted, and truncation.
- Intervals: maximum 50, each with at most 50 normalized evidence IDs.
- Report history: maximum 20, date/ID sorted, with explicit truncation.
- Text: normally 500 characters, labels/IDs up to 128, report summaries up to 1000;
  limitation lists at most 10 items.
- JSON data payload: maximum 96 KiB; overflow returns DATA_UNAVAILABLE.
- No synthetic provider/validation defaults, no live entitlement/status inference.
- `persistence_status: retrieved_from_store` means the existing retrieval succeeded;
  it is not a promise of durable cloud storage, PDF existence or future availability.
- No report-only timeline fallback if frame evidence is missing; no generated PDF
  checks, full vision narrative, reference-media discovery or underlying media reads.
- Existing cloud/local registry readers can normalize legacy metrics/defaults;
  tools do not independently reconstruct missing original database values.
- Stored records are assumed to be normal application-sized data. Responses and
  frame processing are bounded, but existing local readers load JSON collections,
  and report retrieval loads stored report history before filtering/projection.
  There is no new database pagination or per-query snapshot/transaction layer.
- No async job, provider planning, conversation context updates or tool execution
  endpoint. Those belong to later approved stages.

## Offline verification

From `backend/`:

```sh
.venv/bin/python -m unittest tests.test_muse_tools tests.test_muse_conversations tests.test_muse_conversation_api
```

Final result: **55 tests passed** (32 Step 3C tests plus 23 Step 3B regression tests).
Tests cover owned/empty lists; deterministic latest selection with offset/tie
handling; invalid IDs/arguments; cross-session/null/demo denial; missing context;
exact matching timestamps, stable evidence IDs after filtering and singleton continuity; absent/invalid evidence;
empty bundles; report provenance and unknowns; report/parent association; orphaned
and absent reports; result bounds; fixed sanitized errors; source immutability;
and strict storage query/filter/error behavior.

Tool tests prohibit filesystem opens/mkdir and socket connections, use fixtures,
and assert only allowed retrieval calls occur. Strict registry tests execute the
actual read function definitions extracted from source with mocked dependencies,
avoiding registry's import-time dotenv/directory setup and full app/vault startup.
They verify strict SQL ownership filtering before LIMIT, absence of global fallback,
error propagation and preserved legacy defaults. No live database was contacted.

`git diff --check` passed. No live AI/API requests, report/PDF generation, emails,
database changes/migrations, dependency installation, credential edits, commits,
pushes or deployments occurred. Stop here before Stage 3D approval.
