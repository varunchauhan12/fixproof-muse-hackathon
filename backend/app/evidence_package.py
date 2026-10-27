"""
FixProof Phase 1.5: Cryptographic Evidence Package & Chain of Custody System.

Provides:
1. Ed25519 digital signature generation and verification.
2. Canonical JSON serialization (deterministic, RFC 8785 aligned).
3. Hash-linked Chain-of-Custody record generation.
4. Professional human-readable PDF evidence summary generation via ReportLab.
5. In-memory ZIP evidence package builder (manifest, reports, chain, pdf, sig, public key, readme).
6. Comprehensive evidence package verifier (signature, payload SHA-256 hashes, chain links, zip-slip defense).
"""

from datetime import datetime, timezone
import hashlib
import io
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
import uuid
import zipfile

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

logger = logging.getLogger(__name__)

PACKAGE_SCHEMA_VERSION = "1.0.0"
GENESIS_PREV_HASH = "0" * 64
MAX_VERIFICATION_ZIP_BYTES = 50 * 1024 * 1024  # 50 MB zip bomb limit
MAX_VERIFICATION_EXTRACTED_BYTES = 100 * 1024 * 1024  # 100 MB uncompressed limit


class SigningConfigurationError(Exception):
    """Raised when cryptographic signing key is missing or misconfigured and required."""
    pass


class PackageVerificationError(Exception):
    """Raised when package structure or safety verification fails."""
    pass


# ─── Canonicalization & Hashing ───────────────────────────────────────────────

def canonicalize_json(data: Any) -> bytes:
    """
    Deterministic JSON canonicalization.
    Sorts dictionary keys, strips unnecessary whitespace, and forces UTF-8 encoding.
    """
    return json.dumps(
        data,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    """Computes hexadecimal SHA-256 digest of bytes."""
    return hashlib.sha256(data).hexdigest()


# ─── Key Management ───────────────────────────────────────────────────────────

def get_signing_key() -> Tuple[ed25519.Ed25519PrivateKey, str, bool]:
    """
    Resolves the Ed25519 private key from environment or creates a development key.
    Returns: (private_key, key_id, is_dev_key)
    """
    key_hex = os.getenv("FIXPROOF_SIGNING_KEY_HEX", "").strip()
    key_pem = os.getenv("FIXPROOF_SIGNING_KEY_PEM", "").strip()
    key_path = os.getenv("FIXPROOF_SIGNING_KEY_PATH", "").strip()
    custom_key_id = os.getenv("FIXPROOF_SIGNING_KEY_ID", "").strip()
    require_configured = os.getenv("FIXPROOF_REQUIRE_CONFIGURED_SIGNING_KEY", "false").lower() == "true"

    if key_hex:
        try:
            seed_bytes = bytes.fromhex(key_hex)
            if len(seed_bytes) != 32:
                raise ValueError(f"Hex key must be exactly 32 bytes (64 hex characters), got {len(seed_bytes)} bytes.")
            priv = ed25519.Ed25519PrivateKey.from_private_bytes(seed_bytes)
            key_id = custom_key_id or f"ed25519:{sha256_bytes(priv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))[:16]}"
            return priv, key_id, False
        except Exception as e:
            raise SigningConfigurationError(f"Invalid FIXPROOF_SIGNING_KEY_HEX: {e}")

    if key_pem:
        try:
            priv = serialization.load_pem_private_key(key_pem.encode("utf-8"), password=None)
            if not isinstance(priv, ed25519.Ed25519PrivateKey):
                raise ValueError("Configured PEM key is not an Ed25519 private key.")
            key_id = custom_key_id or f"ed25519:{sha256_bytes(priv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))[:16]}"
            return priv, key_id, False
        except Exception as e:
            raise SigningConfigurationError(f"Invalid FIXPROOF_SIGNING_KEY_PEM: {e}")

    if key_path and os.path.exists(key_path):
        try:
            with open(key_path, "rb") as f:
                content = f.read()
            priv = serialization.load_pem_private_key(content, password=None)
            if not isinstance(priv, ed25519.Ed25519PrivateKey):
                raise ValueError("File key is not an Ed25519 private key.")
            key_id = custom_key_id or f"ed25519:{sha256_bytes(priv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))[:16]}"
            return priv, key_id, False
        except Exception as e:
            raise SigningConfigurationError(f"Failed to load key from FIXPROOF_SIGNING_KEY_PATH ({key_path}): {e}")

    if require_configured:
        raise SigningConfigurationError(
            "Cryptographic signing key is not configured. "
            "Set FIXPROOF_SIGNING_KEY_HEX or FIXPROOF_SIGNING_KEY_PEM."
        )

    # Ephemeral dev key
    logger.warning("[Crypto] Generating ephemeral Ed25519 signing key for local development export.")
    priv = ed25519.Ed25519PrivateKey.generate()
    pub_raw = priv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    key_id = f"ed25519:dev-{sha256_bytes(pub_raw)[:12]}"
    return priv, key_id, True


def export_public_key_pem(private_key: ed25519.Ed25519PrivateKey) -> bytes:
    """Exports public key in standard SubjectPublicKeyInfo PEM format."""
    return private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )


