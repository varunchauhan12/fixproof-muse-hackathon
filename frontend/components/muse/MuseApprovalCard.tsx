"use client";
import {useEffect,useState} from "react";
import type {MusePendingAction} from '@/lib/muse-assistant';

export function MuseApprovalCard({proposal,active,busy,onApprove,onCancel}:{proposal:MusePendingAction;active:boolean;busy:boolean;onApprove:()=>void;onCancel:()=>void}) {
  const sending=proposal.action==='send_registered';
  const [expired,setExpired]=useState(false);
  useEffect(()=>{const timer=setTimeout(()=>setExpired(true),Math.max(0,Date.parse(proposal.expires_at)-Date.now()));return()=>clearTimeout(timer);},[proposal.expires_at]);
  return <article aria-label="Muse action approval" className="my-3 min-w-0 w-full max-w-full shrink-0 overflow-hidden rounded-xl border border-teal-700/40 bg-teal-50 p-3 text-black">
    <h4 className="text-sm font-semibold">{sending?'Review email before sending':'Review proposed action'}</h4>
    <p className="my-2 text-xs">{proposal.summary}</p>
    <dl className="space-y-2 break-words text-xs"><div><dt>Incident</dt><dd className="break-all font-mono">{proposal.incident_id}</dd></div>{proposal.recipient_email&&<div><dt>Registered recipient</dt><dd className="break-all">{proposal.recipient_email}</dd></div>}{proposal.subject&&<div><dt>Subject</dt><dd>{proposal.subject}</dd></div>}{proposal.report_id&&<div><dt>Exact attachment</dt><dd className="break-all">{proposal.attachment_name} · Report {proposal.report_id}</dd></div>}</dl>
    {proposal.body_preview&&<details className="mt-3 text-xs"><summary>Email body preview</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">{proposal.body_preview}</pre></details>}
    <p className="my-3 text-[11px]">{sending?'Approve and Send will submit only this prepared email and exact PDF to Resend. Acceptance is not delivery.':'Approving runs this action for the selected investigation. It does not authorize an email send.'}</p>
    {active&&!expired?<div className="flex flex-wrap gap-2"><button disabled={busy} onClick={onApprove} className="rounded-lg bg-teal-900 px-3 py-2 text-xs text-white disabled:opacity-40">{sending?'Approve and Send':'Approve action'}</button><button disabled={busy} onClick={onCancel} className="rounded-lg border border-teal-800 px-3 py-2 text-xs disabled:opacity-40">Cancel</button></div>:<p className="text-xs">{expired?'Proposal expired. Ask for a new one.':'This proposal is no longer active.'}</p>}
  </article>;
}
