# Application restoration: implemented repairs and verification

This is a progress report, not a claim that all requested completion criteria pass.

## Root causes established

- The local backend was launched with FIXPROOF_DB_MODE=local, overriding the intended
  Supabase configuration. Local persistence is JSON/filesystem, not SQLite.
- Local save_incident loaded the session-filtered public list, then truncated it to
  100 items before rewriting the registry. Saving a record could discard other
  sessions' records. Local get_incident_by_id also used that filtered list, causing
  session-owned incidents to return not found even when present on disk.
- An empty/unregistered reference vault exits matcher before CV/vision with
  NO_REFERENCE_DATA. This explains a concrete fast-completion path; it does not
  prove every previously observed fast scan took that path. The branch discarded
  extracted-frame metadata, leaving the UI with an empty evidence list.
- Per-frame decoding/feature exceptions were logged and skipped. If all failed,
  downstream logic could produce CLEAN. These failures now raise an analysis error.
- Summary/PDF downloads omitted the session header required by their endpoints;
  the prior repair changed them to fetchNoCache. This explains authorization
  failures, while the filtered ID lookup/database mismatch explains not-found cases.
- Cloud media upload failures were logged and ignored before saving an incident.
  The scan now returns 503 before incident creation when its media cannot persist.
- Detailed reports are filesystem JSON/PDFs. Multi-instance durable report storage
  remains unresolved; no cloud schema or storage architecture was added here.

## Database verification and runtime

The configured project identity matched the expected new project. Explicit BEGIN
READ ONLY succeeded (transaction_read_only=on). Relevant table columns, check
constraints, primary/foreign keys were inspected. Existing counts: incidents 2,
reference_assets 1, nemotron_reports 0, vision_verifications 6, vault_snapshots 1.
The active snapshot checksum matched, and its metadata had zero orphan vectors.
No schema migration was required for the fields used by these repairs.

Only SELECT/read operations and authenticated snapshot downloads were performed.
No new cloud records or media were written by this task. No local records were
copied into PostgreSQL. Startup reconciliation had no orphan vectors to prune.

The identified local backend was restarted without the local-mode override. Its
actual status returned db_mode=supabase, is_cloud=true, provider=muse,
vision_provider=muse, and one registered cloud asset. The current source factory
continues to route all six migrated operations through Meta when Muse is selected.
No live model invocation or email dispatch was used for verification.

## Repairs implemented

- registry.py: internal unfiltered local persistence read; preserve every session
  and all records on append; reject malformed registries; atomic file replacement;
  direct local lookup followed by existing route authorization. No session bypass.
- matcher.py: preserve real extracted-frame entries without reference candidates;
  retain NO_REFERENCE_DATA; fail on unreadable/unprocessable frames rather than
  silently treating their absence as a clean comparison. CV thresholds unchanged.
- main.py: real upload/decode/extract, CV/vision, and media-persistence durations
  returned as processing_timings; fail cloud media persistence before incident save.
- registry.py: retain processing_timings in the existing JSON evidence dossier and
  return them on cloud incident list/detail reads. No new table/column.
- NemotronCenter.tsx (previous repair): session-aware summary/PDF download requests.

New tests: backend/tests/test_pipeline_repair.py. Existing offline runner gains
--repair. This document is the only new report from this repair pass. Earlier
uncommitted Phase 0A/0B and Meta stages are preserved. Generated frontend output was
rebuilt and the identified local frontend process restarted to serve current code.

## Tests actually executed

All backend automated tests used the existing disposable offline runner: real
environment loading disabled, model/cloud variables cleared, socket connections
blocked. They did not write to the intended cloud database.

| Check | Result |
|---|---|
| New repair suite | 2 tests passed, including multiple pipeline assertions |
| Stage C vision | 13 passed |
| Stage B reasoning (includes Stage A) | 17 passed |
| Phase 0A parity | 91 passed |
| Phase 0B security | 10 passed |
| Full backend run before final timing additions | 282 run; 263 passed, 7 failures, 5 errors, 7 skipped |
| Final frontend webpack production build + TypeScript | Passed |
| Diff whitespace | Passed |

The real-video test uses the existing acceptance_ref_broadcast.mp4, decodes actual
frames, indexes those frames using MobileNetV3/FAISS, scans the actual video through
FastAPI, verifies eligible pair dispatch with a mocked Muse result, persists the
incident, and retrieves a JPEG through the frame API. It checks JPEG bytes/MIME,
session-specific list/detail visibility, cross-session denial, registry module
reload persistence, summary download, mocked Muse detailed JSON synthesis and PDF
download. No fabricated media or incidents are used in the running application.
All test-generated records/media remain confined to disposable test copies.

The preservation test starts with 105 records in another session, adds one new
record and confirms all 106 remain, checks session filters and direct ID lookup,
and verifies corrupt JSON cannot be overwritten by a save attempt.

Module reload in this test is not a full process-restart persistence test. Browser
frame rendering and a newly created cloud incident surviving backend restart were
not verified. Frame API retrieval is verified independently of browser rendering.

The full suite remains red. Remaining failing IDs are the existing matcher/forensic
reference-registration fixtures and offline cloud-delete configuration case. The
session-persistence failure observed previously now passes. Some error details
changed because NO_REFERENCE_DATA now retains unmatched frame entries. No failing
assertion was removed or skipped. Full suite was not rerun after the final small
timing additions; the final repair suite passed after those changes.

## Outstanding work and blockers

- New cloud writes/restart persistence, both dashboards with a newly created cloud
  case, and actual browser-rendered frames have not been validated.
- Full suite failures still require resolution; passing focused tests do not
  establish full application readiness.
- Detailed report durability across instances remains unresolved.
- Atomic local file replacement does not provide a cross-process write lock.
- Cloud media failure may leave partial uploaded objects; rollback/retry handling
  needs further repair without deleting existing evidence.
- Six-agent orchestration, voice, Copilot, SAM, temporal/multiframe enhancements
  were not implemented or verified. Live model access/entitlements remain
  unverified; capabilities must not be advertised as working on this evidence.
- No production deployment, commit, push, provider removal, schema change or
  credential change occurred. Existing source/data in protected repositories was
  not modified. Local original media/reports/audit records were preserved.

## Local startup and controlled validation plan

Backend (backend directory):

```sh
./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Do not set FIXPROOF_DB_MODE=local when intending to use the configured Supabase.
Frontend generated runtime (frontend/.next/standalone directory):

```sh
PORT=3000 HOSTNAME=127.0.0.1 node server.js
```

Both are left running. Backend: http://127.0.0.1:8000 . Dashboard:
http://127.0.0.1:3000/dashboard?tab=nemotron .

Before controlled live validation: resolve remaining offline failures, verify media
and report retrieval in the browser, and obtain separate authorization for paid
model calls. Then use one small real video with one session, verify its new UUID
records and media without overwriting anything, permit at most one Muse vision
pair if eligible and one reasoning call, and verify downloads and process-restart
retrieval. Do not supply an email recipient or invoke any send endpoint. Do not
deploy until this acceptance run and durable report strategy have been reviewed.
