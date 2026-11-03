'use client';
import React,{useEffect,useRef,useState} from 'react';
import {getClientSessionId} from '@/lib/api';
import {evidenceSummary,downloadEvidenceSummary,type EvidenceSummary,type SummaryKind} from '@/lib/evidence-summaries';

export function EvidenceSummaryPanel({incidentId,kind,ready,version=''}:{incidentId:string;kind:SummaryKind;ready:boolean;version?:string}) {
  const [session,setSession]=useState(()=>getClientSessionId());
  useEffect(()=>{const changed=()=>setSession(getClientSessionId());window.addEventListener('fixproof_session_changed',changed);return()=>window.removeEventListener('fixproof_session_changed',changed);},[]);
  return <SessionSummary key={`${incidentId}:${kind}:${session}`} incidentId={incidentId} kind={kind} ready={ready} version={version} session={session}/>;
}
function SessionSummary({incidentId,kind,ready,version,session}:{incidentId:string;kind:SummaryKind;ready:boolean;version:string;session:string}) {
  const [summary,setSummary]=useState<EvidenceSummary|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const [downloading,setDownloading]=useState(false);
  const attempted=useRef('');
  useEffect(()=>{
    if(ready)return;
    const controller=new AbortController();
    evidenceSummary(incidentId,kind,session,false,controller.signal).then(value=>{if(!controller.signal.aborted)setSummary(value);}).catch(()=>{/* Generation below supplies actionable errors. */});
    return()=>controller.abort();
  },[incidentId,kind,session,ready]);
  useEffect(()=>{
    const key=`${version}:${attempt}`;
    if(!ready){attempted.current='';return;}
    if(attempted.current===key)return;
    // Delay dispatch one microtask so Strict Mode's cleanup cannot duplicate inference.
    const controller=new AbortController();
    void Promise.resolve().then(async()=>{
      if(controller.signal.aborted)return;
      attempted.current=key;setBusy(true);setError('');
      try {const value=await evidenceSummary(incidentId,kind,session,true,controller.signal);if(!controller.signal.aborted)setSummary(value);}
      catch(reason){if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Summary generation failed.');}
      finally{if(!controller.signal.aborted)setBusy(false);}
    });
    return()=>controller.abort();
  },[incidentId,kind,session,ready,version,attempt]);
  const download=async()=>{
    if(downloading)return;setDownloading(true);setError('');
    try {const blob=await downloadEvidenceSummary(incidentId,kind,session,summary?.summary_id);const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`fixproof-${kind}-summary.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    catch(reason){setError(reason instanceof Error?reason.message:'PDF download failed.');}
    finally{setDownloading(false);}
  };
  return <section aria-label={`${kind.toUpperCase()} Spark summary`} className="space-y-3 rounded-xl border border-teal-300/20 bg-teal-300/5 p-4 text-sm">
    <h4 className="font-medium">{kind.toUpperCase()} · Muse Spark evidence summary</h4>
    {busy&&ready&&<p role="status">Preparing a saved summary from recorded evidence…</p>}
    {!summary&&!busy&&!error&&<p>{ready?'No saved summary yet.':'The summary will be prepared when this evidence analysis finishes.'}</p>}
    {summary&&<><p className="text-xs text-[#aba497]">Saved {new Date(summary.created_at).toLocaleString()} · {summary.provider} / {summary.model_id}</p><details><summary className="cursor-pointer text-teal-200">Read saved evidence summary</summary><p className="mt-3 whitespace-pre-wrap break-words text-[#ded8cb]">{summary.body}</p></details><button onClick={()=>void download()} disabled={downloading} className="rounded-lg border border-white/20 px-3 py-2 disabled:opacity-50">{downloading?'Downloading…':'Download summary PDF'}</button></>}
    {error&&<p role="alert" className="text-amber-200">{error} No automatic retry will be made.</p>}
    {ready&&!busy&&<button className="ml-3 underline" onClick={()=>{setAttempt(v=>v+1);}}>{error?'Retry summary':'Refresh summary'}</button>}
    <p className="text-xs text-[#aba497]">Saved summaries are available in Muse chat. They describe recorded observations, not legal conclusions.</p>
  </section>;
}
