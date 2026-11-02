#!/usr/bin/env python3
"""Execute the exact browser flow for FixProof Muse Demo Acceptance Test.

Simulates the browser client calling:
1. GET /api/muse/incidents
2. POST /api/muse/conversations with selected_incident_id for sample2.mp4
3. Turn 1: POST /api/muse/conversations/{id}/messages
   Prompt: "Show me the latest incident and explain what happened."
4. Turn 2: POST /api/muse/conversations/{id}/messages
   Prompt: "Were any candidate matches found, and what evidence supports that?"

Reports status, timings, tool calls, grounding results, citations, and responses.
"""
import json
import sys
import time
import urllib.request
import urllib.error
from uuid import uuid4

BASE_URL = "http://127.0.0.1:8000"
SESSION_ID = "sess_hn4b9l85ox_mvr0c2em"
TARGET_INCIDENT_ID = "9e5d20bd-9474-4d9b-a7f6-1ec8e781d5d2"


def http_request(method: str, path: str, body: dict = None) -> dict:
    url = f"{BASE_URL}{path}"
    headers = {
        "X-Client-Session-ID": SESSION_ID,
        "Accept": "application/json",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            content = resp.read().decode("utf-8")
            return json.loads(content) if content else {}
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8")
        print(f"[HTTP ERROR {exc.code}]: {err_body}")
        raise


def main():
    print("=" * 80)
    print("FixProof Muse Demo — Live Acceptance Test (Browser Flow)")
    print("=" * 80)

    # Step 1: Discover Incidents
    print("\n--- Step 1: Discover Incidents (GET /api/muse/incidents) ---")
    t0 = time.perf_counter()
    incidents_resp = http_request("GET", "/api/muse/incidents")
    t_incidents = time.perf_counter() - t0
    data = incidents_resp.get("data", {})
    incidents = data.get("incidents", [])
    print(f"Loaded {len(incidents)} incidents in {t_incidents:.2f}s")
    if not incidents:
        print("[FAIL] No incidents returned.")
        sys.exit(1)

    latest = incidents[0]
    print(f"Latest incident ID:       {latest['incident_id']}")
    print(f"Latest suspect filename:  {latest['suspect_filename']}")
    print(f"Latest scanned at:        {latest['scanned_at']}")
    print(f"Latest status:            {latest['overall_status']}")

    if latest["incident_id"] != TARGET_INCIDENT_ID:
        print(f"[WARN] Expected target {TARGET_INCIDENT_ID}, but latest is {latest['incident_id']}")

    # Step 2: Create Conversation with selected incident
    print(f"\n--- Step 2: Create Conversation (POST /api/muse/conversations) ---")
    print(f"Selecting incident: {TARGET_INCIDENT_ID} ({latest['suspect_filename']})")
    conv = http_request("POST", "/api/muse/conversations", {
        "selected_incident_id": TARGET_INCIDENT_ID
    })
    conv_id = conv["conversation_id"]
    revision = conv["revision"]
    print(f"Conversation created: ID={conv_id}, revision={revision}, selected_incident={conv.get('selected_incident_id')}")

    # Step 3: Turn 1
    turn1_prompt = "Show me the latest incident and explain what happened."
    print(f"\n--- Step 3: Turn 1 ---")
    print(f"User Message: \"{turn1_prompt}\"")
    t1_start = time.perf_counter()
    msg1 = http_request("POST", f"/api/muse/conversations/{conv_id}/messages", {
        "client_message_id": str(uuid4()),
        "text": turn1_prompt,
        "expected_revision": revision,
    })
    t1_elapsed = time.perf_counter() - t1_start

    print(f"\n[Turn 1 Response Received]:")
    print(f"  Status:          {msg1.get('status')}")
    print(f"  Provider:        {msg1.get('provider')}")
    print(f"  Model ID:        {msg1.get('model_id')}")
    print(f"  Revision:        {msg1.get('revision')}")
    print(f"  Latency:         {t1_elapsed:.2f}s")
    print(f"  Tools Called:    {[r.get('tool') for r in msg1.get('tool_results', [])]}")
    print(f"  Citations:       {msg1.get('citations')}")
    print(f"\n[Turn 1 User-Facing Answer]:\n{msg1.get('text')}\n")

    if msg1.get("status") != "completed":
        print(f"[FAIL] Turn 1 status was not completed: {msg1.get('status')}")
        sys.exit(1)

    revision = msg1["revision"]

    # Step 4: Turn 2
    turn2_prompt = "Were any candidate matches found, and what evidence supports that?"
    print(f"\n--- Step 4: Turn 2 (Contextual Follow-Up) ---")
    print(f"User Message: \"{turn2_prompt}\" (expected_revision={revision})")
    t2_start = time.perf_counter()
    msg2 = http_request("POST", f"/api/muse/conversations/{conv_id}/messages", {
        "client_message_id": str(uuid4()),
        "text": turn2_prompt,
        "expected_revision": revision,
    })
    t2_elapsed = time.perf_counter() - t2_start

    print(f"\n[Turn 2 Response Received]:")
    print(f"  Status:          {msg2.get('status')}")
    print(f"  Provider:        {msg2.get('provider')}")
    print(f"  Model ID:        {msg2.get('model_id')}")
    print(f"  Revision:        {msg2.get('revision')}")
    print(f"  Latency:         {t2_elapsed:.2f}s")
    print(f"  Tools Called:    {[r.get('tool') for r in msg2.get('tool_results', [])]}")
    print(f"  Citations:       {msg2.get('citations')}")
    print(f"\n[Turn 2 User-Facing Answer]:\n{msg2.get('text')}\n")

    if msg2.get("status") != "completed":
        print(f"[FAIL] Turn 2 status was not completed: {msg2.get('status')}")
        sys.exit(1)

    # Verification: Did Turn 2 cite the target incident?
    turn2_cites_target = any(c.get("incident_id") == TARGET_INCIDENT_ID for c in msg2.get("citations", []))
    print(f"Context Retained: Cites target incident ({TARGET_INCIDENT_ID})? {'YES' if turn2_cites_target else 'NO'}")

    # Summary
    print("\n" + "=" * 80)
    print("Acceptance Test Results Summary")
    print("=" * 80)
    print(f"Turn 1 Status:   {msg1.get('status')}")
    print(f"Turn 1 Latency:  {t1_elapsed:.2f}s")
    print(f"Turn 2 Status:   {msg2.get('status')}")
    print(f"Turn 2 Latency:  {t2_elapsed:.2f}s")
    print(f"Total Latency:   {t1_elapsed + t2_elapsed:.2f}s")
    print("=" * 80)


if __name__ == "__main__":
    main()

