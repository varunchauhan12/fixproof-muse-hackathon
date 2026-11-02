# Muse Assistant — Stage 3D.1: Grounding investigation and diagnostics

## What is established, and what is not

The previous isolated live run returned an answer action after successfully running
get_latest_incident. It then returned HTTP 502 UNGROUNDED_RESPONSE. The raw answer,
its citations and the specific rejecting rule were not retained. That process and
its ephemeral conversation have ended. The original failing field/value cannot be
conclusively recovered. This work made no live AI request or database connection
and does not invent a reconstruction of that answer.

The live error identifies `_validate_response()` as the rejection boundary. Its
code originally mapped every citation, sanitization, ID, number, status and action
failure to the same exception with no reason. It is therefore not possible to
classify that historical live failure as a genuine model error versus a validator
false positive from the available evidence.

A separate, concrete validator defect was demonstrated offline using the real
get_latest_incident tool projection and a fixture incident. It is fixed below.
This is not claimed to be the cause of the historical live failure.

## Demonstrated defect and exact fix

Fixture:
- Authorized incident belongs to the fixture's existing demo session.
- Its scan date is in 2026.
- Its stored suspect_filename is `archive-2024.mp4`.
- Answer cites that incident and says: `The latest media is "archive-2024.mp4".`

Before editing, the actual tool returned that filename unchanged, yet the actual
validator raised UNGROUNDED_RESPONSE. The numeric regex matched 2024 inside the
filename. allowed_numbers included numeric fields and pieces of created_at,
scanned_at and model_id, but not filename labels. Consequently, the exact quoted
stored label was incorrectly rejected as an unsupported measurement.

Fix: after citation checks and the unchanged output sanitization check, mask exact
quoted media basenames from the fixed suspect_filename field of cited incidents
in the temporary lexical-scanning copy. A conservative basename/extension pattern
and exact case-sensitive value match are required. Double/single quotes, backticks
and paired typographic quotes are recognized. The real response is not rewritten.
This also handles an actual quoted filename that happens to contain a UUID without
authorizing that UUID as an incident/report/evidence reference.

This is not a numeric tolerance, rounding rule or blanket string exemption:
- `2024 matches` outside the quoted filename remains rejected.
- A different/unreturned filename is not exempted.
- A filename belonging only to an uncited incident is not exempted.
- Unquoted numeric filenames remain subject to the existing strict checks; the
  prompt now explicitly asks for exact quoted filenames when naming media.
- Arbitrary metadata, summaries, status_message and instructions cannot authorize
  quoted filenames or numeric claims.
- Incident/evidence/report citations and timestamp associations are validated first
  and independently. Quoting a filename never authorizes an entity ID.
- Output sanitization still runs before any masking.

## Safe diagnostic taxonomy

Grounding rejections now create a typed GroundingDiagnostic attached to the internal
AssistantFailure and emit one WARNING through `app.muse_orchestrator`.

| Rule ID | Field category / condition |
|---|---|
| citation.incident | Incident absent from authorized source observations |
| citation.evidence | Evidence/interval absent from the cited incident |
| citation.report | Report absent from the cited incident |
| citation.mixed_reference | A citation combines report and evidence references |
| citation.timestamp_without_evidence | Timestamp lacks evidence/interval binding |
| citation.timestamp | Timestamp does not equal that record's suspect time/boundary |
| text.sanitization | Existing sanitizer would alter the proposed output |
| text.reference | Recognizable ID absent from cited authorized records |
| text.numeric | Unsupported numeric claim |
| text.status | Unsupported recognized status label |
| text.action_claim | Direct first-person claim of a write/external action |

Each event contains only:
- category: fixed UNGROUNDED_RESPONSE.
- rule_id: fixed enum above.
- field_category: fixed enum.
- reference_state: not_in_authorized_sources, different_incident, or not_applicable.
- correlation_id: an independently server-generated UUID per turn (or null for
  direct validator callers without a correlation ID).

The correlation is not a session ID, incident ID, conversation ID, client message
ID or turn-reservation token. No diagnostic includes the rejected value, source
records, user text, credentials, raw headers or raw model response. Reference state
only describes the currently authorized source set; it does not query undisclosed
sessions or claim that an unknown ID exists elsewhere.

Example event without a live identifier:

