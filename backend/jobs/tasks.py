from __future__ import annotations

import json
import os
from copy import deepcopy
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image, ImageDraw

import django

# Initialize Django before importing models
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.utils import timezone

from jobs.models import Job
from jobs.ocr_service import OCRService
from jobs.services import (
    mark_job_failed,
    mark_job_finished,
    mark_job_running,
    update_job_progress,
)
from records.services import (
    WorkspaceError,
    get_workspace,
    get_item,
    iter_items,
    load_annotations,
    save_annotations,
)


def _normalize_shape_points(points: Optional[Sequence[Sequence[float]]]) -> List[Tuple[float, float]]:
    normalized: List[Tuple[float, float]] = []
    for point in points or []:
        if (
            isinstance(point, (list, tuple))
            and len(point) >= 2
            and isinstance(point[0], (int, float))
            and isinstance(point[1], (int, float))
        ):
            normalized.append((float(point[0]), float(point[1])))
    return normalized


def _compute_bbox(points: Sequence[Tuple[float, float]], width: int, height: int) -> Optional[Tuple[int, int, int, int]]:
    if not points:
        return None
    xs = [pt[0] for pt in points]
    ys = [pt[1] for pt in points]
    min_x = max(int(math.floor(min(xs))), 0)
    min_y = max(int(math.floor(min(ys))), 0)
    max_x = min(int(math.ceil(max(xs))), width)
    max_y = min(int(math.ceil(max(ys))), height)
    if max_x - min_x < 2 or max_y - min_y < 2:
        return None
    return min_x, min_y, max_x, max_y


def _crop_polygon(rgb_image: Image.Image, points: Sequence[Tuple[float, float]], bbox: Tuple[int, int, int, int]) -> Image.Image:
    min_x, min_y, max_x, max_y = bbox
    crop = rgb_image.crop((min_x, min_y, max_x, max_y))
    if len(points) < 3:
        return crop

    mask = Image.new("L", crop.size, 0)
    draw = ImageDraw.Draw(mask)
    offset_points = [(float(pt[0] - min_x), float(pt[1] - min_y)) for pt in points]
    draw.polygon(offset_points, fill=255)
    white_bg = Image.new("RGB", crop.size, (255, 255, 255))
    return Image.composite(crop, white_bg, mask)


def _prepare_rec_input(image: Image.Image) -> np.ndarray:
    array = np.array(image)
    if array.ndim == 2:
        array = np.stack([array] * 3, axis=-1)
    array = array[:, :, ::-1]
    return np.ascontiguousarray(array)


def _extract_text_confidence(recognition_payload) -> Tuple[Optional[str], Optional[float]]:
    """Extract (text, confidence) from PaddleOCR TextRecognition outputs."""

    def _from_dict(data: Dict[str, Any]) -> Tuple[Optional[str], Optional[float]]:
        if not isinstance(data, dict):
            return None, None
        res_block = data.get("res") if isinstance(data.get("res"), dict) else data
        text = res_block.get("rec_text") or res_block.get("text")
        score = res_block.get("rec_score") or res_block.get("confidence") or res_block.get("score")
        return text if isinstance(text, str) else None, float(score) if isinstance(score, (int, float)) else None

    if recognition_payload is None:
        return None, None

    if hasattr(recognition_payload, "json"):
        return _from_dict(recognition_payload.json)  # type: ignore[attr-defined]

    if isinstance(recognition_payload, dict):
        return _from_dict(recognition_payload)

    if isinstance(recognition_payload, list):
        for entry in recognition_payload:
            text, conf = _extract_text_confidence(entry)
            if text is not None or conf is not None:
                return text, conf
        return None, None

    return None, None


