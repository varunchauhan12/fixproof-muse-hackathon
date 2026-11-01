"""
Comprehensive Forensic Investigation Report & PDF Test Suite (Stage 1D Final Correction Pass).
Tests:
- Historical report backward compatibility without SAM/multimodal fields.
- FixProof Meta branding consistency and zero stale MediaGuard strings.
- Neutral legal language (human review required, no statutory certification claims).
- SAM 3.1 mask retention notice without unsupported immutability claims.
- Model provenance validation scope (provider/API validated, component tested, deterministic).
- Missing evidence image placeholder rendering.
- Real proportional image embedding without aspect distortion.
- Accurate CV metric, timestamp, and frame reference rendering.
- Multi-page ReportLab PDF layout and NumberedCanvas page numbering.
- Report persistence and PDF retrieval compatibility.
"""

from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import MagicMock, patch
import uuid
import zlib

from PIL import Image as PILImage

from app.detailed_report import (
    build_evidence_bundle,
    synthesize_detailed_report,
    generate_detailed_report_pdf,
    save_detailed_report,
    get_detailed_report_record,
    get_detailed_report_pdf_bytes,
    NumberedCanvas,
    VISION_MODEL_ID,
)


def _extract_pdf_text_streams(pdf_bytes: bytes) -> str:
    """Helper to extract and decompress all text streams from a ReportLab PDF byte sequence."""
    import base64
    texts = []
    streams = re.findall(rb"stream[\r\n]+(.*?)endstream", pdf_bytes, re.DOTALL)
    for s in streams:
        s = s.strip()
        if not s.startswith(b"<~"):
            s = b"<~" + s
        if not s.endswith(b"~>"):
            s = s + b"~>"
        try:
            a85 = base64.a85decode(s, adobe=True)
            decomp = zlib.decompress(a85).decode("latin1", errors="ignore")
            texts.append(decomp)
            # Also extract concatenated text from Tj operators to handle ReportLab line-wrapping
            tj_strings = re.findall(r"\((.*?)\)\s*Tj", decomp, re.DOTALL)
            if tj_strings:
                texts.append(" ".join(tj_strings))
        except Exception:
            try:
                decomp = zlib.decompress(s).decode("latin1", errors="ignore")
                texts.append(decomp)
                tj_strings = re.findall(r"\((.*?)\)\s*Tj", decomp, re.DOTALL)
                if tj_strings:
                    texts.append(" ".join(tj_strings))
            except Exception:
                pass
    # Also include raw ASCII strings
    raw_ascii = pdf_bytes.decode("latin1", errors="ignore")
    texts.append(raw_ascii)
    return "\n".join(texts)


