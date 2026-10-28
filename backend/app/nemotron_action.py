"""
Nemotron Action Center & Document Generation Module for FixProof (Phase 3.5).
Provides evidence-grounded drafting for copyright notices and commercial revenue-sharing proposals,
coupled with human-in-the-loop review, Resend email dispatch, and audit logging.

Operational Invariants:
- Never sends email automatically without explicit user confirmation.
- Distinct prompts and schemas for Copyright Notices vs Revenue-Sharing Proposals.
- Distinguishes verified FixProof evidence facts from user-supplied declarations.
- Safely degrades when RESEND_API_KEY is not configured; never fabricates delivery.
"""

from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import re
from typing import Any, Dict, List, Literal, Optional, Tuple
import uuid

import requests
from openai import OpenAI

from app.registry import get_incident_by_id, is_cloud_mode
from app.nemotron_engine import get_openai_client, DEFAULT_MODEL, resolve_model_id

logger = logging.getLogger(__name__)

AUDIT_LOG_FILE = Path(__file__).resolve().parent.parent / "storage" / "email_audit_log.json"
EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def get_email_config() -> Tuple[bool, Optional[str], Optional[str]]:
    """Checks whether the server-side email dispatch service is configured."""
    api_key = os.getenv("RESEND_API_KEY", "").strip()
    from_email = os.getenv("FROM_EMAIL", "").strip() or "notices@fixproof.com"
    configured = bool(api_key and len(api_key) > 5)
    return configured, api_key if configured else None, from_email


def load_email_audit_log() -> List[Dict[str, Any]]:
    """Loads email audit logs from storage/email_audit_log.json."""
    if not AUDIT_LOG_FILE.exists():
        return []
    try:
        with open(AUDIT_LOG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"[NemotronAction] Failed to read email audit log: {e}")
        return []


def save_email_audit_entry(entry: Dict[str, Any]) -> None:
    """Appends an entry to the persistent email audit log."""
    try:
        AUDIT_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        logs = load_email_audit_log()
        logs.insert(0, entry)
        logs = logs[:200]  # retain latest 200 entries
        with open(AUDIT_LOG_FILE, "w", encoding="utf-8") as f:
            json.dump(logs, f, indent=2)
    except Exception as e:
        logger.error(f"[NemotronAction] Failed to persist email audit entry: {e}")


def extract_incident_evidence_facts(incident: Dict[str, Any]) -> Dict[str, Any]:
    """Extracts factual, verified evidence records from an incident record."""
    iid = str(incident.get("incident_id") or "UNKNOWN")
    inv_type = incident.get("investigation_type") or "FULL_VIDEO_SCAN"
    suspect_name = incident.get("suspect_filename") or ""
    suspect_url = incident.get("suspect_url") or incident.get("source_url") or ""
    platform = incident.get("platform") or ("Direct File" if inv_type == "FULL_VIDEO_SCAN" else "Web Stream")
    scanned_at = incident.get("scanned_at") or datetime.now(timezone.utc).isoformat()

    matched_assets = incident.get("matched_assets") or []
    candidate_matches_found = incident.get("candidate_matches_found") or 0
    highest_conf = float(incident.get("highest_confidence") or 0.0)
    lowest_l2 = float(incident["lowest_l2_distance"]) if incident.get("lowest_l2_distance") is not None else None
    overall_status = incident.get("overall_status") or "CLEAN"

    # Extract frame match observations
    frames = incident.get("frame_matches") or []
    frame_correlations = []
    for idx, fm in enumerate(frames):
        best = fm.get("best_match") or {}
        sub = fm.get("submitted_frame") or {}
        if best.get("match_confirmed") or (best.get("l2_distance") is not None and best["l2_distance"] < 0.75):
            suspect_ts = sub.get("timestamp_sec") if sub.get("timestamp_sec") is not None else fm.get("timestamp_sec", idx * 5)
            source_ts = best.get("source_timestamp_sec", suspect_ts)
            l2 = best.get("l2_distance")
            phash = best.get("phash_match", False)
            frame_correlations.append({
                "frame_index": idx,
                "suspect_timestamp_sec": suspect_ts,
                "source_timestamp_sec": source_ts,
                "source_asset_id": best.get("source_asset_id", "REF_ASSET"),
                "l2_distance": round(l2, 4) if l2 is not None else None,
                "phash_match": phash,
            })

    return {
        "incident_id": iid,
        "investigation_type": inv_type,
        "suspect_filename": suspect_name,
        "suspect_url": suspect_url,
        "platform": platform,
        "scanned_at": scanned_at,
        "matched_assets": matched_assets,
        "candidate_matches_found": candidate_matches_found,
        "highest_confidence": highest_conf,
        "lowest_l2_distance": lowest_l2,
        "overall_status": overall_status,
        "frame_correlations": frame_correlations[:12],
    }


