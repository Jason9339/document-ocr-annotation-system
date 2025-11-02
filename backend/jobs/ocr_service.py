"""
PaddleOCR Service Module

Provides OCR functionality using PaddleOCR with support for both CPU and GPU.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import List, Dict, Any, Optional

from paddleocr import PaddleOCR


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
            use_gpu_env = os.getenv('USE_GPU', '0').lower()

            if use_gpu_env in ('1', 'true', 'yes'):
                device = 'gpu'
            else:
                device = 'cpu'

            # Get language setting (default to Chinese + English)
            lang = os.getenv('OCR_LANG', 'ch')

            # Initialize PaddleOCR with PaddleOCR 3.x parameters
            # Use mobile models for lower memory usage
            cls._instance = PaddleOCR(
                use_angle_cls=False,  # Disable angle classification to save memory
                lang=lang,            # Language: 'ch', 'en', 'japan', 'korean', etc.
                device=device,        # Device: 'cpu' or 'gpu'
                det_model_dir=None,   # Use default mobile detection model
                rec_model_dir=None,   # Use default mobile recognition model
            )

            print(f"✓ PaddleOCR initialized successfully")
            print(f"  Device: {device.upper()}")
            print(f"  Language: {lang}")

        return cls._instance

    @classmethod
    def run_ocr(cls, image_path: str | Path) -> List[Dict[str, Any]]:
        """
        Run OCR on a single image.

        Args:
            image_path: Path to the image file

        Returns:
            List of detection results, each containing:
                - box: [[x1,y1], [x2,y2], [x3,y3], [x4,y4]] coordinates
                - text: Recognized text
                - confidence: Recognition confidence score

        Example:
            >>> results = OCRService.run_ocr('path/to/image.jpg')
            >>> for item in results:
            ...     print(f"Text: {item['text']}, Confidence: {item['confidence']}")
        """
        ocr = cls.get_ocr_engine()
        image_path = str(image_path)

        # Run OCR
        result = ocr.ocr(image_path)

        # Parse results
        detections = []
        if result and result[0]:
            for line in result[0]:
                box = line[0]  # [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
                text_info = line[1]  # (text, confidence)
                text = text_info[0]
                confidence = float(text_info[1])

                detections.append({
                    'box': box,
                    'text': text,
                    'confidence': confidence
                })

        return detections

    @classmethod
    def format_for_label(cls, detections: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Format OCR results into label JSON format.

        Args:
            detections: OCR detection results from run_ocr()

        Returns:
            Formatted label data ready to be saved as JSON
        """
        return {
            'version': '1.0',
            'shapes': [
                {
                    'label': detection['text'],
                    'points': detection['box'],
                    'group_id': None,
                    'shape_type': 'polygon',
                    'flags': {},
                    'confidence': detection['confidence'],
                }
                for detection in detections
            ]
        }