# ─── Chain of Custody ─────────────────────────────────────────────────────────

def build_chain_of_custody(
    incident: Dict[str, Any],
    reports: List[Dict[str, Any]],
    exported_at: str,
    package_id: str,
) -> List[Dict[str, Any]]:
    """
    Builds a hash-linked, chronological chain-of-custody log.
    Every entry includes its own hash and the previous entry's hash.
    """
    entries: List[Dict[str, Any]] = []

    # Sequence 0: Incident registration / detection event
    created_at = incident.get("created_at") or incident.get("detection_timestamp") or exported_at
    genesis_entry = {
        "sequence": 0,
        "timestamp": str(created_at),
        "event_type": "INCIDENT_REGISTERED",
        "actor": "FixProof Automated Forensic System",
        "incident_id": str(incident.get("incident_id")),
        "details": {
            "target_asset_id": str(incident.get("target_asset_id") or "UNKNOWN"),
            "matched_frames_count": len(incident.get("frame_matches") or []),
            "suspect_metadata": incident.get("suspect_metadata") or {},
        },
        "evidence_references": [
            f"frame_match_{i}" for i, _ in enumerate(incident.get("frame_matches") or [])
        ],
        "prev_hash": GENESIS_PREV_HASH,
    }
    genesis_entry["entry_hash"] = sha256_bytes(canonicalize_json(genesis_entry))
    entries.append(genesis_entry)

    # Sequence 1..N: Investigation reports (ordered chronologically, oldest to newest for audit timeline)
    sorted_reports = list(reports)
    def _get_ts(r: Dict[str, Any]) -> str:
        return str(r.get("created_at") or (r.get("operational_metadata") or {}).get("created_at") or "")
    sorted_reports.sort(key=_get_ts)

    for idx, rep in enumerate(sorted_reports, start=1):
        prev_entry_hash = entries[-1]["entry_hash"]
        rep_ts = _get_ts(rep) or exported_at
        op_meta = rep.get("operational_metadata") or {}
        val_status = op_meta.get("validation_status") or rep.get("validation_status") or "VALIDATED"

        rep_entry = {
            "sequence": idx,
            "timestamp": rep_ts,
            "event_type": "INVESTIGATION_REPORT_SAVED",
            "actor": f"Nemotron Forensic Engine ({rep.get('model_id') or 'nvidia/Nemotron-3_5-Lightning'})",
            "incident_id": str(incident.get("incident_id")),
            "report_id": str(rep.get("report_id")),
            "details": {
                "model_id": str(rep.get("model_id")),
                "validation_status": str(val_status),
                "recommended_action": str(rep.get("recommended_action") or "NEEDS_FULL_VIDEO_REVIEW"),
                "confidence_assessment": str(rep.get("confidence_assessment") or "INCONCLUSIVE_DATA"),
                "human_review_required": bool(rep.get("human_review_required", False)),
                "intervals_count": len(rep.get("timeline_intervals") or []),
                "findings_count": len(rep.get("findings") or []),
            },
            "evidence_references": list(rep.get("evidence_references") or []),
            "prev_hash": prev_entry_hash,
        }
        rep_entry["entry_hash"] = sha256_bytes(canonicalize_json(rep_entry))
        entries.append(rep_entry)

    # Sequence N+1: Evidence Package Export Event
    terminal_entry = {
        "sequence": len(entries),
        "timestamp": exported_at,
        "event_type": "EVIDENCE_PACKAGE_EXPORTED",
        "actor": "FixProof Custody Export Service",
        "incident_id": str(incident.get("incident_id")),
        "details": {
            "package_id": package_id,
            "total_reports_packaged": len(reports),
            "export_schema_version": PACKAGE_SCHEMA_VERSION,
        },
        "evidence_references": [],
        "prev_hash": entries[-1]["entry_hash"],
    }
    terminal_entry["entry_hash"] = sha256_bytes(canonicalize_json(terminal_entry))
    entries.append(terminal_entry)

    return entries