def generate_copyright_notice_draft(
    incident: Dict[str, Any],
    user_inputs: Dict[str, Any],
    use_ai_synthesis: bool = True,
) -> Dict[str, Any]:
    """
    Generates a structured, evidence-grounded draft copyright notice.
    Clearly distinguishes recorded facts, user assertions, and required statutory declarations.
    """
    evidence = extract_incident_evidence_facts(incident)

    rights_holder = (user_inputs.get("rights_holder_name") or "").strip()
    contact_email = (user_inputs.get("contact_email") or "").strip()
    authorized_rep = (user_inputs.get("authorized_rep") or "").strip()
    recipient_name = (user_inputs.get("recipient_name") or "").strip()
    recipient_email = (user_inputs.get("recipient_email") or "").strip()
    work_title = (user_inputs.get("work_title") or "").strip()
    jurisdiction = (user_inputs.get("jurisdiction") or "US_DMCA").strip().upper()
    custom_notes = (user_inputs.get("additional_notes") or "").strip()

    missing_fields = []
    if not rights_holder:
        missing_fields.append("rights_holder_name")
    if not contact_email:
        missing_fields.append("contact_email")
    if not work_title:
        missing_fields.append("work_title")
    if not recipient_email:
        missing_fields.append("recipient_email")

    suspect_location = evidence["suspect_url"] or evidence["suspect_filename"] or f"Suspect Content (Incident {evidence['incident_id'][:8]})"
    is_clean = (evidence.get("candidate_matches_found") or 0) == 0 or evidence.get("overall_status") == "CLEAN"

    # Default evidence table string
    evidence_lines = []
    if evidence["frame_correlations"]:
        evidence_lines.append("Verified Frame Match Telemetry:")
        for fc in evidence["frame_correlations"]:
            evidence_lines.append(
                f"  - Suspect Timestamp {fc['suspect_timestamp_sec']}s corresponds to Reference Asset {fc['source_asset_id'][:8]} at {fc['source_timestamp_sec']}s (L2 Metric: {fc['l2_distance']}, pHash Corroborated: {fc['phash_match']})"
            )
    elif not is_clean:
        evidence_lines.append(f"  - Observed peak heuristic similarity: {evidence['highest_confidence']}% (Lowest L2 distance: {evidence['lowest_l2_distance']})")
    else:
        evidence_lines.append("  - Telemetry: No frame matches confirmed above threshold in reference vault (0 matching frames).")

    evidence_text = "\n".join(evidence_lines)

    # Jurisdiction legal framing
    if jurisdiction == "US_DMCA":
        statute_header = "NOTICE OF CLAIMED COPYRIGHT INFRINGEMENT PURSUANT TO 17 U.S.C. § 512(c)"
        statutory_declaration = (
            "STATUTORY DECLARATIONS & STATEMENTS OF GOOD FAITH:\n"
            "1. I have a good faith belief that the use of the material in the manner complained of is not authorized by the copyright owner, its agent, or the law.\n"
            "2. The information in this notification is accurate.\n"
            "3. Under penalty of perjury, I declare that I am authorized to act on behalf of the owner of an exclusive right that is allegedly infringed."
        )
    elif jurisdiction == "EU_DSA":
        statute_header = "NOTICE AND ACTION REQUEST PURSUANT TO EU DIGITAL SERVICES ACT (REGULATION 2022/2065, ARTICLE 16)"
        statutory_declaration = (
            "SUBMITTER CONFIRMATIONS:\n"
            "1. I confirm that I hold a bona fide belief that the information and allegations contained herein are accurate and complete.\n"
            "2. I declare that I am duly authorized to submit this notice on behalf of the identified intellectual property rights-holder."
        )
    elif jurisdiction == "UK_CDPA":
        statute_header = "NOTICE OF COPYRIGHT INFRINGEMENT UNDER UK COPYRIGHT, DESIGNS AND PATENTS ACT 1988"
        statutory_declaration = (
            "RIGHTS-HOLDER DECLARATIONS:\n"
            "1. The submitter declares that the identified work is protected under copyright and that the identified dissemination is unauthorized.\n"
            "2. The submitter confirms authority to represent the rights-holder in this matter."
        )
    else:
        statute_header = "FORMAL NOTICE OF INTELLECTUAL PROPERTY INFRINGEMENT & TAKEDOWN REQUEST"
        statutory_declaration = (
            "DECLARATIONS:\n"
            "1. The submitter maintains a good faith belief that the identified media is an unauthorized reproduction.\n"
            "2. All statements herein are made to the best of knowledge and authority."
        )

    forensic_intro = (
        "FixProof automated visual analysis identified perceptual correspondence between the suspect material and the authentic reference work:"
        if not is_clean
        else "FixProof automated screening evaluated the suspect material against registered reference assets and recorded no confirmed perceptual match above threshold:"
    )

    subject = f"[{jurisdiction} Notice] Copyright Infringement Notice — {work_title or 'Protected Content'} (Ref: {evidence['incident_id'][:8]})"

    body_template = f"""{statute_header}

Date: {datetime.now(timezone.utc).strftime('%B %d, %Y')}
To: {recipient_name or '[Designated Copyright Agent / Platform Operator]'}
Notice Recipient: {recipient_email or '[recipient-email@platform.com]'}
From: {authorized_rep + ' on behalf of ' if authorized_rep else ''}{rights_holder or '[Rights Holder Legal Name]'}
Contact: {contact_email or '[legal-contact@rightsholder.com]'}

1. IDENTIFICATION OF COPYRIGHTED WORK:
The copyrighted work at issue is:
Title: {work_title or '[Title of Copyrighted Work / Broadcast]'}
Rights Holder: {rights_holder or '[Rights Holder Legal Name]'}
Reference Vault Registration ID: {', '.join(evidence['matched_assets']) if evidence['matched_assets'] else 'Registered Official Asset'}

2. IDENTIFICATION OF ALLEGEDLY INFRINGING MATERIAL:
The unauthorized reproduction is hosted/distributed at the following location:
URL / Target: {suspect_location}
Platform: {evidence['platform']}
Recorded Scan Date: {evidence['scanned_at']}

3. FORENSIC EVIDENCE & CORROBORATION:
{forensic_intro}
- Overall Recorded Forensic Status: {evidence['overall_status']}
- Peak Visual Similarity Score: {evidence['highest_confidence']}%
- Lowest L2 Embedding Distance: {evidence['lowest_l2_distance'] if evidence['lowest_l2_distance'] is not None else 'N/A'}
- Total Evaluated Keyframes: {len(evidence['frame_correlations'])}

{evidence_text}

Disclaimer: Visual similarity measurements reflect algorithmic feature matching and do not constitute self-executing legal findings without authorized human review. Similarity metrics are heuristic scores and are not calibrated probabilities of copyright infringement. Recorded frame correlations are factual observations, while formal infringement determination requires authorized human evaluation.

4. REQUESTED ACTION:
You are hereby requested to expeditiously remove or disable access to the infringing material identified above.

5. {statutory_declaration}

Signed,
{authorized_rep or rights_holder or '[Authorized Signatory]'}
{rights_holder or '[Rights Holder Organization]'}
{contact_email or '[Contact Email]'}
FixProof Forensic Incident Reference: {evidence['incident_id']}
"""

    if custom_notes:
        body_template += f"\nAdditional Context:\n{custom_notes}\n"

    # AI Enhancement if requested and API key available
    ai_enhanced = False
    if use_ai_synthesis and os.getenv("NEBIUS_API_KEY"):
        try:
            client = get_openai_client()
            model_id = resolve_model_id()
            prompt = (
                f"You are a professional intellectual property paralegal assistant. "
                f"Review this draft notice and polish the introductory and evidence explanation sections. "
                f"CRITICAL RULES: Do NOT alter any evidence numbers, timestamps, or statutory declarations. "
                f"Do NOT invent statutory sections or legal citations. Preserve all placeholders like [Rights Holder].\n\n"
                f"DRAFT NOTICE:\n{body_template}"
            )
            resp = client.chat.completions.create(
                model=model_id,
                messages=[
                    {"role": "system", "content": "You are a professional forensic legal drafter."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=2500,
                temperature=0.1,
            )
            polished = resp.choices[0].message.content
            if polished and len(polished.strip()) > 200:
                body_template = polished.strip()
                ai_enhanced = True
        except Exception as e:
            logger.warning(f"[NemotronAction] AI enhancement skipped due to: {e}")

    if is_clean:
        draft_status = "UNVERIFIED_EVIDENCE"
        warn_msg = "WARNING: Incident status is CLEAN (0 matched candidate frames). Independent human verification is required prior to legal escalation."
        if warn_msg not in missing_fields:
            missing_fields.append(warn_msg)
    elif missing_fields:
        draft_status = "INCOMPLETE_EVIDENCE"
    else:
        draft_status = "READY_FOR_REVIEW"

    return {
        "document_id": str(uuid.uuid4()),
        "incident_id": evidence["incident_id"],
        "document_type": "COPYRIGHT_NOTICE",
        "status": draft_status,
        "jurisdiction": jurisdiction,
        "subject": subject,
        "body": body_template,
        "facts_imported": evidence,
        "user_inputs": user_inputs,
        "missing_fields": missing_fields,
        "ai_enhanced": ai_enhanced,
        "model_id": DEFAULT_MODEL if ai_enhanced else "deterministic-template-v1.0",
        "declarations_required": [
            "I have reviewed the identified suspect material and verified ownership of the claimed work.",
            "I declare in good faith that this notice is accurate and that I am authorized to act on behalf of the rights holder.",
            "I acknowledge that submitting false legal notices carries potential statutory and common-law liabilities.",
        ],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def generate_rev_share_proposal_draft(
    incident: Dict[str, Any],
    user_inputs: Dict[str, Any],
    use_ai_synthesis: bool = True,
) -> Dict[str, Any]:
    """
    Generates a professional commercial outreach proposal offering licensing or revenue sharing.
    Strictly framed as a commercial invitation to discuss partnership, not an accusation.
    """
    evidence = extract_incident_evidence_facts(incident)

    rights_holder = (user_inputs.get("rights_holder_name") or "").strip()
    contact_email = (user_inputs.get("contact_email") or "").strip()
    rep_name = (user_inputs.get("representative_name") or "").strip()
    recipient_name = (user_inputs.get("recipient_name") or "").strip()
    recipient_email = (user_inputs.get("recipient_email") or "").strip()
    work_title = (user_inputs.get("work_title") or "").strip()
    rev_share_pct = user_inputs.get("proposed_rev_share_pct") or 70.0
    commercial_terms = (user_inputs.get("commercial_terms") or "").strip()
    response_deadline_days = int(user_inputs.get("response_deadline_days") or 14)

    missing_fields = []
    if not rights_holder:
        missing_fields.append("rights_holder_name")
    if not contact_email:
        missing_fields.append("contact_email")
    if not work_title:
        missing_fields.append("work_title")
    if not recipient_email:
        missing_fields.append("recipient_email")

    suspect_location = evidence["suspect_url"] or evidence["suspect_filename"] or f"Shared Media Item ({evidence['incident_id'][:8]})"
    is_clean = (evidence.get("candidate_matches_found") or 0) == 0 or evidence.get("overall_status") == "CLEAN"

    if not is_clean:
        monitoring_text = (
            f"Our automated forensic monitoring detected visual correspondence to our official broadcast archive "
            f"(observed heuristic similarity score: {evidence['highest_confidence']}%, non-calibrated metric). "
            f"We recognize the creative vitality and community value of fan content, highlights, and secondary commentary, "
            f"and rather than issuing a standard copyright takedown, we would like to offer a direct monetization partnership."
        )
    else:
        monitoring_text = (
            f"Our monitoring system screened publication of content at this location. "
            f"Although automated analysis observed no confirmed fingerprint matches ({evidence['highest_confidence']}%), "
            f"we actively explore content licensing and distribution partnerships with emerging creators, "
            f"and would like to propose a direct commercial monetization framework."
        )

    subject = f"Commercial Content Partnership Proposal — {work_title or 'Official Broadcast'} / {recipient_name or 'Creator'}"

    creator_share = max(0.0, min(100.0, 100.0 - float(rev_share_pct)))

    body_template = f"""COMMERCIAL LICENSING & REVENUE-SHARING PROPOSAL (NON-BINDING OFFER)

Date: {datetime.now(timezone.utc).strftime('%B %d, %Y')}
To: {recipient_name or '[Channel Owner / Content Creator]'}
Email: {recipient_email or '[creator@domain.com]'}
From: {rep_name + ' on behalf of ' if rep_name else ''}{rights_holder or '[Rights Holder Organization]'}
Contact: {contact_email or '[partnerships@rightsholder.com]'}

Dear {recipient_name or 'Content Creator'},

We are reaching out on behalf of {rights_holder or '[Rights Holder Organization]'}, the official producer and rights-holder of "{work_title or '[Protected Work / Broadcast Series]'}".

We have observed audience engagement with your recent content publication at:
Location: {suspect_location}
Observed Media Reference: FixProof Forensic ID {evidence['incident_id'][:8]}

{monitoring_text}

PROPOSED COMMERCIAL PARTNERSHIP TERMS:
1. Rev-Share Allocation:
   - Rights Holder Allocation: {rev_share_pct}% of net platform advertising / sponsorship revenues.
   - Creator Allocation: {creator_share}% retained directly by your channel.
2. Official White-Listing:
   - Upon agreement, your publication will be officially white-listed against automated copyright claims for this specific segment.
3. Additional Commercial Scope:
   {commercial_terms or "- Standard digital distribution terms with transparent monthly revenue reporting."}
4. Discussion Window:
   - This preliminary licensing framework is open for review until {(datetime.now(timezone.utc)).strftime('%B %d, %Y')} (open for {response_deadline_days} days).

IMPORTANT NOTICE:
This communication represents a commercial invitation to negotiate and does not constitute a formal licensing contract, a waiver of any statutory rights, or an admission of liability. Heuristic similarity scores are not calibrated probabilities of copyright infringement. If you are interested in legalizing this broadcast and sharing ongoing revenue, please reply directly to {contact_email or '[email]'} to finalize terms.

We look forward to collaborating with your channel.

Sincerely,

{rep_name or rights_holder or '[Business Development Representative]'}
{rights_holder or '[Rights Holder Organization]'}
{contact_email or '[partnerships@rightsholder.com]'}
Forensic Record ID: {evidence['incident_id']}
"""

    ai_enhanced = False
    if use_ai_synthesis and os.getenv("NEBIUS_API_KEY"):
        try:
            client = get_openai_client()
            model_id = resolve_model_id()
            prompt = (
                f"You are a professional digital media partnership and licensing manager. "
                f"Polish this commercial revenue-sharing proposal email to make it professional, engaging, and collaborative. "
                f"CRITICAL RULES: Do NOT alter the revenue share percentages ({rev_share_pct}% / {creator_share}%), "
                f"do NOT claim an agreement has already been executed, and do NOT allege criminal liability.\n\n"
                f"DRAFT PROPOSAL:\n{body_template}"
            )
            resp = client.chat.completions.create(
                model=model_id,
                messages=[
                    {"role": "system", "content": "You are a professional digital media licensing manager."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=2500,
                temperature=0.2,
            )
            polished = resp.choices[0].message.content
            if polished and len(polished.strip()) > 200:
                body_template = polished.strip()
                ai_enhanced = True
        except Exception as e:
            logger.warning(f"[NemotronAction] AI commercial enhancement skipped due to: {e}")

    return {
        "document_id": str(uuid.uuid4()),
        "incident_id": evidence["incident_id"],
        "document_type": "REVENUE_SHARE_OFFER",
        "status": "READY_FOR_REVIEW" if not missing_fields else "INCOMPLETE_EVIDENCE",
        "subject": subject,
        "body": body_template,
        "facts_imported": evidence,
        "user_inputs": user_inputs,
        "missing_fields": missing_fields,
        "ai_enhanced": ai_enhanced,
        "model_id": DEFAULT_MODEL if ai_enhanced else "deterministic-template-v1.0",
        "declarations_required": [
            "I confirm that I am authorized to represent the rights holder in commercial licensing discussions.",
            "I understand that this proposal is an invitation to treat and not an executed contract.",
        ],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def send_nemotron_document_email(
    incident_id: str,
    document_type: str,
    recipient_email: str,
    subject: str,
    body: str,
    cc_emails: Optional[List[str]] = None,
    user_confirmed: bool = False,
    rights_declaration_confirmed: bool = False,
    client_session_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Executes validated server-side email delivery via Resend API.
    Enforces human review, declaration confirmation, and records minimal audit trail.
    """
    # 1. Validation Checks
    if not incident_id or not str(incident_id).strip():
        raise ValueError("Incident ID cannot be empty.")

    if document_type not in ("COPYRIGHT_NOTICE", "REVENUE_SHARE_OFFER"):
        raise ValueError(f"Invalid document type '{document_type}'. Must be COPYRIGHT_NOTICE or REVENUE_SHARE_OFFER.")

    if not user_confirmed:
        raise ValueError("Cannot send document: Explicit human review confirmation is required.")

    if document_type == "COPYRIGHT_NOTICE" and not rights_declaration_confirmed:
        raise ValueError("Cannot send copyright notice: Mandatory rights-holder legal declarations must be confirmed.")

    if not recipient_email or not EMAIL_REGEX.match(recipient_email.strip()):
        raise ValueError(f"Invalid recipient email address: '{recipient_email}'.")

    if not subject or not subject.strip():
        raise ValueError("Email subject cannot be empty.")

    if not body or not body.strip():
        raise ValueError("Email body cannot be empty.")

    # 2. Check Service Configuration
    configured, api_key, from_email = get_email_config()
    audit_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()

    if not configured:
        # Record unconfigured attempt in audit log
        save_email_audit_entry({
            "audit_id": audit_id,
            "timestamp": now_iso,
            "incident_id": incident_id,
            "document_type": document_type,
            "recipient_email": recipient_email,
            "subject": subject,
            "status": "NOT_CONFIGURED",
            "provider": "Resend",
            "delivery_id": None,
            "session_id": client_session_id,
            "error": "Email delivery service not configured. RESEND_API_KEY environment variable is absent or invalid.",
        })
        return {
            "success": False,
            "status": "NOT_CONFIGURED",
            "audit_id": audit_id,
            "message": "Email delivery is not configured on this server. Please set RESEND_API_KEY and FROM_EMAIL in the backend environment.",
        }

    # 3. Execute HTTP Dispatch to Resend API
    payload = {
        "from": from_email,
        "to": [recipient_email.strip()],
        "subject": subject.strip(),
        "text": body.strip(),
    }
    if cc_emails:
        valid_ccs = [c.strip() for c in cc_emails if c and EMAIL_REGEX.match(c.strip())]
        if valid_ccs:
            payload["cc"] = valid_ccs

    try:
        res = requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=15.0,
        )

        if res.status_code in (200, 201):
            data = res.json()
            delivery_id = data.get("id")
            save_email_audit_entry({
                "audit_id": audit_id,
                "timestamp": now_iso,
                "incident_id": incident_id,
                "document_type": document_type,
                "recipient_email": recipient_email,
                "subject": subject,
                "status": "DELIVERED",
                "provider": "Resend",
                "delivery_id": delivery_id,
                "session_id": client_session_id,
                "error": None,
            })
            return {
                "success": True,
                "status": "DELIVERED",
                "delivery_id": delivery_id,
                "audit_id": audit_id,
                "message": f"Document successfully dispatched to {recipient_email} via Resend.",
            }
        else:
            err_msg = f"HTTP {res.status_code}: {res.text}"
            save_email_audit_entry({
                "audit_id": audit_id,
                "timestamp": now_iso,
                "incident_id": incident_id,
                "document_type": document_type,
                "recipient_email": recipient_email,
                "subject": subject,
                "status": "FAILED",
                "provider": "Resend",
                "delivery_id": None,
                "session_id": client_session_id,
                "error": err_msg,
            })
            return {
                "success": False,
                "status": "FAILED",
                "audit_id": audit_id,
                "message": f"Resend API rejected delivery: {err_msg}",
            }

    except Exception as e:
        err_str = str(e)
        logger.error(f"[NemotronAction] Exception dispatching email via Resend: {err_str}")
        save_email_audit_entry({
            "audit_id": audit_id,
            "timestamp": now_iso,
            "incident_id": incident_id,
            "document_type": document_type,
            "recipient_email": recipient_email,
            "subject": subject,
            "status": "FAILED",
            "provider": "Resend",
            "delivery_id": None,
            "session_id": client_session_id,
            "error": err_str,
        })
        return {
            "success": False,
            "status": "FAILED",
            "audit_id": audit_id,
            "message": f"Network error during email dispatch: {err_str}",
        }
