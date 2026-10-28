/**
 * Integration verification test for Nemotron Intelligence & Action Center (Phase 3.5).
 * Validates backend endpoints against live server on port 8000.
 */

const BASE_URL = process.env.API_URL || "http://127.0.0.1:8000";

async function runTests() {
  console.log(`\n======================================================`);
  console.log(`Phase 3.5 Nemotron Action Center Integration Test`);
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

  // 1. Check Nemotron status
  console.log(`[1] Testing GET /api/nemotron/status...`);
  try {
    const res = await fetch(`${BASE_URL}/api/nemotron/status`);
    assert(res.status === 200, `Status code is 200 (got ${res.status})`);
    const data = await res.json();
    assert(data.configured_model === "nvidia/Nemotron-3_5-Lightning", `Configured model is nvidia/Nemotron-3_5-Lightning`);
    assert(data.vision_model === "nvidia/Nemotron-3.5-Super-VL", `Vision model is nvidia/Nemotron-3.5-Super-VL`);
    assert(data.email_provider === "Resend", `Email provider is Resend`);
    assert(Array.isArray(data.supported_documents) && data.supported_documents.includes("COPYRIGHT_NOTICE"), `Supports COPYRIGHT_NOTICE`);
    assert(Array.isArray(data.supported_jurisdictions) && data.supported_jurisdictions.includes("US_DMCA"), `Supports US_DMCA`);
  } catch (err) {
    console.error(`Status endpoint failed: ${err.message}`);
    failed++;
  }

  // 2. Fetch incidents to get a real incident ID with matches
  console.log(`\n[2] Testing GET /api/incidents...`);
  let testIncidentId = null;
  let cleanIncidentId = null;
  try {
    const res = await fetch(`${BASE_URL}/api/incidents`);
    assert(res.status === 200, `Incident list returns 200`);
    const incidents = await res.json();
    assert(Array.isArray(incidents) && incidents.length > 0, `Returned ${incidents.length} incidents`);
    
    const matchedInc = incidents.find((i) => (i.candidate_matches_found || 0) > 0);
    const cleanInc = incidents.find((i) => (i.candidate_matches_found || 0) === 0 || i.overall_status === "CLEAN");
    
    if (matchedInc) {
      testIncidentId = matchedInc.incident_id;
      console.log(`  Selected matched incident ID for testing: ${testIncidentId} (matches: ${matchedInc.candidate_matches_found})`);
    } else {
      testIncidentId = incidents[0].incident_id;
    }
    if (cleanInc) {
      cleanIncidentId = cleanInc.incident_id;
      console.log(`  Selected clean incident ID for testing: ${cleanIncidentId}`);
    }
  } catch (err) {
    console.error(`Incident fetch failed: ${err.message}`);
    failed++;
  }

  if (!testIncidentId) {
    console.error(`Cannot continue document tests without a test incident.`);
    process.exit(1);
  }

  // 3. Draft Copyright Notice
  console.log(`\n[3] Testing POST /api/nemotron/draft-document (COPYRIGHT_NOTICE)...`);
  try {
    const payload = {
      incident_id: testIncidentId,
      document_type: "COPYRIGHT_NOTICE",
      rights_holder: "Acme Sports Media Corp",
      authorized_rep: "Sarah Jenkins, Legal Counsel",
      contact_email: "legal@acmemedia.example",
      work_title: "Premier Match Official Live Feed",
      recipient_name: "StreamingHost Legal Team",
      recipient_email: "dmca-agent@streaminghost.example",
      jurisdiction: "US_DMCA",
      use_ai_synthesis: false,
    };
    const res = await fetch(`${BASE_URL}/api/nemotron/draft-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert(res.status === 200, `Notice drafting returns 200 (got ${res.status})`);
    const doc = await res.json();
    assert(doc.status === "READY_FOR_REVIEW", `Draft status is READY_FOR_REVIEW (got ${doc.status})`);
    assert(doc.missing_fields.length === 0, `No missing fields`);
    assert(doc.body.includes("17 U.S.C. § 512(c)"), `Includes DMCA statutory citation`);
    assert(doc.body.includes("Acme Sports Media Corp"), `Includes rights-holder name`);
    assert(doc.facts_imported.incident_id === testIncidentId, `Imported facts match incident ID`);
  } catch (err) {
    console.error(`Notice draft failed: ${err.message}`);
    failed++;
  }

  // 4. Draft Notice with Missing Fields
  console.log(`\n[4] Testing Notice drafting with missing fields (Incomplete Evidence Safeguard)...`);
  try {
    const payload = {
      incident_id: testIncidentId,
      document_type: "COPYRIGHT_NOTICE",
      rights_holder: "", // missing
      contact_email: "", // missing
      work_title: "",     // missing
      recipient_email: "",
      jurisdiction: "US_DMCA",
      use_ai_synthesis: false,
    };
    const res = await fetch(`${BASE_URL}/api/nemotron/draft-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert(res.status === 200, `Returns 200 with incomplete status`);
    const doc = await res.json();
    assert(doc.status === "INCOMPLETE_EVIDENCE", `Draft status is INCOMPLETE_EVIDENCE`);
    assert(doc.missing_fields.includes("rights_holder_name"), `Identified missing rights_holder_name`);
    assert(doc.missing_fields.includes("contact_email"), `Identified missing contact_email`);
  } catch (err) {
    console.error(`Incomplete notice draft failed: ${err.message}`);
    failed++;
  }

  // 5. Draft Revenue-Sharing Proposal
  console.log(`\n[5] Testing POST /api/nemotron/draft-document (REVENUE_SHARE_OFFER)...`);
  try {
    const payload = {
      incident_id: testIncidentId,
      document_type: "REVENUE_SHARE_OFFER",
      rights_holder: "Acme Sports Media Corp",
      authorized_rep: "Mark Taylor, Commercial Lead",
      contact_email: "partnerships@acmemedia.example",
      work_title: "Premier Match Official Live Feed",
      recipient_name: "MatchHighlightsChannel",
      recipient_email: "creator@youtube.example",
      rev_share_pct: 45.0,
      response_deadline_days: 14,
      use_ai_synthesis: false,
    };
    const res = await fetch(`${BASE_URL}/api/nemotron/draft-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert(res.status === 200, `Rev-share draft returns 200`);
    const doc = await res.json();
    assert(doc.status === "READY_FOR_REVIEW", `Draft status is READY_FOR_REVIEW`);
    assert(doc.body.includes("45.0% of net platform advertising"), `Accurate rights-holder percentage`);
    assert(doc.body.includes("55.0% retained directly by your channel"), `Accurate creator percentage`);
    assert(doc.body.includes("NON-BINDING OFFER"), `States proposal is non-binding offer`);
  } catch (err) {
    console.error(`Rev-share draft failed: ${err.message}`);
    failed++;
  }

  // 6. Test Email Safeguards: Unconfirmed user
  console.log(`\n[6] Testing send-email safeguard: user_confirmed=false...`);
  try {
    const res = await fetch(`${BASE_URL}/api/nemotron/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: testIncidentId,
        document_type: "COPYRIGHT_NOTICE",
        recipient_email: "legal@platform.example",
        subject: "Notice",
        body: "Body",
        user_confirmed: false,
        rights_declaration_confirmed: true,
      }),
    });
    assert(res.status === 400, `Unconfirmed send rejected with 400 (got ${res.status})`);
    const err = await res.json();
    assert(err.detail.includes("Explicit human review confirmation is required"), `Correct error message`);
  } catch (err) {
    console.error(`Unconfirmed send check failed: ${err.message}`);
    failed++;
  }

  // 7. Test Email Safeguards: Undeclared copyright notice
  console.log(`\n[7] Testing send-email safeguard: rights_declaration_confirmed=false on notice...`);
  try {
    const res = await fetch(`${BASE_URL}/api/nemotron/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: testIncidentId,
        document_type: "COPYRIGHT_NOTICE",
        recipient_email: "legal@platform.example",
        subject: "Notice",
        body: "Body",
        user_confirmed: true,
        rights_declaration_confirmed: false,
      }),
    });
    assert(res.status === 400, `Undeclared notice send rejected with 400 (got ${res.status})`);
    const err = await res.json();
    assert(err.detail.includes("Mandatory rights-holder legal declarations must be confirmed"), `Correct error message`);
  } catch (err) {
    console.error(`Undeclared send check failed: ${err.message}`);
    failed++;
  }

  // 8. Test Confirmed Send Safeguards (Unconfigured or Failed Provider Request)
  console.log(`\n[8] Testing confirmed send safeguards (Unconfigured or Failed Provider Request)...`);
  let testAuditId = null;
  let isEmailConfigured = false;
  try {
    const statusRes = await fetch(`${BASE_URL}/api/nemotron/email-status`);
    const statusData = await statusRes.json();
    isEmailConfigured = Boolean(statusData.configured);
    console.log(`  Current email provider configuration status: configured=${isEmailConfigured}`);

    const res = await fetch(`${BASE_URL}/api/nemotron/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: testIncidentId,
        document_type: "COPYRIGHT_NOTICE",
        recipient_email: "legal@platform.example",
        subject: "Formal Notice",
        body: "Formal Notice Body",
        user_confirmed: true,
        rights_declaration_confirmed: true,
      }),
    });
    assert(res.status === 200, `Returns 200 without throwing 500`);
    const result = await res.json();
    assert(result.success === false, `Result success is false (safeguard enforced)`);
    if (isEmailConfigured) {
      assert(result.status === "FAILED", `Configured test dispatch correctly reports FAILED (got ${result.status})`);
    } else {
      assert(result.status === "NOT_CONFIGURED", `Unconfigured dispatch correctly reports NOT_CONFIGURED (got ${result.status})`);
    }
    assert(Boolean(result.audit_id), `Returns valid audit_id`);
    testAuditId = result.audit_id;
  } catch (err) {
    console.error(`Send safeguard check failed: ${err.message}`);
    failed++;
  }

  // 9. Verify Email Audit Log
  console.log(`\n[9] Testing GET /api/nemotron/email-audit-log...`);
  try {
    const res = await fetch(`${BASE_URL}/api/nemotron/email-audit-log?incident_id=${testIncidentId}`);
    assert(res.status === 200, `Audit log returns 200`);
    const logs = await res.json();
    assert(Array.isArray(logs) && logs.length > 0, `Returned ${logs.length} audit log entries`);
    if (testAuditId) {
      const match = logs.find((l) => l.audit_id === testAuditId);
      assert(Boolean(match), `Audit log contains the attempt entry`);
      if (match) {
        if (isEmailConfigured) {
          assert(match.status === "FAILED", `Audit entry records FAILED`);
        } else {
          assert(match.status === "NOT_CONFIGURED", `Audit entry records NOT_CONFIGURED`);
        }
        assert(match.provider === "Resend", `Audit entry records provider Resend`);
      }
    }
  } catch (err) {
    console.error(`Audit log check failed: ${err.message}`);
    failed++;
  }

  // 10. Clean Incident Drafting Safeguards
  console.log(`\n[10] Testing drafting against CLEAN incident (Forensic Evidence Integrity)...`);
  try {
    const targetCleanId = cleanIncidentId || testIncidentId;

    const payload = {
      incident_id: targetCleanId,
      document_type: "COPYRIGHT_NOTICE",
      rights_holder: "Broadcaster Corp",
      contact_email: "legal@broadcaster.example",
      work_title: "Protected Stream",
      recipient_email: "dmca@host.example",
      use_ai_synthesis: false,
    };
    const res = await fetch(`${BASE_URL}/api/nemotron/draft-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert(res.status === 200, `Clean incident draft returns 200`);
    const doc = await res.json();
    assert(doc.status === "UNVERIFIED_EVIDENCE", `Status is UNVERIFIED_EVIDENCE for clean incident (got ${doc.status})`);
    assert(doc.body.includes("not calibrated probabilities of copyright infringement"), `Body includes uncalibrated heuristic notice`);
    assert(doc.body.includes("recorded no confirmed perceptual match above threshold"), `Body correctly states no confirmed match`);
  } catch (err) {
    console.error(`Clean incident safeguard test failed: ${err.message}`);
    failed++;
  }

  // 11. Invalid Document Type Rejection
  console.log(`\n[11] Testing POST /api/nemotron/draft-document with invalid document_type...`);
  try {
    const res = await fetch(`${BASE_URL}/api/nemotron/draft-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: testIncidentId,
        document_type: "INVALID_DOCUMENT_TYPE",
      }),
    });
    assert(res.status === 400, `Invalid document type returns 400 (got ${res.status})`);
  } catch (err) {
    console.error(`Invalid document type test failed: ${err.message}`);
    failed++;
  }

  // 12. Invalid Email Format Rejection on Send
  console.log(`\n[12] Testing POST /api/nemotron/send-email with invalid recipient format...`);
  try {
    const res = await fetch(`${BASE_URL}/api/nemotron/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: testIncidentId,
        document_type: "REVENUE_SHARE_OFFER",
        recipient_email: "not-an-email-address",
        subject: "Offer",
        body: "Offer Body",
        user_confirmed: true,
      }),
    });
    assert(res.status === 400, `Invalid email rejected with 400 (got ${res.status})`);
  } catch (err) {
    console.error(`Invalid email format test failed: ${err.message}`);
    failed++;
  }

  console.log(`\n======================================================`);
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log(`======================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error(`Fatal test error: ${err}`);
  process.exit(1);
});
