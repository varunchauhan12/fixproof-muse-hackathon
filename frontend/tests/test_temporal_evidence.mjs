import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');

const compile = (path) =>
  ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;

test('getTemporalEvidence calls API with session headers and decodes canonical payload', async () => {
  const calls = [];
  const mockPayload = {
    incident_id: 'inc-test-1',
    generated_at: '2026-11-02T00:00:00Z',
    methodology: 'Deterministic temporal correspondence analysis',
    limitations: ['Temporal offset is not proof of infringement.'],
    candidates: [
      {
        candidate_id: 'c-1',
        incident_id: 'inc-test-1',
        frame_match_index: 0,
        suspect_frame_idx: 0,
        source_asset_id: 'asset-1',
        source_frame_id: 10,
        source_filename: 'r0.jpg',
        suspect_filename: 's0.jpg',
        suspect_timestamp_sec: 10.0,
        source_timestamp_sec: 5.0,
        offset_sec: 5.0,
        l2_distance: 0.25,
        visual_similarity_score: 85.0,
        match_confirmed: true,
        similarity_status: 'CONFIRMED_MATCH',
        evidence_id: 'ev-0',
        interval_id: 'interval_1',
        rank: 1,
        deviation_from_median_sec: 0.0,
        is_outlier: false,
        sam_available: false,
        sam_object_count: null,
        is_report_fallback: false,
      },
    ],
    total_candidate_count: 1,
    valid_pair_count: 1,
    missing_timestamp_count: 0,
    populations: {
      confirmed: {
        population_name: 'confirmed',
        population_definition: 'Backend-confirmed matches',
        total_candidates: 1,
        valid_pairs: 1,
        missing_timestamps: 0,
        offset_stats: {
          sample_count: 1,
          valid_pair_count: 1,
          missing_timestamp_count: 0,
          min_offset_sec: 5.0,
          max_offset_sec: 5.0,
          median_offset_sec: 5.0,
          mad_sec: 0.0,
          tolerance_band: null,
          dispersion_note: 'Measured dispersion (MAD) is 0.00s',
        },
        chronological_consistency: {
          sample_count: 1,
          inversions_count: 0,
          inversions: [],
          lis_length: 1,
          lis_candidate_ids: ['c-1'],
          consistency_ratio: 1.0,
          interpretation: 'Monotonic progression',
        },
      },
    },
    global_offset: {
      sample_count: 1,
      valid_pair_count: 1,
      missing_timestamp_count: 0,
      min_offset_sec: 5.0,
      max_offset_sec: 5.0,
      median_offset_sec: 5.0,
      mad_sec: 0.0,
      tolerance_band: null,
      dispersion_note: 'Measured dispersion (MAD) is 0.00s',
    },
    chronological_consistency: {
      sample_count: 1,
      inversions_count: 0,
      inversions: [],
      lis_length: 1,
      lis_candidate_ids: ['c-1'],
      consistency_ratio: 1.0,
      interpretation: 'Monotonic progression',
    },
    clusters: [],
    trend: null,
    has_raw_evidence: true,
    is_report_fallback_only: false,
  };

  const out = {};
  vm.runInNewContext(compile('../lib/temporal-evidence.ts'), {
    exports: out,
    require: (mod) => {
      if (mod === './api') {
        return {
          API_BASE: 'http://127.0.0.1:8000',
          fetchNoCache: async (url, init) => {
            calls.push({ url, init });
            return new Response(JSON.stringify(mockPayload), { status: 200 });
          },
        };
      }
      return {};
    },
    Response,
    JSON,
    encodeURIComponent,
    Error,
  });

  const res = await out.getTemporalEvidence('inc-test-1');
  assert.equal(res.incident_id, 'inc-test-1');
  assert.equal(res.valid_pair_count, 1);
  assert.equal(res.global_offset.median_offset_sec, 5.0);
  assert.equal(res.global_offset.mad_sec, 0.0);
  assert.equal(res.global_offset.tolerance_band, null);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes('/api/incidents/inc-test-1/temporal-evidence'));
});