def verify_chain_of_custody(chain: List[Dict[str, Any]], expected_head_hash: Optional[str] = None) -> Tuple[bool, List[str]]:
    """
    Validates sequential integrity, prev_hash links, and entry_hash signatures of a chain of custody.
    Returns (is_valid, error_messages).
    """
    errors: List[str] = []
    if not chain or not isinstance(chain, list):
        return False, ["Chain of custody is empty or not a list."]

    # Verify genesis entry
    genesis = chain[0]
    if genesis.get("sequence") != 0:
        errors.append(f"Genesis sequence must be 0, found {genesis.get('sequence')}.")
    if genesis.get("prev_hash") != GENESIS_PREV_HASH:
        errors.append(f"Genesis prev_hash must be {GENESIS_PREV_HASH}, found {genesis.get('prev_hash')}.")

    for i, entry in enumerate(chain):
        # Check sequence continuity
        if entry.get("sequence") != i:
            errors.append(f"Chain sequence broken at index {i}: expected sequence {i}, got {entry.get('sequence')}.")

        # Check prev_hash link
        if i > 0:
            expected_prev = chain[i - 1].get("entry_hash")
            actual_prev = entry.get("prev_hash")
            if actual_prev != expected_prev:
                errors.append(
                    f"Chain link broken at sequence {i}: prev_hash ({actual_prev}) "
                    f"does not match sequence {i-1} entry_hash ({expected_prev})."
                )

        # Verify entry_hash
        stored_hash = entry.get("entry_hash")
        copy_entry = dict(entry)
        copy_entry.pop("entry_hash", None)
        computed_hash = sha256_bytes(canonicalize_json(copy_entry))
        if stored_hash != computed_hash:
            errors.append(
                f"Entry hash mismatch at sequence {i}: stored {stored_hash}, computed {computed_hash}."
            )

    # Check terminal head hash if specified
    if expected_head_hash and chain:
        actual_head = chain[-1].get("entry_hash")
        if actual_head != expected_head_hash:
            errors.append(f"Chain head hash mismatch: manifest has {expected_head_hash}, chain ends with {actual_head}.")

    return len(errors) == 0, errors


# ─── Human-Readable PDF Generation ───────────────────────────────────────────

