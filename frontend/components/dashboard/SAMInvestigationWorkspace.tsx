'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getClientSessionId } from '@/lib/api';
import { evidenceTime } from '@/lib/forensic-evidence';
import { SAMWorkspaceClient, processSAMQueue, maskState, observationMatches, validatedBox, type SAMCandidate, type SAMObservation, type SAMTarget } from '@/lib/sam-workspace';

function SAMFrameViewer({client, candidate, target, observation}: {client:SAMWorkspaceClient;candidate:SAMCandidate;target:SAMTarget;observation?:SAMObservation}) {
  const [image,setImage]=useState<{url:string;width:number;height:number;hash:string}|null>(null);
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  const [visible,setVisible]=useState(true);
  const [selectedObject,setSelectedObject]=useState<number|null>(null);
  const svgRef=useRef<SVGSVGElement|null>(null);
  const [renderWidth,setRenderWidth]=useState(0);
  useEffect(()=>{
    if(!svgRef.current || typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(entries=>{const width=entries[0]?.contentRect.width;if(width>0)setRenderWidth(width);});
    observer.observe(svgRef.current);
    return()=>observer.disconnect();
  },[image?.url]);
  useEffect(()=>{
    const controller=new AbortController();let url='';
    client.frame(candidate,target,controller.signal).then(async blob=>{
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join('');
      if(controller.signal.aborted)return;
      url=URL.createObjectURL(blob);
      const probe=new Image();
      probe.onload=()=>{if(!controller.signal.aborted)setImage({url,width:probe.naturalWidth,height:probe.naturalHeight,hash});};
      probe.onerror=()=>{if(!controller.signal.aborted)setError('Frame image could not be decoded.');};
      probe.src=url;
    }).catch(()=>{if(!controller.signal.aborted)setError('Recorded frame is unavailable.');});
    return ()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
  },[client,candidate,target,attempt]);
  const valid=observation && observationMatches(candidate,target,observation) ? observation : undefined;
  const dimensions=valid?.original_dimensions;
  const aligned=(valid?.status==='VALIDATED' || valid?.status==='PARTIAL') && !!image && !!dimensions && image.width===dimensions.width && image.height===dimensions.height && image.hash===valid?.image_sha256;
  const objects=valid?.objects || [];
  const frame=candidate[target];
  const labelSize=image ? (renderWidth ? 13*image.width/renderWidth : image.width/32) : 16;
  return <section className={`min-w-0 overflow-hidden rounded-xl border ${target==='reference'?'border-teal-800':'border-amber-900'}`} aria-label={`SAM ${target} evidence`}>
    <header className="flex items-center justify-between bg-[#201e1b] p-3"><strong className={target==='reference'?'text-teal-300':'text-amber-200'}>{target==='reference'?'Reference':'Suspect'}</strong><span className="font-mono">{evidenceTime(frame.timestamp_sec)}</span></header>
    <div className="flex min-h-52 items-center justify-center bg-black/60 p-2">
      {image && !error ? <svg ref={svgRef} viewBox={`0 0 ${image.width} ${image.height}`} className="block max-h-[520px] w-full" style={{aspectRatio:`${image.width}/${image.height}`}} role="img" aria-label={`${target} recorded frame`}>
        <image href={image.url} x="0" y="0" width={image.width} height={image.height}/>
        {visible && aligned && objects.map((object,index)=>{
          const box=validatedBox(object.box);if(!box)return null;
          const [x1,y1,x2,y2]=box;
          return <g key={`${object.object_id}-${index}`} onClick={()=>setSelectedObject(index)} role="button" tabIndex={0} aria-label={`Inspect ${object.label}, local object ${object.object_id}`} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelectedObject(index);}}}>
            <rect x={x1*image.width} y={y1*image.height} width={(x2-x1)*image.width} height={(y2-y1)*image.height} fill="transparent" stroke={selectedObject===index?'#fff':'#5eead4'} strokeWidth={selectedObject===index?3:2} vectorEffect="non-scaling-stroke"/>
            <text x={x1*image.width+4} y={Math.min(image.height-labelSize*.25,Math.max(labelSize,y1*image.height+labelSize))} fill="white" stroke="black" strokeWidth={labelSize*.12} paintOrder="stroke" fontWeight="600" fontSize={labelSize}>{object.label} · {object.object_id}</text>
          </g>;
        })}
      </svg> : <div className="p-6 text-center text-sm text-[#aba497]" role="status">{error || 'Loading session-authorized frame…'}{error&&<button className="ml-2 underline" onClick={()=>{setError('');setImage(null);setAttempt(a=>a+1);}}>Retry image</button>}</div>}
    </div>
    <div className="space-y-3 p-3 text-xs">
      <p className="break-all font-mono text-[#aba497]">{frame.asset_id} · {frame.filename}<br/>Frame ID {frame.frame_id ?? 'not recorded'} · original {image?`${image.width}×${image.height}`:'dimensions pending'}</p>
      <label className="flex gap-2"><input type="checkbox" checked={visible} onChange={e=>setVisible(e.target.checked)}/>Show validated bounding boxes</label>
      {valid && !aligned && objects.length>0 && <p className="text-amber-200">Overlay unavailable until original image dimensions and content hash agree with the result.</p>}
      <p>{valid?.status || 'Not investigated'}{valid?.reused?' · cached result':''}</p>
      {valid?.error && <p role="alert" className="text-amber-200">{valid.error}</p>}
      {valid && <p className="text-[#aba497]">Provider {valid.provider || 'not recorded'} · model {valid.model_id || 'not recorded'}{typeof valid.latency_ms==='number'?` · ${valid.latency_ms}ms`:''}<br/>Label discovery: {valid.discovery_model || 'Explicit concept prompt'}<br/>Provider input: {valid.prepared_dimensions ? `${valid.prepared_dimensions.width}×${valid.prepared_dimensions.height}` : 'dimensions not recorded'}<br/>Image hash: {valid.image_sha256?.slice(0,16) || 'not recorded'}</p>}
      <ul className="space-y-2" aria-label={`${target} objects`}>{objects.map((object,index)=><li key={`${object.object_id}-${index}`}><button className={`w-full rounded border p-2 text-left ${selectedObject===index?'border-white/70':'border-white/10'}`} onClick={()=>setSelectedObject(index)} aria-pressed={selectedObject===index}>
        <strong>{object.label || 'Unlabelled object'} · local object {object.object_id}</strong><br/>{validatedBox(object.box)?'Box coordinates validated':'Box rejected'}<br/>{maskState(object.mask)}
      </button></li>)}</ul>
      {(valid?.status==='NO_OBJECTS_DETECTED' || valid?.status==='NO_OBJECT_CONCEPTS') && <p>No validated object boxes were returned for this frame.</p>}
      {valid?.concept_results && <ul className="text-[#aba497]">{valid.concept_results.map((concept,index)=><li key={index}>{concept.label}: {concept.status}</li>)}</ul>}
    </div>
  </section>;
}

