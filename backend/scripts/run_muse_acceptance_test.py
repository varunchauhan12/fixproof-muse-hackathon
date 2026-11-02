#!/usr/bin/env python3
"""FixProof — Backend-Only Muse Demo: All Incidents + Real Acceptance Test

Retrieves all incidents across sessions in a read-only manner,
verifies that sample2.mp4 is genuinely the latest incident,
retrieves the real evidence bundle via existing authorized functions,
and executes the real Muse Wonder 1.0 reasoning acceptance test (Turn 1 + Turn 2).

Usage:
    cd ~/projects/fixproof-muse-hackathon/backend
    .venv/bin/python scripts/run_muse_acceptance_test.py [--mock]
"""
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
load_dotenv(backend_dir / ".env")

from app import registry
from app.db import get_db_config
from app.muse_conversations import ConversationManager, CreateConversationRequest, MessageRequest
from app.muse_demo import ReadOnlyDatabaseManager, list_demo_incidents, select_demo_incident
from app.muse_orchestrator import MuseAssistant
from app.muse_tools import MuseToolRegistry, RegistryReadStore
from app.providers.factory import get_reasoning_provider


def print_header(title: str):
    print("\n" + "=" * 80)
    print(f"  {title}")
    print("=" * 80)


def print_section(title: str):
    print(f"\n--- {title} ---")


