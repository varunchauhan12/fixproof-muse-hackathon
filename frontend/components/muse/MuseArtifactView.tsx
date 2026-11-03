"use client";
import React, {useState} from 'react';
import type {MuseArtifact} from '@/lib/muse-assistant';
import {downloadDetailedReportPdf} from '@/lib/api';
import {saveMuseFile} from './MuseDocumentWorkspace';

export function MuseArtifactView({artifact,edit,onEdit,onSend}:{artifact:MuseArtifact;edit?:{subject:string;body:string};onEdit:(edit:{subject:string;body:string})=>void;onSend:()=>void}) {
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const value=edit || {subject:artifact.title,body:artifact.body};
  const download=async()=>{
    if(!artifact.report_id||busy)return;
    setBusy(true);setError('');
    try {saveMuseFile(await downloadDetailedReportPdf(artifact.report_id),`fixproof-${artifact.report_id}.pdf`);}
    catch(e){setError(e instanceof Error?e.message:'PDF download failed.');}
    finally{setBusy(false);}
  };
  return <article aria-label={`${artifact.kind} artifact`} className="my-3 min-w-0 w-full max-w-full shrink-0 overflow-hidden space-y-3 rounded-xl border border-[#c9c2b5] bg-white p-3 text-black">
    <div><h4 className="text-xs font-semibold">{artifact.title}</h4><p className="mt-1 break-all text-[10px] text-zinc-600">{artifact.status} · {artifact.model_id || 'Server-prepared workflow'}{artifact.report_id ? ` · PDF ${artifact.report_id.slice(0,8)}` : ''}</p></div>
    {artifact.kind==='report'?<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed">{artifact.body}</pre>:<><label className="block text-[11px]">Draft title<input aria-label="Artifact title" value={value.subject} maxLength={200} onChange={e=>onEdit({...value,subject:e.target.value})} className="mt-1 w-full rounded border p-2 text-xs" /></label><label className="block text-[11px]">Editable draft<textarea aria-label="Artifact draft" value={value.body} maxLength={20000} onChange={e=>onEdit({...value,body:e.target.value})} className="mt-1 min-h-52 w-full resize-y rounded border p-2 text-xs leading-relaxed" /></label></>}
    {artifact.truncated&&<p className="text-xs text-amber-800">Preview was shortened. Use the full saved PDF where available.</p>}
    <div className="flex flex-wrap gap-2 text-[11px]">{artifact.report_id&&<button disabled={busy} onClick={download} className="rounded-lg border px-3 py-2">{busy?'Downloading PDF…':'Download PDF'}</button>}<button onClick={()=>saveMuseFile(value.body,`fixproof-${artifact.kind}-${artifact.artifact_id.slice(0,8)}.txt`)} className="rounded-lg border px-3 py-2">Export {artifact.truncated?'preview':'draft'}</button>{artifact.kind==='email'&&artifact.status!=='ACCEPTED'&&<button onClick={onSend} className="rounded-lg border px-3 py-2">Review email proposal</button>}</div>
    {error&&<p role="alert" className="text-xs text-red-800">{error}</p>}
    {artifact.kind==='email'&&<p className="text-[10px] text-zinc-600">Recipient is fixed on the server. Sending requires a separate exact email approval. Acceptance is not proof of delivery.</p>}
  </article>;
}
