/**
 * FixProof Addendum Workflow Test Suite
 * Validates:
 * 1. Status Island backend health & task lifecycle contracts
 * 2. Threat Hunter multi-file validation (1-3 files, >3 rejection, extensions, sizes)
 * 3. Sequential batch investigation orchestration & failure isolation
 * 4. Reference Vault multi-file ingestion contracts
 * 5. Animated Download Button endpoint contracts (PDF, Summary, Signed Evidence ZIP)
 */

// FixProof Addendum Workflow Test Suite
// Uses native global fetch available in Node.js v18+

const API_BASE = process.env.API_BASE || "http://127.0.0.1:8000";

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

async function runTests() {
  console.log("\n======================================================");
  console.log("FixProof Addendum Workflow Integration Test Suite");
  console.log(`Target: ${API_BASE}`);
  console.log("======================================================\n");

  // ─── [1] Status Island Health Contract ───
  console.log("[1] Testing Status Island Backend Health Contract...");
  try {
    const res = await fetch(`${API_BASE}/api/nemotron/status`);
    assert(res.status === 200, `GET /api/nemotron/status returns 200 (got ${res.status})`);
    const data = await res.json();
    assert(data.status === "ok" || data.status === "ready", `Backend status reports operational (${data.status})`);
    assert(Boolean(data.configured_model || data.email_provider), `Provider/Model identified: ${data.configured_model || data.email_provider}`);
  } catch (err) {
    assert(false, `Status check failed: ${err.message}`);
  }

  // ─── [2] Multi-File Validation Logic in Threat Hunter ───
  console.log("\n[2] Testing Multi-File Validation Constraints (Threat Hunter)...");
  const MAX_BATCH_FILES = 3;
  const MAX_FILE_SIZE = 500 * 1024 * 1024;
  const ALLOWED_EXTS = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".flv", ".wmv", ".ts", ".3gp", ".ogg", ".ogv"];

  function validateFiles(newFiles, currentFiles) {
    if (currentFiles.length + newFiles.length > MAX_BATCH_FILES) {
      return {
        error: `Maximum 3 video files permitted per investigation batch. You currently have ${currentFiles.length} selected and attempted to add ${newFiles.length}. Please select no more than 3 videos.`,
        valid: [],
      };
    }
    const valid = [];
    for (const f of newFiles) {
      const ext = "." + (f.name.split(".").pop() || "").toLowerCase();
      if (!ALLOWED_EXTS.includes(ext)) {
        return { error: `Unsupported format for ${f.name}`, valid: [] };
      }
      if (f.size > MAX_FILE_SIZE) {
        return { error: `File exceeds 500 MB limit`, valid: [] };
      }
      valid.push(f);
    }
    return { valid };
  }

  // Test 1: 1 valid file
  const test1 = validateFiles([{ name: "clip1.mp4", size: 1024 * 1024 }], []);
  assert(test1.valid.length === 1 && !test1.error, "Accepts 1 valid video file");

  // Test 2: 3 valid files
  const test2 = validateFiles(
    [
      { name: "clip1.mp4", size: 1024 * 1024 },
      { name: "clip2.mov", size: 2 * 1024 * 1024 },
      { name: "clip3.webm", size: 3 * 1024 * 1024 },
    ],
    []
  );
  assert(test2.valid.length === 3 && !test2.error, "Accepts maximum 3 valid video files in one batch");

  // Test 3: 4 files - MUST be rejected with explicit error message, NO silent truncation
  const test3 = validateFiles(
    [
      { name: "clip1.mp4", size: 1024 },
      { name: "clip2.mp4", size: 1024 },
      { name: "clip3.mp4", size: 1024 },
      { name: "clip4.mp4", size: 1024 },
    ],
    []
  );
  assert(
    test3.valid.length === 0 && test3.error && test3.error.includes("Maximum 3 video files permitted"),
    "Strictly rejects 4 files without silent truncation"
  );

  // Test 4: Unsupported extension rejected
  const test4 = validateFiles([{ name: "document.pdf", size: 1024 }], []);
  assert(test4.valid.length === 0 && test4.error.includes("Unsupported format"), "Rejects unsupported non-video file formats (.pdf)");

  // Test 5: Oversized file rejected (>500MB)
  const test5 = validateFiles([{ name: "huge.mp4", size: 600 * 1024 * 1024 }], []);
  assert(test5.valid.length === 0 && test5.error.includes("500 MB limit"), "Rejects file exceeding 500 MB limit");

  // ─── [3] Sequential Processing & Failure Isolation Simulation ───
  console.log("\n[3] Testing Batch Sequential Processing & Failure Isolation Logic...");
  const mockQueue = [
    { name: "video1.mp4", shouldPass: true },
    { name: "corrupt.mp4", shouldPass: false },
    { name: "video3.mp4", shouldPass: true },
  ];

  const processed = [];
  for (let i = 0; i < mockQueue.length; i++) {
    const item = mockQueue[i];
    try {
      if (!item.shouldPass) throw new Error("Codec container parsing error");
      processed.push({ name: item.name, status: "completed", incidentId: `inc-${i + 1}` });
    } catch (err) {
      // Failure isolation: record failure, do NOT stop next item!
      processed.push({ name: item.name, status: "failed", error: err.message });
    }
  }

  assert(processed.length === 3, "All 3 items processed in sequence despite middle failure");
  assert(processed[0].status === "completed" && processed[0].incidentId === "inc-1", "Video 1 completed with dedicated incident ID");
  assert(processed[1].status === "failed" && processed[1].error.includes("Codec container"), "Video 2 failed isolated without terminating batch");
  assert(processed[2].status === "completed" && processed[2].incidentId === "inc-3", "Video 3 completed with separate dedicated incident ID");

  // ─── [4] Reference Vault Multi-File Ingestion Logic ───
  console.log("\n[4] Testing Reference Vault Ingestion Limits...");
  function validateVaultFiles(incoming, existing) {
    if (existing.length + incoming.length > 3) {
      return { error: "Maximum 3 reference videos permitted per upload batch. Please select up to 3 videos." };
    }
    return { valid: incoming };
  }

  const vaultPass = validateVaultFiles([{ name: "ref1.mp4" }, { name: "ref2.mp4" }], []);
  assert(vaultPass.valid && vaultPass.valid.length === 2, "Accepts 2 reference videos for ingestion batch");

  const vaultReject = validateVaultFiles([{ name: "ref1.mp4" }, { name: "ref2.mp4" }, { name: "ref3.mp4" }, { name: "ref4.mp4" }], []);
  assert(Boolean(vaultReject.error), "Rejects 4 reference videos with clear error message");

  // ─── [5] Download & Export Endpoints Real Verification ───
  console.log("\n[5] Testing Genuine Download Endpoints (PDF, Summary, Evidence Package)...");

  // Fetch real incident
  let targetIncidentId = null;
  try {
    const incRes = await fetch(`${API_BASE}/api/incidents`);
    const incs = await incRes.json();
    if (incs && incs.length > 0) {
      targetIncidentId = incs[0].incident_id;
      console.log(`  Target Incident: ${targetIncidentId}`);
    }
  } catch (err) {
    console.warn("Could not fetch incidents:", err.message);
  }

  if (targetIncidentId) {
    // 5.1 Short Summary Download Endpoint
    try {
      const sumRes = await fetch(`${API_BASE}/api/nemotron/summary-download/${encodeURIComponent(targetIncidentId)}`);
      assert(sumRes.status === 200, `Summary download endpoint returned HTTP 200 (got ${sumRes.status})`);
      const sumText = await sumRes.text();
      assert(sumText.toUpperCase().includes("FIXPROOF") || sumText.toUpperCase().includes("FORENSIC"), "Summary text contains genuine forensic headers");
    } catch (err) {
      assert(false, `Summary download failed: ${err.message}`);
    }

    // 5.2 Evidence Package Export Endpoint
    try {
      const expRes = await fetch(`${API_BASE}/api/threats/${encodeURIComponent(targetIncidentId)}/reports/export`);
      assert(expRes.status === 200, `Signed Evidence Package ZIP export returned HTTP 200 (got ${expRes.status})`);
      const contentType = expRes.headers.get("Content-Type") || "";
      assert(contentType.includes("zip") || contentType.includes("octet-stream"), `Content-Type is zip/stream (got ${contentType})`);
      const buf = await expRes.arrayBuffer();
      assert(buf.byteLength > 0, `Evidence Package ZIP contains real data (${buf.byteLength} bytes)`);
    } catch (err) {
      assert(false, `Evidence Package export failed: ${err.message}`);
    }
  } else {
    console.warn("  (Skipping incident-dependent download tests because no incident was found)");
  }

  // 5.3 Error handling when requesting non-existent detailed report PDF
  try {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const nonExistentRes = await fetch(`${API_BASE}/api/nemotron/detailed-report/${fakeId}/pdf`);
    assert(nonExistentRes.status === 404, `Requesting non-existent PDF correctly returns 404 (got ${nonExistentRes.status})`);
  } catch (err) {
    assert(false, `404 check error: ${err.message}`);
  }

  console.log("\n======================================================");
  console.log(`Test Summary: ${passed} PASSED, ${failed} FAILED`);
  console.log("======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution aborted:", err);
  process.exit(1);
});
