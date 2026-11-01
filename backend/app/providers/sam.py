"""
SAM 3.1 specialist visual segmentation and localization provider for FixProof.
Interfaces with Meta Model Responses API (POST /v1/responses) on https://api.meta.ai/v1.
Provides isolated concept segmentation, bounding box localization, and mask extraction.
"""

import base64
from datetime import datetime, timezone
import io
import logging
import os
from pathlib import Path
import re
import time
from typing import Any, Dict, List, Optional, Set, Union

from PIL import Image

from app.providers.base import BaseSegmentationProvider
from app.providers.meta_client import (
    MuseClient,
    MetaAPIError,
    DEFAULT_SAM_MODEL,
)
from app.providers.sam_models import (
    BoundingBox,
    SegmentationMask,
    SegmentedObject,
    SegmentationResult,
)

logger = logging.getLogger(__name__)

# Grammar parsing regular expressions for SAM 3.1 special tokens
FRAME_TAG_RE = re.compile(r"^<(\d+)f>")
OBJECT_RECORD_RE = re.compile(
    r"(?:^|,)?(\d+)<\|box;([^|]+)\|>(?:<\|mask;([^|]+)\|>)?",
    re.DOTALL,
)


def parse_sam_grammar(
    grammar_text: str,
    default_label: str = "",
    default_frame_idx: Optional[int] = None,
) -> List[SegmentedObject]:
    """
    Parses the SAM 3.1 raw output grammar into typed SegmentedObject instances.
    Example grammar:
      <0f>0<|box;x1=16;y1=16;x2=47;y2=47;w=64;h=64|><|mask;x=0;y=0;data=32,32,~...|>
    """
    if not grammar_text or not grammar_text.strip():
        return []

    results: List[SegmentedObject] = []
    text = grammar_text.strip()

    # Determine frame index if present
    frame_match = FRAME_TAG_RE.match(text)
    frame_idx = int(frame_match.group(1)) if frame_match else default_frame_idx
    stripped = FRAME_TAG_RE.sub("", text)

    for m in OBJECT_RECORD_RE.finditer(stripped):
        obj_id = int(m.group(1))
        box_str = m.group(2)
        mask_str = m.group(3)

        # Parse box attributes (supports x1/y1/x2/y2/w/h and x/y/w/h)
        box_attrs: Dict[str, str] = {}
        for item in box_str.split(";"):
            if "=" in item:
                k, v = item.split("=", 1)
                box_attrs[k.strip()] = v.strip()

        try:
            w = int(box_attrs.get("w", 0))
            h = int(box_attrs.get("h", 0))

            if "x1" in box_attrs and "x2" in box_attrs:
                x1 = float(box_attrs["x1"])
                y1 = float(box_attrs["y1"])
                x2 = float(box_attrs["x2"])
                y2 = float(box_attrs["y2"])
            elif "x" in box_attrs and "y" in box_attrs:
                x1 = float(box_attrs["x"])
                y1 = float(box_attrs["y"])
                bw = float(box_attrs.get("bw", box_attrs.get("w", 0)))
                bh = float(box_attrs.get("bh", box_attrs.get("h", 0)))
                x2 = x1 + bw
                y2 = y1 + bh
            else:
                continue

            bbox = BoundingBox(x1=x1, y1=y1, x2=x2, y2=y2, w=w, h=h)
        except (ValueError, TypeError) as exc:
            logger.warning(f"[SAM Parser] Error parsing box tokens: {exc}")
            continue

        # Parse mask attributes if present
        mask_obj: Optional[SegmentationMask] = None
        if mask_str:
            mask_attrs: Dict[str, str] = {}
            for item in mask_str.split(";"):
                if "=" in item:
                    k, v = item.split("=", 1)
                    mask_attrs[k.strip()] = v.strip()

            try:
                mx = int(mask_attrs.get("x", 0))
                my = int(mask_attrs.get("y", 0))
                data_str = mask_attrs.get("data", "")
                
                mh, mw = 0, 0
                encoding = "lossless_base85"
                raw_payload = data_str

                if "," in data_str:
                    parts = data_str.split(",", 2)
                    if len(parts) >= 2:
                        mh = int(parts[0])
                        mw = int(parts[1])
                    if len(parts) == 3:
                        raw_payload = parts[2]
                        if raw_payload.startswith("~"):
                            encoding = "lossless_base85"
                            raw_payload = raw_payload[1:]
                        elif raw_payload.startswith("!"):
                            encoding = "1bit_base85"
                            raw_payload = raw_payload[1:]

                mask_obj = SegmentationMask(
                    x=mx,
                    y=my,
                    height=mh,
                    width=mw,
                    encoding=encoding,
                    raw_payload=raw_payload,
                )
            except Exception as exc:
                logger.warning(f"[SAM Parser] Error parsing mask tokens: {exc}")

        results.append(
            SegmentedObject(
                object_id=obj_id,
                label=default_label,
                box=bbox,
                mask=mask_obj,
                tracking_id=obj_id,
            )
        )

    return results


