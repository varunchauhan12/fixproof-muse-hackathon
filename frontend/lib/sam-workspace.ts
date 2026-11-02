import { API_BASE } from './api';
export type SAMTarget = 'reference' | 'suspect';
export interface SAMFrame { asset_id: string; frame_id: number | null; filename: string; timestamp_sec: number; }
export interface SAMCandidate {
  candidate_id: string; incident_id: string; frame_match_index: number; rank: number;
  evidence_id: string | null; confirmed: boolean; status: string; l2_distance: number;
  visual_similarity_score: number | null; reference: SAMFrame; suspect: SAMFrame;
}
export interface SAMObject {
  object_id: number; label: string; normalized_box: number[];
  box: { x1: number; y1: number; x2: number; y2: number; w: number; h: number; normalized_coords?: number[] };
  mask?: { encoding?: string; raw_payload?: string; decoding_status?: string; is_decoded?: boolean; width?: number; height?: number } | null;
}
export interface SAMObservation {
  association: SAMFrame & { candidate_id: string; incident_id: string; frame_match_index: number; target: SAMTarget };
  status: string; objects: SAMObject[]; model_id?: string; provider?: string; prompt?: string;
  original_dimensions?: {width: number; height: number}; prepared_dimensions?: {width: number; height: number};
  image_sha256?: string; discovery_model?: string; concept_results?: {label:string;status:string;error?:string}[]; error?: string; reused?: boolean; latency_ms?: number; mask_decoding?: string;
}
export interface SAMInvestigation { candidate: SAMCandidate; targets: Record<SAMTarget, SAMObservation>; }