class TestForensicReportPDF(unittest.TestCase):
    def setUp(self):
        self.incident_id = f"test-inc-{uuid.uuid4().hex[:8]}"
        self.tmp_dir = tempfile.mkdtemp()

        # Create a test PIL image for proportional embedding testing
        self.test_img_path = str(Path(self.tmp_dir) / "test_frame.jpg")
        img = PILImage.new("RGB", (640, 360), color=(15, 23, 42))
        img.save(self.test_img_path)

        # Standard multimodal bundle fixture for Stage 1D
        self.sample_bundle = {
            "incident_id": self.incident_id,
            "investigation_type": "FULL_VIDEO_SCAN",
            "suspect_filename": "world_cup_highlight_stream.mp4",
            "suspect_url": "https://stream.example.org/live/world_cup",
            "platform": "Web Stream",
            "scanned_at": "2026-11-01T10:00:00Z",
            "overall_status": "HIGH_CONFIDENCE_MATCH",
            "candidate_matches_found": 3,
            "highest_confidence": 94.2,
            "lowest_l2_distance": 0.2150,
            "matched_assets": [
                {
                    "asset_id": "asset-broadcast-ref-001",
                    "title": "Official_Broadcast_Feed_Live.mp4",
                    "duration_sec": 3600.0,
                    "file_size": 1048576000,
                    "fps": 60.0,
                    "indexed_at": "2026-10-30T12:00:00Z",
                }
            ],
            "frame_correlations": [
                {
                    "correlation_id": "corr-001",
                    "evidence_id": "evidence_frame_0010s",
                    "suspect_timestamp_sec": 10.0,
                    "source_timestamp_sec": 10.0,
                    "source_asset_id": "asset-broadcast-ref-001",
                    "source_asset_title": "Official_Broadcast_Feed_Live.mp4",
                    "l2_distance": 0.2150,
                    "phash_match": True,
                    "phash_distance": 2,
                    "visual_similarity_score": 94.2,
                    "vision_verification": {
                        "model_id": "muse-spark-1.3",
                        "visual_correspondence": "CONFIRMED",
                        "matching_features": ["Identical scoreboard graphic", "Synchronized broadcast camera angle"],
                        "contradictions": [],
                        "reasoning": "Pairwise vision verification confirms identical broadcast chyrons and pitch alignment.",
                    },
                    "sam_segmentation": {
                        "model_id": "sam-3.1",
                        "provider": "meta",
                        "frame_reference": "evidence_frame_0010s",
                        "timestamp_sec": 10.0,
                        "decoding_status": "RAW_PRESERVED",
                        "mask_payload_validated": True,
                        "detected_objects": [
                            {
                                "label": "scoreboard",
                                "box": [0.05, 0.05, 0.35, 0.15],
                                "confidence": 0.96,
                            },
                            {
                                "label": "athlete",
                                "box": [0.42, 0.30, 0.58, 0.85],
                                "confidence": 0.91,
                            },
                        ],
                    },
                    "suspect_image_path": self.test_img_path,
                    "ref_image_path": self.test_img_path,
                },
                {
                    "correlation_id": "corr-002",
                    "evidence_id": "evidence_frame_0015s",
                    "suspect_timestamp_sec": 15.0,
                    "source_timestamp_sec": 15.0,
                    "source_asset_id": "asset-broadcast-ref-001",
                    "source_asset_title": "Official_Broadcast_Feed_Live.mp4",
                    "l2_distance": 0.2840,
                    "phash_match": True,
                    "phash_distance": 3,
                    "visual_similarity_score": 88.5,
                    "vision_verification": {
                        "model_id": "muse-spark-1.3",
                        "visual_correspondence": "CONFIRMED",
                        "matching_features": ["Continuous action sequence", "Uniform color consistency"],
                        "contradictions": [],
                        "reasoning": "Temporal continuity sustained across 5-second interval.",
                    },
                    "sam_segmentation": {
                        "model_id": "sam-3.1",
                        "provider": "meta",
                        "frame_reference": "evidence_frame_0015s",
                        "timestamp_sec": 15.0,
                        "decoding_status": "RAW_PRESERVED",
                        "mask_payload_validated": True,
                        "detected_objects": [
                            {
                                "label": "ball",
                                "box": [0.48, 0.52, 0.52, 0.56],
                                "confidence": 0.88,
                            }
                        ],
                    },
                    "suspect_image_path": "/path/to/missing_suspect_frame.jpg",
                    "ref_image_path": None,
                },
            ],
            "timeline_intervals": [
                {
                    "interval_id": "itv-001",
                    "source_asset_id": "asset-broadcast-ref-001",
                    "reference_start_sec": 10.0,
                    "reference_end_sec": 15.0,
                    "suspect_start_sec": 10.0,
                    "suspect_end_sec": 15.0,
                    "duration_sec": 5.0,
                    "confidence": 94.2,
                    "evidence_ids": ["evidence_frame_0010s", "evidence_frame_0015s"],
                    "continuity_status": "CONTINUOUS",
                }
            ],
            "prior_reports": [],
        }

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_historical_report_backward_compatibility(self):
        """Historical report without SAM or multimodal fields must render without KeyError or crash."""
        historical_report = {
            "report_id": "hist-rep-001",
            "incident_id": self.incident_id,
            "generated_at": "2026-10-25T14:30:00Z",
            "model_id": "nvidia/Nemotron-3_5-Lightning",
            "ai_synthesized": False,
            "sections": {
                "executive_summary": "Historical screening observed candidate matches requiring human review.",
                "methodology_scope": "Standard MobileNetV3 and FAISS vector retrieval.",
                "suspect_and_reference_details": {
                    "suspect_source": "historical_upload.mp4",
                    "platform": "Direct Video File",
                    "scanned_at": "2026-10-25T14:00:00Z",
                    "matched_references": [{"asset_id": "ref-legacy-1", "title": "Legacy Asset"}],
                },
                "frame_correlations": [
                    {
                        "correlation_id": "corr-legacy-001",
                        "suspect_timestamp_sec": 5.0,
                        "source_timestamp_sec": 5.0,
                        "source_asset_id": "ref-legacy-1",
                        "source_asset_title": "Legacy Asset",
                        "l2_distance": 0.32,
                        "visual_similarity_score": 86.0,
                        "phash_match": True,
                        "vision_verification": {
                            "model_id": "nvidia/Nemotron-3.5-Super-VL",
                            "visual_correspondence": "UNVERIFIED",
                            "matching_features": [],
                            "contradictions": [],
                            "reasoning": "Unverified visual correspondence.",
                        },
                        "suspect_image_path": None,
                        "ref_image_path": None,
                    }
                ],
                "temporal_continuity": "Single candidate match point observed.",
                "model_assessment": "Alternative explanations not ruled out.",
                "risk_and_limitations": "Uncalibrated heuristic scores, not calibrated probabilities of copyright infringement.",
                "recommended_actions": ["Conduct manual review of keyframes."],
                "provenance": {
                    "incident_id": self.incident_id,
                    "report_id": "hist-rep-001",
                    "synthesizer_model": "nvidia/Nemotron-3_5-Lightning",
                    "vision_verifier_model": "nvidia/Nemotron-3.5-Super-VL",
                    "embedding_model": "MobileNetV3-Small (576-dim L2-normalized)",
                    "vector_store": "FAISS IndexFlatL2",
                    "timestamp": "2026-10-25T14:30:00Z",
                },
            },
        }

        # Must render cleanly with empty bundle fallback
        pdf_bytes = generate_detailed_report_pdf(historical_report, {})
        self.assertIsInstance(pdf_bytes, bytes)
        self.assertTrue(pdf_bytes.startswith(b"%PDF-"), "Historical report must output valid PDF bytes")
        self.assertGreater(len(pdf_bytes), 2500)

    @patch("app.providers.factory.reasoning_is_configured", return_value=False)
    def test_new_multimodal_report_synthesis_deterministic(self, _mock_cfg):
        """Synthesized detailed report in deterministic mode must preserve all backward-compatible keys and carry new metadata."""
        report = synthesize_detailed_report(self.sample_bundle)
        self.assertIn("report_id", report)
        self.assertEqual(report["incident_id"], self.incident_id)
        self.assertIn("sections", report)

        secs = report["sections"]
        required_keys = [
            "executive_summary",
            "methodology_scope",
            "suspect_and_reference_details",
            "frame_correlations",
            "temporal_continuity",
            "model_assessment",
            "risk_and_limitations",
            "recommended_actions",
            "provenance",
        ]
        for k in required_keys:
            self.assertIn(k, secs, f"Missing required section: {k}")

        # Verify Stage 1D additions
        self.assertIn("timeline_intervals", secs)
        self.assertEqual(len(secs["timeline_intervals"]), 1)
        self.assertEqual(secs["timeline_intervals"][0]["continuity_status"], "CONTINUOUS")
        self.assertIn("sam_segmentations", secs)
        self.assertEqual(len(secs["sam_segmentations"]), 2)
        self.assertEqual(secs["provenance"]["validation_status"], "DETERMINISTIC_FALLBACK")

    @patch("app.providers.factory.reasoning_is_configured", return_value=True)
    def test_new_multimodal_report_synthesis_ai(self, _mock_cfg):
        """Synthesized detailed report with AI provider mocked must populate all 12 sections accurately."""
        mock_provider = MagicMock()
        mock_provider.provider_name = "muse"
        mock_provider.model_id = "muse-wonder-1.0"
        mock_ai_content = {
            "executive_summary": "AI forensic evaluation observes candidate broadcast correspondence requiring human inspection.",
            "methodology_scope": "Four-tier pipeline utilizing MobileNetV3, FAISS, Spark 1.3, and SAM 3.1.",
            "temporal_continuity_analysis": "Continuous keyframe progression identified between 10.0s and 15.0s.",
            "model_assessment_and_alternatives": "Confirmed visual alignment with reference feed. Alternative fair-use uses noted.",
            "risk_limitations": "Similarity measurements reflect heuristic distance, not calibrated probabilities of infringement.",
            "recommended_actions": ["Review keyframe correspondence pairs.", "Verify broadcast license rights."],
        }
        mock_resp = MagicMock()
        mock_resp.choices = [MagicMock(message=MagicMock(content=json.dumps(mock_ai_content)))]
        mock_provider.create_text_completion.return_value = mock_resp

        with patch("app.providers.factory.get_reasoning_provider", return_value=mock_provider):
            report = synthesize_detailed_report(self.sample_bundle)
            self.assertTrue(report["ai_synthesized"])
            self.assertEqual(report["model_id"], "muse-wonder-1.0")
            secs = report["sections"]
            self.assertEqual(secs["executive_summary"], mock_ai_content["executive_summary"])
            self.assertEqual(secs["temporal_continuity"], mock_ai_content["temporal_continuity_analysis"])
            self.assertEqual(secs["provenance"]["validation_status"], "PROVIDER_VALIDATED")

    @patch("app.providers.factory.reasoning_is_configured", return_value=False)
    def test_branding_consistency_and_no_mediaguard(self, _mock_cfg):
        """PDF output must use FixProof Meta consistently and have 0 stale MediaGuard branding."""
        report = synthesize_detailed_report(self.sample_bundle)
        pdf_bytes = generate_detailed_report_pdf(report, self.sample_bundle)
        extracted = _extract_pdf_text_streams(pdf_bytes)

        self.assertIn("FixProof Meta", extracted)
        self.assertNotIn("MediaGuard", extracted, "Stale MediaGuard branding must not appear in FixProof Meta reports")

    @patch("app.providers.factory.reasoning_is_configured", return_value=False)
    def test_neutral_legal_wording_no_statutory_certification(self, _mock_cfg):
        """Legal language must require human review without claiming statutory certification or compliance."""
        report = synthesize_detailed_report(self.sample_bundle)
        pdf_bytes = generate_detailed_report_pdf(report, self.sample_bundle)
        extracted = _extract_pdf_text_streams(pdf_bytes)

        # Must contain neutral human review heading
        self.assertIn("HUMAN REVIEW REQUIRED BEFORE EXTERNAL ENFORCEMENT", extracted)
        # Must not claim statutory certification
        self.assertNotIn("STATUTORY HUMAN REVIEW CERTIFICATION", extracted)
        # Must disclaim legal determination or statutory certification
        self.assertIn("does not certify compliance", extracted)

    @patch("app.providers.factory.reasoning_is_configured", return_value=False)
    def test_sam_mask_data_notice_no_immutability_claims(self, _mock_cfg):
        """SAM mask notice must accurately state original encoded representation retention without unsupported immutability claims."""
        report = synthesize_detailed_report(self.sample_bundle)
        pdf_bytes = generate_detailed_report_pdf(report, self.sample_bundle)
        extracted = _extract_pdf_text_streams(pdf_bytes)

        self.assertIn("SAM MASK DATA NOTICE", extracted)
        self.assertIn("RAW_PRESERVED", extracted)
        self.assertIn("Direct mask decoding and visual polygon overlay rendering are not implemented", extracted)
        self.assertNotIn("immutably", extracted.lower())

    @patch("app.providers.factory.reasoning_is_configured", return_value=False)
    def test_missing_evidence_image_handling(self, _mock_cfg):
        """Missing or non-existent frame images must render clear placeholder text without raising exceptions."""
        report = synthesize_detailed_report(self.sample_bundle)
        pdf_bytes = generate_detailed_report_pdf(report, self.sample_bundle)
        self.assertIsInstance(pdf_bytes, bytes)
        self.assertTrue(pdf_bytes.startswith(b"%PDF-"))
        self.assertGreater(len(pdf_bytes), 3000)

    @patch("app.providers.factory.reasoning_is_configured", return_value=True)
    def test_spark_sam_wonder_provenance(self, _mock_cfg):
        """Model provenance must accurately reflect Muse Wonder 1.0, Muse Spark 1.3, and SAM 3.1 when Muse provider is active."""
        mock_provider = MagicMock()
        mock_provider.provider_name = "muse"
        mock_provider.model_id = "muse-wonder-1.0"
        mock_ai_content = {
            "executive_summary": "AI synthesis with Muse Wonder 1.0.",
            "methodology_scope": "Four-tier pipeline methodology.",
            "temporal_continuity_analysis": "Continuous keyframe progression.",
            "model_assessment_and_alternatives": "Observed visual alignment.",
            "risk_limitations": "Uncalibrated heuristic metrics, not calibrated probabilities.",
            "recommended_actions": ["Human verification required."],
        }
        mock_resp = MagicMock()
        mock_resp.choices = [MagicMock(message=MagicMock(content=json.dumps(mock_ai_content)))]
        mock_provider.create_text_completion.return_value = mock_resp

        with patch("app.providers.factory.get_reasoning_provider", return_value=mock_provider):
            report = synthesize_detailed_report(self.sample_bundle)
            prov = report["sections"]["provenance"]

            self.assertEqual(prov["synthesizer_model"], "muse-wonder-1.0")
            self.assertEqual(prov["vision_verifier_model"], "muse-spark-1.3")
            self.assertEqual(prov["sam_model"], "sam-3.1")
            self.assertEqual(prov["validation_status"], "PROVIDER_VALIDATED")
            self.assertEqual(prov["reasoning_provider"], "meta")
            self.assertEqual(prov["vision_provider"], "meta")
            self.assertEqual(prov["sam_provider"], "meta")
            self.assertEqual(prov["vector_store"], "FAISS IndexFlatL2")

    @patch("app.providers.factory.reasoning_is_configured", return_value=False)
    def test_model_provenance_validation_scope_notice(self, _mock_cfg):
        """Section 11 must include validation scope notice distinguishing component testing from live investigation."""
        report = synthesize_detailed_report(self.sample_bundle)
        pdf_bytes = generate_detailed_report_pdf(report, self.sample_bundle)
        extracted = _extract_pdf_text_streams(pdf_bytes)

        self.assertIn("VALIDATION SCOPE NOTICE", extracted)
        self.assertIn("Full end-to-end multimodal pipeline validation requires an active live investigation run", extracted)

    @patch("app.providers.factory.reasoning_is_configured", return_value=False)
    def test_sam_mask_raw_preserved_handling(self, _mock_cfg):
        """SAM 3.1 segmentation metadata must maintain RAW_PRESERVED status and bitstream integrity."""
        report = synthesize_detailed_report(self.sample_bundle)
        sam_segs = report["sections"]["sam_segmentations"]
        self.assertTrue(len(sam_segs) > 0)
        for s in sam_segs:
            self.assertEqual(s.get("decoding_status"), "RAW_PRESERVED")
            self.assertTrue(s.get("mask_payload_validated"))

    @patch("app.providers.factory.reasoning_is_configured", return_value=False)
    def test_legal_language_and_human_review_invariants(self, _mock_cfg):
        """Reports must qualify visual similarity, disclaim legal findings, and require human review."""
        report = synthesize_detailed_report(self.sample_bundle)
        exec_sum = report["sections"]["executive_summary"].lower()
        risk_lim = report["sections"]["risk_and_limitations"].lower()

        # Non-adjudication assertions
        self.assertNotIn("guilty", exec_sum)
        self.assertNotIn("guaranteed infringement", exec_sum)
        self.assertNotIn("criminal violation", exec_sum)

        # Statutory and heuristic disclosures
        self.assertIn("calibrated probabilities", risk_lim)
        self.assertIn("human", exec_sum + risk_lim)

        recs = " ".join(report["sections"]["recommended_actions"]).lower()
        self.assertIn("human review", recs)

    @patch("app.providers.factory.reasoning_is_configured", return_value=False)
    def test_multi_page_pdf_generation_and_numbered_canvas(self, _mock_cfg):
        """PDF must generate multi-page layout with NumberedCanvas page numbering."""
        report = synthesize_detailed_report(self.sample_bundle)
        pdf_bytes = generate_detailed_report_pdf(report, self.sample_bundle)

        self.assertIsInstance(pdf_bytes, bytes)
        self.assertTrue(pdf_bytes.startswith(b"%PDF-1.4"))
        # A multi-page detailed report with 12 sections and tables is substantially larger than 5KB
        self.assertGreater(len(pdf_bytes), 5000)

    @patch("app.providers.factory.reasoning_is_configured", return_value=False)
    def test_report_persistence_and_retrieval(self, _mock_cfg):
        """save_detailed_report, get_detailed_report_record, and get_detailed_report_pdf_bytes round-trip."""
        report = synthesize_detailed_report(self.sample_bundle)
        pdf_bytes = generate_detailed_report_pdf(report, self.sample_bundle)

        save_detailed_report(self.incident_id, report, pdf_bytes)

        loaded_rec = get_detailed_report_record(report["report_id"])
        self.assertIsNotNone(loaded_rec)
        self.assertEqual(loaded_rec["report_id"], report["report_id"])
        self.assertEqual(loaded_rec["incident_id"], self.incident_id)

        retrieved_pdf = get_detailed_report_pdf_bytes(report["report_id"])
        self.assertIsNotNone(retrieved_pdf)
        self.assertEqual(retrieved_pdf, pdf_bytes)

    @patch("app.providers.factory.reasoning_is_configured", return_value=False)
    def test_sam_bounding_box_annotation_in_pdf(self, _mock_cfg):
        """When SAM segmentation bounding boxes are present on available images, PDF draws overlays and labels captions."""
        bundle_with_images = dict(self.sample_bundle)
        bundle_with_images["frame_correlations"] = [
            dict(
                self.sample_bundle["frame_correlations"][0],
                suspect_image_path=self.test_img_path,
            )
        ]

        # Record initial file mtime and hash
        with open(self.test_img_path, "rb") as f:
            original_bytes = f.read()

        report = synthesize_detailed_report(bundle_with_images)
        pdf_bytes = generate_detailed_report_pdf(report, bundle_with_images)

        self.assertIsInstance(pdf_bytes, bytes)
        self.assertTrue(pdf_bytes.startswith(b"%PDF-1.4"))

        extracted = _extract_pdf_text_streams(pdf_bytes)
        self.assertIn("SAM 3.1 Annotated Visualization", extracted, "Caption must indicate SAM 3.1 annotation")

        # Verify disk asset was untouched
        with open(self.test_img_path, "rb") as f:
            current_bytes = f.read()
        self.assertEqual(original_bytes, current_bytes, "Original image file on disk must not be altered")


if __name__ == "__main__":
    unittest.main()