function SAMSessionWorkspace({incidentId,session,active}: {incidentId:string;session:string;active:boolean}) {
  const client=useMemo(()=>new SAMWorkspaceClient(session),[session]);
  const [queue,setQueue]=useState<SAMCandidate[]|null>(null);
  const [queueError,setQueueError]=useState('');
  const [refresh,setRefresh]=useState(0);
  const [selectedId,setSelectedId]=useState('');
  const [results,setResults]=useState<Record<string, SAMInvestigationResult>>({});
  const [statuses,setStatuses]=useState<Record<string,'running'|'ready'|'failed'>>({});
  const [errors,setErrors]=useState<Record<string,string>>({});
  const pending=useRef(new Set<string>());
  const attempted=useRef(new Set<string>());
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    const controller=new AbortController();
    client.queue(incidentId,controller.signal).then(items=>{if(!controller.signal.aborted){setQueue(items);setQueueError('');}}).catch(()=>{if(!controller.signal.aborted)setQueueError('SAM candidate queue could not be loaded. Check the backend and session.');});
    return()=>controller.abort();
  },[client,incidentId,refresh]);
  const selected=queue?.find(candidate=>candidate.candidate_id===selectedId)||queue?.[0];
  const result=selected?results[selected.candidate_id]:undefined;
  const error=selected?errors[selected.candidate_id]:undefined;
  const runAutomatic=useCallback(async(retry=false)=>{
    if(!selected||pending.current.has(selected.candidate_id)||(!retry&&attempted.current.has(selected.candidate_id)))return;
    attempted.current.add(selected.candidate_id);
    pending.current.add(selected.candidate_id);setStatuses(previous=>({...previous,[selected.candidate_id]:'running'}));setErrors(previous=>({...previous,[selected.candidate_id]:''}));
    try {
      const response=await client.automatic(selected,retry);
      if(mounted.current){setResults(previous=>({...previous,[selected.candidate_id]:response}));setStatuses(previous=>({...previous,[selected.candidate_id]:'ready'}));}
    }catch(failure){if(mounted.current){setErrors(previous=>({...previous,[selected.candidate_id]:failure instanceof Error?failure.message:'Automatic object investigation failed.'}));setStatuses(previous=>({...previous,[selected.candidate_id]:'failed'}));}}
    finally{pending.current.delete(selected.candidate_id);}
  },[client,selected]);
  useEffect(()=>{
    const controller=new AbortController();
    if(active&&queue)void Promise.resolve().then(()=>{
      if(controller.signal.aborted)return;
      return processSAMQueue(client,queue,{
        signal:controller.signal,
        shouldStart:candidate=>{if(attempted.current.has(candidate.candidate_id))return false;attempted.current.add(candidate.candidate_id);return true;},
        onStart:candidate=>{pending.current.add(candidate.candidate_id);if(mounted.current)setStatuses(previous=>({...previous,[candidate.candidate_id]:'running'}));},
        onResult:(candidate,response)=>{if(mounted.current){setResults(previous=>({...previous,[candidate.candidate_id]:response}));setStatuses(previous=>({...previous,[candidate.candidate_id]:'ready'}));}},
        onError:(candidate,failure)=>{if(mounted.current){setErrors(previous=>({...previous,[candidate.candidate_id]:failure instanceof Error?failure.message:'Automatic object investigation failed.'}));setStatuses(previous=>({...previous,[candidate.candidate_id]:'failed'}));}},
        onFinish:candidate=>{pending.current.delete(candidate.candidate_id);},
      });
    });
    return()=>controller.abort();
  },[active,queue,client]);
  const busy=selected?statuses[selected.candidate_id]==='running':false;
  const finished=Object.values(statuses).filter(status=>status==='ready'||status==='failed').length;
  const running=Object.values(statuses).filter(status=>status==='running').length;
  return <section className="space-y-5 rounded-2xl border border-white/10 bg-[#171615] p-5" aria-label="SAM investigation workspace">
    <header><h3 className="text-xl font-semibold">Automatic object investigation</h3><p className="mt-1 text-sm text-[#aba497]">All confirmed CV matches are prepared automatically. Browse any pair while the batch runs.</p><p className="mt-2 text-xs text-[#8e887d]">Up to four salient categories per image. Results are reused; this is not an exhaustive detector of everything in the scene.</p></header>
    {queueError?<div role="alert" className="text-amber-200">{queueError}<button className="ml-3 underline" onClick={()=>{setQueueError('');setRefresh(count=>count+1);}}>Retry candidate queue</button></div>:!queue?<p role="status">Loading eligible CV candidates…</p>:!queue.length?<p className="rounded border border-dashed border-white/20 p-8 text-center">No CV candidate pairs are available for SAM investigation.</p>:selected&&<>
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 text-xs text-[#aba497]">CV-discovered candidate<select aria-label="SAM candidate" value={selected.candidate_id} onChange={event=>setSelectedId(event.target.value)} className="mt-2 w-full rounded border border-white/15 bg-[#121211] p-3 text-[#f4efe6]">{queue.map((candidate,index)=><option key={candidate.candidate_id} value={candidate.candidate_id}>#{index+1} · S {evidenceTime(candidate.suspect.timestamp_sec)} / R {evidenceTime(candidate.reference.timestamp_sec)} · L2 {candidate.l2_distance.toFixed(4)} · {candidate.status} · SAM {statuses[candidate.candidate_id] || 'queued'}</option>)}</select></label>
        {(error||result)&&<button onClick={()=>void runAutomatic(true)} disabled={busy} className="rounded border border-white/15 px-4 py-3 text-sm disabled:opacity-40">Retry object investigation</button>}
      </div>
      <div role="status" className="space-y-2 text-sm text-teal-200"><p>{finished} / {queue.length} pairs prepared · {running} running{!active?' · queue paused':''}</p><progress aria-label="SAM batch progress" max={queue.length} value={finished} className="h-2 w-full accent-teal-400"/><p className="text-xs text-[#8e887d]">Two candidate workers; up to four localization calls at once. Inactive tabs pause remaining jobs. Failed pairs require an explicit retry.</p></div>
      {error&&<p role="alert" className="text-sm text-amber-200">{error} No automatic retry will be made.</p>}
      <div className="rounded border border-white/10 p-3 text-xs font-mono break-all">Candidate {selected.candidate_id} · array index {selected.frame_match_index} · CV rank {selected.rank} · {selected.status}<br/>Visual similarity {typeof selected.visual_similarity_score==='number'?`${selected.visual_similarity_score.toFixed(1)} / 100`:'not recorded'} · Evidence {selected.evidence_id || 'ID not recorded'}</div>
      <div className="grid gap-4 lg:grid-cols-2">{(['reference','suspect'] as const).map(target=><SAMFrameViewer key={`${selected.candidate_id}-${target}`} client={client} candidate={selected} target={target} observation={result?.targets[target]}/>)}</div>
      <section className="rounded-xl border border-white/10 p-4 text-sm"><h4 className="font-semibold">Combined evidence review</h4><p className="mt-2">CV L2 {selected.l2_distance.toFixed(4)} · backend confirmation: {selected.confirmed?'explicitly confirmed CV candidate':'unconfirmed candidate'}</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{(['reference','suspect'] as const).map(target=><p key={target}>{target}: {result?.targets[target]?.status || 'Awaiting automatic investigation'}{result?` · ${result.targets[target].objects.length} localized objects`:''}</p>)}</div><p className="mt-3 text-[#aba497]">Labels are Muse vision suggestions localized by SAM. Object IDs are local to each category and image. Tracking and cross-video identity are unavailable. Raw masks remain undecoded. These observations are visual evidence, not legal conclusions.</p></section>
    </>}
  </section>;
}
type SAMInvestigationResult = Awaited<ReturnType<SAMWorkspaceClient['investigate']>>;
export function SAMInvestigationWorkspace({incidentId,active=true}: {incidentId:string;active?:boolean}) {
  const [session,setSession]=useState(()=>getClientSessionId());
  useEffect(()=>{const changed=()=>setSession(getClientSessionId());window.addEventListener('fixproof_session_changed',changed);return()=>window.removeEventListener('fixproof_session_changed',changed);},[]);
  return <SAMSessionWorkspace key={`${incidentId}:${session}`} incidentId={incidentId} session={session} active={active}/>;
}
