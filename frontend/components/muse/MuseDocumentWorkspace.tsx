"use client";

import React, { useEffect, useRef, useState } from 'react';
import { downloadDetailedReportPdf, draftNemotronDocument, emailDetailedReport, generateDetailedReport, getClientSessionId, getDetailedReport, getDetailedReportsForIncident, getEmailStatus } from '@/lib/api';
import type { DetailedReportRecord } from '@/lib/types';
import type { MuseWorkflow } from '@/lib/muse-assistant';

const choices: [MuseWorkflow, string][] = [['report','Investigation report'],['copyright','Copyright notice'],['licensing','Licensing proposal'],['summary','Professional summary'],['email','Email report']];
const input = 'w-full rounded-lg border border-[#d5d0c5] bg-white px-3 py-2 text-xs text-black focus-visible:outline-2 focus-visible:outline-teal-600';
const button = 'rounded-lg border border-[#c6c0b4] bg-white px-3 py-2 text-xs text-black hover:bg-[#eee9df] disabled:opacity-40';

export function saveMuseFile(content: Blob | string, name: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(typeof content === 'string' ? new Blob([content], {type}) : content);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function reportText(report: DetailedReportRecord): string {
  const s = report.sections;
  const temporal = s.temporal_evidence;
  return [
    'FIXPROOF INVESTIGATION REPORT — HUMAN REVIEW REQUIRED', `Incident: ${report.incident_id}`, `Report: ${report.report_id}`, `Model: ${report.model_id} · ${report.ai_synthesized ? 'AI interpretation of recorded evidence' : 'Deterministic evidence summary'}`,
    '\nEXECUTIVE SUMMARY', s.executive_summary, '\nMETHODOLOGY', s.methodology_scope,
    '\nRECORDED CV FINDINGS', ...(s.frame_correlations || []).map(c => `Evidence ${c.evidence_id || 'Not recorded'}: suspect ${c.suspect_timestamp_sec ?? 'Not recorded'}s / reference ${c.source_timestamp_sec ?? 'Not recorded'}s; L2 ${c.l2_distance ?? 'Not recorded'}. Similarity is an uncalibrated heuristic.`),
    '\nTEMPORAL MEASUREMENTS', temporal ? `Eligible valid pairs: ${temporal.global_offset.valid_pair_count}; missing: ${temporal.global_offset.missing_timestamp_count}; median offset ${temporal.global_offset.median_offset_sec ?? 'Not recorded'}s; MAD ${temporal.global_offset.mad_sec ?? 'Not recorded'}s. ${temporal.global_offset.dispersion_note}` : 'Canonical measurements not recorded in this report.',
    s.temporal_continuity, '\nSAM CONTEXT', s.sam_context ? JSON.stringify(s.sam_context, null, 2) : 'No current SAM snapshot attached. This does not establish that SAM never ran.',
    '\nAI INTERPRETATION', s.model_assessment, '\nLIMITATIONS', s.risk_and_limitations,
    'Sampled frames do not verify unsampled footage. These findings do not determine legal infringement.', '\nNEXT STEPS', ...(s.recommended_actions || []),
  ].join('\n');
}

/** Fresh instance for every incident/session. Drafts remain local and are never model tools. */
export function MuseDocumentWorkspace(props: {incidentId: string; initial?: MuseWorkflow; onClose?: () => void}) {
  const [session, setSession] = useState(getClientSessionId);
  useEffect(() => { const change = () => setSession(getClientSessionId()); window.addEventListener('fixproof_session_changed', change); return () => window.removeEventListener('fixproof_session_changed', change); }, []);
  return <DocumentBody key={`${session}:${props.incidentId}:${props.initial || 'report'}`} {...props} session={session} />;
}

export function DocumentBody({incidentId, initial='report', onClose, session}: {incidentId:string; initial?:MuseWorkflow; onClose?:()=>void; session:string}) {
  const [kind, setKind] = useState<MuseWorkflow>(initial);
  const [report, setReport] = useState<DetailedReportRecord | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [recipient, setRecipient] = useState('');
  const [sender, setSender] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [work, setWork] = useState('');
  const [terms, setTerms] = useState('');
  const [share, setShare] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const alive = useRef(true);
  const locked = useRef(false);
  useEffect(() => {
    alive.current = true;
    getEmailStatus().then(s => { if(alive.current) setConfigured(s.configured); }).catch(()=>{});
    return () => { alive.current = false; };
  }, []);
  // No automatic report generation, external mail or model invocation on mount.
  const run = async (label: string, action: () => Promise<void>) => {
    if (locked.current || getClientSessionId() !== session) return;
    locked.current = true; setBusy(label); setError(''); setNotice('');
    try { await action(); } catch(e) { if(alive.current) setError(e instanceof Error ? e.message : 'This operation could not be completed.'); }
    finally { locked.current = false; if(alive.current) setBusy(''); }
  };
  const applyReport = (value: DetailedReportRecord, email=false) => {
    if (!alive.current || value.incident_id !== incidentId) throw new Error('The report does not belong to the selected incident.');
    setReport(value);
    setBody(email ? `Please review the attached FixProof investigation report.\n\nIncident: ${incidentId}\nReport: ${value.report_id}\n\n${value.sections.executive_summary}\n\nFindings are limited to sampled evidence and require human review. No legal conclusion is established.` : reportText(value));
    setSubject(`FixProof investigation report — ${incidentId.slice(0,8)}`); setReviewed(false);
  };
  const load = () => run('Loading saved report', async () => {
    const reports = await getDetailedReportsForIncident(incidentId);
    if (!reports.length) throw new Error('No saved report is available. Generate one in the Investigation report tab first.');
    const value = await getDetailedReport(reports[0].report_id);
    if(alive.current) {applyReport(value,kind==='email');setNotice('Saved report loaded. Review the preview before export or sending.');}
  });
  const prepare = () => run(kind==='report' || kind==='summary' ? 'Generating report and PDF' : 'Preparing evidence draft', async () => {
    if (kind==='email') { throw new Error('Load a saved report to prepare its email.'); }
    if (kind==='report' || kind==='summary') {
      const result = await generateDetailedReport({incident_id:incidentId}); // Deliberately omit recipient.
      if(alive.current) {applyReport(result.report);setNotice(result.report.ai_synthesized ? 'Report and PDF prepared using the configured reasoning provider. Review its interpretation.' : 'Report and PDF prepared by the deterministic fallback. Live model synthesis was unavailable; no AI success is claimed.');}
    } else {
      const result = await draftNemotronDocument({incident_id:incidentId,document_type:kind==='copyright'?'COPYRIGHT_NOTICE':'REVENUE_SHARE_OFFER',rights_holder:sender || undefined,contact_email:senderEmail || undefined,work_title:work || undefined,recipient_email:recipient || undefined,commercial_terms:terms || undefined,rev_share_pct:share.trim() ? Number(share) : undefined,use_ai_synthesis:false});
      if(alive.current) {setBody(result.body);setSubject(result.subject);setMissing(result.missing_fields);setNotice('Evidence-based template draft prepared. No model inference, sending or legal finding occurred.');setReviewed(false);}
    }
  });
  const download = () => run('Downloading saved PDF', async () => { if(!report) throw new Error('Load or generate a report first.'); const pdf=await downloadDetailedReportPdf(report.report_id); if(alive.current) saveMuseFile(pdf,`fixproof-${report.report_id}.pdf`); });
  const send = () => run('Submitting email to Resend', async () => {
    if(!reviewed || !report || !recipient.trim() || !body.trim() || !subject.trim()) throw new Error('Review the recipient, content and selected attachment before sending.');
    const result=await emailDetailedReport({incident_id:incidentId,report_id:report.report_id,recipient_email:recipient.trim(),subject,body,user_confirmed:true});
    if(!result.success) throw new Error(result.message);
    if(alive.current) {setNotice('Resend accepted the email request. Recipient delivery is not verified. Do not resend unless you intend another dispatch.');setReviewed(false);}
  });
  const edit = (setter: (v:string)=>void, value:string) => {setter(value);setReviewed(false);setNotice('');};
  return <section aria-label="Muse Document Studio" className="space-y-4 rounded-xl border border-[#d5d0c5] bg-[#faf8f5] p-4 text-black [color-scheme:light]">
    <header className="flex items-start justify-between gap-2"><div><h3 className="text-base font-semibold">Muse Document Studio</h3><p className="mt-1 break-all text-[11px] text-zinc-600">Selected incident · {incidentId}</p></div>{onClose && <button className={button} onClick={onClose} aria-label="Close Document Studio">Close</button>}</header>
    <label className="block text-xs">Document workflow<select aria-label="Document workflow" className={`${input} mt-1`} value={kind} disabled={!!busy} onChange={e=>{setKind(e.target.value as MuseWorkflow);setBody('');setSubject('');setError('');setNotice('');setReviewed(false);setMissing([]);}}>{choices.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    <p className="text-xs text-zinc-600">Prepare → review → export. Generation and sending are separate actions. Drafts and edits remain in this browser view.</p>
    {(kind==='copyright'||kind==='licensing') && <div className="grid gap-3 sm:grid-cols-2">{[['Rights holder / sender',sender,setSender],['Sender contact email',senderEmail,setSenderEmail],['Protected work title',work,setWork],['Recipient email (optional for draft)',recipient,setRecipient]] .map(([label,value,setter])=><label key={String(label)} className="text-xs">{String(label)}<input className={`${input} mt-1`} aria-label={String(label)} value={String(value)} disabled={!!busy} onChange={e=>edit(setter as (v:string)=>void,e.target.value)} /></label>)}{kind==='licensing' && <><label className="text-xs">Proposed rights-holder share (%)<input aria-label="Proposed rights-holder share" type="number" min="0" max="100" className={`${input} mt-1`} value={share} disabled={!!busy} onChange={e=>edit(setShare,e.target.value)} placeholder="Unconfirmed — left as placeholder" /></label><label className="text-xs">Proposed commercial terms<textarea className={`${input} mt-1`} aria-label="Proposed commercial terms" value={terms} disabled={!!busy} onChange={e=>edit(setTerms,e.target.value)} placeholder="No terms assumed" /></label></>}</div>}
    <div className="flex flex-wrap gap-2">{kind!=='email'&&<button className={button} disabled={!!busy} onClick={prepare}>{kind==='report'||kind==='summary'?'Generate report & PDF':'Prepare draft'}</button>}{(kind==='report'||kind==='summary'||kind==='email')&&<button className={button} disabled={!!busy} onClick={load}>Load latest saved report</button>}</div>
    {busy&&<p role="status" className="text-xs text-teal-800">{busy}…</p>}{error&&<p role="alert" className="break-words text-xs text-red-800">{error}</p>}{notice&&<p role="status" className="text-xs text-teal-800">{notice}</p>}{!!missing.length&&<p className="text-xs text-amber-900">Needs review: {missing.join(', ')}</p>}
    {body&&<div className="space-y-3 border-t border-[#d5d0c5] pt-4"><p className="text-xs font-semibold">{kind==='report'?'Report preview · measured evidence and AI interpretation labelled':'Editable draft preview'}</p>{kind==='email'&&<label className="block text-xs">Recipient email<input type="email" aria-label="Email recipient" className={`${input} mt-1`} value={recipient} disabled={!!busy} onChange={e=>edit(setRecipient,e.target.value)} placeholder="Enter the recipient; never inferred" /></label>}
      {kind!=='report'&&<label className="block text-xs">Subject<input aria-label="Document subject" maxLength={200} className={`${input} mt-1`} value={subject} disabled={!!busy} onChange={e=>edit(setSubject,e.target.value)} /></label>}
      {kind==='report'?<pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white p-3 text-xs leading-relaxed">{body}</pre>:<textarea aria-label="Document body" className={`${input} min-h-80 resize-y leading-relaxed`} value={body} maxLength={20000} disabled={!!busy} onChange={e=>edit(setBody,e.target.value)} />}
      {report&&(kind==='report'||kind==='summary'||kind==='email')&&<p className="break-all text-[11px] text-zinc-600">Saved attachment: fixproof-{report.report_id}.pdf · source model {report.model_id}. Edited text exports separately; the saved PDF remains the original report.</p>}
      <div className="flex flex-wrap gap-2"><button className={button} disabled={!!busy} onClick={()=>run('Copying preview',async()=>{await navigator.clipboard.writeText(body);if(alive.current)setNotice('Preview copied.');})}>Copy text</button><button className={button} disabled={!!busy} onClick={()=>saveMuseFile(body,`fixproof-${kind}-${incidentId.slice(0,8)}.txt`)}>Export text</button>{report&&(kind==='report'||kind==='summary'||kind==='email')&&<button className={button} disabled={!!busy} onClick={download}>Download saved PDF</button>}{kind==='email'&&<button className={button} disabled={!!busy} onClick={()=>saveMuseFile(`To: ${recipient.replace(/[\r\n]/g,'')}\r\nSubject: ${subject.replace(/[\r\n]/g,'')}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`,`fixproof-email-${incidentId.slice(0,8)}.eml`)}>Export email draft (text only)</button>}</div>
      {kind==='email'&&<div className="space-y-3 rounded-lg border border-[#d5d0c5] p-3"><p className="text-xs">{configured?'Resend configured; delivery has not been verified.':'Email sending is not configured. Copy or export the draft instead.'} Exported .eml contains text only; downloaded PDFs can be attached manually.</p><label className="flex items-start gap-2 text-xs"><input type="checkbox" aria-label="Confirm email review" checked={reviewed} disabled={!!busy} onChange={e=>setReviewed(e.target.checked)} />I reviewed the recipient, subject, full body and saved PDF attachment and explicitly want to send this email.</label><button className={button} disabled={!!busy||!configured||!reviewed||!report||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)||!subject.trim()||!body.trim()} onClick={send}>Send reviewed email with PDF</button></div>}
    </div>}
  </section>;
}
