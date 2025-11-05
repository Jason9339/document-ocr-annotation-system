"""
PaddleOCR Service Module

Provides OCR functionality using PaddleOCR with support for both CPU and GPU.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from paddleocr import PaddleOCR

try:
    import paddleocr
    PADDLEOCR_VERSION = paddleocr.__version__
except (ImportError, AttributeError):
    PADDLEOCR_VERSION = "unknown"

DEFAULT_LABEL = "text"


class OCRService:
    """
    OCR Service using PaddleOCR.

    Supports automatic CPU/GPU detection and can be configured via environment variables.
    """

    _instance: Optional[PaddleOCR] = None

    @classmethod
    def get_ocr_engine(cls) -> PaddleOCR:
        """
        Get or create the singleton PaddleOCR instance.

        Environment Variables:
            USE_GPU: Set to '1' or 'true' to use GPU (default: 'cpu')
            OCR_LANG: Language for OCR (default: 'ch' for Chinese)

        Returns:
            Configured PaddleOCR instance
        """
        if cls._instance is None:
            # Check device setting (PaddleOCR 3.x uses 'device' parameter)
            use_gpu_env = os.getenv("USE_GPU", "0").lower()

            if use_gpu_env in ("1", "true", "yes"):
                device = "gpu"
            else:
                device = "cpu"

            # Get language setting (default to Traditional Chinese)
            lang = os.getenv("OCR_LANG", "chinese_cht")

            # Initialize PaddleOCR with PaddleOCR 3.x parameters
            # Use mobile models for lower memory usage
            cls._instance = PaddleOCR(
                use_angle_cls=False,  # Disable angle classification to save memory
                lang=lang,  # Language: 'ch', 'en', 'japan', 'korean', etc.
                device=device,  # Device: 'cpu' or 'gpu'
                det_model_dir=None,  # Use default mobile detection model
                rec_model_dir=None,  # Use default mobile recognition model
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
            )

            print("✓ PaddleOCR initialized successfully")
            print(f"  Device: {device.upper()}")
            print(f"  Language: {lang}")

        return cls._instance

    @classmethod
    def run_ocr(cls, image_path: str | Path) -> Dict[str, Any]:
        """
        Run OCR on a single image.

        Args:
            image_path: Path to the image file

        Returns:
            Dict with detection results and metadata.
        """
        ocr = cls.get_ocr_engine()
        image_path = str(image_path)

        # Run OCR
        result = ocr.ocr(image_path)

        # Parse results - PaddleOCR 3.x returns OCRResult objects
        detections: List[Dict[str, Any]] = []
        metadata: Dict[str, Any] = {}

        if result:
            ocr_result = result[0]

            # Get JSON data from OCRResult object
            result_data = ocr_result.json

            if isinstance(result_data, dict):
                # Preserve full OCR result payload for downstream consumers
                metadata = result_data

                res_data = result_data.get("res")
                if isinstance(res_data, dict):
                    boxes = res_data.get("rec_polys")
                    texts = res_data.get("rec_texts")
                    scores = res_data.get("rec_scores")
                    orientations = res_data.get("textline_orientation_angles", [])

                    if (
                        isinstance(boxes, list)
                        and isinstance(texts, list)
                        and isinstance(scores, list)
                    ):
                        print(f"✓ OCR detected {len(texts)} text regions")

                        for i, (box, text, score) in enumerate(zip(boxes, texts, scores)):
                            detection: Dict[str, Any] = {
                                "box": box,
                                "text": text,
                                "confidence": float(score),
                                "orientation": orientations[i] if i < len(orientations) else -1
                            }

                            # Attach any other list-based fields for this index for reference
                            extras: Dict[str, Any] = {}
                            for key, values in res_data.items():
                                if key in {"rec_polys", "rec_texts", "rec_scores"}:
                                    continue
                                if isinstance(values, list) and len(values) > i:
                                    extras[key] = values[i]
                            if extras:
                                detection["extras"] = extras

                            detection["points"] = box  # convenient alias for downstream usage
                            detections.append(detection)

        return {"detections": detections, "metadata": metadata}

    @classmethod
    def format_for_label(
        cls,
        detections: List[Dict[str, Any]],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Format OCR results into minimal label JSON format (方案 A).

        Args:
            detections: OCR detection results from run_ocr()
            metadata: OCR metadata from run_ocr()

        Returns:
            Formatted label data ready to be saved as JSON
        """
        shapes: List[Dict[str, Any]] = []

        for detection in detections:
            points = detection.get("points")
            if not isinstance(points, list):
                continue

            # 正規化座標格式
            normalized_points: List[List[float]] = []
            for point in points:
                if (
                    isinstance(point, (list, tuple))
                    and len(point) >= 2
                    and isinstance(point[0], (int, float))
                    and isinstance(point[1], (int, float))
                ):
                    normalized_points.append([float(point[0]), float(point[1])])

            if not normalized_points:
                continue

            shape: Dict[str, Any] = {
                "text": detection.get("text", ""),
                "points": normalized_points,
                "confidence": detection.get("confidence", 0.0),
                "orientation": detection.get("orientation", -1)
            }

            # Retain detection extras if present (e.g., dt_poly, rec_box)
            extras = detection.get("extras")
            if isinstance(extras, dict):
                shape.update(extras)

            shapes.append(shape)

        result: Dict[str, Any] = {
            "version": "1.0",
            "shapes": shapes,
        }

        # Include the full OCR result JSON payload for frontend consumption
        if metadata:
            result["ocr_result"] = metadata

        return result