test('getTemporalEvidence rejects on HTTP error with server detail', async () => {
  const out = {};
  vm.runInNewContext(compile('../lib/temporal-evidence.ts'), {
    exports: out,
    require: (mod) => {
      if (mod === './api') {
        return {
          API_BASE: 'http://127.0.0.1:8000',
          fetchNoCache: async () =>
            new Response(JSON.stringify({ detail: 'Incident not found' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            }),
        };
      }
      return {};
    },
    Response,
    JSON,
    encodeURIComponent,
    Error,
  });

  await assert.rejects(
    () => out.getTemporalEvidence('nonexistent'),
    /Incident not found/
  );
});

test('ForensicEvidenceExperience tab bar includes Temporal Evidence alongside CV and SAM', () => {
  const source = fs.readFileSync(
    new URL('../components/dashboard/ForensicEvidenceExperience.tsx', import.meta.url),
    'utf8'
  );
  assert.ok(source.includes("'cv', 'sam', 'temporal'"), 'Tab state should include cv, sam, and temporal');
  assert.ok(source.includes('Temporal Evidence'), 'UI should render Temporal Evidence tab label');
  assert.ok(source.includes('temporal-investigation-panel'), 'UI should include temporal-evidence-panel');
});


function loadTemporal(state) {
  const out = {};
  let index = 0;
  vm.runInNewContext(compile('../components/dashboard/TemporalEvidenceWorkspace.tsx'), {
    exports: out,
    require: mod => {
      if (mod === 'react') return { useState: () => [state[index++], () => {}], useEffect: () => {}, useId: () => 'test-clip' };
      if (mod === 'react/jsx-runtime') return { jsx: (type, props) => ({type, props}), jsxs: (type, props) => ({type, props}) };
      if (mod === './EvidenceSummaryPanel') return {EvidenceSummaryPanel: 'EvidenceSummaryPanel'};
      if (mod === '@/lib/temporal-evidence') return {getTemporalEvidence: () => {throw Error('Network forbidden');}};
      throw Error(mod);
    },
  });
  return out.TemporalEvidenceWorkspace;
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function payload() {
  const candidate = { candidate_id:'c-alt', incident_id:'incident-a', frame_match_index:4, suspect_frame_idx:42, rank:2,
    source_asset_id:'source-a', suspect_timestamp_sec:20, source_timestamp_sec:15, offset_sec:5, eligible:true,
    match_confirmed:false, similarity_status:'SUSPECT_MATCH', l2_distance:.6, visual_similarity_score:70 };
  const population = {population_definition:'Fixture eligible CV candidates', valid_pairs:1, missing_timestamps:0,
    total_candidates:1, offset_stats:{median_offset_sec:5,mad_sec:0,tolerance_band:null},
    chronological_consistency:{sample_count:1,lis_length:1,inversions_count:0,inversions:[]}, trend:{slope:null,sample_count:1}};
  return {incident_id:'incident-a', candidates:[candidate], by_source:{'source-a':{all_eligible:population,confirmed:{...population,total_candidates:0,valid_pairs:0,offset_stats:{median_offset_sec:null,mad_sec:null},chronological_consistency:{sample_count:0,lis_length:0,inversions_count:0,inversions:[]}}}}, clusters:[], limitations:[]};
}

test('actual point keyboard and click handlers pass exact original index AND alternative rank', () => {
  const data = payload(), selected=[];
  const Component=loadTemporal([data,null,0,'all_eligible','',null]);
  const tree=Component({incidentId:'incident-a',active:true,onSelectCandidate:c=>selected.push(c)});
  const point=nodes(tree).find(n=>n.type==='g'&&n.props.role==='button');
  assert.equal(point.props.tabIndex,0);
  point.props.onClick();
  let prevented=false;
  point.props.onKeyDown({key:'Enter',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.equal(selected.length,2);
  assert.equal(selected[0].frame_match_index,4);
  assert.equal(selected[0].rank,2);
  const out={};
  vm.runInNewContext(compile('../lib/temporal-evidence.ts'),{exports:out,require:()=>({})});
  assert.equal(out.findCVPairIndex([{frameIndex:9,rank:1},{frameIndex:4,rank:1},{frameIndex:4,rank:2}],selected[0]),2);
  assert.equal(out.findCVPairIndex([{frameIndex:4,rank:1}],selected[0]),-1);
});

test('empty selected population cannot inherit global statistics or invented playback slope', () => {
  const data=payload();
  const tree=loadTemporal([data,null,0,'confirmed','',null])({incidentId:'incident-a',active:true});
  const text=JSON.stringify(tree);
  assert.ok(text.includes('No valid timestamp pairs'));
  assert.ok(text.includes('Not recorded'));
  assert.ok(!text.includes('1.00x'));
  assert.equal(nodes(tree).filter(n=>n.type==='g'&&n.props.role==='button').length,0);
});

test('workspace handles loading, unavailable and real empty states before summary generation', () => {
  assert.ok(JSON.stringify(loadTemporal([null,null,0,'all_eligible','',null])({incidentId:'incident-a',active:true})).includes('Loading recorded'));
  assert.ok(JSON.stringify(loadTemporal([null,'Offline',0,'all_eligible','',null])({incidentId:'incident-a',active:true})).includes('Offline'));
  assert.equal(loadTemporal([null,null,0,'all_eligible','',null])({incidentId:'incident-a',active:false}),null);
  assert.ok(JSON.stringify(loadTemporal([{...payload(), candidates:[]},null,0,'all_eligible','',null])({incidentId:'incident-a',active:true})).includes('No raw temporal evidence'));
});
