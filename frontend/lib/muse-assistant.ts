import { API_BASE, getClientSessionId } from "./api";

export type MuseCitation = { incident_id: string; evidence_id?: string | null; report_id?: string | null; timestamp_sec?: number | null };
export type MuseMessage = { message_id: string; role: "user" | "assistant"; text: string; metadata?: { status?: string | null; citations?: MuseCitation[]; provider?: string | null; model_id?: string | null } };
export type MuseConversation = { conversation_id: string; revision: number; selected_incident_id: string | null; messages: MuseMessage[] };
export type MuseReply = { conversation_id: string; revision: number; message_id: string; text: string; status: "completed" | "needs_clarification" | "failed"; citations: MuseCitation[]; provider: string | null; model_id: string | null; tool_results: { tool: string; status: string; data?: { incident_id?: string; incident?: { incident_id?: string } } | null; error_code?: string | null }[] };
export type MuseIncident = { incident_id: string; scanned_at: string | null; overall_status: string | null; suspect_filename?: string | null };

export class MuseApiError extends Error {
  constructor(message: string, public code = "REQUEST_FAILED") { super(message); }
}

async function request<T>(session: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: body === undefined ? "GET" : "POST", cache: "no-store", signal,
    headers: { "X-Client-Session-ID": session, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new MuseApiError(typeof data?.detail === "string" ? data.detail : `Muse request failed (${response.status}).`, data?.error || "REQUEST_FAILED");
  if (!data) throw new MuseApiError("Muse returned an unreadable response.");
  return data as T;
}

export async function listMuseIncidents(session: string, signal?: AbortSignal): Promise<MuseIncident[]> {
  const result = await request<{ status: string; data: { incidents: MuseIncident[] } | null; error?: { detail: string; code: string } }>(session, "/api/muse/incidents", undefined, signal);
  if (result.status !== "success" || !result.data) throw new MuseApiError(result.error?.detail || "Unable to load this session's incidents.", result.error?.code);
  return result.data.incidents;
}

export async function transcribeRecording(file: File, session: string, signal?: AbortSignal) {
  if (!file.name.toLowerCase().endsWith(".wav") || !file.size || file.size > 25 * 1024 * 1024)
    throw new MuseApiError("Choose a nonempty PCM WAV file no larger than 25 MiB.");
  const body = new FormData(); body.append("file", file);
  const response = await fetch(`${API_BASE}/api/voice/transcribe`, { method: "POST", body, signal, headers: { "X-Client-Session-ID": session } });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success !== true) throw new MuseApiError(typeof data?.detail === "string" ? data.detail : "Transcription failed.");
  if (typeof data.transcript !== "string" || typeof data.provider !== "string" || typeof data.model_id !== "string")
    throw new MuseApiError("The backend returned an invalid transcription response.");
  return data as { success: boolean; transcript: string; provider: string; model_id: string; language: string | null };
}

/** One existing session and conversation. ASR insertion is separate from explicit send. */
export class MuseConversationClient {
  conversation: MuseConversation | null = null;
  busy = false;
  needsRecovery = false;
  constructor(readonly session = getClientSessionId(), public selectedIncident: string | null = null) {}

  async recover() {
    if (!this.conversation) return;
    try {
      this.conversation = await request<MuseConversation>(this.session, `/api/muse/conversations/${this.conversation.conversation_id}`);
      this.selectedIncident = this.conversation.selected_incident_id;
      this.needsRecovery = false;
    } catch (error) {
      if (error instanceof MuseApiError && error.code === "CONVERSATION_NOT_FOUND") {
        this.conversation = null; this.needsRecovery = false;
      }
      throw error;
    }
  }

  async send(text: string, incidentOverride?: string | null) {
    if (this.busy) throw new MuseApiError("Muse is already processing a message.", "TURN_IN_PROGRESS");
    text = text.trim();
    if (!text || text.length > 8000) throw new MuseApiError("Enter a message of up to 8,000 characters.");
    if (incidentOverride !== undefined) {
      this.selectedIncident = incidentOverride;
    }
    this.busy = true;
    try {
      if (this.needsRecovery) await this.recover();
      if (!this.conversation) this.conversation = await request<MuseConversation>(this.session, "/api/muse/conversations", { selected_incident_id: this.selectedIncident || null });
      const before = this.conversation;
      const clientId = crypto.randomUUID();
      try {
        const reply = await request<MuseReply>(this.session, `/api/muse/conversations/${before.conversation_id}/messages`, {
          client_message_id: clientId,
          text,
          expected_revision: before.revision,
          selected_incident_id: this.selectedIncident || null,
        });
        if (typeof reply.text !== "string" || !Number.isInteger(reply.revision) || !Array.isArray(reply.citations)
            || !Array.isArray(reply.tool_results) || !["completed", "needs_clarification", "failed"].includes(reply.status))
          throw new MuseApiError("Muse returned an invalid message response.");
        const selected = [...reply.tool_results].reverse().find(r => r.status === "completed" && (r.data?.incident_id || r.data?.incident?.incident_id));
        this.selectedIncident = selected?.data?.incident_id || selected?.data?.incident?.incident_id || reply.citations[0]?.incident_id || this.selectedIncident;
        this.conversation = { ...before, revision: reply.revision, selected_incident_id: this.selectedIncident,
          messages: [...before.messages, { message_id: clientId, role: "user" as const, text },
            { message_id: reply.message_id, role: "assistant" as const, text: reply.text,
              metadata: { status: reply.status, citations: reply.citations, provider: reply.provider, model_id: reply.model_id } }].slice(-40) };
        return reply;
      } catch (error) {
        // Read history only. Never retry inference after a conflict, timeout, or uncertain send.
        this.needsRecovery = true;
        try { await this.recover(); } catch { /* caller can explicitly check history again */ }
        throw error;
      }
    } finally { this.busy = false; }
  }
}

export type MuseWorkflow = 'report' | 'copyright' | 'licensing' | 'summary' | 'email';
/** UI navigation only. This never grants the model new tools or executes an action. */
export function workflowForText(text: string): MuseWorkflow | null {
  if (!/\b(generate|prepare|draft|create|write|make|give me)\b/i.test(text)) return null;
  if (/\b(e-?mail)\b/i.test(text)) return 'email';
  if (/\b(copyright|takedown|notice)\b/i.test(text)) return 'copyright';
  if (/\b(licensing|licen[cs]e|revenue.shar|proposal)\b/i.test(text)) return 'licensing';
  if (/\b(professional|executive) summary\b/i.test(text)) return 'summary';
  if (/\b(report|pdf)\b/i.test(text)) return 'report';
  return null;
}
