"""
Data models for SAM 3.1 specialist visual segmentation and localization.
Strict typed, validated immutable schemas for concept detection, bounding boxes,
and raster segmentation masks.
"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, model_validator


class BoundingBox(BaseModel):
    """
    Absolute and normalized pixel coordinates for a detected object bounding box.
    """
    x1: float
    y1: float
    x2: float
    y2: float
    w: int
    h: int
    normalized_coords: List[float] = Field(default_factory=list)

    @model_validator(mode="after")
    def compute_normalized(self) -> "BoundingBox":
        if not self.normalized_coords and self.w > 0 and self.h > 0:
            nx1 = max(0.0, min(1.0, round(self.x1 / self.w, 4)))
            ny1 = max(0.0, min(1.0, round(self.y1 / self.h, 4)))
            nx2 = max(0.0, min(1.0, round(self.x2 / self.w, 4)))
            ny2 = max(0.0, min(1.0, round(self.y2 / self.h, 4)))
            self.normalized_coords = [nx1, ny1, nx2, ny2]
        return self


class SegmentationMask(BaseModel):
    """
    Pixel-precise raster segmentation mask representation.
    Preserves raw encoded payload for cryptographic reproducibility and provenance.
    """
    x: int = 0
    y: int = 0
    height: int = 0
    width: int = 0
    encoding: str = "lossless_base85"
    raw_payload: str = ""
    is_decoded: bool = False
    decoded_mask: Optional[List[List[int]]] = None
    decoding_status: str = "RAW_PRESERVED"
    decoding_notice: Optional[str] = (
        "Raw SAM 3.1 run-length base85 payload preserved immutably. "
        "Native byte decompression requires @meta-sam/parser."
    )


class SegmentedObject(BaseModel):
    """
    Individual localized object instance detected by SAM 3.1.
    """
    object_id: int
    label: str
    box: BoundingBox
    mask: Optional[SegmentationMask] = None
    tracking_id: Optional[int] = None
    confidence_score: Optional[float] = None


class SegmentationResult(BaseModel):
    """
    Complete structured result of a SAM 3.1 perception pass.
    Maintains provenance and association with target media frame.
    """
    incident_id: Optional[str] = None
    asset_id: Optional[str] = None
    evidence_id: Optional[str] = None
    frame_index: Optional[int] = None
    timestamp_sec: Optional[float] = None
    prompt: str
    model_id: str = "sam-3.1"
    objects: List[SegmentedObject] = Field(default_factory=list)
    validation_status: str = "VALIDATED"  # VALIDATED | NO_OBJECTS_DETECTED | FAILED_VALIDATION
    target: Optional[str] = "suspect"  # suspect | reference
    frame_filename: Optional[str] = None
    raw_grammar: Optional[str] = None
    operational_metadata: Dict[str, Any] = Field(default_factory=dict)

