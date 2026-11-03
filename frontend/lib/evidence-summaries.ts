import {API_BASE} from './api';
export type SummaryKind = 'sam'|'temporal';
export type EvidenceSummary = {summary_id:string;kind:SummaryKind;body:string;model_id:string;provider:string;created_at:string;limitation:string};
export async function evidenceSummary(incident:string,kind:SummaryKind,session:string,generate=false,signal?:AbortSignal):Promise<EvidenceSummary|null> {
  const response=await fetch(`${API_BASE}/api/incidents/${encodeURIComponent(incident)}/evidence-summaries/${kind}`,{
    method:generate?'POST':'GET',headers:{'X-Client-Session-ID':session},cache:'no-store',signal});
  const data=await response.json().catch(()=>null);
  if(!generate&&response.status===404)return null;
  if(!response.ok)throw new Error(typeof data?.detail==='string'?data.detail:'Evidence summary is unavailable.');
  return data;
}
export async function downloadEvidenceSummary(incident:string,kind:SummaryKind,session:string,summaryId?:string) {
  const response=await fetch(`${API_BASE}/api/incidents/${encodeURIComponent(incident)}/evidence-summaries/${kind}/pdf${summaryId?`?summary_id=${encodeURIComponent(summaryId)}`:''}`,{headers:{'X-Client-Session-ID':session},cache:'no-store'});
  if(!response.ok)throw new Error('Saved summary PDF is unavailable. Open the evidence workspace to regenerate it.');
  return response.blob();
}