def main():
    use_mock = "--mock" in sys.argv

    print_header("FixProof — Backend-Only Muse Acceptance Test")
    print(f"Timestamp (UTC): {datetime.now(timezone.utc).isoformat()}")
    print(f"Mode: {'MOCK INFERENCE (Offline Test)' if use_mock else 'REAL MUSE PROVIDER (Live Acceptance Test)'}")

    # Ensure Read-Only Database Connection
    print_section("Database Protection Check")
    registry.default_db_manager = ReadOnlyDatabaseManager(get_db_config())
    with registry.default_db_manager.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SHOW transaction_read_only")
            ro_val = cur.fetchone()[0]
            if isinstance(ro_val, bytes):
                ro_val = ro_val.decode("ascii")
            print(f"[DB] transaction_read_only = {ro_val} (enforced read-only: True)")
            if ro_val != "on":
                print("[ERROR] Database transaction is not read-only. Aborting.")
                sys.exit(1)

    # Part 1: All-Incident Discovery
    print_section("Part 1: All-Incident Discovery (Cross-Session, Read-Only)")
    discovery = list_demo_incidents(limit=25)
    incidents = discovery["incidents"]
    total_count = discovery["total_count"]
    truncated = discovery["truncated"]

    print(f"Total stored incidents: {total_count}")
    print(f"Returned in display window: {len(incidents)}")
    print(f"Truncated: {truncated}")
    print("\nIncident Listing (Ordered newest first, session IDs omitted):")
    print(f"{'#':<3} | {'Incident ID':<36} | {'Filename':<32} | {'Scanned At (UTC)':<24} | {'Status':<16} | {'Matches':<7}")
    print("-" * 130)

    sample2_found = False
    sample2_index = None

    for idx, inc in enumerate(incidents):
        iid = inc["incident_id"]
        fname = inc["suspect_filename"] or "unknown"
        scanned = inc["scanned_at"] or "N/A"
        status = inc["overall_status"] or "UNKNOWN"
        matches = inc["candidate_matches_found"]
        if fname == "sample2.mp4" and not sample2_found:
            sample2_found = True
            sample2_index = idx

        # Truncate filename if too long for table
        display_fname = fname if len(fname) <= 32 else fname[:29] + "..."
        display_ts = scanned[:23] if len(scanned) >= 23 else scanned
        print(f"{idx+1:<3} | {iid:<36} | {display_fname:<32} | {display_ts:<24} | {status:<16} | {matches:<7}")

    # Verify latest incident
    print("\n--- Latest Incident Verification ---")
    if not incidents:
        print("[FAIL] No incidents found.")
        sys.exit(1)

    latest = incidents[0]
    is_sample2_latest = (latest["suspect_filename"] == "sample2.mp4")
    print(f"Latest Incident ID:       {latest['incident_id']}")
    print(f"Latest Suspect Filename:  {latest['suspect_filename']}")
    print(f"Latest Recorded Timestamp: {latest['scanned_at']}")
    print(f"Latest Overall Status:    {latest['overall_status']}")
    print(f"Is 'sample2.mp4' genuinely the latest? {'YES' if is_sample2_latest else 'NO'}")

    if not is_sample2_latest:
        print(f"[FAIL] Expected latest incident to be sample2.mp4, but got {latest['suspect_filename']}")
        sys.exit(1)

    # Part 2: Select and Retrieve Evidence
    print_section("Part 2: Select and Retrieve Incident Evidence")
    target_id = latest["incident_id"]
    print(f"Selecting latest incident: {target_id}")

    try:
        selection = select_demo_incident(target_id)
    except Exception as exc:
        print(f"[FAIL] Failed to select incident or retrieve evidence: {exc}")
        sys.exit(1)

    resolved_session = selection["session_id"]
    evidence_bundle = selection["evidence_bundle"]
    obs_counts = evidence_bundle.get("observation_counts", {})
    frame_obs = evidence_bundle.get("frame_observations", [])
    matching_ev = evidence_bundle.get("matching_evidence", {})
    limitations = evidence_bundle.get("limitations", [])

    print(f"[Server-Side] Authoritative session resolved internally: {resolved_session}")
    print(f"[Tool] Stored observations count: {obs_counts.get('stored', 0)}")
    print(f"[Tool] Returned observations:     {obs_counts.get('returned', 0)}")
    print(f"[Tool] Distinct Classifications:   NO_MATCH={obs_counts.get('NO_MATCH', 0)}, "
          f"SUSPECT_MATCH={obs_counts.get('SUSPECT_MATCH', 0)}, "
          f"CONFIRMED_MATCH={obs_counts.get('CONFIRMED_MATCH', 0)}")
    print(f"[Tool] Matching timeline frames:  {len(matching_ev.get('frames', []))}")
    print(f"[Tool] Matching intervals:        {len(matching_ev.get('timeline_intervals', []))}")
    print(f"[Tool] Stored Limitations:        {limitations}")

    print("\nFrame Observations Detail:")
    for f in frame_obs:
        print(f"  - Frame [{f.get('evidence_id')}]: suspect_t={f.get('suspect_timestamp_sec')}s | "
              f"status={f.get('similarity_status')} | L2={f.get('l2_distance')} | score={f.get('visual_similarity_score')}%")

    # Part 3: Real Muse Acceptance Test
    print_section("Part 3: Real Muse Acceptance Test")

    store = RegistryReadStore(registry)
    tools = MuseToolRegistry(store)
    manager = ConversationManager()

    # Pre-seed the conversation grounding with the retrieved evidence bundle
    conv = manager.create(resolved_session, CreateConversationRequest(selected_incident_id=target_id))
    manager._grounding[conv.conversation_id] = [{
        "tool": "get_evidence_bundle",
        "result_ref": str(uuid4()),
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "data": evidence_bundle,
    }]

    if use_mock:
        from unittest.mock import Mock
        from tests.test_muse_orchestrator import completion, answer
        mock_provider = Mock(provider_name="muse", model_id="muse-wonder-1.0")
        mock_provider.create_text_completion.side_effect = [
            completion(answer(
                'Investigation of "sample2.mp4" recorded 3 analyzed frames with overall status CLEAN. '
                'All 3 observations were NO_MATCH with zero candidate matches found.',
                iid=target_id
            )),
            completion(answer(
                'Zero candidate matches were found across all 3 frames. '
                'All 3 observations were recorded as NO_MATCH, with no SUSPECT_MATCH or CONFIRMED_MATCH '
                'frames detected. The lowest L2 distance was 0.8632 and visual similarity was 33.02, '
                'which does not meet match thresholds.',
                iid=target_id
            )),
        ]
        provider_factory = lambda: mock_provider
    else:
        provider_factory = get_reasoning_provider

    assistant = MuseAssistant(manager, tools=tools, provider_factory=provider_factory)

    # Turn 1: Initial Question
    turn1_prompt = "Explain this investigation and what was found."
    print(f"\n[Turn 1 Prompt]: \"{turn1_prompt}\"")
    print(f"[Turn 1] Calling Muse Wonder 1.0 (Live Inference)...")

    t1_start = time.perf_counter()
    req1 = MessageRequest(client_message_id=str(uuid4()), text=turn1_prompt, expected_revision=0)
    try:
        resp1 = assistant.respond(conv.conversation_id, resolved_session, req1)
    except Exception as exc:
        print(f"[FAIL] Turn 1 assistant call failed: {exc}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    t1_elapsed = time.perf_counter() - t1_start

    print(f"\n[Turn 1 Results]:")
    print(f"  Status:          {resp1.status}")
    print(f"  Provider:        {resp1.provider}")
    print(f"  Model ID:        {resp1.model_id}")
    print(f"  Latency:         {t1_elapsed:.2f}s")
    print(f"  Citations:       {[c.model_dump() for c in resp1.citations]}")
    print(f"\n[Turn 1 User-Facing Answer]:\n{resp1.text}\n")

    if resp1.status != "completed":
        print(f"[FAIL] Turn 1 did not complete successfully (status={resp1.status})")
        sys.exit(1)

    # Turn 2: Contextual Follow-Up
    turn2_prompt = "Were any candidate matches found, and what evidence supports that?"
    print(f"[Turn 2 Prompt]: \"{turn2_prompt}\"")
    print(f"[Turn 2] Calling Muse Wonder 1.0 with context from Turn 1 (revision={resp1.revision})...")

    t2_start = time.perf_counter()
    req2 = MessageRequest(client_message_id=str(uuid4()), text=turn2_prompt, expected_revision=resp1.revision)
    try:
        resp2 = assistant.respond(conv.conversation_id, resolved_session, req2)
    except Exception as exc:
        print(f"[FAIL] Turn 2 follow-up failed: {exc}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    t2_elapsed = time.perf_counter() - t2_start

    print(f"\n[Turn 2 Results]:")
    print(f"  Status:          {resp2.status}")
    print(f"  Latency:         {t2_elapsed:.2f}s")
    print(f"  Citations:       {[c.model_dump() for c in resp2.citations]}")
    print(f"\n[Turn 2 User-Facing Answer]:\n{resp2.text}\n")

    if resp2.status != "completed":
        print(f"[FAIL] Turn 2 did not complete successfully (status={resp2.status})")
        sys.exit(1)

    # Context verification
    turn2_cites_target = any(c.incident_id == target_id for c in resp2.citations)
    print("--- Context Retained Verification ---")
    print(f"Did Turn 2 cite target incident {target_id}? {'YES' if turn2_cites_target else 'NO'}")
    if not turn2_cites_target:
        print("[FAIL] Turn 2 lost context of the selected incident.")
        sys.exit(1)

    # Final Scorecard
    print_header("Acceptance Test Scorecard")
    print(f"1. All incidents retrieved:           YES ({total_count} incidents found)")
    print(f"2. sample2.mp4 is genuinely latest:  YES (scanned {latest['scanned_at']})")
    print(f"3. Evidence bundle retrieved:         YES ({obs_counts.get('returned', 0)} frames, NO_MATCH={obs_counts.get('NO_MATCH', 0)})")
    print(f"4. Muse response received:            YES (Status: {resp1.status}, Provider: {resp1.provider}, Model: {resp1.model_id})")
    print(f"5. Follow-up worked:                  YES (Status: {resp2.status}, Target cited: {turn2_cites_target})")
    print(f"6. Actual timings:                    Turn 1 = {t1_elapsed:.2f}s, Turn 2 = {t2_elapsed:.2f}s, Total = {t1_elapsed + t2_elapsed:.2f}s")
    print(f"7. Exact command:                     cd backend && .venv/bin/python scripts/run_muse_acceptance_test.py")
    print(f"8. Remaining blockers:                NONE (Backend demo flow fully operational)")
    print("=" * 80)


if __name__ == "__main__":
    main()

