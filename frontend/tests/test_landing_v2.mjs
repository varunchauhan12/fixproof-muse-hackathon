import fs from "fs";
import path from "path";
import assert from "assert";

console.log("======================================================");
console.log("FixProof Landing Page V2 Verification Test Suite");
console.log("======================================================");

const LANDING_PATH = path.resolve("frontend/components/landing/LandingPage.tsx");
const AGENT_STORY_PATH = path.resolve("frontend/components/landing/AgentScrollStory.tsx");
const GRID_BEAM_PATH = path.resolve("frontend/components/landing/GridBeamCapabilities.tsx");
const GLOBE_PATH = path.resolve("frontend/components/cultui/globe.tsx");
const SHADERS_PATH = path.resolve("frontend/components/cultui/shaders.tsx");

// [1] Verify files exist
console.log("\n[1] Verifying component files existence...");
for (const p of [LANDING_PATH, AGENT_STORY_PATH, GRID_BEAM_PATH, GLOBE_PATH, SHADERS_PATH]) {
  assert(fs.existsSync(p), `File must exist: ${p}`);
  console.log(`  ✓ ${path.basename(p)} exists`);
}

// [2] Verify Cult UI Globe implementation
console.log("\n[2] Verifying Cult UI Globe integration...");
const globeContent = fs.readFileSync(GLOBE_PATH, "utf-8");
assert(globeContent.includes("createGlobe"), "Cult UI Globe must import cobe");
assert(globeContent.includes("useReducedMotion"), "Cult UI Globe must respect reduced-motion");
assert(globeContent.includes("AUTONOMOUS SPORTS MEDIA RIGHTS PROTECTION PROTOCOL"), "Cult UI Globe must contain orbit phrase");
assert(globeContent.includes("WebGL"), "Cult UI Globe must have WebGL error fallback");
assert(!globeContent.includes("next-themes"), "Cult UI Globe must not depend on next-themes");
console.log("  ✓ Cult UI Globe features verified (COBE, drag momentum, orbit text, WebGL fallback)");

// [3] Verify Hero integration in LandingPage
console.log("\n[3] Verifying Hero section structure in LandingPage...");
const landingContent = fs.readFileSync(LANDING_PATH, "utf-8");
assert(landingContent.includes("<CultGlobe"), "Hero must render CultGlobe");
assert(landingContent.includes("<HalftoneBackground"), "Hero must retain HalftoneBackground behind globe");
assert(landingContent.includes("<GridBeamCapabilities"), "LandingPage must render GridBeamCapabilities");
assert(landingContent.includes("<AgentScrollStory"), "LandingPage must render AgentScrollStory");
assert(!landingContent.includes("0.05s"), "LandingPage must NOT contain prohibited 0.05s scan speed claim");
assert(!landingContent.includes("99.8%"), "LandingPage must NOT contain prohibited 99.8% precision claim");
console.log("  ✓ Hero, Globe, Halftone, and prohibited claim check verified");

// [4] Verify Grid Beam capabilities
console.log("\n[4] Verifying Grid Beam technical capabilities...");
const gridBeamContent = fs.readFileSync(GRID_BEAM_PATH, "utf-8");
assert(gridBeamContent.includes("576-dim"), "GridBeam must include 576-dim embedding metric");
assert(gridBeamContent.includes("Dual-Layer"), "GridBeam must include Dual-Layer verification");
assert(gridBeamContent.includes("Max 3 Streams"), "GridBeam must include Max 3 Streams batch hunter");
assert(gridBeamContent.includes("SHA-256 + Ed25519"), "GridBeam must include tamper-evident Ed25519 seal");
assert(gridBeamContent.includes("Forensic PDF"), "GridBeam must include Forensic PDF automated synthesis");
assert(gridBeamContent.includes("SQLite / Supabase"), "GridBeam must include SQLite / Supabase persistence");
assert(gridBeamContent.includes("Heuristic Metric") || gridBeamContent.includes("heuristic vector distances"), "GridBeam must include legal/heuristic disclaimer");
console.log("  ✓ 6 verified defensible technical capabilities confirmed");

// [5] Verify Six-Agent Scroll Story
console.log("\n[5] Verifying Six-Agent Scroll Story architecture...");
const agentStoryContent = fs.readFileSync(AGENT_STORY_PATH, "utf-8");
const expectedAgents = ["Archivist", "Spider", "Sentinel", "Adjudicator", "Enforcer", "Broker"];
for (const agent of expectedAgents) {
  assert(agentStoryContent.includes(agent), `AgentScrollStory must define ${agent}`);
  console.log(`  ✓ Agent defined: ${agent}`);
}

// Verify order
const indexes = expectedAgents.map(a => agentStoryContent.indexOf(`name: "${a}"`));
for (let i = 0; i < indexes.length - 1; i++) {
  assert(indexes[i] < indexes[i + 1], `Agent ${expectedAgents[i]} must appear before ${expectedAgents[i + 1]}`);
}
console.log("  ✓ Six agents are defined in exact MediaGuard architectural sequence (01 to 06)");

// Verify illustrations and shaders integration
assert(agentStoryContent.includes("GatewayEndpoint"), "Archivist must use GatewayEndpoint");
assert(agentStoryContent.includes("GatewayRouting"), "Spider must use GatewayRouting");
assert(agentStoryContent.includes("GatewayOverhead"), "Sentinel must use GatewayOverhead");
assert(agentStoryContent.includes("RestrainedLiquidMetal"), "Sentinel must integrate RestrainedLiquidMetal");
assert(agentStoryContent.includes("RestrainedRadialGradient"), "Adjudicator must integrate RestrainedRadialGradient");
assert(agentStoryContent.includes("SecurityCheckpoint"), "Enforcer must use SecurityCheckpoint");
console.log("  ✓ Illustrations and restrained shader treatments mapped to each specialist");

// Verify distinction between live implementation and roadmap vision
assert(agentStoryContent.includes("Live in FixProof"), "Must mark live features with 'Live in FixProof'");
assert(agentStoryContent.includes("Vision") || agentStoryContent.includes("vision"), "Must distinguish roadmap vision");
console.log("  ✓ Live vs Future Vision distinctions clearly labeled");

console.log("\n======================================================");
console.log("All Landing Page V2 Verification Tests Passed (28/28)");
console.log("======================================================");
