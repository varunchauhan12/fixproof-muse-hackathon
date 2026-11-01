#!/usr/bin/env python3
"""
FixProof Meta — Authorized Incident SAM 3.1 Grounding Reprocessor
Re-runs SAM 3.1 visual grounding for incident candidate keyframes,
attaches suspect and reference bounding boxes to incident evidence,
and persists results back through the authorized persistence layer.

Usage:
    cd backend && .venv/bin/python scripts/reprocess_incident_sam.py [--incident-id ID] [--generate-pdf] [--dry-run]
"""

import argparse
import json
import logging
import os
import sys
from pathlib import Path

# Add backend directory to module search path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("reprocess_sam")

# Load environment variables (.env)
from dotenv import load_dotenv
load_dotenv(backend_dir / ".env")

DEFAULT_INCIDENT_ID = "3e1473da-4b6f-462d-bba6-864e21b67c53"


def reprocess_incident(incident_id: str, generate_pdf: bool = False, dry_run: bool = False):
    from app.registry import get_incident_by_id, save_incident
    from app.temporal_selector import (
        select_investigation_keyframes,
        ground_candidate_frames_with_sam,
    )
    from app.evidence_models import build_frame_evidence_from_matches
    from app.detailed_report import synthesize_detailed_report

    logger.info(f"Loading incident: {incident_id}")
    incident = get_incident_by_id(incident_id)
    if not incident:
        logger.error(f"Incident {incident_id} not found in database or local store.")
        return False

    matches = incident.get("frame_matches", [])
    logger.info(f"Incident contains {len(matches)} frame match candidates.")
    if not matches:
        logger.warning("No frame matches to process.")
        return False

    # 1. Select keyframe candidate pairs (max 3 pairs / 6 frames)
    pairs = select_investigation_keyframes(incident, max_pairs=3)
    logger.info(f"Selected {len(pairs)} top candidate pairs for investigation grounding.")

    for i, p in enumerate(pairs):
        s_bytes_len = len(p.get("suspect_image_bytes") or b"")
        r_bytes_len = len(p.get("reference_image_bytes") or b"")
        logger.info(
            f"  Pair {i + 1} ({p['evidence_id']}): "
            f"Suspect ts={p.get('suspect_timestamp_sec')}s ({s_bytes_len} bytes), "
            f"Ref ts={p.get('source_timestamp_sec')}s ({r_bytes_len} bytes)"
        )

    # 2. Perform SAM 3.1 visual localization on both suspect and reference frames
    prompt = "football"
    logger.info(f"Running SAM 3.1 grounding with prompt: '{prompt}' (max 6 calls)...")
    grounded_pairs = ground_candidate_frames_with_sam(pairs, prompt=prompt, max_sam_calls=6)

    # 3. Attach SAM results to incident frame matches
    grounded_by_idx = {p.get("pair_index"): p for p in grounded_pairs if p.get("pair_index") is not None}
    grounded_by_ev = {p["evidence_id"]: p for p in grounded_pairs if p.get("evidence_id")}
    updated_count = 0

    fms = incident.get("frame_matches", [])
    for idx, fm in enumerate(fms):
        ev_id = fm.get("evidence_id")
        best = fm.setdefault("best_match", {})
        p_data = grounded_by_idx.get(idx) or (grounded_by_ev.get(ev_id) if ev_id else None)
        if p_data:
            fm["evidence_id"] = p_data.get("evidence_id") or f"frame_{idx}_t{int(fm.get('submitted_frame', {}).get('timestamp_sec', 0))}s"
            # Suspect localization
            if "sam_segmentation" in p_data:
                fm["sam_segmentation"] = p_data["sam_segmentation"]
                best["sam_segmentation"] = p_data["sam_segmentation"]
            # Reference localization
            if "ref_sam_segmentation" in p_data:
                fm["ref_sam_segmentation"] = p_data["ref_sam_segmentation"]
                best["ref_sam_segmentation"] = p_data["ref_sam_segmentation"]
            updated_count += 1

    logger.info(f"Attached SAM grounding data to {updated_count} candidate matches.")

    # Display localization results summary
    for i, gp in enumerate(grounded_pairs):
        s_sam = gp.get("sam_segmentation") or {}
        r_sam = gp.get("ref_sam_segmentation") or {}
        s_objs = s_sam.get("objects") or s_sam.get("detected_objects") or []
        r_objs = r_sam.get("objects") or r_sam.get("detected_objects") or []
        logger.info(
            f"  Pair {i + 1} [{gp['evidence_id']}]: "
            f"Suspect Status={s_sam.get('validation_status')} (objects={len(s_objs)}), "
            f"Ref Status={r_sam.get('validation_status')} (objects={len(r_objs)})"
        )

    if dry_run:
        logger.info("[DRY RUN] Changes were NOT persisted to database.")
        return True

    # 4. Save updated incident through authorized persistence layer
    logger.info("Persisting updated incident to database...")
    save_incident(incident)
    logger.info("Incident successfully updated.")

    # 5. Optionally generate fresh detailed report and PDF
    if generate_pdf:
        logger.info("Generating updated detailed forensic report and PDF...")
        try:
            report_record = synthesize_detailed_report(
                incident_id=incident_id,
                force_model="muse-wonder-1.0",
            )
            report_id = report_record.get("report_id")
            logger.info(f"Detailed forensic report and PDF generated successfully: {report_id}")
        except Exception as e:
            logger.error(f"Failed to generate detailed report PDF: {e}")

    logger.info("Reprocessing complete. Incident is ready for display in UI and PDF download.")
    return True


def main():
    parser = argparse.ArgumentParser(description="FixProof Meta SAM 3.1 Incident Reprocessor")
    parser.add_argument(
        "--incident-id",
        type=str,
        default=DEFAULT_INCIDENT_ID,
        help=f"Target incident ID (default: {DEFAULT_INCIDENT_ID})",
    )
    parser.add_argument(
        "--generate-pdf",
        action="store_true",
        help="Synthesize a new detailed forensic report JSON and binary PDF",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run frame path resolution and grounding without persisting changes",
    )
    args = parser.parse_args()

    success = reprocess_incident(
        incident_id=args.incident_id,
        generate_pdf=args.generate_pdf,
        dry_run=args.dry_run,
    )
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
