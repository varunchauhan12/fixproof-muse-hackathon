"use client";

import React, { useEffect, useId, useState } from "react";
import { getTemporalEvidence, type TemporalCandidate, type TemporalEvidenceResult } from "@/lib/temporal-evidence";

type Population = 'all_eligible' | 'confirmed' | 'unconfirmed';
interface Props {
  incidentId: string;
  active: boolean;
  onSelectCandidate?: (candidate: TemporalCandidate) => void;
}
const number = (value: number | null | undefined, unit = '') => value == null ? 'Not recorded' : `${value.toFixed(2)}${unit}`;
const panel = 'rounded-xl border border-white/10 bg-[#171615] p-4 sm:p-5';
const control = 'rounded-lg border border-white/15 bg-[#121110] px-3 py-2 text-xs text-[#f4efe6] focus-visible:outline-2 focus-visible:outline-teal-400';

/** Lazy, abortable read only view. Opening this tab never starts SAM or inference. */
export function TemporalEvidenceWorkspace({ incidentId, active, onSelectCandidate }: Props) {
  const [data, setData] = useState<TemporalEvidenceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [population, setPopulation] = useState<Population>('all_eligible');
  const [source, setSource] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const clipId = useId();

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    getTemporalEvidence(incidentId, controller.signal).then(result => {
      if (!controller.signal.aborted) { setData(result); setError(null); }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Temporal evidence is unavailable.');
    });
    return () => controller.abort();
  }, [incidentId, active, attempt]);

  if (!active) return null;
  if (error) return <div role="alert" className={panel}><h3 className="font-medium">Temporal evidence unavailable</h3><p className="my-3 text-sm text-[#aba497]">{error}</p><button className={control} onClick={() => { setError(null); setData(null); setAttempt(v => v + 1); }}>Retry</button></div>;
  if (!data || data.incident_id !== incidentId) return <div role="status" className={panel}>Loading recorded temporal evidence…</div>;
  if (!data.candidates.length) return <div className={panel}><h3 className="font-medium">No raw temporal evidence</h3><p className="mt-2 text-sm text-[#aba497]">{data.is_report_fallback_only ? 'Only stored report correlations are available. They are excluded from raw statistics.' : 'No recorded frame candidates are available for this incident.'}</p></div>;

  const sources = Object.keys(data.by_source);
  const sourceId = sources.includes(source) ? source : sources[0];
  const metrics = data.by_source[sourceId]?.[population];
  const candidates = data.candidates.filter(c => c.eligible && c.source_asset_id === sourceId && (population === 'all_eligible' || (population === 'confirmed') === c.match_confirmed));
  const valid = candidates.filter(c => c.source_timestamp_sec != null && c.suspect_timestamp_sec != null);
  const selected = candidates.find(c => c.candidate_id === selectedId) || candidates[0];
  const offsets = metrics?.offset_stats;
  const chronology = metrics?.chronological_consistency;
  const trend = metrics?.trend;
  const referenceTimes = valid.map(c => c.source_timestamp_sec!);
  const suspectTimes = valid.map(c => c.suspect_timestamp_sec!);
  const domain = (times: number[]) => {
    const min = times.length ? Math.min(...times) : 0;
    const max = times.length ? Math.max(...times) : 0;
    const margin = Math.max(1, (max - min) * .08);
    return [Math.max(0, min - margin), max + margin];
  };
  const [xmin, xmax] = domain(referenceTimes), [ymin, ymax] = domain(suspectTimes);
  const x = (v: number) => 60 + (v - xmin) / (xmax - xmin) * 580;
  const y = (v: number) => 300 - (v - ymin) / (ymax - ymin) * 260;
  const median = offsets?.median_offset_sec;
  const band = offsets?.tolerance_band;
  const inspect = (candidate: TemporalCandidate) => { setSelectedId(candidate.candidate_id); onSelectCandidate?.(candidate); };
  const summary = [
    ['Valid pairs', `${metrics?.valid_pairs ?? 0}`, `${metrics?.missing_timestamps ?? 0} missing timestamp pairs`],
    ['Median offset', number(median, 's'), `MAD ${number(offsets?.mad_sec, 's')}`],
    ['Ordering inversions', `${chronology?.inversions_count ?? 0}`, `Increasing subsequence ${chronology?.lis_length ?? 0} / ${chronology?.sample_count ?? 0}`],
    ['Reference-time slope', number(trend?.slope), `${trend?.sample_count ?? 0} valid pairs · descriptive OLS`],
  ];

  return <section aria-label="Temporal evidence workspace" className="space-y-5 text-[#f4efe6]">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs uppercase tracking-widest text-teal-300">Recorded correspondence</p><h3 className="mt-1 text-xl font-medium">Temporal Evidence</h3><p className="mt-2 max-w-xl text-xs text-[#aba497]">Compare sampled timestamps, ordering and offset dispersion. Gaps cannot establish missing footage or infringement.</p></div>
      <div className="flex flex-wrap gap-2">
        <label className="space-y-1 text-xs text-[#aba497]"><span className="block">Reference asset</span><select aria-label="Reference asset" className={`${control} max-w-64`} value={sourceId || ''} onChange={e => { setSource(e.target.value); setSelectedId(null); }}>{sources.map(id => <option key={id} value={id}>{id}</option>)}</select></label>
        <label className="space-y-1 text-xs text-[#aba497]"><span className="block">Candidate population</span><select aria-label="Candidate population" className={control} value={population} onChange={e => { setPopulation(e.target.value as Population); setSelectedId(null); }}><option value="all_eligible">All eligible</option><option value="confirmed">Backend-confirmed</option><option value="unconfirmed">Eligible, unconfirmed</option></select></label>
      </div>
    </header>
    <p className="text-xs text-[#aba497]">{metrics?.population_definition || 'No eligible candidates passed the existing CV gate.'} · {candidates.length} candidates in this view; {data.candidates.filter(c => !c.eligible).length} excluded observations across the incident.</p>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{summary.map(([title, value, detail]) => <div key={title} className={panel}><p className="text-xs text-[#aba497]">{title}</p><p className="my-2 text-2xl font-medium tabular-nums">{value}</p><p className="text-[11px] text-[#aba497]">{detail}</p></div>)}</div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(250px,1fr)]">
      <div className={`${panel} min-w-0 space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-medium">Frame correspondence</h4><p className="text-xs text-[#aba497]">● Confirmed <span className="ml-2 text-amber-300">● Unconfirmed</span></p></div>
        {!valid.length ? <p role="status" className="py-12 text-center text-sm text-[#aba497]">No valid timestamp pairs in this population. Missing values remain unavailable.</p> : <svg viewBox="0 0 680 350" role="group" aria-label="Reference versus suspect timestamp correspondence" className="h-auto w-full rounded-lg bg-[#121110]">
          <defs><clipPath id={clipId}><rect x="60" y="40" width="580" height="260" /></clipPath></defs>
          {[0, .25, .5, .75, 1].map(t => <g key={t}>
            <path d={`M ${x(xmin + t * (xmax - xmin))} 40 V 300 M 60 ${y(ymin + t * (ymax - ymin))} H 640`} stroke="#ffffff10" />
            <text x={x(xmin + t * (xmax - xmin))} y="319" textAnchor="middle" fill="#aba497" fontSize="11">{(xmin + t * (xmax - xmin)).toFixed(1)}</text>
            <text x="50" y={y(ymin + t * (ymax - ymin)) + 4} textAnchor="end" fill="#aba497" fontSize="11">{(ymin + t * (ymax - ymin)).toFixed(1)}</text>
          </g>)}
          <text x="350" y="341" textAnchor="middle" fill="#aba497" fontSize="12">Reference timestamp (s)</text><text x="16" y="170" textAnchor="middle" transform="rotate(-90 16 170)" fill="#aba497" fontSize="12">Suspect timestamp (s)</text>
          <g clipPath={`url(#${clipId})`}>
            {band && <polygon points={`${x(xmin)},${y(xmin + band.lower)} ${x(xmax)},${y(xmax + band.lower)} ${x(xmax)},${y(xmax + band.upper)} ${x(xmin)},${y(xmin + band.upper)}`} fill="#5eead415" />}
            {median != null && <line x1={x(xmin)} y1={y(xmin + median)} x2={x(xmax)} y2={y(xmax + median)} stroke="#5eead4" strokeDasharray="5 5" />}
          </g>
          {valid.map(c => <g key={c.candidate_id} role="button" tabIndex={0} aria-label={`Inspect array ${c.frame_match_index}, candidate ${c.rank}: reference ${number(c.source_timestamp_sec, 's')}, suspect ${number(c.suspect_timestamp_sec, 's')}`} onFocus={() => setSelectedId(c.candidate_id)} onMouseEnter={() => setSelectedId(c.candidate_id)} onClick={() => inspect(c)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inspect(c); } }} className="cursor-pointer outline-none">
            <title>{`Array ${c.frame_match_index} · candidate ${c.rank}\nReference ${number(c.source_timestamp_sec, 's')} · Suspect ${number(c.suspect_timestamp_sec, 's')}\nOffset ${number(c.offset_sec, 's')} · L2 ${number(c.l2_distance)}\nDeviation from selected median ${median == null ? 'Not recorded' : number(c.offset_sec! - median, 's')} · Uncalibrated similarity ${number(c.visual_similarity_score)} · ${c.similarity_status}`}</title>
            <circle cx={x(c.source_timestamp_sec!)} cy={y(c.suspect_timestamp_sec!)} r="12" fill="transparent" />
            <circle cx={x(c.source_timestamp_sec!)} cy={y(c.suspect_timestamp_sec!)} r={selected?.candidate_id === c.candidate_id ? 7 : 5} fill={c.match_confirmed ? '#5eead4' : '#fbbf24'} stroke={selected?.candidate_id === c.candidate_id ? '#fff' : median != null && offsets?.mad_sec != null && Math.abs(c.offset_sec! - median) > 2.5 * offsets.mad_sec ? '#fb7185' : '#121110'} strokeWidth="2" />
          </g>)}
        </svg>}
        <p className="text-xs leading-relaxed text-[#aba497]">{offsets?.dispersion_note} The dashed line is a measured median-offset guide, not continuous frame evidence. Rose outlines mark deviations beyond 2.5 MAD; when MAD is zero they only mark unequal offsets, without a tolerance band. {band && 'Shading: median ± 2.5 MAD, a descriptive heuristic, not a confidence interval.'}</p>
        <div className="space-y-4 border-t border-white/10 pt-4"><h4 className="text-sm font-medium">Two sampled timelines</h4>{(['source_timestamp_sec', 'suspect_timestamp_sec'] as const).map((field, index) => {
          // Each stream retains its recorded times even if its counterpart is missing.
          const timed = candidates.filter(c => c[field] != null);
          const [min, max] = domain(timed.map(c => c[field]!));
          return <div key={field}><p className="mb-2 text-xs text-[#aba497]">{index === 0 ? 'Reference' : 'Suspect'} · {timed.length} recorded timestamps</p><div className="relative h-8 rounded bg-white/5">{timed.map(c => <button key={c.candidate_id} style={{ left: `calc(${(c[field]! - min) / (max - min) * 96}% + 2px)` }} onClick={() => inspect(c)} className={`absolute top-1 h-6 w-2 rounded-sm focus-visible:outline-2 focus-visible:outline-white ${c.match_confirmed ? 'bg-teal-300' : 'bg-amber-300'}`} aria-label={`Inspect ${index === 0 ? 'reference' : 'suspect'} timestamp ${number(c[field], 's')}, candidate ${c.rank}`} title={number(c[field], 's')} />)}</div></div>;
        })}<p className="text-xs text-[#aba497]">Empty space marks intervals without sampled observations. Sampling cadence is not assumed.</p></div>
      </div>
      <aside className={`${panel} space-y-4`} aria-label="Temporal candidate details"><h4 className="text-sm font-medium">Recorded pair details</h4>{selected ? <>
        <p className="text-xs text-teal-300">Array {selected.frame_match_index} · submitted frame {selected.suspect_frame_idx ?? 'Not recorded'} · candidate {selected.rank}</p>
        <dl className="space-y-3 text-xs">{[
          ['Reference timestamp', number(selected.source_timestamp_sec, 's')], ['Suspect timestamp', number(selected.suspect_timestamp_sec, 's')], ['Measured offset', number(selected.offset_sec, 's')], ['L2 distance', number(selected.l2_distance)], ['Visual similarity (uncalibrated)', number(selected.visual_similarity_score)], ['Backend status', selected.similarity_status], ['Evidence ID', selected.evidence_id || 'Not recorded'], ['Cluster', selected.interval_id || 'Not clustered'], ['SAM context', 'Independent SAM workspace; cached observations are not queried here'],
        ].map(([label, value]) => <div key={label}><dt className="text-[#aba497]">{label}</dt><dd className="mt-1 break-all font-mono">{value}</dd></div>)}</dl>
        {onSelectCandidate && <button className={`${control} w-full`} onClick={() => inspect(selected)}>Inspect exact pair in CV →</button>}
      </> : <p className="text-xs text-[#aba497]">No candidates in this population.</p>}
      <div className="border-t border-white/10 pt-4"><h4 className="text-sm font-medium">Ordering observations</h4><p className="mt-2 text-xs leading-relaxed text-[#aba497]">{chronology?.interpretation || 'Unavailable'}</p><p className="mt-2 text-xs text-[#aba497]">{trend?.interpretation}</p></div></aside>
    </div>
    {!!chronology?.inversions.length && <div className={panel}><h4 className="mb-3 text-sm font-medium">Backward reference comparisons</h4><div className="max-h-64 space-y-3 overflow-auto">{chronology.inversions.map(inv => <div key={`${inv.candidate_a_id}-${inv.candidate_b_id}`} className="border-l-2 border-amber-400/50 pl-3 text-xs"><p>{inv.description}</p><p className="my-1 break-all font-mono text-[#aba497]">{inv.candidate_a_id} → {inv.candidate_b_id}</p><button className="text-teal-300" onClick={() => { const c = candidates.find(c => c.candidate_id === inv.candidate_b_id); if (c) inspect(c); }}>Inspect exact later pair →</button></div>)}</div></div>}
    <div className={`${panel} overflow-hidden`}><h4 className="mb-3 text-sm font-medium">Candidate provenance</h4><div className="max-h-80 overflow-auto"><table className="w-full text-left text-xs"><thead className="text-[#aba497]"><tr>{['Pair', 'Suspect', 'Reference', 'Offset', 'L2', 'Status', ''].map((v, i) => <th key={i} className="px-3 py-2 whitespace-nowrap">{v}</th>)}</tr></thead><tbody>{candidates.map(c => <tr key={c.candidate_id} className="border-t border-white/5"><td className="px-3 py-3">{c.frame_match_index} / {c.rank}</td><td className="px-3 py-3 whitespace-nowrap">{number(c.suspect_timestamp_sec, 's')}</td><td className="px-3 py-3 whitespace-nowrap">{number(c.source_timestamp_sec, 's')}</td><td className="px-3 py-3 whitespace-nowrap">{number(c.offset_sec, 's')}</td><td className="px-3 py-3">{number(c.l2_distance)}</td><td className="px-3 py-3">{c.match_confirmed ? 'Backend-confirmed' : 'Unconfirmed'}</td><td className="px-3 py-3"><button className={control} onClick={() => inspect(c)}>CV Inspect</button></td></tr>)}</tbody></table></div></div>
    <details className={panel}><summary className="cursor-pointer text-sm">Clusters, methodology & limitations</summary><p className="mt-4 text-xs leading-relaxed text-[#aba497]">{data.methodology}</p><p className="mt-3 text-xs text-[#aba497]">{offsets?.method} {chronology?.method} {trend?.method}</p><div className="my-4 space-y-2">{data.clusters.filter(c => c.source_asset_id === sourceId).map(c => <p key={c.interval_id} className="text-xs text-[#aba497]">{c.interval_id} · {c.continuity_status} · {c.frame_count} retained pairs · median {number(c.median_offset_sec, 's')} · MAD {number(c.mad_sec, 's')}. Existing clustering uses all eligible candidates; it is independent of the selected population.</p>)}</div><ul className="list-disc space-y-2 pl-4 text-xs text-[#aba497]">{data.limitations.map(l => <li key={l}>{l}</li>)}</ul></details>
  </section>;
}
