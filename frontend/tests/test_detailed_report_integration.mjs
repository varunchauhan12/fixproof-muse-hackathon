/**
 * Integration verification test for Phase 3.5 Step 3:
 * Evidence-Backed Detailed Report, PDF Download & Email Delivery.
 * Validates backend endpoints against live server on port 8000.
 */

const BASE_URL = process.env.API_URL || "http://127.0.0.1:8000";

async function runDetailedReportIntegrationTests() {
  console.log(`\n======================================================`);
  console.log(`Phase 3.5 Step 3 Detailed Report Integration Test`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`======================================================\n`);

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  // 1. Status endpoint checks
  console.log(`[1] Testing GET /api/nemotron/status...`);
  try {
    const res = await fetch(`${BASE_URL}/api/nemotron/status`);
    assert(res.status === 200, `Status code is 200`);
    const data = await res.json();
    assert(!!data.detailed_report_model, `detailed_report_model is exposed: ${data.detailed_report_model}`);
    assert(data.vision_model === "nvidia/Nemotron-3.5-Super-VL", `Vision model is nvidia/Nemotron-3.5-Super-VL`);
    assert(data.email_provider === "Resend", `Email provider is Resend`);
  } catch (err) {
    console.error(`Status endpoint failed: ${err.message}`);
    failed++;
  }

  // 2. Fetch incidents to select a valid target
  console.log(`\n[2] Selecting target incident from /api/incidents...`);
  let targetIncidentId = null;
  try {
    const res = await fetch(`${BASE_URL}/api/incidents`);
    assert(res.status === 200, `Incidents list returned 200`);
    const incidents = await res.json();
    assert(Array.isArray(incidents) && incidents.length > 0, `Found ${incidents.length} incident(s) in database`);

    const matchedInc = incidents.find((i) => (i.candidate_matches_found || 0) > 0);
    targetIncidentId = matchedInc ? matchedInc.incident_id : incidents[0].incident_id;
    console.log(`  Selected Target Incident: ${targetIncidentId}`);
  } catch (err) {
    console.error(`Incidents fetch failed: ${err.message}`);
    failed++;
  }

  if (!targetIncidentId) {
    console.error("Cannot proceed with detailed report tests without an incident ID.");
    process.exit(1);
  }

  // 3. Test Short Summary Download (Zero Model Invocation)
  console.log(`\n[3] Testing GET /api/nemotron/summary-download/${targetIncidentId}...`);
  try {
    const res = await fetch(`${BASE_URL}/api/nemotron/summary-download/${targetIncidentId}`);
    assert(res.status === 200, `Summary download returned 200`);
    const cType = res.headers.get("content-type") || "";
    assert(cType.includes("text/plain"), `Content-Type is text/plain (got ${cType})`);
    const text = await res.text();
    assert(text.includes("FIXPROOF FORENSIC INVESTIGATION SUMMARY"), `Contains FixProof header`);
    assert(text.includes(targetIncidentId), `Cites target incident ID`);
    assert(text.includes("STATUTORY & HEURISTIC DISCLAIMER"), `Contains heuristic and legal disclaimer`);
  } catch (err) {
    console.error(`Summary download failed: ${err.message}`);
    failed++;
  }

  // 4. Test Invalid Email Rejection on Detailed Report
  console.log(`\n[4] Testing invalid email validation on /api/nemotron/detailed-report...`);
  try {
    const res = await fetch(`${BASE_URL}/api/nemotron/detailed-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: targetIncidentId,
        recipient_email: "not-a-valid-email",
      }),
    });
    assert(res.status === 400, `Rejects invalid email format with HTTP 400 (got ${res.status})`);
  } catch (err) {
    console.error(`Invalid email test failed: ${err.message}`);
    failed++;
  }

  // 5. Test Generate Detailed Report & PDF
  console.log(`\n[5] Testing POST /api/nemotron/detailed-report...`);
  let generatedReportId = null;
  let pdfUrl = null;
  try {
    const startTime = Date.now();
    const res = await fetch(`${BASE_URL}/api/nemotron/detailed-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: targetIncidentId,
      }),
    });
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    assert(res.status === 200, `Detailed report generation returned 200 in ${elapsedSec}s`);

    const data = await res.json();
    assert(data.success === true, `Response success is true`);
    assert(!!data.report, `Report object present`);
    assert(!!data.pdf_url, `PDF URL present: ${data.pdf_url}`);

    generatedReportId = data.report.report_id;
    pdfUrl = data.pdf_url;

    // Check Sections A through I
    const sections = data.report.sections || {};
    assert(typeof sections.executive_summary === "string" && sections.executive_summary.length > 20, `Executive summary populated`);
    assert(typeof sections.methodology_scope === "string", `Methodology and scope section present`);
    assert(!!sections.suspect_and_reference_details, `Suspect & Reference details section present`);
    assert(Array.isArray(sections.frame_correlations), `Frame correlations present (${sections.frame_correlations.length} items)`);
    assert(typeof sections.temporal_continuity === "string", `Temporal continuity section present`);
    assert(typeof sections.model_assessment === "string", `Model assessment section present`);
    assert(typeof sections.risk_and_limitations === "string", `Risk & limitations section present`);
    assert(Array.isArray(sections.recommended_actions) && sections.recommended_actions.length > 0, `Recommended actions present`);
    assert(!!sections.provenance, `Provenance records present`);
    assert(sections.provenance.vision_verifier_model === "nvidia/Nemotron-3.5-Super-VL", `Provenance vision verifier model verified`);
  } catch (err) {
    console.error(`Detailed report generation failed: ${err.message}`);
    failed++;
  }

  if (!generatedReportId) {
    console.error("Cannot proceed with PDF download and retry tests without a report ID.");
    process.exit(1);
  }

  // 6. Test PDF Download Binary Stream
  console.log(`\n[6] Testing GET ${pdfUrl}...`);
  try {
    const res = await fetch(`${BASE_URL}${pdfUrl}`);
    assert(res.status === 200, `PDF stream returned 200`);
    const cType = res.headers.get("content-type") || "";
    assert(cType.includes("application/pdf"), `Content-Type is application/pdf (got ${cType})`);
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    assert(bytes.length > 2000, `PDF payload is substantial (${bytes.length} bytes)`);
    const headerStr = String.fromCharCode(...bytes.slice(0, 5));
    assert(headerStr === "%PDF-", `PDF begins with magic header %PDF-`);
  } catch (err) {
    console.error(`PDF stream test failed: ${err.message}`);
    failed++;
  }

  // 7. Test List Detailed Reports for Incident
  console.log(`\n[7] Testing GET /api/nemotron/detailed-reports/${targetIncidentId}...`);
  try {
    const res = await fetch(`${BASE_URL}/api/nemotron/detailed-reports/${targetIncidentId}`);
    assert(res.status === 200, `Report listing returned 200`);
    const list = await res.json();
    assert(Array.isArray(list) && list.length > 0, `Listed ${list.length} detailed report(s)`);
    const found = list.some((item) => item.report_id === generatedReportId);
    assert(found, `Generated report ${generatedReportId} appears in incident report list`);
  } catch (err) {
    console.error(`Report listing test failed: ${err.message}`);
    failed++;
  }

  // 8. Test Email Retry / Dispatch Endpoint
  console.log(`\n[8] Testing POST /api/nemotron/email-detailed-report...`);
  try {
    // 8a. Invalid recipient email
    const errRes = await fetch(`${BASE_URL}/api/nemotron/email-detailed-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: targetIncidentId,
        report_id: generatedReportId,
        recipient_email: "bad-email-format",
      }),
    });
    assert(errRes.status === 400, `Email retry rejects invalid address with HTTP 400 (got ${errRes.status})`);

    // 8b. Mismatched report ID
    const mismatchRes = await fetch(`${BASE_URL}/api/nemotron/email-detailed-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: targetIncidentId,
        report_id: "non-existent-report-id",
        recipient_email: "test@example.com",
      }),
    });
    assert(mismatchRes.status === 404, `Email retry returns 404 for non-existent report ID`);

    // 8c. Valid test email address
    const emailRes = await fetch(`${BASE_URL}/api/nemotron/email-detailed-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: targetIncidentId,
        report_id: generatedReportId,
        recipient_email: "delivered@resend.dev",
      }),
    });
    assert(emailRes.status === 200, `Email dispatch endpoint returns HTTP 200`);
    const emailData = await emailRes.json();
    assert(["DELIVERED", "NOT_CONFIGURED", "FAILED"].includes(emailData.status), `Status is a valid outcome: ${emailData.status}`);
    console.log(`  Email Dispatch Result: status=${emailData.status}, message=${emailData.message}`);
  } catch (err) {
    console.error(`Email retry test failed: ${err.message}`);
    failed++;
  }

  console.log(`\n======================================================`);
  console.log(`Test Summary: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runDetailedReportIntegrationTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