```json
{
  "category":"UNGROUNDED_RESPONSE",
  "rule_id":"text.numeric",
  "field_category":"numeric_value",
  "reference_state":"not_applicable",
  "correlation_id":null
}
```

Diagnostics are logging/internal exception data, not a new persistent database or
raw-output debug file. HTTP error semantics remain unchanged. Normal logging
configuration controls retention. A future isolated harness must capture this
named logger (or the typed exception diagnostic); globally disabling all logging
will suppress these events. No raw model-output persistence is needed.

Splitting the citation rejection into specific diagnostic branches retains the
same acceptance conditions. Unknown/mismatched references are still rejected;
existing timestamp and output checks remain in place. The only intentional new
acceptance is the demonstrated exact quoted filename-label case.

## Parse, context and prompt investigation

The provider's content is parsed as strict JSON and validated through the existing
discriminated Pydantic plan union before grounding. Invalid JSON, unknown fields,
missing/empty/malformed citations and invalid timestamp types fail as INVALID_PLAN,
not UNGROUNDED_RESPONSE. The Text contract strips leading/trailing whitespace.
Grounding examines that validated plan, not an unrecorded chain of thought.
Sanitization compares a redacted copy against output and rejects changes; it does
not silently rewrite a failing answer into success. The filename fix similarly
uses a temporary scan copy and leaves returned/stored text unchanged.

The source traversal preserves incident association through nested frame, interval
and report structures. Evidence citations accept evidence_id or interval_id; report
citations use report_id; timestamp_sec denotes the specific suspect time/boundary,
not the reference/source timestamp. No demonstrated mismatch in these schemas was
found. Wrong-incident references remain rejected even if that reference exists in
another authorized observation.

get_latest_incident returns metadata/status/metrics and evidence/report availability
indicators, not full frame evidence or report contents. Those details require the
existing matching/evidence/report tools. No evidence establishes that valid data
was accidentally dropped in the original live turn. The filename defect is a
specific omission from the lexical support handling, not from the actual tool
response or authorization checks.

Final-answer instructions now ask for concise qualitative explanations, only
supplied facts, exact quoted filenames when necessary, no unnecessary numeric/ID/
status claims, no rounding/conversions, and no inference of report contents from
report availability. Additional detail must come through the existing read-only
tools. Unknowns should remain unknown. No automatic repair/retry was introduced.

## Files changed in this debugging stage

Modified:
- `backend/app/muse_orchestrator.py`: safe diagnostics, exact quoted filename-label
  handling, more specific final-answer instructions.

Created:
- `backend/tests/test_muse_grounding_diagnostics.py`: focused offline regressions.
- `docs/MUSE_ASSISTANT_STEP_3D_1.md`: this report.

Existing Stage 3A–3D uncommitted work is preserved. No conversation API/schema,
provider, registry, database, vault, frontend or voice file changed in this stage.

## Verification

From backend/:

```sh
.venv/bin/python -B -m unittest tests.test_muse_grounding_diagnostics tests.test_muse_orchestrator tests.test_muse_tools tests.test_muse_conversations tests.test_muse_conversation_api
```

Result: **109 tests passed**: 18 new debugging regressions plus the existing 91.

Coverage includes the reproduced exact-label defect, quote variants, unchanged
returned/stored text through the mocked provider/tool loop, real tool-result-shaped
valid numbers/statuses, qualitative explanation, wrong incident/evidence/report
references, cross-incident citations, mixed citations, timestamp/source-time
spoofing, unsupported numbers/statuses, malformed/missing citations, injected
metadata, filename scope, safe log contents, per-turn correlation, sanitized failed
message persistence and absence of inference retries. Tool/orchestration tests use
fixtures/mocked providers and guard against filesystem/network operations.

`git diff --check` passed. No live inference, external API request, application
restart, database read/write/migration, report generation, email, configuration or
credential change, commit, push or deployment was performed.

## Remaining uncertainty and next validation

A separately authorized isolated live run is required to determine whether Muse
now produces an accepted first answer and follow-up. If it fails, retain only the
safe rule/correlation diagnostic. This stage does not claim to have recovered or
fixed the exact historical live failure. Free-prose semantic limitations described
in Stage 3D still apply; the change is not a universal hallucination verifier.
Stop before Stage 3E.
