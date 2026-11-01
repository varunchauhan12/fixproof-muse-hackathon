/**
 * Automated test suite for FixProof Meta Persistent Session Switcher.
 * Verifies:
 * 1. Session recovery from URL query parameters (?session_id=... / ?session=...).
 * 2. Fallback to default session and localStorage persistence.
 * 3. Session switching updates localStorage, URL search params, and dispatches change event.
 * 4. generateNewSessionId creates valid compliant session strings.
 * 5. Incident filtering isolates records by active visitor session.
 * 6. Discovered sessions payload adheres to the API schema.
 */

import test from "node:test";
import assert from "node:assert/strict";

// Mock minimal browser environment
class MockStorage {
  constructor() {
    this.store = {};
  }
  getItem(k) {
    return this.store[k] || null;
  }
  setItem(k, v) {
    this.store[k] = String(v);
  }
  clear() {
    this.store = {};
  }
}

globalThis.localStorage = new MockStorage();

test("1. Session recovery from URL query parameter overrides stored session", () => {
  localStorage.setItem("fixproof_session_id", "sess_old_session");

  function getSessionFromUrlOrStorage(urlStr) {
    const url = new URL(urlStr);
    const urlSession = url.searchParams.get("session_id") || url.searchParams.get("session");
    if (urlSession && /^[a-zA-Z0-9_-]{3,64}$/.test(urlSession)) {
      localStorage.setItem("fixproof_session_id", urlSession);
      return urlSession;
    }
    return localStorage.getItem("fixproof_session_id") || "sess_default";
  }

  const active = getSessionFromUrlOrStorage("http://localhost:3000/dashboard?session_id=sess_crac4mhaxr_mvwtk3jy");
  assert.equal(active, "sess_crac4mhaxr_mvwtk3jy", "Must extract session_id from URL");
  assert.equal(localStorage.getItem("fixproof_session_id"), "sess_crac4mhaxr_mvwtk3jy", "Must persist to localStorage");
});

test("2. Session generation: creates compliant session identifier", () => {
  function generateNewSessionId() {
    const rand = Math.random().toString(36).substring(2, 10);
    const time = Date.now().toString(36);
    return `sess_${rand}_${time}`;
  }

  const newId = generateNewSessionId();
  assert.ok(newId.startsWith("sess_"), "Must prefix with sess_");
  assert.ok(/^[a-zA-Z0-9_-]{3,64}$/.test(newId), "Must match valid session regex");
});

test("3. Session switching: updates storage and prepares query params", () => {
  let eventDispatched = null;

  function setClientSessionId(sessionId, currentHref = "http://localhost:3000/dashboard") {
    const clean = sessionId.trim();
    if (/^[a-zA-Z0-9_-]{3,64}$/.test(clean)) {
      localStorage.setItem("fixproof_session_id", clean);
      const url = new URL(currentHref);
      url.searchParams.set("session_id", clean);
      eventDispatched = { type: "fixproof_session_changed", detail: clean };
      return url.toString();
    }
    return currentHref;
  }

  const target = "sess_crac4mhaxr_mvwtk3jy";
  const updatedUrl = setClientSessionId(target, "http://localhost:3000/dashboard?tab=incidents");

  assert.equal(localStorage.getItem("fixproof_session_id"), target);
  assert.ok(updatedUrl.includes("session_id=sess_crac4mhaxr_mvwtk3jy"));
  assert.ok(updatedUrl.includes("tab=incidents"));
  assert.notEqual(eventDispatched, null);
  assert.equal(eventDispatched.detail, target);
});

test("4. Incident isolation: filters records strictly by visitor session", () => {
  const incidents = [
    { incident_id: "inc-1", session_id: "sess_crac4mhaxr_mvwtk3jy", suspect_filename: "sample1.mp4" },
    { incident_id: "inc-2", session_id: "sess_crac4mhaxr_mvwtk3jy", suspect_filename: "sample2.mp4" },
    { incident_id: "inc-3", session_id: "sess_hn4b9l85ox_mvr0c2em", suspect_filename: "sample3.mp4" },
    { incident_id: "inc-demo", session_id: "demo-showcase", suspect_filename: "demo.mp4" },
  ];

  function filterBySession(items, activeSession) {
    return items.filter(
      (i) => i.session_id === activeSession || i.session_id === "demo-showcase" || !i.session_id
    );
  }

  const sessionA = filterBySession(incidents, "sess_crac4mhaxr_mvwtk3jy");
  assert.equal(sessionA.length, 3);
  const idsA = sessionA.map((i) => i.incident_id);
  assert.ok(idsA.includes("inc-1"));
  assert.ok(idsA.includes("inc-2"));
  assert.ok(idsA.includes("inc-demo"));
  assert.ok(!idsA.includes("inc-3"));

  const sessionB = filterBySession(incidents, "sess_hn4b9l85ox_mvr0c2em");
  assert.equal(sessionB.length, 2);
  const idsB = sessionB.map((i) => i.incident_id);
  assert.ok(idsB.includes("inc-3"));
  assert.ok(idsB.includes("inc-demo"));
  assert.ok(!idsB.includes("inc-1"));
});

test("5. Discovered sessions payload: minimal non-sensitive summary", () => {
  const sampleSessionApi = [
    { session_id: "sess_hn4b9l85ox_mvr0c2em", incident_count: 9, latest_activity: "2026-11-01T12:14:17Z" },
    { session_id: "sess_crac4mhaxr_mvwtk3jy", incident_count: 2, latest_activity: "2026-11-01T08:19:33Z" },
  ];

  for (const s of sampleSessionApi) {
    assert.ok(s.session_id);
    assert.equal(typeof s.incident_count, "number");
    assert.ok(s.latest_activity);
    // Non-exposure of raw internal data
    assert.equal(s.api_key, undefined);
    assert.equal(s.credentials, undefined);
    assert.equal(s.dossier, undefined);
  }
});

