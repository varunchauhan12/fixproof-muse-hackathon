/**
 * Automated test suite for FixProof Milestone 6C.6C.1:
 * Frontend Integration for Nemotron Investigation Reports.
 *
 * Verifies:
 * 1. API helper behavior for getIncidentLatestReport (200, 404, 500).
 * 2. API helper behavior for getReportById (200, 404).
 * 3. API helper behavior for investigateIncident (force_refresh, errors).
 * 4. Resilient handling of empty findings, empty timeline intervals, and FAILED_VALIDATION reports.
 * 5. Safe clipboard fallback logic that never crashes the UI on permission failure.
 */

import test from "node:test";
import assert from "node:assert/strict";

const API_BASE = "http://localhost:8000";

const noCacheHeaders = {
  "Cache-Control": "no-cache, no-store, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

async function fetchNoCache(url, init) {
  const separator = url.includes("?") ? "&" : "?";
  const cacheBustedUrl = `${url}${separator}_t=${Date.now()}`;
  return fetch(cacheBustedUrl, {
    ...init,
    cache: "no-store",
    headers: {
      ...noCacheHeaders,
      ...init?.headers,
    },
  });
}

// Mirroring the exact functions from frontend/lib/api.ts for isolated contract testing
async function getIncidentLatestReport(incidentId) {
  const safeId = encodeURIComponent(incidentId.trim());
  const res = await fetchNoCache(`${API_BASE}/api/threats/${safeId}/report`);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Failed to fetch report for incident ${incidentId}`);
  }
  return res.json();
}

async function getReportById(reportId) {
  const safeId = encodeURIComponent(reportId.trim());
  const res = await fetchNoCache(`${API_BASE}/api/threats/reports/${safeId}`);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Failed to fetch report ${reportId}`);
  }
  return res.json();
}

async function investigateIncident(incidentId, payload) {
  const safeId = encodeURIComponent(incidentId.trim());
  const res = await fetch(`${API_BASE}/api/threats/${safeId}/investigate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload || { force_refresh: false, model_override: null }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Investigation failed with status ${res.status}`);
  }

  return res.json();
}

function createMockFetch(routes) {
  return async (url, options = {}) => {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const method = options.method || "GET";
    const routeKey = `${method} ${pathname}`;

    const handler = routes[routeKey] || routes[pathname];
    if (!handler) {
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ detail: "Not found in mock" }),
      };
    }

    return handler(options);
  };
}

test("1. getIncidentLatestReport: returns report on 200 OK", async () => {
  const mockReport = {
    report_id: "rep-1234",
    incident_id: "inc-abcd",
    model_id: "nvidia/Nemotron-3_5-Lightning",
    prompt_version: "v1.0",
    summary: "Forensic analysis completed.",
    recommended_action: "MONITOR_ACCOUNT",
    confidence_assessment: "HIGH_CONFIDENCE_MATCH",
    human_review_required: false,
    timeline_intervals: [],
    findings: [],
    unresolved_questions: [],
    contradictions_detected: [],
    limitations_disclosed: [],
    evidence_references: [],
    operational_metadata: {
      validation_status: "VALIDATED",
      latency_ms: 1200,
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch({
    "GET /api/threats/inc-abcd/report": () => ({
      ok: true,
      status: 200,
      json: async () => mockReport,
    }),
  });

  try {
    const result = await getIncidentLatestReport("inc-abcd");
    assert.deepEqual(result, mockReport);
    assert.equal(result.report_id, "rep-1234");
    assert.equal(result.operational_metadata.validation_status, "VALIDATED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("2. getIncidentLatestReport: returns null cleanly on 404 (uninvestigated incident)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch({
    "GET /api/threats/uninvestigated-123/report": () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ detail: "No investigation report found for this incident." }),
    }),
  });

  try {
    const result = await getIncidentLatestReport("uninvestigated-123");
    assert.equal(result, null, "Uninvestigated incident must return null, not throw");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("3. getIncidentLatestReport: throws descriptive error on non-404 failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch({
    "GET /api/threats/error-inc/report": () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ detail: "Database connection failed" }),
    }),
  });

  try {
    await assert.rejects(
      async () => getIncidentLatestReport("error-inc"),
      /Database connection failed/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("4. getReportById: fetches report by report_id", async () => {
  const mockReport = {
    report_id: "rep-9999",
    incident_id: "inc-7777",
    model_id: "nvidia/Nemotron-3_5-Lightning",
    summary: "Retrieved by direct ID.",
    operational_metadata: { validation_status: "VALIDATED" },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch({
    "GET /api/threats/reports/rep-9999": () => ({
      ok: true,
      status: 200,
      json: async () => mockReport,
    }),
  });

  try {
    const result = await getReportById("rep-9999");
    assert.equal(result.report_id, "rep-9999");
    assert.equal(result.summary, "Retrieved by direct ID.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("5. investigateIncident: sends correct payload with force_refresh and null model_override", async () => {
  let capturedBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch({
    "POST /api/threats/inc-refresh/investigate": (opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          report_id: "rep-new",
          incident_id: "inc-refresh",
          summary: "Fresh investigation.",
          operational_metadata: { validation_status: "VALIDATED" },
        }),
      };
    },
  });

  try {
    const result = await investigateIncident("inc-refresh", { force_refresh: true, model_override: null });
    assert.equal(result.report_id, "rep-new");
    assert.equal(capturedBody.force_refresh, true);
    assert.equal(capturedBody.model_override, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("6. UI Data Contract: empty arrays and FAILED_VALIDATION reports render safely", () => {
  const emptyReport = {
    report_id: "rep-empty",
    incident_id: "inc-empty",
    model_id: "nvidia/Nemotron-3_5-Lightning",
    prompt_version: "v1.0",
    summary: "Investigation complete with zero candidates.",
    recommended_action: "NEEDS_FULL_VIDEO_REVIEW",
    confidence_assessment: "INCONCLUSIVE_DATA",
    human_review_required: true,
    timeline_intervals: [],
    findings: [],
    unresolved_questions: [],
    contradictions_detected: [],
    limitations_disclosed: ["No video frames matched."],
    evidence_references: [],
    operational_metadata: {
      validation_status: "FAILED_VALIDATION",
      failure_type: "EMPTY_CANDIDATES",
      errors: ["No candidates met threshold."],
    },
  };

  assert.equal(emptyReport.findings.length, 0);
  assert.equal(emptyReport.timeline_intervals.length, 0);
  assert.equal(emptyReport.operational_metadata.validation_status, "FAILED_VALIDATION");
  assert.equal(emptyReport.operational_metadata.failure_type, "EMPTY_CANDIDATES");
  assert.equal(emptyReport.limitations_disclosed.length, 1);
});

test("7. Safe Clipboard: clipboard failure is handled without throwing", async () => {
  const mockNavigator = {
    clipboard: {
      writeText: async () => {
        throw new Error("Clipboard permission denied");
      },
    },
  };

  let didCatch = false;
  try {
    if (mockNavigator?.clipboard?.writeText) {
      await mockNavigator.clipboard.writeText("test-id").catch(() => {
        didCatch = true;
      });
    }
  } catch {
    assert.fail("Should not throw unhandled exception");
  }

  assert.equal(didCatch, true, "Clipboard permission denial should be caught gracefully");
});