def generate_evidence_summary_pdf(
    incident: Dict[str, Any],
    reports: List[Dict[str, Any]],
    chain: List[Dict[str, Any]],
    manifest: Dict[str, Any],
) -> bytes:
    """
    Generates a professionally formatted, human-readable forensic summary PDF
    using ReportLab, covering incident metadata, investigation versions, findings,
    timeline intervals, chain of custody, and legal disclaimers.
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=40,
        leftMargin=40,
        topMargin=40,
        bottomMargin=40,
    )

    styles = getSampleStyleSheet()

    # Custom typography
    title_style = ParagraphStyle(
        "DocTitle",
        parent=styles["Heading1"],
        fontSize=18,
        leading=22,
        textColor=colors.HexColor("#090d16"),
        fontName="Helvetica-Bold",
        spaceAfter=4,
    )
    subtitle_style = ParagraphStyle(
        "DocSubtitle",
        parent=styles["Normal"],
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#475569"),
        spaceAfter=12,
    )
    h2_style = ParagraphStyle(
        "SectionH2",
        parent=styles["Heading2"],
        fontSize=12,
        leading=16,
        textColor=colors.HexColor("#0f172a"),
        fontName="Helvetica-Bold",
        spaceBefore=10,
        spaceAfter=6,
    )
    body_style = ParagraphStyle(
        "BodyDark",
        parent=styles["Normal"],
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#1e293b"),
    )
    code_style = ParagraphStyle(
        "CodeText",
        parent=styles["Normal"],
        fontSize=7.5,
        leading=9.5,
        fontName="Courier",
        textColor=colors.HexColor("#0f172a"),
    )
    disclaimer_style = ParagraphStyle(
        "LegalDisclaimer",
        parent=styles["Normal"],
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#475569"),
        fontName="Helvetica-Oblique",
    )

    elements: List[Any] = []

    # Title & Metadata Banner
    elements.append(Paragraph("FIXPROOF FORENSIC EVIDENCE PACKAGE", title_style))
    elements.append(Paragraph("Cryptographically Signed Investigation Audit & Chain of Custody", subtitle_style))
    elements.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#0284c7"), spaceAfter=12))

    # Package Metadata Table
    pkg_id = manifest.get("package_id", "N/A")
    inc_id = incident.get("incident_id", "N/A")
    exp_at = manifest.get("exported_at", "N/A")
    key_id = manifest.get("signing_key_id", "N/A")
    algo = manifest.get("signature_algorithm", "Ed25519")

    meta_table_data = [
        [
            Paragraph("<b>Package ID:</b>", body_style),
            Paragraph(f"<font name='Courier'>{pkg_id}</font>", body_style),
            Paragraph("<b>Exported (UTC):</b>", body_style),
            Paragraph(exp_at, body_style),
        ],
        [
            Paragraph("<b>Incident ID:</b>", body_style),
            Paragraph(f"<font name='Courier'>{inc_id}</font>", body_style),
            Paragraph("<b>Signing Algorithm:</b>", body_style),
            Paragraph(algo, body_style),
        ],
        [
            Paragraph("<b>Signing Key ID:</b>", body_style),
            Paragraph(f"<font name='Courier'>{key_id}</font>", body_style),
            Paragraph("<b>Total Reports:</b>", body_style),
            Paragraph(str(len(reports)), body_style),
        ],
    ]
    meta_table = Table(meta_table_data, colWidths=[1.3 * inch, 2.5 * inch, 1.4 * inch, 1.8 * inch])
    meta_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ])
    )
    elements.append(meta_table)
    elements.append(Spacer(1, 14))

    # Section 1: Subject Incident & Media Verification
    elements.append(Paragraph("1. Incident Evidence Overview", h2_style))
    target_asset = (
        incident.get("target_asset_id")
        or incident.get("submitted_asset_id")
        or incident.get("incident_id")
        or "N/A"
    )
    matches = incident.get("frame_matches") or []
    confirmed_matches = sum(1 for f in matches if (f.get("best_match") or {}).get("match_confirmed"))

    inc_table_data = [
        [
            Paragraph("Target Asset ID", body_style),
            Paragraph(f"<font name='Courier'>{target_asset}</font>", body_style),
        ],
        [
            Paragraph("Total Scanned Frames", body_style),
            Paragraph(str(len(matches)), body_style),
        ],
        [
            Paragraph("Confirmed Matching Frames", body_style),
            Paragraph(f"<b>{confirmed_matches}</b> frames (Hamming & Cosine Verified)", body_style),
        ],
    ]
    inc_table = Table(inc_table_data, colWidths=[2.2 * inch, 4.8 * inch])
    inc_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ])
    )
    elements.append(inc_table)
    elements.append(Spacer(1, 14))

    # Section 2: Investigation Reports Inventory
    elements.append(Paragraph("2. Investigation Report History (Newest to Oldest)", h2_style))
    if not reports:
        elements.append(Paragraph("<i>No AI investigation reports generated for this incident prior to package export.</i>", body_style))
    else:
        rep_headers = ["Report ID", "Timestamp (UTC)", "Validation", "Recommended Action", "Confidence"]
        rep_rows = [rep_headers]
        for rep in reports:
            op_meta = rep.get("operational_metadata") or {}
            val = op_meta.get("validation_status") or rep.get("validation_status") or "VALIDATED"
            ts = rep.get("created_at") or op_meta.get("created_at") or "N/A"
            action = rep.get("recommended_action") or "REVIEW"
            conf = rep.get("confidence_assessment") or "INCONCLUSIVE"
            rid = str(rep.get("report_id", ""))[:18]

            rep_rows.append([
                Paragraph(f"<font name='Courier'>{rid}...</font>", code_style),
                Paragraph(ts[:19], body_style),
                Paragraph(f"<b>{val}</b>", body_style),
                Paragraph(action, body_style),
                Paragraph(conf, body_style),
            ])

        rep_table = Table(rep_rows, colWidths=[1.8 * inch, 1.4 * inch, 1.2 * inch, 1.3 * inch, 1.3 * inch])
        rep_table.setStyle(
            TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ])
        )
        elements.append(rep_table)
    elements.append(Spacer(1, 14))

    # Section 3: Detailed Findings of Latest Investigation Report
    if reports:
        latest = reports[0]
        elements.append(Paragraph("3. Latest Investigation Findings & Legal Triage Details", h2_style))
        summary_text = latest.get("summary") or "No executive summary provided."
        elements.append(Paragraph(f"<b>Executive Summary:</b> {summary_text}", body_style))
        elements.append(Spacer(1, 6))

        # Intervals
        intervals = latest.get("timeline_intervals") or []
        if intervals:
            elements.append(Paragraph(f"<b>Synthesized Source Timeline Intervals ({len(intervals)}):</b>", body_style))
            int_rows = [["Interval ID", "Suspect Range", "Asset Match Range", "Duration", "Confidence"]]
            for intv in intervals[:5]:  # Show up to 5 intervals in summary
                dur = intv.get("duration_sec") if intv.get("duration_sec") is not None else intv.get("duration_seconds", 0)
                s_start = intv.get("suspect_start_sec") if intv.get("suspect_start_sec") is not None else intv.get("suspect_start_seconds", 0)
                s_end = intv.get("suspect_end_sec") if intv.get("suspect_end_sec") is not None else intv.get("suspect_end_seconds", 0)
                ref_start = intv.get("source_start_sec") if intv.get("source_start_sec") is not None else intv.get("source_asset_start_seconds", 0)
                ref_end = intv.get("source_end_sec") if intv.get("source_end_sec") is not None else intv.get("source_asset_end_seconds", 0)
                conf_val = intv.get("continuity_status") or intv.get("confidence") or "CONTINUOUS_MATCH"
                int_rows.append([
                    Paragraph(str(intv.get("interval_id", "")), code_style),
                    Paragraph(f"{s_start:.1f}s - {s_end:.1f}s", body_style),
                    Paragraph(f"{ref_start:.1f}s - {ref_end:.1f}s", body_style),
                    Paragraph(f"{dur:.1f}s", body_style),
                    Paragraph(str(conf_val), body_style),
                ])
            int_table = Table(int_rows, colWidths=[1.5 * inch, 1.5 * inch, 1.5 * inch, 1.0 * inch, 1.5 * inch])
            int_table.setStyle(
                TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0")),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ])
            )
            elements.append(int_table)
            elements.append(Spacer(1, 6))

        # Findings
        findings = latest.get("findings") or []
        if findings:
            elements.append(Paragraph(f"<b>Forensic Findings ({len(findings)}):</b>", body_style))
            for f in findings[:6]:
                ftitle = f.get("title") or f.get("category") or "Finding"
                fdesc = f.get("description") or f.get("statement") or ""
                elements.append(Paragraph(f"• <b>{ftitle}:</b> {fdesc}", body_style))
                elements.append(Spacer(1, 2))

    elements.append(Spacer(1, 10))

    # Section 4: Chain of Custody Audit Log
    elements.append(Paragraph("4. Chain of Custody Ledger", h2_style))
    chain_rows = [["Seq", "Timestamp (UTC)", "Event Type", "Entry Hash (SHA-256)"]]
    for item in chain:
        seq = str(item.get("sequence", 0))
        ts = str(item.get("timestamp", ""))[:19]
        etype = str(item.get("event_type", ""))
        ehash = str(item.get("entry_hash", ""))[:20] + "..."
        chain_rows.append([
            Paragraph(seq, body_style),
            Paragraph(ts, body_style),
            Paragraph(etype, body_style),
            Paragraph(f"<font name='Courier'>{ehash}</font>", code_style),
        ])

    chain_table = Table(chain_rows, colWidths=[0.5 * inch, 1.7 * inch, 2.2 * inch, 2.6 * inch])
    chain_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e293b")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ])
    )
    elements.append(chain_table)
    elements.append(Spacer(1, 14))

    # Section 5: Legal & Forensic Attestation
    elements.append(
        Paragraph("5. Forensic Attestation & Legal Limitation Notice", h2_style)
    )
    legal_notice = (
        "<b>LEGAL & FORENSIC ATTESTATION:</b> This package preserves and cryptographically verifies the "
        "integrity of FixProof forensic investigation records using an Ed25519 digital signature. "
        "Signature and hash verification proves that the enclosed files have not been modified, replaced, "
        "or tampered with since package creation relative to the designated public key. "
        "This attestation DOES NOT independently establish copyright ownership, statutory infringement, "
        "authenticity of the original media source, or admissibility under specific court jurisdictions. "
        "All recommendations are decision-support outputs produced by an automated AI reasoning model and "
        "require independent human legal review prior to formal enforcement or court filing."
    )
    notice_table = Table(
        [[Paragraph(legal_notice, disclaimer_style)]],
        colWidths=[7.0 * inch],
    )
    notice_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f1f5f9")),
            ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#94a3b8")),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ])
    )
    elements.append(notice_table)

    doc.build(elements)
    return buffer.getvalue()


# ─── Readme Generation ────────────────────────────────────────────────────────

def generate_package_readme(package_id: str, incident_id: str, exported_at: str, key_id: str) -> str:
    """Generates the README.txt with independent verification instructions."""
    return f"""================================================================================