def validate_mask_payload(mask: SegmentationMask) -> Dict[str, Any]:
    """
    Validates SAM 3.1 mask attributes without guessing proprietary decompression algorithms.
    Verifies dimensions, payload existence, and encoding prefix.
    """
    errors: List[str] = []
    if mask.height <= 0 or mask.width <= 0:
        errors.append(f"Invalid mask dimensions: {mask.height}x{mask.width}")

    if not mask.raw_payload or not mask.raw_payload.strip():
        errors.append("Empty raw mask payload")

    if mask.encoding not in ("lossless_base85", "1bit_base85", "base85"):
        errors.append(f"Unsupported mask encoding prefix: {mask.encoding}")

    is_valid = len(errors) == 0
    return {
        "is_valid": is_valid,
        "height": mask.height,
        "width": mask.width,
        "encoding": mask.encoding,
        "payload_length": len(mask.raw_payload),
        "errors": errors,
        "decoding_status": "RAW_PRESERVED_VERIFIED" if is_valid else "INVALID_MASK_STRUCTURE",
    }


class MetaSAMProvider(BaseSegmentationProvider):
    """
    SAM 3.1 specialist perception provider on the Meta Model Responses API.
    """
    provider_name = property(lambda self: "muse")
    model_id = property(lambda self: os.getenv("MUSE_SAM_MODEL", DEFAULT_SAM_MODEL).strip())

    @property
    def allowed_models(self) -> Set[str]:
        return {self.model_id, "sam-3.1"}

    def segment_frame(
        self,
        image_bytes: bytes,
        prompt: str,
        metadata: Optional[Dict[str, Any]] = None,
        model_override: Optional[str] = None,
    ) -> SegmentationResult:
        """
        Executes an isolated SAM 3.1 perception pass on a single candidate frame.
        """
        model = model_override or self.model_id
        meta = metadata or {}
        incident_id = meta.get("incident_id")
        asset_id = meta.get("asset_id")
        evidence_id = meta.get("evidence_id")
        frame_idx = meta.get("frame_index")
        timestamp_sec = meta.get("timestamp_sec")
        if timestamp_sec is not None:
            try:
                timestamp_sec = float(timestamp_sec)
            except (ValueError, TypeError):
                timestamp_sec = None

        clean_prompt = (prompt or "").strip()
        started = time.perf_counter()

        def make_failure(failure_type: str, err_msg: str) -> SegmentationResult:
            return SegmentationResult(
                incident_id=incident_id,
                asset_id=asset_id,
                evidence_id=evidence_id,
                frame_index=frame_idx,
                timestamp_sec=timestamp_sec,
                prompt=clean_prompt,
                model_id=model,
                objects=[],
                validation_status="FAILED_VALIDATION",
                operational_metadata={
                    "model_id": model,
                    "failure_type": failure_type,
                    "errors": [err_msg],
                    "latency_ms": int((time.perf_counter() - started) * 1000),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                },
            )

        if model != self.model_id and model not in self.allowed_models:
            return make_failure("INVALID_MODEL_OVERRIDE", f"Model override '{model}' is not permitted for SAM provider.")

        if not clean_prompt:
            return make_failure("EMPTY_PROMPT", "Concept segmentation prompt must be a non-empty string.")

        if not image_bytes:
            return make_failure("INVALID_IMAGE", "Empty image bytes provided for SAM segmentation.")

        # Validate and resize image if necessary
        try:
            pil_img = Image.open(io.BytesIO(image_bytes))
            orig_w, orig_h = pil_img.size
            if orig_w <= 0 or orig_h <= 0:
                raise ValueError("Image has non-positive dimensions.")

            # Bounded sizing (max 1024px maintaining aspect ratio)
            max_dim = 1024
            if max(orig_w, orig_h) > max_dim:
                scale = max_dim / float(max(orig_w, orig_h))
                new_w = max(1, int(round(orig_w * scale)))
                new_h = max(1, int(round(orig_h * scale)))
                pil_img = pil_img.resize((new_w, new_h), Image.Resampling.LANCZOS)

            buf = io.BytesIO()
            pil_img.convert("RGB").save(buf, format="JPEG", quality=92)
            prepared_bytes = buf.getvalue()
        except Exception as exc:
            return make_failure("INVALID_IMAGE", f"Could not decode or validate image: {exc}")

        b64_img = base64.b64encode(prepared_bytes).decode("ascii")
        data_url = f"data:image/jpeg;base64,{b64_img}"

        payload = {
            "model": model,
            "input": [
                {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": clean_prompt},
                        {"type": "input_image", "image_url": data_url},
                    ],
                }
            ],
            "stream": False,
        }

        try:
            resp_data = MuseClient().post_responses(payload)
        except MetaAPIError as exc:
            return make_failure(exc.category, str(exc))
        except Exception as exc:
            return make_failure("PROVIDER_API_ERROR", f"Unexpected error during SAM call: {exc}")

        # Extract output text from response
        output_text = resp_data.get("output_text")
        if output_text is None and resp_data.get("output"):
            try:
                output_text = resp_data["output"][0]["content"][0]["text"]
            except (KeyError, IndexError, TypeError):
                output_text = ""

        raw_grammar = output_text or ""
        parsed_objects = parse_sam_grammar(
            raw_grammar,
            default_label=clean_prompt,
            default_frame_idx=frame_idx,
        )

        val_status = "VALIDATED" if parsed_objects else "NO_OBJECTS_DETECTED"
        latency_ms = int((time.perf_counter() - started) * 1000)

        usage = resp_data.get("usage") or {}

        return SegmentationResult(
            incident_id=incident_id,
            asset_id=asset_id,
            evidence_id=evidence_id,
            frame_index=frame_idx,
            timestamp_sec=timestamp_sec,
            prompt=clean_prompt,
            model_id=model,
            objects=parsed_objects,
            validation_status=val_status,
            raw_grammar=raw_grammar,
            operational_metadata={
                "model_id": model,
                "latency_ms": latency_ms,
                "token_usage": usage,
                "objects_detected": len(parsed_objects),
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )


def segment_candidate_frame(
    frame_source: Union[bytes, str, Path],
    prompt: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> SegmentationResult:
    """
    Minimum reusable helper to run SAM 3.1 segmentation on an explicitly selected frame.
    Accepts raw bytes, string file path, or Path object.
    Does NOT modify FAISS indices, embeddings, or candidate ranking.
    """
    raw_bytes: bytes = b""
    if isinstance(frame_source, (str, Path)):
        p = Path(frame_source)
        if p.is_file():
            raw_bytes = p.read_bytes()
        else:
            return SegmentationResult(
                prompt=prompt,
                model_id=DEFAULT_SAM_MODEL,
                objects=[],
                validation_status="FAILED_VALIDATION",
                operational_metadata={
                    "errors": [f"Frame source file not found: {p}"],
                    "failure_type": "FILE_NOT_FOUND",
                },
            )
    elif isinstance(frame_source, bytes):
        raw_bytes = frame_source
    else:
        return SegmentationResult(
            prompt=prompt,
            model_id=DEFAULT_SAM_MODEL,
            objects=[],
            validation_status="FAILED_VALIDATION",
            operational_metadata={
                "errors": ["Unsupported frame source type; expected bytes or Path."],
                "failure_type": "INVALID_INPUT_TYPE",
            },
        )

    provider = MetaSAMProvider()
    return provider.segment_frame(raw_bytes, prompt, metadata)

