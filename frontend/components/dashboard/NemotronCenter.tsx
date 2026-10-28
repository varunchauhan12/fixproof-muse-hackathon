"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Cpu,
  Shield,
  AlertTriangle,
  CheckCircle,
  FileText,
  Send,
  Copy,
  Download,
  RefreshCw,
  Mail,
  Scale,
  DollarSign,
  Clock,
  User,
  ChevronRight,
  X,
  ExternalLink,
  Check,
  Info,
  Sparkles,
  History,
  FileCheck,
} from "lucide-react";
import {
  MatchAnalysisResult,
  AssetRecord,
  NemotronStatus,
  DraftDocumentPayload,
  DraftDocumentResult,
  SendEmailResult,
  EmailAuditEntry,
  InvestigationReport,
  ReportHistoryItem,
} from "@/lib/types";
import {
  getNemotronStatus,
  draftNemotronDocument,
  sendNemotronEmail,
  getEmailAuditLog,
  getIncidentLatestReport,
  getIncidentReportHistory,
  getReportById,
  investigateIncident,
} from "@/lib/api";

interface NemotronCenterProps {
  incidents: MatchAnalysisResult[];
  assets: AssetRecord[];
  preselectedIncident?: MatchAnalysisResult | null;
  preselectedDocType?: "COPYRIGHT_NOTICE" | "REVENUE_SHARE_OFFER" | null;
  onNavigateToIncidents?: (incident: MatchAnalysisResult) => void;
}