FIXPROOF FORENSIC EVIDENCE PACKAGE
================================================================================
Package ID:       {package_id}
Incident ID:      {incident_id}
Exported (UTC):   {exported_at}
Signing Key ID:   {key_id}
Signature Algo:   Ed25519 (PureEdDSA, RFC 8032)
================================================================================

PACKAGE CONTENTS:
1. manifest.json           - Cryptographically signed manifest containing package metadata,
                             report inventory, chain head hash, and file inventory with SHA-256 digests.
2. manifest.sig            - Ed25519 binary digital signature over canonicalized manifest.json.
3. public_key.pem          - Ed25519 public key in SubjectPublicKeyInfo PEM format.
4. chain_of_custody.json   - Hash-linked chronological ledger of all detection, investigation,
                             and export events.
5. summary.pdf             - Human-readable forensic summary report.
6. reports/                - Full JSON snapshots of each investigation report on record.
7. README.txt              - This file.

INDEPENDENT VERIFICATION INSTRUCTIONS:
-------------------------------------
You can verify the cryptographic authenticity and integrity of this package
independently using Python 3 and the 'cryptography' library:

1. Verify the digital signature on manifest.json:
   python3 -c "
   import json
   from cryptography.hazmat.primitives.asymmetric import ed25519
   from cryptography.hazmat.primitives import serialization

   with open('public_key.pem', 'rb') as f:
       pub = serialization.load_pem_public_key(f.read())
   with open('manifest.json', 'r') as f:
       manifest = json.load(f)
   canonical = json.dumps(manifest, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('utf-8')
   with open('manifest.sig', 'rb') as f:
       sig = f.read()
   pub.verify(sig, canonical)
   print('SUCCESS: Ed25519 manifest signature is cryptographically valid.')
   "

2. Verify file payload SHA-256 hashes:
   python3 -c "
   import hashlib, json
   with open('manifest.json', 'r') as f:
       manifest = json.load(f)
   for rel_path, meta in manifest['file_inventory'].items():
       with open(rel_path, 'rb') as f:
           digest = hashlib.sha256(f.read()).hexdigest()
       assert digest == meta['sha256'], f'Hash mismatch on {{rel_path}}!'
   print('SUCCESS: All payload file hashes match the signed manifest inventory.')
   "

LEGAL NOTICE:
-------------
Verification proves that the enclosed files have not been modified, replaced, or
tampered with since package creation relative to the designated public key.
It does not constitute a judicial ruling on legal infringement or video authenticity.
"""


# ─── Evidence Package Builder ─────────────────────────────────────────────────

def create_evidence_package(
    incident: Dict[str, Any],
    reports: List[Dict[str, Any]],
    signing_key: Optional[ed25519.Ed25519PrivateKey] = None,
    key_id: Optional[str] = None,
) -> Tuple[bytes, Dict[str, Any]]:
    """
    Assembles a complete signed evidence package in memory as a ZIP file.
    Returns: (zip_bytes, manifest_dict)
    """
    incident_id = str(incident.get("incident_id"))
    package_id = f"pkg_{uuid.uuid4().hex}"
    exported_at = datetime.now(timezone.utc).isoformat()

    # 1. Resolve signing key
    if signing_key is None:
        priv_key, derived_key_id, _ = get_signing_key()
    else:
        priv_key = signing_key
        derived_key_id = key_id or "ed25519:custom"

    final_key_id = key_id or derived_key_id

    # 2. Strict incident isolation: filter reports to only those belonging to this incident
    filtered_reports = [r for r in reports if str(r.get("incident_id")) == incident_id]
    # Sort newest first for report inventory
    def _get_ts(r: Dict[str, Any]) -> str:
        return str(r.get("created_at") or (r.get("operational_metadata") or {}).get("created_at") or "")
    filtered_reports.sort(key=_get_ts, reverse=True)

    # 3. Build chain of custody
    chain = build_chain_of_custody(incident, filtered_reports, exported_at, package_id)
    chain_bytes = json.dumps(chain, indent=2, sort_keys=True).encode("utf-8")
    chain_head_hash = chain[-1]["entry_hash"] if chain else GENESIS_PREV_HASH

    # 4. Prepare public key & readme
    public_key_pem_bytes = export_public_key_pem(priv_key)
    readme_text = generate_package_readme(package_id, incident_id, exported_at, final_key_id)
    readme_bytes = readme_text.encode("utf-8")

    # 5. Build report snapshots
    report_files: Dict[str, bytes] = {}
    report_inventory: List[Dict[str, Any]] = []

    for rep in filtered_reports:
        rid = str(rep.get("report_id"))
        rel_path = f"reports/{rid}.json"
        rep_bytes = json.dumps(rep, indent=2, sort_keys=True).encode("utf-8")
        report_files[rel_path] = rep_bytes

        op_meta = rep.get("operational_metadata") or {}
        val_status = op_meta.get("validation_status") or rep.get("validation_status") or "VALIDATED"

        report_inventory.append({
            "report_id": rid,
            "created_at": _get_ts(rep),
            "model_id": str(rep.get("model_id") or "nvidia/Nemotron-3_5-Lightning"),
            "validation_status": str(val_status),
            "recommended_action": str(rep.get("recommended_action") or "NEEDS_FULL_VIDEO_REVIEW"),
            "confidence_assessment": str(rep.get("confidence_assessment") or "INCONCLUSIVE_DATA"),
            "relative_path": rel_path,
            "sha256": sha256_bytes(rep_bytes),
        })

    # Temporary manifest to pass into PDF generator
    temp_manifest = {
        "package_id": package_id,
        "incident_id": incident_id,
        "exported_at": exported_at,
        "signing_key_id": final_key_id,
        "signature_algorithm": "Ed25519",
    }

    # 6. Generate summary PDF
    try:
        pdf_bytes = generate_evidence_summary_pdf(incident, filtered_reports, chain, temp_manifest)
    except Exception as e:
        logger.error(f"[EvidencePackage] PDF generation failed, creating fallback summary text: {e}")
        pdf_bytes = b"%PDF-1.4 Fallback summary: " + str(e).encode("utf-8")

    # 7. Build file inventory (excluding manifest.json and manifest.sig to avoid circular dependency)
    file_inventory: Dict[str, Dict[str, Any]] = {
        "public_key.pem": {
            "size_bytes": len(public_key_pem_bytes),
            "sha256": sha256_bytes(public_key_pem_bytes),
        },
        "chain_of_custody.json": {
            "size_bytes": len(chain_bytes),
            "sha256": sha256_bytes(chain_bytes),
        },
        "summary.pdf": {
            "size_bytes": len(pdf_bytes),
            "sha256": sha256_bytes(pdf_bytes),
        },
        "README.txt": {
            "size_bytes": len(readme_bytes),
            "sha256": sha256_bytes(readme_bytes),
        },
    }

    for rel_path, rbytes in report_files.items():
        file_inventory[rel_path] = {
            "size_bytes": len(rbytes),
            "sha256": sha256_bytes(rbytes),
        }

    # 8. Assemble canonical manifest and sign it
    manifest: Dict[str, Any] = {
        "package_schema_version": PACKAGE_SCHEMA_VERSION,
        "package_id": package_id,
        "incident_id": incident_id,
        "exported_at": exported_at,
        "signing_key_id": final_key_id,
        "signature_algorithm": "Ed25519",
        "chain_head_hash": chain_head_hash,
        "report_inventory": report_inventory,
        "file_inventory": file_inventory,
    }

    canonical_manifest_bytes = canonicalize_json(manifest)
    signature_bytes = priv_key.sign(canonical_manifest_bytes)
    manifest_bytes = json.dumps(manifest, indent=2, sort_keys=True).encode("utf-8")

    # 9. Pack into ZIP in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", manifest_bytes)
        zf.writestr("manifest.sig", signature_bytes)
        zf.writestr("public_key.pem", public_key_pem_bytes)
        zf.writestr("chain_of_custody.json", chain_bytes)
        zf.writestr("summary.pdf", pdf_bytes)
        zf.writestr("README.txt", readme_bytes)
        for rel_path, rbytes in report_files.items():
            zf.writestr(rel_path, rbytes)

    return zip_buffer.getvalue(), manifest


# ─── Evidence Package Verifier ────────────────────────────────────────────────

def verify_evidence_package(zip_input: Union[bytes, io.BytesIO]) -> Dict[str, Any]:
    """
    Cryptographically verifies an evidence package ZIP.
    Checks:
    1. Safe ZIP extraction (no path traversal, size limits).
    2. Manifest signature against public_key.pem via Ed25519.
    3. Payload file SHA-256 digests against file_inventory.
    4. Completeness: no missing or extra unauthorized files in ZIP.
    5. Chain-of-custody hash linkage and sequence integrity.
    """
    errors: List[str] = []
    warnings: List[str] = []

    if isinstance(zip_input, bytes):
        if len(zip_input) > MAX_VERIFICATION_ZIP_BYTES:
            raise PackageVerificationError(
                f"Package exceeds maximum allowed size ({len(zip_input)} > {MAX_VERIFICATION_ZIP_BYTES} bytes)."
            )
        zip_stream = io.BytesIO(zip_input)
    else:
        zip_stream = zip_input

    try:
        zf = zipfile.ZipFile(zip_stream, mode="r")
    except Exception as e:
        return {
            "valid": False,
            "signature_verified": False,
            "payload_integrity_verified": False,
            "chain_of_custody_verified": False,
            "errors": [f"Invalid or corrupted ZIP archive: {e}"],
            "verified_at": datetime.now(timezone.utc).isoformat(),
        }

    # Inspect filenames and guard against ZipSlip / directory traversal
    namelist = zf.namelist()
    total_uncompressed = 0
    for name in namelist:
        if name.startswith("/") or name.startswith("\\") or ".." in name:
            return {
                "valid": False,
                "signature_verified": False,
                "payload_integrity_verified": False,
                "chain_of_custody_verified": False,
                "errors": [f"Security violation: path traversal detected in file '{name}'."],
                "verified_at": datetime.now(timezone.utc).isoformat(),
            }
        info = zf.getinfo(name)
        total_uncompressed += info.file_size
        if total_uncompressed > MAX_VERIFICATION_EXTRACTED_BYTES:
            return {
                "valid": False,
                "signature_verified": False,
                "payload_integrity_verified": False,
                "chain_of_custody_verified": False,
                "errors": ["Security violation: uncompressed archive size exceeds limit (possible zip bomb)."],
                "verified_at": datetime.now(timezone.utc).isoformat(),
            }

    # Check mandatory files
    for req in ("manifest.json", "manifest.sig", "public_key.pem", "chain_of_custody.json"):
        if req not in namelist:
            errors.append(f"Missing mandatory package file '{req}'.")

    if errors:
        return {
            "valid": False,
            "signature_verified": False,
            "payload_integrity_verified": False,
            "chain_of_custody_verified": False,
            "errors": errors,
            "verified_at": datetime.now(timezone.utc).isoformat(),
        }

    # Read manifest, sig, and public key
    try:
        manifest_raw = zf.read("manifest.json")
        manifest = json.loads(manifest_raw.decode("utf-8"))
    except Exception as e:
        return {
            "valid": False,
            "signature_verified": False,
            "payload_integrity_verified": False,
            "chain_of_custody_verified": False,
            "errors": [f"Failed to parse manifest.json: {e}"],
            "verified_at": datetime.now(timezone.utc).isoformat(),
        }

    sig_bytes = zf.read("manifest.sig")
    pub_pem_bytes = zf.read("public_key.pem")

    # 1. Verify Ed25519 signature
    signature_verified = False
    try:
        pub_key = serialization.load_pem_public_key(pub_pem_bytes)
        if not isinstance(pub_key, ed25519.Ed25519PublicKey):
            errors.append("Public key in package is not an Ed25519 public key.")
        else:
            canonical_bytes = canonicalize_json(manifest)
            pub_key.verify(sig_bytes, canonical_bytes)
            signature_verified = True
    except InvalidSignature:
        errors.append("Ed25519 signature verification failed: manifest has been modified or signature is invalid.")
    except Exception as e:
        errors.append(f"Public key loading or signature verification failed: {e}")

    # 2. Verify payload file inventory and SHA-256 digests
    payload_integrity_verified = False
    file_inventory = manifest.get("file_inventory") or {}
    accounted_files = {"manifest.json", "manifest.sig"}

    file_errors = []
    for rel_path, meta in file_inventory.items():
        accounted_files.add(rel_path)
        if rel_path not in namelist:
            file_errors.append(f"Inventory file missing from archive: '{rel_path}'.")
            continue

        actual_bytes = zf.read(rel_path)
        actual_hash = sha256_bytes(actual_bytes)
        expected_hash = meta.get("sha256")
        if actual_hash != expected_hash:
            file_errors.append(
                f"SHA-256 mismatch for '{rel_path}': expected {expected_hash}, computed {actual_hash}."
            )

        expected_size = meta.get("size_bytes")
        if len(actual_bytes) != expected_size:
            file_errors.append(
                f"Size mismatch for '{rel_path}': expected {expected_size} bytes, got {len(actual_bytes)} bytes."
            )

    # Check for unindexed rogue files in zip
    for name in namelist:
        # Ignore directory entries
        if name.endswith("/"):
            continue
        if name not in accounted_files:
            file_errors.append(f"Archive contains unverified file not listed in manifest: '{name}'.")

    if not file_errors:
        payload_integrity_verified = True
    else:
        errors.extend(file_errors)

    # 3. Verify Chain of Custody
    chain_of_custody_verified = False
    try:
        chain_raw = zf.read("chain_of_custody.json")
        chain = json.loads(chain_raw.decode("utf-8"))
        chain_valid, chain_errs = verify_chain_of_custody(chain, manifest.get("chain_head_hash"))
        if chain_valid:
            chain_of_custody_verified = True
        else:
            errors.extend(chain_errs)
    except Exception as e:
        errors.append(f"Failed to read or verify chain_of_custody.json: {e}")

    is_overall_valid = (
        signature_verified
        and payload_integrity_verified
        and chain_of_custody_verified
        and len(errors) == 0
    )

    return {
        "valid": is_overall_valid,
        "package_id": manifest.get("package_id"),
        "incident_id": manifest.get("incident_id"),
        "exported_at": manifest.get("exported_at"),
        "signing_key_id": manifest.get("signing_key_id"),
        "signature_algorithm": manifest.get("signature_algorithm", "Ed25519"),
        "signature_verified": signature_verified,
        "payload_integrity_verified": payload_integrity_verified,
        "chain_of_custody_verified": chain_of_custody_verified,
        "total_reports": len(manifest.get("report_inventory") or []),
        "file_count": len(file_inventory),
        "errors": errors,
        "warnings": warnings,
        "verified_at": datetime.now(timezone.utc).isoformat(),
    }