/** Only explicit coordinate conventions; never infer pixel-vs-normalized from magnitude. */
export function validatedBox(value: unknown): number[] | null {
  if (!value || typeof value !== 'object') return null;
  const b = value as Record<string, unknown>;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const xy = [b.x1,b.y1,b.x2,b.y2];
  let result: number[];
  if (xy.every(finite) && finite(b.w) && finite(b.h) && b.w > 0 && b.h > 0) {
    result = [xy[0]/b.w,xy[1]/b.h,xy[2]/b.w,xy[3]/b.h];
    const declared = b.normalized_coords;
    if (Array.isArray(declared) && declared.length && (declared.length !== 4 || !declared.every(finite) || declared.some((v,i)=>Math.abs(v-result[i])>.001))) return null;
  } else if (Array.isArray(b.normalized_coords) && b.normalized_coords.length === 4 && b.normalized_coords.every(finite) && xy.every(v=>v===undefined)) {
    result = b.normalized_coords;
  } else return null;
  const [x1,y1,x2,y2] = result;
  return result.every(v=>Number.isFinite(v)&&v>=0&&v<=1) && x2>x1 && y2>y1 ? result : null;
}
export function maskState(mask: SAMObject['mask']): string {
  return mask ? `${mask.encoding || 'Unknown encoding'} · ${mask.decoding_status || 'RAW_PRESERVED'} · rendering unavailable` : 'No mask returned';
}
export function observationMatches(candidate: SAMCandidate, target: SAMTarget, observation: SAMObservation): boolean {
  const a=observation?.association, f=candidate[target];
  return !!a && a.candidate_id===candidate.candidate_id && a.incident_id===candidate.incident_id && a.frame_match_index===candidate.frame_match_index && a.target===target && a.asset_id===f.asset_id && a.filename===f.filename && a.frame_id===f.frame_id && a.timestamp_sec===f.timestamp_sec;
}
export class SAMWorkspaceClient {
  private pending = new Map<string, Promise<SAMInvestigation>>();
  constructor(readonly session: string) {}
  private async request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${API_BASE}/api/sam/incidents/${path}`, {...init, cache:'no-store', headers:{'X-Client-Session-ID':this.session,...(init.body ? {'Content-Type':'application/json'} : {})}});
    if (!response.ok) {
      const safe: Record<number,string> = {400:'A valid session and prompt are required.',403:'This incident is unavailable in your session.',404:'Candidate or frame unavailable. Refresh the incident.',409:'This investigation is already in progress. Wait before retrying.',422:'The selected input or frame could not be validated.'};
      if(response.status===502) {
        const data=await response.json().catch(()=>({}));
        const category=(response.headers.get('X-SAM-Failure-Code') || (typeof data.detail==='string' ? data.detail.match(/\((AUTHENTICATION_ERROR|API_TIMEOUT|RATE_LIMIT_EXCEEDED|CONNECTION_ERROR|PROVIDER_API_ERROR|CLIENT_INITIALIZATION_ERROR|TOKEN_BUDGET_EXHAUSTED|EMPTY_CONTENT|EMPTY_CHOICES|INVALID_SCENE_RESPONSE|INVALID_SCENE_LABEL)\)/)?.[1] : undefined))?.match(/^(AUTHENTICATION_ERROR|API_TIMEOUT|RATE_LIMIT_EXCEEDED|CONNECTION_ERROR|PROVIDER_API_ERROR|CLIENT_INITIALIZATION_ERROR|TOKEN_BUDGET_EXHAUSTED|EMPTY_CONTENT|EMPTY_CHOICES|INVALID_SCENE_RESPONSE|INVALID_SCENE_LABEL)$/)?.[1];
        throw new Error(`Automatic object discovery unavailable${category ? ` (${category})` : ''}. Retry explicitly.`);
      }
      throw new Error(safe[response.status] || `SAM request failed (${response.status}). Retry explicitly.`);
    }
    return response;
  }
  async queue(incident: string, signal?: AbortSignal): Promise<SAMCandidate[]> {
    const response=await this.request(`${encodeURIComponent(incident)}/candidates`,{signal});
    const data=await response.json();
    if (!Array.isArray(data.candidates)) throw new Error('Invalid SAM candidate response.');
    return data.candidates;
  }
  async frame(candidate: SAMCandidate, target: SAMTarget, signal?: AbortSignal): Promise<Blob> {
    const response=await this.request(`${encodeURIComponent(candidate.incident_id)}/candidates/${encodeURIComponent(candidate.candidate_id)}/frames/${target}`,{signal});
    return response.blob();
  }
  automatic(candidate: SAMCandidate, retry=false): Promise<SAMInvestigation> {
    const key=`auto:${candidate.incident_id}:${candidate.candidate_id}`;
    const existing=this.pending.get(key); if(existing)return existing;
    const request=this.request(`${encodeURIComponent(candidate.incident_id)}/candidates/${encodeURIComponent(candidate.candidate_id)}/automatic`,{method:'POST',body:JSON.stringify({retry})}).then(async response=>{
      const data=await response.json() as SAMInvestigation;
      if(data.candidate?.candidate_id!==candidate.candidate_id || !(['reference','suspect'] as const).every(target=>observationMatches(candidate,target,data.targets?.[target])))throw new Error('SAM response frame association failed validation.');
      return data;
    }).finally(()=>this.pending.delete(key));
    this.pending.set(key,request);return request;
  }
  investigate(candidate: SAMCandidate, prompt: string): Promise<SAMInvestigation> {
    const clean=prompt.trim();
    if (!clean || clean.length>200) return Promise.reject(new Error('Enter a concept prompt of 1–200 characters.'));
    const key=`${candidate.incident_id}:${candidate.candidate_id}:${clean}`;
    const existing=this.pending.get(key); if(existing) return existing;
    const request=this.request(`${encodeURIComponent(candidate.incident_id)}/candidates/${encodeURIComponent(candidate.candidate_id)}`, {method:'POST',body:JSON.stringify({prompt:clean})}).then(async response=>{
      const data=await response.json() as SAMInvestigation;
      if(data.candidate?.candidate_id!==candidate.candidate_id || !(['reference','suspect'] as const).every(t=>observationMatches(candidate,t,data.targets?.[t]))) throw new Error('SAM response frame association failed validation.');
      return data;
    }).finally(()=>this.pending.delete(key));
    this.pending.set(key,request);return request;
  }
}


export interface SAMBatchCallbacks {
  signal: AbortSignal;
  shouldStart: (candidate: SAMCandidate) => boolean;
  onStart: (candidate: SAMCandidate) => void;
  onResult: (candidate: SAMCandidate, result: SAMInvestigation) => void;
  onError: (candidate: SAMCandidate, error: unknown) => void;
  onFinish: (candidate: SAMCandidate) => void;
}
/** Two workers prepare the whole queue; browsing selection is independent. */
export async function processSAMQueue(client: SAMWorkspaceClient, queue: SAMCandidate[], callbacks: SAMBatchCallbacks): Promise<void> {
  let cursor=0;
  async function worker() {
    while(!callbacks.signal.aborted) {
      const candidate=queue[cursor++];
      if(!candidate)return;
      if(!callbacks.shouldStart(candidate))continue;
      callbacks.onStart(candidate);
      try { callbacks.onResult(candidate,await client.automatic(candidate)); }
      catch(error){ callbacks.onError(candidate,error); }
      finally{callbacks.onFinish(candidate);}
    }
  }
  await Promise.all([worker(),worker()]);
}