def run_item_reocr_job(job_id: str, workspace_slug: str, item_id: str) -> Dict[str, object]:
    """
    Execute OCR recognition for a single item using the currently annotated boxes.

    This function:
    1. Loads the current annotations (shapes) for the item
    2. Re-runs PaddleOCR recognition within each user-defined box (no detection)
    3. Updates the text (and confidence when available) on the shapes in place
    4. Saves the refreshed annotations back to the label JSON file
    """
    job = Job.objects.get(pk=job_id)
    mark_job_running(job)

    try:
        try:
            workspace = get_workspace(workspace_slug)
        except WorkspaceError as exc:
            mark_job_failed(job, message=str(exc))
            raise

        # Get the item
        try:
            item = get_item(workspace, item_id)
        except Exception as exc:
            mark_job_failed(job, message=f"找不到頁面: {str(exc)}")
            raise

        # Get the image path
        image_path = workspace.path / item.rel_path

        payload = load_annotations(workspace, item_id)
        shapes_raw = payload.get("shapes") if isinstance(payload.get("shapes"), list) else []
        if not shapes_raw:
            raise ValueError("此頁面尚未有可重新辨識的框。請先完成框校正再試一次。")

        shapes = [deepcopy(shape) for shape in shapes_raw]
        recognizer = OCRService.get_text_recognition_engine()

        update_job_progress(job, progress=10)

        recognized = 0
        shape_entries: List[Tuple[int, List[Tuple[float, float]], Tuple[int, int, int, int]]] = []
        with Image.open(image_path) as pil_image:
            rgb_image = pil_image.convert("RGB")
            width, height = rgb_image.size

            for index, shape in enumerate(shapes):
                normalized_points = _normalize_shape_points(shape.get("points"))
                if not normalized_points:
                    continue
                bbox = _compute_bbox(normalized_points, width, height)
                if not bbox:
                    continue
                shape_entries.append((index, normalized_points, bbox))

            if not shape_entries:
                raise ValueError("找不到有效的框可辨識，請確認標註資料。")

            BATCH_LIMIT = 16
            batch_inputs: List[np.ndarray] = []
            batch_meta: List[Tuple[int, int]] = []  # (shape_index, rotation_index)
            best_results: Dict[int, Tuple[Optional[str], float]] = {}

            def _flush_batch():
                if not batch_inputs:
                    return
                results = recognizer.predict(batch_inputs, batch_size=len(batch_inputs))
                for (shape_index, _rotation_idx), result in zip(batch_meta, results):
                    text, confidence = _extract_text_confidence(result)
                    score = float(confidence) if isinstance(confidence, (int, float)) else -1.0
                    best_text, best_score = best_results.get(shape_index, (None, -1.0))
                    if text is not None and score > best_score:
                        best_results[shape_index] = (text, score)
                batch_inputs.clear()
                batch_meta.clear()

            rotations = [0, 90, 180, 270]

            for processed, (shape_index, points, bbox) in enumerate(shape_entries, start=1):
                crop = _crop_polygon(rgb_image, points, bbox)
                for rotation_idx, angle in enumerate(rotations):
                    rotated = crop.rotate(angle, expand=True) if angle != 0 else crop
                    batch_inputs.append(_prepare_rec_input(rotated))
                    batch_meta.append((shape_index, rotation_idx))

                    if len(batch_inputs) >= BATCH_LIMIT:
                        _flush_batch()

                progress = 10 + int(processed / len(shape_entries) * 80)
                update_job_progress(job, progress=min(progress, 90))

            _flush_batch()

            recognized = 0
            for shape_index, (text, score) in best_results.items():
                if text is None:
                    continue
                recognized += 1
                shapes[shape_index]["text"] = text
                if isinstance(score, (int, float)) and score >= 0:
                    shapes[shape_index]["confidence"] = score

        save_annotations(workspace, item_id, {"shapes": shapes})

        update_job_progress(job, progress=100)
        mark_job_finished(job)

        job.payload = {
            "item_id": item_id,
            "recognized_boxes": recognized,
            "total_boxes": len(shape_entries),
            "completed_at": timezone.now().isoformat(),
        }
        job.save(update_fields=["payload", "updated_at"])
        return job.payload

    except Exception as exc:
        mark_job_failed(job, message=str(exc))
        raise


def run_record_ocr_job(job_id: str, workspace_slug: str, record_slug: str) -> Dict[str, object]:
    """
    Execute OCR processing for all pages in a record.

    This function:
    1. Loads all pages from the record
    2. Runs PaddleOCR on each page
    3. Saves results to label JSON files
    4. Updates job progress in real-time
    """
    job = Job.objects.get(pk=job_id)
    mark_job_running(job)

    ocr_results_count = 0

    try:
        try:
            workspace = get_workspace(workspace_slug)
        except WorkspaceError as exc:
            mark_job_failed(job, message=str(exc))
            raise

        items = list(iter_items(workspace, record_slug=record_slug))
        total = max(len(items), 1)

        for index, item in enumerate(items, start=1):
            # Get the page image path
            image_path = workspace.path / item.rel_path

            # Run OCR on the image
            ocr_result = OCRService.run_ocr(image_path)
            detections = ocr_result['detections']
            metadata = ocr_result['metadata']

            # Format results as label JSON
            label_data = OCRService.format_for_label(detections, metadata)

            # Save to label file
            label_dir = workspace.path / 'labels' / record_slug
            label_dir.mkdir(parents=True, exist_ok=True)
            # Use Path to get filename without extension
            from pathlib import Path
            filename_without_ext = Path(item.filename).stem
            label_path = label_dir / f"{filename_without_ext}.json"

            with open(label_path, 'w', encoding='utf-8') as f:
                json.dump(label_data, f, ensure_ascii=False, indent=2)

            ocr_results_count += len(detections)

            # Update progress
            progress = int(index / total * 100)
            job.progress = progress
            update_job_progress(job, progress=progress)

        mark_job_finished(job)
        job.payload = {
            "record": record_slug,
            "pages": len(items),
            "total_detections": ocr_results_count,
            "completed_at": timezone.now().isoformat(),
        }
        job.save(update_fields=["payload", "updated_at"])
        return job.payload
    except Exception as exc:  # pylint: disable=broad-except
        mark_job_failed(job, message=str(exc))
        raise