export const NemotronCenter: React.FC<NemotronCenterProps> = ({
  incidents,
  assets,
  preselectedIncident,
  preselectedDocType,
  onNavigateToIncidents,
}) => {
  // Model & Service Status
  const [nemotronStatus, setNemotronStatus] = useState<NemotronStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  // Selected Incident
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>(
    preselectedIncident?.incident_id ||
      (incidents.length > 0 && incidents[0].incident_id ? incidents[0].incident_id : "")
  );
  const [incidentSearchQuery, setIncidentSearchQuery] = useState("");
  const [incidentStatusFilter, setIncidentStatusFilter] = useState<string>("ALL");

  // Investigation Workspace State
  const [latestReport, setLatestReport] = useState<InvestigationReport | null>(null);
  const [reportHistory, setReportHistory] = useState<ReportHistoryItem[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [refreshingInvestigation, setRefreshingInvestigation] = useState(false);
  const [investigationError, setInvestigationError] = useState<string | null>(null);

  // Document Drafting State
  const [activeDocType, setActiveDocType] = useState<"COPYRIGHT_NOTICE" | "REVENUE_SHARE_OFFER">(
    preselectedDocType || "COPYRIGHT_NOTICE"
  );
  const [rightsHolderName, setRightsHolderName] = useState("");
  const [authorizedRep, setAuthorizedRep] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [workTitle, setWorkTitle] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [jurisdiction, setJurisdiction] = useState("US_DMCA");
  const [revSharePct, setRevSharePct] = useState<number>(50);
  const [commercialTerms, setCommercialTerms] = useState("");
  const [responseDeadlineDays, setResponseDeadlineDays] = useState<number>(14);
  const [customNotes, setCustomNotes] = useState("");
  const [useAiSynthesis, setUseAiSynthesis] = useState(true);

  // Draft Output State
  const [currentDraft, setCurrentDraft] = useState<DraftDocumentResult | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  // Per-incident draft storage to avoid state leaking or evidence mixing across incidents
  const [draftsByIncident, setDraftsByIncident] = useState<
    Record<
      string,
      {
        draft: DraftDocumentResult;
        editedSubject: string;
        editedBody: string;
        docType: "COPYRIGHT_NOTICE" | "REVENUE_SHARE_OFFER";
      }
    >
  >({});
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  const [saveSuccessToast, setSaveSuccessToast] = useState(false);

  // Historical Report State
  const [viewingHistorySnapshot, setViewingHistorySnapshot] = useState<string | null>(null);
  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false);

  // Editor State
  const [editedSubject, setEditedSubject] = useState("");
  const [editedBody, setEditedBody] = useState("");
  const [copySuccess, setCopySuccess] = useState(false);

  // Email Modal State
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [modalRecipientEmail, setModalRecipientEmail] = useState("");
  const [modalCcEmail, setModalCcEmail] = useState("");
  const [modalSubject, setModalSubject] = useState("");
  const [modalBody, setModalBody] = useState("");
  const [confirmHumanReview, setConfirmHumanReview] = useState(false);
  const [confirmRightsDeclaration, setConfirmRightsDeclaration] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [sendResult, setSendResult] = useState<SendEmailResult | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  // Audit Log State
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditLogs, setAuditLogs] = useState<EmailAuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Update selection if preselected props change
  useEffect(() => {
    if (preselectedIncident?.incident_id) {
      setSelectedIncidentId(preselectedIncident.incident_id);
    }
  }, [preselectedIncident]);

  useEffect(() => {
    if (preselectedDocType) {
      setActiveDocType(preselectedDocType);
    }
  }, [preselectedDocType]);

  // Load Nemotron status
  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const st = await getNemotronStatus();
      setNemotronStatus(st);
    } catch {
      // Degraded or backend offline
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Find currently selected incident record
  const selectedIncident = useMemo(() => {
    return incidents.find((i) => i.incident_id === selectedIncidentId) || incidents[0] || null;
  }, [incidents, selectedIncidentId]);

  // Auto-fill work title from matched asset if available
  useEffect(() => {
    if (selectedIncident && !workTitle) {
      if (selectedIncident.matched_assets && selectedIncident.matched_assets.length > 0) {
        const firstMatchId = selectedIncident.matched_assets[0];
        const assetRec = assets.find((a) => a.asset_id === firstMatchId);
        if (assetRec) {
          setWorkTitle(assetRec.filename.replace(/\.[^/.]+$/, ""));
        } else {
          setWorkTitle(`Official Reference Work (${firstMatchId.slice(0, 8)})`);
        }
      }
    }
  }, [selectedIncident, assets, workTitle]);

  // Load report and report history for selected incident
  const loadIncidentReports = useCallback(async (incId: string) => {
    if (!incId) return;
    setReportLoading(true);
    setInvestigationError(null);
    try {
      const [rep, hist] = await Promise.all([
        getIncidentLatestReport(incId).catch(() => null),
        getIncidentReportHistory(incId).catch(() => []),
      ]);
      setLatestReport(rep);
      setReportHistory(hist);
    } catch (err: any) {
      setInvestigationError(err.message || "Failed to load report");
    } finally {
      setReportLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedIncident?.incident_id) {
      loadIncidentReports(selectedIncident.incident_id);
    }
  }, [selectedIncident?.incident_id, loadIncidentReports]);

  // Refresh Nemotron Report
  const handleRefreshReport = async () => {
    if (!selectedIncident?.incident_id) return;
    setRefreshingInvestigation(true);
    setInvestigationError(null);
    try {
      const freshReport = await investigateIncident(selectedIncident.incident_id, {
        force_refresh: true,
      });
      setLatestReport(freshReport);
      const hist = await getIncidentReportHistory(selectedIncident.incident_id).catch(() => []);
      setReportHistory(hist);
    } catch (err: any) {
      setInvestigationError(err.message || "Investigation refresh failed");
    } finally {
      setRefreshingInvestigation(false);
    }
  };

  // Filtered incidents list for selector
  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      const matchesSearch =
        !incidentSearchQuery.trim() ||
        (inc.suspect_filename || "").toLowerCase().includes(incidentSearchQuery.toLowerCase()) ||
        (inc.incident_id || "").toLowerCase().includes(incidentSearchQuery.toLowerCase());

      const matchesStatus =
        incidentStatusFilter === "ALL" ||
        (incidentStatusFilter === "MATCHES" && (inc.candidate_matches_found || 0) > 0) ||
        (incidentStatusFilter === "CLEAN" && (inc.candidate_matches_found || 0) === 0) ||
        inc.overall_status === incidentStatusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [incidents, incidentSearchQuery, incidentStatusFilter]);

  // Safely switch between incidents with draft context isolation
  const handleSelectIncident = (incId: string) => {
    if (incId === selectedIncidentId) return;

    // Cache current draft edits if present
    if (selectedIncidentId && currentDraft) {
      setDraftsByIncident((prev) => ({
        ...prev,
        [selectedIncidentId]: {
          draft: currentDraft,
          editedSubject,
          editedBody,
          docType: activeDocType,
        },
      }));
    }

    setSelectedIncidentId(incId);
    setShowRegenConfirm(false);
    setDraftError(null);
    setInvestigationError(null);
    setViewingHistorySnapshot(null);
    setShowHistoryDropdown(false);

    // Restore cached draft if available, or reset clean
    const existing = draftsByIncident[incId];
    if (existing) {
      setCurrentDraft(existing.draft);
      setEditedSubject(existing.editedSubject);
      setEditedBody(existing.editedBody);
      setActiveDocType(existing.docType);
    } else {
      setCurrentDraft(null);
      setEditedSubject("");
      setEditedBody("");
    }

    // Refresh work title for newly selected incident
    const newInc = incidents.find((i) => i.incident_id === incId);
    if (newInc && newInc.matched_assets && newInc.matched_assets.length > 0) {
      const firstMatchId = newInc.matched_assets[0];
      const assetRec = assets.find((a) => a.asset_id === firstMatchId);
      setWorkTitle(assetRec ? assetRec.filename.replace(/\.[^/.]+$/, "") : `Official Reference (${firstMatchId.slice(0, 8)})`);
    } else {
      setWorkTitle("");
    }
  };

  // Select historical report snapshot
  const handleSelectReportVersion = async (item: ReportHistoryItem) => {
    setShowHistoryDropdown(false);
    setReportLoading(true);
    setInvestigationError(null);
    try {
      const rep = await getReportById(item.report_id);
      setLatestReport(rep);
      setViewingHistorySnapshot(item.report_id);
    } catch (err: any) {
      setInvestigationError(err.message || "Failed to load prior report version");
    } finally {
      setReportLoading(false);
    }
  };

  // Revert back to latest report
  const handleReturnToLatestReport = () => {
    setViewingHistorySnapshot(null);
    if (selectedIncident?.incident_id) {
      loadIncidentReports(selectedIncident.incident_id);
    }
  };

  // Save manual draft edits into session
  const handleSaveDraftEdits = () => {
    if (!currentDraft || !selectedIncident?.incident_id) return;
    const updated: DraftDocumentResult = {
      ...currentDraft,
      subject: editedSubject,
      body: editedBody,
    };
    setCurrentDraft(updated);
    setDraftsByIncident((prev) => ({
      ...prev,
      [String(selectedIncident.incident_id)]: {
        draft: updated,
        editedSubject,
        editedBody,
        docType: activeDocType,
      },
    }));
    setSaveSuccessToast(true);
    setTimeout(() => setSaveSuccessToast(false), 2200);
  };

  // Handle Generate Draft with Overwrite Protection
  const handleGenerateDraft = async (force: boolean = false) => {
    if (!selectedIncident?.incident_id) return;
    if (currentDraft && !force) {
      setShowRegenConfirm(true);
      return;
    }
    setShowRegenConfirm(false);
    setDrafting(true);
    setDraftError(null);
    try {
      const payload: DraftDocumentPayload = {
        incident_id: selectedIncident.incident_id,
        document_type: activeDocType,
        rights_holder: rightsHolderName,
        authorized_rep: authorizedRep,
        contact_email: contactEmail,
        work_title: workTitle,
        recipient_name: recipientName,
        recipient_email: recipientEmail,
        jurisdiction: jurisdiction,
        custom_notes: customNotes,
        rev_share_pct: revSharePct,
        commercial_terms: commercialTerms,
        response_deadline_days: responseDeadlineDays,
        use_ai_synthesis: useAiSynthesis,
      };

      const result = await draftNemotronDocument(payload);
      setCurrentDraft(result);
      setEditedSubject(result.subject);
      setEditedBody(result.body);
      setDraftsByIncident((prev) => ({
        ...prev,
        [String(selectedIncident.incident_id)]: {
          draft: result,
          editedSubject: result.subject,
          editedBody: result.body,
          docType: activeDocType,
        },
      }));
    } catch (err: any) {
      setDraftError(err.message || "Failed to generate draft");
    } finally {
      setDrafting(false);
    }
  };

  // Copy to clipboard
  const handleCopyDraft = () => {
    if (!editedBody) return;
    const fullText = `Subject: ${editedSubject}\n\n${editedBody}`;
    navigator.clipboard.writeText(fullText);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2200);
  };

  // Download draft as .txt
  const handleDownloadDraft = () => {
    if (!editedBody) return;
    const fullText = `Subject: ${editedSubject}\n\n${editedBody}`;
    const blob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const incidentSuffix = selectedIncident?.incident_id
      ? selectedIncident.incident_id.slice(0, 8)
      : "draft";
    a.download = `${activeDocType.toLowerCase()}_${incidentSuffix}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Open Email Modal
  const handleOpenEmailModal = () => {
    if (!currentDraft) return;
    setModalRecipientEmail(recipientEmail || "");
    setModalCcEmail("");
    setModalSubject(editedSubject);
    setModalBody(editedBody);
    setConfirmHumanReview(false);
    setConfirmRightsDeclaration(false);
    setSendResult(null);
    setSendError(null);
    setShowEmailModal(true);
  };

  // Send Email
  const handleSendEmail = async () => {
    if (!selectedIncident?.incident_id) return;
    setSendingEmail(true);
    setSendError(null);
    setSendResult(null);
    try {
      const ccList = modalCcEmail
        ? modalCcEmail.split(",").map((c) => c.trim()).filter(Boolean)
        : undefined;

      const res = await sendNemotronEmail({
        incident_id: selectedIncident.incident_id,
        document_type: activeDocType,
        recipient_email: modalRecipientEmail,
        subject: modalSubject,
        body: modalBody,
        cc_emails: ccList,
        user_confirmed: confirmHumanReview,
        rights_declaration_confirmed: confirmRightsDeclaration,
      });

      setSendResult(res);
    } catch (err: any) {
      setSendError(err.message || "Email dispatch failed");
    } finally {
      setSendingEmail(false);
    }
  };

  // Open Audit Log
  const handleOpenAuditModal = async () => {
    setShowAuditModal(true);
    setAuditLoading(true);
    try {
      const logs = await getEmailAuditLog(selectedIncident?.incident_id);
      setAuditLogs(logs);
    } catch {
      setAuditLogs([]);
    } finally {
      setAuditLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 text-[#ded7cb]">
      {/* ─── SECTION A: Nemotron Capability Overview ─── */}
      <div
        style={{
          background: "#171615",
          borderRadius: 16,
          border: "1px solid rgba(238, 231, 219, 0.08)",
        }}
        className="p-5"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[rgba(238,231,219,0.08)]">
          <div className="flex items-center gap-3">
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "rgba(13, 148, 136, 0.12)",
                color: "#14b8a6",
                border: "1px solid rgba(20, 184, 166, 0.3)",
              }}
              className="flex items-center justify-center shrink-0"
            >
              <Cpu size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[17px] font-extrabold text-[#f4efe6] m-0">
                  Nemotron Intelligence & Action Center
                </h1>
                <span
                  style={{
                    background:
                      nemotronStatus?.status === "ready"
                        ? "rgba(34, 197, 94, 0.12)"
                        : "rgba(234, 179, 8, 0.12)",
                    color: nemotronStatus?.status === "ready" ? "#4ade80" : "#facc15",
                    border: `1px solid ${
                      nemotronStatus?.status === "ready"
                        ? "rgba(34, 197, 94, 0.25)"
                        : "rgba(234, 179, 8, 0.25)"
                    }`,
                  }}
                  className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
                >
                  {nemotronStatus?.status === "ready" ? "Service Online" : "Degraded / Unconfigured"}
                </span>
              </div>
              <p className="text-[12px] text-[#8e887d] m-0 mt-0.5">
                Consolidated forensic reasoning, vision verification, and evidence-grounded action preparation.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenAuditModal}
              style={{
                background: "#1c1b1a",
                border: "1px solid rgba(238, 231, 219, 0.1)",
                color: "#ded7cb",
              }}
              className="px-3 py-1.5 rounded-lg hover:bg-[#262422] text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <History size={13} className="text-[#8e887d]" />
              <span>Email Audit Log</span>
            </button>
            <button
              onClick={loadStatus}
              disabled={statusLoading}
              style={{
                background: "#1c1b1a",
                border: "1px solid rgba(238, 231, 219, 0.1)",
                color: "#ded7cb",
              }}
              className="p-1.5 rounded-lg hover:bg-[#262422] text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh Service Status"
            >
              <RefreshCw size={14} className={statusLoading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Capability Indicators Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4 text-[12px]">
          <div
            style={{
              background: "#141312",
              border: "1px solid rgba(238, 231, 219, 0.06)",
              borderRadius: 10,
            }}
            className="p-3"
          >
            <div className="text-[10px] uppercase font-bold text-[#8e887d] tracking-wider mb-1 flex items-center justify-between">
              <span>Text Reasoning</span>
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  nemotronStatus?.text_reasoning_available ? "bg-emerald-400" : "bg-amber-400"
                }`}
              />
            </div>
            <div className="font-mono text-[11px] text-[#f4efe6] truncate">
              {nemotronStatus?.configured_model || "nvidia/Nemotron-3_5-Lightning"}
            </div>
            <div className="text-[10px] text-[#736d62] mt-0.5">Nebius Token Factory</div>
          </div>

          <div
            style={{
              background: "#141312",
              border: "1px solid rgba(238, 231, 219, 0.06)",
              borderRadius: 10,
            }}
            className="p-3"
          >
            <div className="text-[10px] uppercase font-bold text-[#8e887d] tracking-wider mb-1 flex items-center justify-between">
              <span>Vision Verifier</span>
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  nemotronStatus?.vision_verification_available ? "bg-emerald-400" : "bg-amber-400"
                }`}
              />
            </div>
            <div className="font-mono text-[11px] text-[#f4efe6] truncate">
              {nemotronStatus?.vision_model || "nvidia/Nemotron-3.5-Super-VL"}
            </div>
            <div className="text-[10px] text-[#736d62] mt-0.5">Frame Correspondence</div>
          </div>

          <div
            style={{
              background: "#141312",
              border: "1px solid rgba(238, 231, 219, 0.06)",
              borderRadius: 10,
            }}
            className="p-3"
          >
            <div className="text-[10px] uppercase font-bold text-[#8e887d] tracking-wider mb-1 flex items-center justify-between">
              <span>Email Service</span>
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  nemotronStatus?.email_delivery_available ? "bg-emerald-400" : "bg-zinc-500"
                }`}
              />
            </div>
            <div className="text-[11px] text-[#f4efe6] font-medium">
              {nemotronStatus?.email_delivery_available ? "Resend API Active" : "Resend (Unconfigured)"}
            </div>
            <div className="text-[10px] text-[#736d62] mt-0.5 truncate">
              {nemotronStatus?.email_from || "RESEND_API_KEY required in .env"}
            </div>
          </div>

          <div
            style={{
              background: "#141312",
              border: "1px solid rgba(238, 231, 219, 0.06)",
              borderRadius: 10,
            }}
            className="p-3"
          >
            <div className="text-[10px] uppercase font-bold text-[#8e887d] tracking-wider mb-1">
              Supported Workflows
            </div>
            <div className="text-[11px] text-[#f4efe6] font-medium">
              DMCA Notice • Rev-Share
            </div>
            <div className="text-[10px] text-[#736d62] mt-0.5">Human Review Enforced</div>
          </div>
        </div>
      </div>

      {/* ─── MAIN TWO-COLUMN WORKSPACE: Selector + Workspace ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ─── SECTION B: Investigation Selector (4 Cols) ─── */}
        <div
          style={{
            background: "#171615",
            borderRadius: 16,
            border: "1px solid rgba(238, 231, 219, 0.08)",
          }}
          className="lg:col-span-4 p-4 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-[#f4efe6] m-0 flex items-center gap-2">
              <Shield size={16} className="text-[#14b8a6]" />
              <span>Investigated Incidents</span>
            </h2>
            <span className="text-[11px] text-[#8e887d] font-mono">
              {filteredIncidents.length} record(s)
            </span>
          </div>

          {/* Search and Filter */}
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Search filename or ID..."
              value={incidentSearchQuery}
              onChange={(e) => setIncidentSearchQuery(e.target.value)}
              style={{
                background: "#141312",
                border: "1px solid rgba(238, 231, 219, 0.1)",
                color: "#f4efe6",
              }}
              className="w-full px-3 py-1.5 rounded-lg text-[12px] placeholder-[#5a554c] outline-none focus:border-[#14b8a6]"
            />
            <div className="flex items-center gap-1.5 text-[10px]">
              {(["ALL", "MATCHES", "CLEAN"] as const).map((filterVal) => (
                <button
                  key={filterVal}
                  onClick={() => setIncidentStatusFilter(filterVal)}
                  style={{
                    background: incidentStatusFilter === filterVal ? "#262422" : "#141312",
                    color: incidentStatusFilter === filterVal ? "#f4efe6" : "#8e887d",
                    border: "1px solid rgba(238, 231, 219, 0.06)",
                  }}
                  className="px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer"
                >
                  {filterVal}
                </button>
              ))}
            </div>
          </div>

          {/* Incidents List */}
          <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {filteredIncidents.length === 0 ? (
              <div className="text-center py-10 text-[12px] text-[#736d62]">
                No matching incidents found.
              </div>
            ) : (
              filteredIncidents.map((inc, incIdx) => {
                const incId = inc.incident_id || `inc-${incIdx}`;
                const isSelected = incId === selectedIncident?.incident_id;
                const hasMatches = (inc.candidate_matches_found || 0) > 0;

                return (
                  <div
                    key={incId}
                    onClick={() => handleSelectIncident(incId)}
                    style={{
                      background: isSelected ? "#22201e" : "#141312",
                      border: isSelected
                        ? "1px solid #14b8a6"
                        : "1px solid rgba(238, 231, 219, 0.06)",
                      borderRadius: 10,
                    }}
                    className="p-3 cursor-pointer transition-all hover:border-[rgba(20,184,166,0.5)] text-left"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[12px] font-bold text-[#f4efe6] truncate">
                          {inc.suspect_filename || `Suspect ${incId.slice(0, 8)}`}
                        </div>
                        <div className="text-[10px] text-[#8e887d] font-mono mt-0.5">
                          ID: {incId.slice(0, 8)} •{" "}
                          {new Date(inc.scanned_at || Date.now()).toLocaleDateString()}
                        </div>
                      </div>
                      <span
                        style={{
                          background: hasMatches
                            ? "rgba(239, 68, 68, 0.12)"
                            : "rgba(34, 197, 94, 0.12)",
                          color: hasMatches ? "#f87171" : "#4ade80",
                          border: `1px solid ${
                            hasMatches ? "rgba(239, 68, 68, 0.25)" : "rgba(34, 197, 94, 0.25)"
                          }`,
                        }}
                        className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider shrink-0"
                      >
                        {hasMatches ? "Candidate Match" : "Clean"}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 mt-2 text-[10px] text-[#8e887d] border-t border-[rgba(238,231,219,0.04)] pt-1.5">
                      <span>Matches: {inc.candidate_matches_found || 0}</span>
                      <span>Peak Conf: {inc.highest_confidence || 0}%</span>
                      {inc.lowest_l2_distance !== null && inc.lowest_l2_distance !== undefined && (
                        <span>L2: {Number(inc.lowest_l2_distance).toFixed(3)}</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ─── SECTION C & D: Workspace & Action Area (8 Cols) ─── */}
        <div className="lg:col-span-8 space-y-6">
          {selectedIncident ? (
            <>
              {/* Incident Header & Evidence Telemetry */}
              <div
                style={{
                  background: "#171615",
                  borderRadius: 16,
                  border: "1px solid rgba(238, 231, 219, 0.08)",
                }}
                className="p-5 space-y-4"
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-[rgba(238,231,219,0.08)]">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase font-bold text-[#14b8a6] tracking-wider">
                        Active Target Record
                      </span>
                      <span className="text-[#5a554c]">•</span>
                      <span className="text-[11px] text-[#8e887d] font-mono">
                        {selectedIncident.incident_id}
                      </span>
                    </div>
                    <h3 className="text-[16px] font-bold text-[#f4efe6] m-0 mt-0.5">
                      {selectedIncident.suspect_filename || "Uploaded Media File"}
                    </h3>
                  </div>

                  <div className="flex items-center gap-2">
                    {onNavigateToIncidents && (
                      <button
                        onClick={() => onNavigateToIncidents(selectedIncident)}
                        style={{
                          background: "#1c1b1a",
                          border: "1px solid rgba(238, 231, 219, 0.1)",
                          color: "#ded7cb",
                        }}
                        className="px-2.5 py-1.5 rounded-lg hover:bg-[#262422] text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <span>Full Incident Inspection</span>
                        <ExternalLink size={12} />
                      </button>
                    )}
                    <button
                      onClick={handleRefreshReport}
                      disabled={refreshingInvestigation}
                      style={{
                        background: "#1c1b1a",
                        border: "1px solid rgba(238, 231, 219, 0.1)",
                        color: "#ded7cb",
                      }}
                      className="px-2.5 py-1.5 rounded-lg hover:bg-[#262422] text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw
                        size={12}
                        className={refreshingInvestigation ? "animate-spin" : ""}
                      />
                      <span>Refresh Report</span>
                    </button>

                    {reportHistory.length > 0 && (
                      <div className="relative">
                        <button
                          onClick={() => setShowHistoryDropdown((prev) => !prev)}
                          style={{
                            background: viewingHistorySnapshot ? "rgba(20, 184, 166, 0.15)" : "#1c1b1a",
                            border: viewingHistorySnapshot
                              ? "1px solid rgba(20, 184, 166, 0.4)"
                              : "1px solid rgba(238, 231, 219, 0.1)",
                            color: viewingHistorySnapshot ? "#5eead4" : "#ded7cb",
                          }}
                          className="px-2.5 py-1.5 rounded-lg hover:bg-[#262422] text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <History size={12} />
                          <span>History ({reportHistory.length})</span>
                        </button>

                        {showHistoryDropdown && (
                          <div
                            style={{
                              background: "#171615",
                              border: "1px solid rgba(238, 231, 219, 0.15)",
                              borderRadius: 10,
                            }}
                            className="absolute right-0 mt-1 w-64 p-2 shadow-2xl z-20 space-y-1 text-[11px]"
                          >
                            <div className="text-[10px] font-bold text-[#8e887d] px-2 py-1 uppercase tracking-wider">
                              Report History Snapshots
                            </div>
                            {reportHistory.map((item, idx) => (
                              <button
                                key={item.report_id}
                                onClick={() => handleSelectReportVersion(item)}
                                className={`w-full text-left px-2 py-1.5 rounded-md hover:bg-[#262422] transition-colors cursor-pointer flex flex-col ${
                                  viewingHistorySnapshot === item.report_id ? "bg-[#262422] text-[#14b8a6]" : "text-[#ded7cb]"
                                }`}
                              >
                                <div className="font-semibold flex items-center justify-between">
                                  <span>Version {reportHistory.length - idx}</span>
                                  <span className="text-[9px] text-[#8e887d] font-mono">
                                    {new Date(item.created_at).toLocaleTimeString()}
                                  </span>
                                </div>
                                <div className="text-[10px] text-[#8e887d] truncate">
                                  {item.recommended_action} • {item.model_id}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Evidence Metrics Summary */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
                  <div
                    style={{
                      background: "#141312",
                      border: "1px solid rgba(238, 231, 219, 0.06)",
                      borderRadius: 8,
                    }}
                    className="p-2.5"
                  >
                    <div className="text-[10px] text-[#8e887d] font-semibold uppercase tracking-wider">
                      Forensic Status
                    </div>
                    <div className="text-[12px] font-bold text-[#f4efe6] mt-0.5">
                      {selectedIncident.overall_status || "CLEAN"}
                    </div>
                  </div>

                  <div
                    style={{
                      background: "#141312",
                      border: "1px solid rgba(238, 231, 219, 0.06)",
                      borderRadius: 8,
                    }}
                    className="p-2.5"
                  >
                    <div className="text-[10px] text-[#8e887d] font-semibold uppercase tracking-wider">
                      Matched Frames
                    </div>
                    <div className="text-[12px] font-bold text-[#f4efe6] mt-0.5">
                      {selectedIncident.candidate_matches_found || 0} candidate(s)
                    </div>
                  </div>

                  <div
                    style={{
                      background: "#141312",
                      border: "1px solid rgba(238, 231, 219, 0.06)",
                      borderRadius: 8,
                    }}
                    className="p-2.5"
                  >
                    <div className="text-[10px] text-[#8e887d] font-semibold uppercase tracking-wider">
                      Peak Similarity
                    </div>
                    <div className="text-[12px] font-bold text-[#f4efe6] mt-0.5">
                      {selectedIncident.highest_confidence || 0}%
                    </div>
                  </div>

                  <div
                    style={{
                      background: "#141312",
                      border: "1px solid rgba(238, 231, 219, 0.06)",
                      borderRadius: 8,
                    }}
                    className="p-2.5"
                  >
                    <div className="text-[10px] text-[#8e887d] font-semibold uppercase tracking-wider">
                      Lowest L2 Distance
                    </div>
                    <div className="text-[12px] font-bold text-[#f4efe6] mt-0.5">
                      {selectedIncident.lowest_l2_distance !== null &&
                      selectedIncident.lowest_l2_distance !== undefined
                        ? Number(selectedIncident.lowest_l2_distance).toFixed(4)
                        : "N/A"}
                    </div>
                  </div>
                </div>

                {/* Latest Nemotron Reasoning Summary */}
                <div
                  style={{
                    background: "#141312",
                    border: "1px solid rgba(238, 231, 219, 0.06)",
                    borderRadius: 10,
                  }}
                  className="p-3.5 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-[#f4efe6] flex items-center gap-1.5">
                      <Sparkles size={13} className="text-[#14b8a6]" />
                      <span>Nemotron Investigation Synthesis</span>
                    </span>
                    {latestReport && (
                      <span className="text-[10px] text-[#8e887d] font-mono">
                        Model: {latestReport.model_id}
                      </span>
                    )}
                  </div>

                  {viewingHistorySnapshot && (
                    <div className="p-2 bg-teal-950/30 border border-teal-800/40 rounded-lg flex items-center justify-between text-[11px] text-teal-300">
                      <div className="flex items-center gap-1.5">
                        <History size={13} />
                        <span>Viewing historical snapshot ({viewingHistorySnapshot.slice(0, 8)})</span>
                      </div>
                      <button
                        onClick={handleReturnToLatestReport}
                        className="text-xs font-bold underline hover:text-white cursor-pointer"
                      >
                        Return to Latest
                      </button>
                    </div>
                  )}

                  {reportLoading ? (
                    <div className="py-4 text-center text-[12px] text-[#736d62] flex items-center justify-center gap-2">
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Loading investigation telemetry...</span>
                    </div>
                  ) : latestReport ? (
                    <div className="space-y-2 text-[12px]">
                      <p className="text-[#ded7cb] leading-relaxed m-0">
                        {latestReport.summary}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[rgba(238,231,219,0.06)] text-[10px]">
                        <span className="text-[#8e887d]">
                          Recommended Action:{" "}
                          <strong className="text-[#f4efe6]">
                            {latestReport.recommended_action}
                          </strong>
                        </span>
                        <span className="text-[#5a554c]">•</span>
                        <span className="text-[#8e887d]">
                          Human Review:{" "}
                          <strong className="text-[#f4efe6]">
                            {latestReport.human_review_required ? "MANDATORY" : "OPTIONAL"}
                          </strong>
                        </span>
                        {reportHistory.length > 1 && (
                          <>
                            <span className="text-[#5a554c]">•</span>
                            <span className="text-[#14b8a6]">
                              {reportHistory.length} saved version(s) in vault
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-[12px] text-[#736d62] py-2">
                      No Nemotron report currently persisted for this incident. Click &quot;Refresh Report&quot; to synthesize forensic telemetry.
                    </div>
                  )}

                  {investigationError && (
                    <div className="text-[11px] text-red-400 p-2 bg-red-950/20 rounded border border-red-900/30">
                      {investigationError}
                    </div>
                  )}
                </div>
              </div>

              {/* ─── SECTION D: Document Generation Area ─── */}
              <div
                style={{
                  background: "#171615",
                  borderRadius: 16,
                  border: "1px solid rgba(238, 231, 219, 0.08)",
                }}
                className="p-5 space-y-4"
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-[rgba(238,231,219,0.08)]">
                  <div>
                    <h3 className="text-[15px] font-bold text-[#f4efe6] m-0">
                      Action Document Generator
                    </h3>
                    <p className="text-[11px] text-[#8e887d] m-0 mt-0.5">
                      Prepares formal, evidence-grounded documents for legal review or commercial outreach.
                    </p>
                  </div>

                  {/* Document Type Selector Tabs */}
                  <div
                    style={{
                      background: "#141312",
                      border: "1px solid rgba(238, 231, 219, 0.08)",
                      borderRadius: 8,
                    }}
                    className="p-1 flex items-center gap-1"
                  >
                    <button
                      onClick={() => setActiveDocType("COPYRIGHT_NOTICE")}
                      style={{
                        background:
                          activeDocType === "COPYRIGHT_NOTICE"
                            ? "rgba(239, 68, 68, 0.18)"
                            : "transparent",
                        color:
                          activeDocType === "COPYRIGHT_NOTICE" ? "#fca5a5" : "#8e887d",
                        border:
                          activeDocType === "COPYRIGHT_NOTICE"
                            ? "1px solid rgba(239, 68, 68, 0.3)"
                            : "none",
                      }}
                      className="px-3 py-1.5 rounded text-[11px] font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <Scale size={13} />
                      <span>Copyright Notice</span>
                    </button>
                    <button
                      onClick={() => setActiveDocType("REVENUE_SHARE_OFFER")}
                      style={{
                        background:
                          activeDocType === "REVENUE_SHARE_OFFER"
                            ? "rgba(20, 184, 166, 0.18)"
                            : "transparent",
                        color:
                          activeDocType === "REVENUE_SHARE_OFFER" ? "#5eead4" : "#8e887d",
                        border:
                          activeDocType === "REVENUE_SHARE_OFFER"
                            ? "1px solid rgba(20, 184, 166, 0.3)"
                            : "none",
                      }}
                      className="px-3 py-1.5 rounded text-[11px] font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <DollarSign size={13} />
                      <span>Rev-Share Proposal</span>
                    </button>
                  </div>
                </div>

                {/* Form Fields: Distinguish User Declarations vs Imported Facts */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[12px]">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#f4efe6] mb-1">
                      Rights Holder Legal Entity *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Acme Media Corp / Premier League"
                      value={rightsHolderName}
                      onChange={(e) => setRightsHolderName(e.target.value)}
                      style={{
                        background: "#141312",
                        border: "1px solid rgba(238, 231, 219, 0.1)",
                        color: "#f4efe6",
                      }}
                      className="w-full px-3 py-1.5 rounded-lg text-[12px] placeholder-[#5a554c] outline-none focus:border-[#14b8a6]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#f4efe6] mb-1">
                      Authorized Representative
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Jane Doe, VP Legal Affairs"
                      value={authorizedRep}
                      onChange={(e) => setAuthorizedRep(e.target.value)}
                      style={{
                        background: "#141312",
                        border: "1px solid rgba(238, 231, 219, 0.1)",
                        color: "#f4efe6",
                      }}
                      className="w-full px-3 py-1.5 rounded-lg text-[12px] placeholder-[#5a554c] outline-none focus:border-[#14b8a6]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#f4efe6] mb-1">
                      Official Contact Email *
                    </label>
                    <input
                      type="email"
                      placeholder="e.g. legal@acmemedia.example"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      style={{
                        background: "#141312",
                        border: "1px solid rgba(238, 231, 219, 0.1)",
                        color: "#f4efe6",
                      }}
                      className="w-full px-3 py-1.5 rounded-lg text-[12px] placeholder-[#5a554c] outline-none focus:border-[#14b8a6]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#f4efe6] mb-1">
                      Protected Work / Broadcast Title *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Matchday 14 Official Broadcast"
                      value={workTitle}
                      onChange={(e) => setWorkTitle(e.target.value)}
                      style={{
                        background: "#141312",
                        border: "1px solid rgba(238, 231, 219, 0.1)",
                        color: "#f4efe6",
                      }}
                      className="w-full px-3 py-1.5 rounded-lg text-[12px] placeholder-[#5a554c] outline-none focus:border-[#14b8a6]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#f4efe6] mb-1">
                      Recipient / Channel Operator Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Platform DMCA Agent or Creator"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      style={{
                        background: "#141312",
                        border: "1px solid rgba(238, 231, 219, 0.1)",
                        color: "#f4efe6",
                      }}
                      className="w-full px-3 py-1.5 rounded-lg text-[12px] placeholder-[#5a554c] outline-none focus:border-[#14b8a6]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#f4efe6] mb-1">
                      Recipient Destination Email *
                    </label>
                    <input
                      type="email"
                      placeholder="e.g. dmca@platform.example or creator@domain.com"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      style={{
                        background: "#141312",
                        border: "1px solid rgba(238, 231, 219, 0.1)",
                        color: "#f4efe6",
                      }}
                      className="w-full px-3 py-1.5 rounded-lg text-[12px] placeholder-[#5a554c] outline-none focus:border-[#14b8a6]"
                    />
                  </div>

                  {/* Document-Specific Settings */}
                  {activeDocType === "COPYRIGHT_NOTICE" ? (
                    <div>
                      <label className="block text-[11px] font-semibold text-[#f4efe6] mb-1">
                        Applicable Jurisdiction Framework
                      </label>
                      <select
                        value={jurisdiction}
                        onChange={(e) => setJurisdiction(e.target.value)}
                        style={{
                          background: "#141312",
                          border: "1px solid rgba(238, 231, 219, 0.1)",
                          color: "#f4efe6",
                        }}
                        className="w-full px-3 py-1.5 rounded-lg text-[12px] outline-none focus:border-[#14b8a6]"
                      >
                        <option value="US_DMCA">US — DMCA 17 U.S.C. § 512(c)</option>
                        <option value="EU_DSA">EU — Digital Services Act (Regulation 2022/2065, Art 16)</option>
                        <option value="UK_CDPA">UK — Copyright, Designs and Patents Act 1988</option>
                        <option value="GENERAL">General International Infringement Notice</option>
                      </select>
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-[11px] font-semibold text-[#f4efe6] mb-1">
                          Proposed Rights-Holder Revenue Share ({revSharePct}% / {100 - revSharePct}% Creator)
                        </label>
                        <input
                          type="range"
                          min="10"
                          max="90"
                          step="5"
                          value={revSharePct}
                          onChange={(e) => setRevSharePct(Number(e.target.value))}
                          className="w-full accent-[#14b8a6]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-[#f4efe6] mb-1">
                          Response Window (Days)
                        </label>
                        <input
                          type="number"
                          min="3"
                          max="60"
                          value={responseDeadlineDays}
                          onChange={(e) => setResponseDeadlineDays(Number(e.target.value))}
                          style={{
                            background: "#141312",
                            border: "1px solid rgba(238, 231, 219, 0.1)",
                            color: "#f4efe6",
                          }}
                          className="w-full px-3 py-1.5 rounded-lg text-[12px] outline-none focus:border-[#14b8a6]"
                        />
                      </div>
                    </>
                  )}

                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold text-[#f4efe6] mb-1">
                      Additional Context / Custom Observations (Optional)
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Add specific remarks regarding match segments or licensing boundaries..."
                      value={customNotes}
                      onChange={(e) => setCustomNotes(e.target.value)}
                      style={{
                        background: "#141312",
                        border: "1px solid rgba(238, 231, 219, 0.1)",
                        color: "#f4efe6",
                      }}
                      className="w-full px-3 py-1.5 rounded-lg text-[12px] placeholder-[#5a554c] outline-none focus:border-[#14b8a6] resize-none"
                    />
                  </div>
                </div>

                {/* Overwrite Confirmation Warning */}
                {showRegenConfirm && (
                  <div className="p-3 bg-amber-950/25 border border-amber-800/40 rounded-lg text-[11px] text-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                      <span>
                        A draft already exists for this incident. Regenerating will replace existing draft text and edits.
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleGenerateDraft(true)}
                        className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-[11px] font-bold cursor-pointer transition-colors"
                      >
                        Confirm Overwrite
                      </button>
                      <button
                        onClick={() => setShowRegenConfirm(false)}
                        className="px-2.5 py-1 bg-[#262422] hover:bg-[#33302d] text-[#ded7cb] rounded text-[11px] font-semibold cursor-pointer transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Synthesis Options & Generate Action */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-3 border-t border-[rgba(238,231,219,0.06)]">
                  <label className="flex items-center gap-2 cursor-pointer text-[11px] text-[#ded7cb]">
                    <input
                      type="checkbox"
                      checked={useAiSynthesis}
                      onChange={(e) => setUseAiSynthesis(e.target.checked)}
                      className="rounded accent-[#14b8a6]"
                    />
                    <span>Enhance introductory narrative with Nemotron reasoning</span>
                  </label>

                  <button
                    onClick={() => handleGenerateDraft(false)}
                    disabled={drafting}
                    style={{
                      background:
                        activeDocType === "COPYRIGHT_NOTICE"
                          ? "rgba(239, 68, 68, 0.85)"
                          : "rgba(20, 184, 166, 0.85)",
                      color: "#f4efe6",
                    }}
                    className="px-4 py-2 rounded-lg font-bold text-[12px] flex items-center gap-2 transition-all hover:opacity-95 cursor-pointer disabled:opacity-50"
                  >
                    {drafting ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <FileCheck size={14} />
                    )}
                    <span>
                      {drafting
                        ? "Generating Draft..."
                        : activeDocType === "COPYRIGHT_NOTICE"
                        ? "Draft Copyright Notice"
                        : "Draft Revenue-Sharing Proposal"}
                    </span>
                  </button>
                </div>

                {draftError && (
                  <div className="text-[11px] text-red-400 p-2.5 bg-red-950/25 rounded-lg border border-red-900/40">
                    {draftError}
                  </div>
                )}
              </div>

              {/* ─── SECTION E: Shared Document Editor & Review ─── */}
              {currentDraft && (
                <div
                  style={{
                    background: "#171615",
                    borderRadius: 16,
                    border: "1px solid rgba(238, 231, 219, 0.08)",
                  }}
                  className="p-5 space-y-4"
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-[rgba(238,231,219,0.08)]">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          style={{
                            background:
                              currentDraft.status === "READY_FOR_REVIEW"
                                ? "rgba(34, 197, 94, 0.15)"
                                : currentDraft.status === "UNVERIFIED_EVIDENCE"
                                ? "rgba(239, 68, 68, 0.15)"
                                : "rgba(234, 179, 8, 0.15)",
                            color:
                              currentDraft.status === "READY_FOR_REVIEW"
                                ? "#4ade80"
                                : currentDraft.status === "UNVERIFIED_EVIDENCE"
                                ? "#f87171"
                                : "#facc15",
                            border: `1px solid ${
                              currentDraft.status === "READY_FOR_REVIEW"
                                ? "rgba(34, 197, 94, 0.3)"
                                : currentDraft.status === "UNVERIFIED_EVIDENCE"
                                ? "rgba(239, 68, 68, 0.3)"
                                : "rgba(234, 179, 8, 0.3)"
                            }`,
                          }}
                          className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
                        >
                          {currentDraft.status === "READY_FOR_REVIEW"
                            ? "Draft Ready for Review"
                            : currentDraft.status === "UNVERIFIED_EVIDENCE"
                            ? "Unverified Evidence (CLEAN Incident)"
                            : "Evidence Incomplete"}
                        </span>
                        {currentDraft.ai_enhanced ? (
                          <span className="text-[10px] text-[#14b8a6] bg-[rgba(20,184,166,0.12)] border border-[rgba(20,184,166,0.3)] px-2 py-0.5 rounded-full flex items-center gap-1 font-semibold">
                            <Sparkles size={11} />
                            <span>Nemotron AI Synthesized ({currentDraft.model_id})</span>
                          </span>
                        ) : (
                          <span className="text-[10px] text-[#aba497] bg-[#1c1b1a] border border-[rgba(238,231,219,0.1)] px-2 py-0.5 rounded-full flex items-center gap-1 font-semibold">
                            <FileText size={11} />
                            <span>Deterministic Template ({currentDraft.model_id})</span>
                          </span>
                        )}
                      </div>
                      <h4 className="text-[14px] font-bold text-[#f4efe6] m-0 mt-1">
                        Review & Edit Generated Output
                      </h4>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSaveDraftEdits}
                        style={{
                          background: "#1c1b1a",
                          border: "1px solid rgba(238, 231, 219, 0.1)",
                          color: "#ded7cb",
                        }}
                        className="px-2.5 py-1.5 rounded-lg hover:bg-[#262422] text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        title="Save modified text to this incident session"
                      >
                        {saveSuccessToast ? <Check size={13} className="text-emerald-400" /> : <FileCheck size={13} />}
                        <span>{saveSuccessToast ? "Saved" : "Save Edits"}</span>
                      </button>

                      <button
                        onClick={handleCopyDraft}
                        style={{
                          background: "#1c1b1a",
                          border: "1px solid rgba(238, 231, 219, 0.1)",
                          color: "#ded7cb",
                        }}
                        className="px-2.5 py-1.5 rounded-lg hover:bg-[#262422] text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        {copySuccess ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                        <span>{copySuccess ? "Copied" : "Copy"}</span>
                      </button>

                      <button
                        onClick={handleDownloadDraft}
                        style={{
                          background: "#1c1b1a",
                          border: "1px solid rgba(238, 231, 219, 0.1)",
                          color: "#ded7cb",
                        }}
                        className="px-2.5 py-1.5 rounded-lg hover:bg-[#262422] text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Download size={13} />
                        <span>Download</span>
                      </button>

                      <button
                        onClick={handleOpenEmailModal}
                        style={{
                          background: "#eee7db",
                          color: "#141312",
                        }}
                        className="px-3.5 py-1.5 rounded-lg hover:bg-[#fbf7ef] text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Mail size={13} />
                        <span>Prepare & Dispatch</span>
                      </button>
                    </div>
                  </div>

                  {/* Missing Fields Warning if any */}
                  {currentDraft.missing_fields && currentDraft.missing_fields.length > 0 && (
                    <div className="p-3 bg-amber-950/20 border border-amber-900/30 rounded-lg text-[11px] text-amber-300 space-y-1">
                      <div className="font-bold flex items-center gap-1.5">
                        <AlertTriangle size={13} />
                        <span>Missing Fields Requiring Manual Completion:</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {currentDraft.missing_fields.map((field) => (
                          <span
                            key={field}
                            className="px-2 py-0.5 bg-amber-900/30 rounded text-[10px] font-mono text-amber-200"
                          >
                            {field}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Subject Line Editor */}
                  <div>
                    <label className="block text-[11px] font-semibold text-[#8e887d] mb-1">
                      Subject Line
                    </label>
                    <input
                      type="text"
                      value={editedSubject}
                      onChange={(e) => setEditedSubject(e.target.value)}
                      style={{
                        background: "#141312",
                        border: "1px solid rgba(238, 231, 219, 0.1)",
                        color: "#f4efe6",
                      }}
                      className="w-full px-3 py-2 rounded-lg text-[13px] font-semibold outline-none focus:border-[#14b8a6]"
                    />
                  </div>

                  {/* Document Body Editor */}
                  <div>
                    <label className="block text-[11px] font-semibold text-[#8e887d] mb-1">
                      Document Content (Editable Draft)
                    </label>
                    <textarea
                      rows={14}
                      value={editedBody}
                      onChange={(e) => setEditedBody(e.target.value)}
                      style={{
                        background: "#141312",
                        border: "1px solid rgba(238, 231, 219, 0.1)",
                        color: "#f4efe6",
                      }}
                      className="w-full px-3.5 py-3 rounded-lg font-mono text-[11px] leading-relaxed outline-none focus:border-[#14b8a6]"
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            <div
              style={{
                background: "#171615",
                borderRadius: 16,
                border: "1px dashed rgba(238, 231, 219, 0.12)",
              }}
              className="p-12 text-center text-[#8e887d]"
            >
              <Shield size={32} className="mx-auto mb-2 text-[#5a554c]" />
              <div className="text-[14px] font-bold text-[#f4efe6]">No Incident Selected</div>
              <p className="text-[12px] max-w-sm mx-auto mt-1">
                Select an investigated incident from the left panel to load its forensic evidence telemetry and draft actions.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ─── SECTION F: Email Composition & Dispatch Modal ─── */}
      {showEmailModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            style={{
              background: "#171615",
              border: "1px solid rgba(238, 231, 219, 0.15)",
              borderRadius: 18,
            }}
            className="w-full max-w-2xl p-6 text-[#ded7cb] shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[rgba(238,231,219,0.08)]">
              <div className="flex items-center gap-2">
                <Mail size={18} className="text-[#14b8a6]" />
                <h3 className="text-[16px] font-extrabold text-[#f4efe6] m-0">
                  Email Dispatch Review
                </h3>
              </div>
              <button
                onClick={() => setShowEmailModal(false)}
                className="p-1 rounded-md text-[#8e887d] hover:text-[#f4efe6] hover:bg-[#262422] transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Provider Configuration Notice */}
            <div
              style={{
                background: nemotronStatus?.email_delivery_available
                  ? "rgba(34, 197, 94, 0.08)"
                  : "rgba(234, 179, 8, 0.08)",
                border: `1px solid ${
                  nemotronStatus?.email_delivery_available
                    ? "rgba(34, 197, 94, 0.2)"
                    : "rgba(234, 179, 8, 0.2)"
                }`,
                borderRadius: 10,
              }}
              className="p-3 text-[11px]"
            >
              {nemotronStatus?.email_delivery_available ? (
                <div className="text-emerald-300 flex items-center gap-2">
                  <CheckCircle size={14} />
                  <span>
                    Resend API service configured. Outgoing address:{" "}
                    <strong>{nemotronStatus.email_from}</strong>
                  </span>
                </div>
              ) : (
                <div className="text-amber-300 space-y-1">
                  <div className="flex items-center gap-2 font-bold">
                    <AlertTriangle size={14} />
                    <span>Email Delivery Service Unconfigured</span>
                  </div>
                  <p className="text-[10px] text-amber-200/80 m-0 leading-relaxed">
                    Set <code>RESEND_API_KEY</code> and <code>FROM_EMAIL</code> in the backend environment to enable real HTTP dispatch. Attempts will be recorded in the audit log.
                  </p>
                </div>
              )}
            </div>

            {/* Form Fields */}
            <div className="space-y-3 text-[12px]">
              <div>
                <label className="block text-[11px] font-semibold text-[#8e887d] mb-1">
                  Recipient Email *
                </label>
                <input
                  type="email"
                  value={modalRecipientEmail}
                  onChange={(e) => setModalRecipientEmail(e.target.value)}
                  placeholder="recipient@platform.example"
                  style={{
                    background: "#141312",
                    border: "1px solid rgba(238, 231, 219, 0.1)",
                    color: "#f4efe6",
                  }}
                  className="w-full px-3 py-1.5 rounded-lg text-[12px] outline-none focus:border-[#14b8a6]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#8e887d] mb-1">
                  CC Email Addresses (Optional, comma-separated)
                </label>
                <input
                  type="text"
                  value={modalCcEmail}
                  onChange={(e) => setModalCcEmail(e.target.value)}
                  placeholder="legal-archive@acme.example, counsel@law.example"
                  style={{
                    background: "#141312",
                    border: "1px solid rgba(238, 231, 219, 0.1)",
                    color: "#f4efe6",
                  }}
                  className="w-full px-3 py-1.5 rounded-lg text-[12px] outline-none focus:border-[#14b8a6]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#8e887d] mb-1">
                  Outgoing Subject Line *
                </label>
                <input
                  type="text"
                  value={modalSubject}
                  onChange={(e) => setModalSubject(e.target.value)}
                  style={{
                    background: "#141312",
                    border: "1px solid rgba(238, 231, 219, 0.1)",
                    color: "#f4efe6",
                  }}
                  className="w-full px-3 py-1.5 rounded-lg text-[12px] font-semibold outline-none focus:border-[#14b8a6]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#8e887d] mb-1">
                  Outgoing Message Body Preview
                </label>
                <textarea
                  rows={8}
                  value={modalBody}
                  onChange={(e) => setModalBody(e.target.value)}
                  style={{
                    background: "#141312",
                    border: "1px solid rgba(238, 231, 219, 0.1)",
                    color: "#f4efe6",
                  }}
                  className="w-full px-3.5 py-2.5 rounded-lg font-mono text-[11px] leading-relaxed outline-none focus:border-[#14b8a6]"
                />
              </div>
            </div>

            {/* Mandatory Safeguard Checkboxes */}
            <div className="p-3.5 bg-[#141312] border border-[rgba(238,231,219,0.08)] rounded-xl space-y-2.5 text-[11px]">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmHumanReview}
                  onChange={(e) => setConfirmHumanReview(e.target.checked)}
                  className="mt-0.5 rounded accent-[#14b8a6]"
                />
                <span className="text-[#f4efe6] font-medium leading-snug">
                  I confirm that I have reviewed the recipient, subject, body, evidence telemetry, and all material statements in this communication.
                </span>
              </label>

              {activeDocType === "COPYRIGHT_NOTICE" && (
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmRightsDeclaration}
                    onChange={(e) => setConfirmRightsDeclaration(e.target.checked)}
                    className="mt-0.5 rounded accent-[#14b8a6]"
                  />
                  <span className="text-[#f4efe6] font-medium leading-snug">
                    I state under penalty of perjury/good faith that I am the authorized copyright holder or authorized to act on behalf of the exclusive rights owner.
                  </span>
                </label>
              )}
            </div>

            {/* Result / Error Banner */}
            {sendResult && (
              <div
                style={{
                  background: sendResult.success
                    ? "rgba(34, 197, 94, 0.12)"
                    : "rgba(234, 179, 8, 0.12)",
                  border: `1px solid ${
                    sendResult.success ? "rgba(34, 197, 94, 0.3)" : "rgba(234, 179, 8, 0.3)"
                  }`,
                  borderRadius: 10,
                }}
                className="p-3 text-[11px]"
              >
                <div
                  className={`font-bold ${
                    sendResult.success ? "text-emerald-400" : "text-amber-300"
                  }`}
                >
                  Status: {sendResult.status}
                </div>
                <div className="text-[#ded7cb] mt-0.5">{sendResult.message}</div>
                {sendResult.delivery_id && (
                  <div className="text-[10px] text-[#8e887d] font-mono mt-1">
                    Resend Delivery ID: {sendResult.delivery_id}
                  </div>
                )}
                <div className="text-[10px] text-[#8e887d] font-mono">
                  Audit ID: {sendResult.audit_id}
                </div>
              </div>
            )}

            {sendError && (
              <div className="p-3 bg-red-950/30 border border-red-900/40 rounded-lg text-[11px] text-red-300">
                {sendError}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[rgba(238,231,219,0.08)]">
              <button
                onClick={() => setShowEmailModal(false)}
                style={{
                  background: "#1c1b1a",
                  border: "1px solid rgba(238, 231, 219, 0.1)",
                  color: "#ded7cb",
                }}
                className="px-3.5 py-1.5 rounded-lg hover:bg-[#262422] text-[12px] font-semibold transition-colors cursor-pointer"
              >
                Close
              </button>

              <button
                onClick={handleSendEmail}
                disabled={
                  sendingEmail ||
                  !confirmHumanReview ||
                  (activeDocType === "COPYRIGHT_NOTICE" && !confirmRightsDeclaration) ||
                  !modalRecipientEmail.trim()
                }
                style={{
                  background: "#eee7db",
                  color: "#141312",
                }}
                className="px-4 py-1.5 rounded-lg hover:bg-[#fbf7ef] text-[12px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {sendingEmail ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  <Send size={13} />
                )}
                <span>Dispatch Verified Email</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── AUDIT LOG MODAL ─── */}
      {showAuditModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            style={{
              background: "#171615",
              border: "1px solid rgba(238, 231, 219, 0.15)",
              borderRadius: 18,
            }}
            className="w-full max-w-3xl p-6 text-[#ded7cb] shadow-2xl space-y-4 max-h-[85vh] flex flex-col"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[rgba(238,231,219,0.08)] shrink-0">
              <div className="flex items-center gap-2">
                <History size={18} className="text-[#14b8a6]" />
                <h3 className="text-[16px] font-extrabold text-[#f4efe6] m-0">
                  Email Dispatch Audit Trail
                </h3>
              </div>
              <button
                onClick={() => setShowAuditModal(false)}
                className="p-1 rounded-md text-[#8e887d] hover:text-[#f4efe6] hover:bg-[#262422] transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {auditLoading ? (
                <div className="py-12 text-center text-[12px] text-[#736d62] flex items-center justify-center gap-2">
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Loading audit log entries...</span>
                </div>
              ) : auditLogs.length === 0 ? (
                <div className="py-12 text-center text-[12px] text-[#736d62]">
                  No email dispatch attempts recorded in audit log.
                </div>
              ) : (
                auditLogs.map((entry) => (
                  <div
                    key={entry.audit_id}
                    style={{
                      background: "#141312",
                      border: "1px solid rgba(238, 231, 219, 0.06)",
                      borderRadius: 10,
                    }}
                    className="p-3 text-[11px] space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[#f4efe6]">{entry.subject}</span>
                      <span
                        style={{
                          background:
                            entry.status === "DELIVERED"
                              ? "rgba(34, 197, 94, 0.15)"
                              : entry.status === "NOT_CONFIGURED"
                              ? "rgba(234, 179, 8, 0.15)"
                              : "rgba(239, 68, 68, 0.15)",
                          color:
                            entry.status === "DELIVERED"
                              ? "#4ade80"
                              : entry.status === "NOT_CONFIGURED"
                              ? "#facc15"
                              : "#f87171",
                        }}
                        className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider shrink-0"
                      >
                        {entry.status}
                      </span>
                    </div>

                    <div className="text-[#8e887d] flex flex-wrap items-center gap-3 text-[10px]">
                      <span>To: {entry.recipient_email}</span>
                      <span>•</span>
                      <span>Type: {entry.document_type}</span>
                      <span>•</span>
                      <span>{new Date(entry.timestamp).toLocaleString()}</span>
                    </div>

                    {entry.delivery_id && (
                      <div className="text-[#14b8a6] font-mono text-[10px]">
                        Resend Delivery ID: {entry.delivery_id}
                      </div>
                    )}
                    {entry.error && (
                      <div className="text-red-400 text-[10px]">{entry.error}</div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="pt-2 border-t border-[rgba(238,231,219,0.08)] text-right shrink-0">
              <button
                onClick={() => setShowAuditModal(false)}
                style={{
                  background: "#1c1b1a",
                  border: "1px solid rgba(238, 231, 219, 0.1)",
                  color: "#ded7cb",
                }}
                className="px-3.5 py-1.5 rounded-lg hover:bg-[#262422] text-[12px] font-semibold transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
