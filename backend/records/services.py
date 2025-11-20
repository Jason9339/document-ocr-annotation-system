from __future__ import annotations

import json
import math
import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone as dt_timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from django.conf import settings
from django.core.files.uploadedfile import UploadedFile
from django.utils import timezone
from django.utils.text import slugify


WORKSPACE_STATE_FILE: Path = settings.WORKSPACE_STATE_FILE
WORKSPACE_ROOT: Path = settings.WORKSPACES_ROOT
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}
RECORD_METADATA_FILENAME = "metadata.json"
LABELS_DIRNAME = "labels"
ANNOTATIONS_SCHEMA_VERSION = 1
METADATA_TEMPLATES_DIRNAME = "metadata_templates"
DEFAULT_SHAPE_LABEL = "text"
WORKSPACE_INFO_FILENAME = "workspace.json"

DEFAULT_METADATA_TEMPLATE = {
    "id": "default",
    "label": "預設欄位",
    "description": "基本書籍欄位，包括作者、出版年份與分類。",
    "fields": [
        {
            "key": "author",
            "label": "作者",
            "type": "text",
            "required": False,
            "default": "",
        },
        {
            "key": "publication_year",
            "label": "出版年份",
            "type": "text",
            "required": False,
            "default": "",
        },
        {
            "key": "category",
            "label": "分類",
            "type": "text",
            "required": False,
            "default": "",
        },
    ],
}


@dataclass(frozen=True)
class Workspace:
    slug: str
    path: Path


@dataclass(frozen=True)
class Item:
    id: str
    record: str
    filename: str
    rel_path: Path


@dataclass(frozen=True)
class Record:
    slug: str
    title: str
    created_at: datetime
    page_count: int
    source: Optional[Dict[str, str]]
    has_annotations: bool = False

    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "slug": self.slug,
            "title": self.title,
            "created_at": self.created_at.isoformat(),
            "page_count": self.page_count,
            "has_annotations": self.has_annotations,
        }
        if self.source:
            payload["source"] = self.source
        return payload


class WorkspaceError(Exception):
    """Raised when workspace operations fail."""


class RecordError(Exception):
    """Raised when record operations fail."""


def list_workspaces() -> List[Workspace]:
    if not WORKSPACE_ROOT.exists():
        return []

    workspaces: List[Workspace] = []
    for child in sorted(WORKSPACE_ROOT.iterdir()):
        if child.is_dir() and not child.name.startswith("."):
            workspaces.append(Workspace(slug=child.name, path=child))
    return workspaces


def _workspace_info_path(workspace: Workspace) -> Path:
    return workspace.path / WORKSPACE_INFO_FILENAME


def load_workspace_info(workspace: Workspace) -> Dict[str, Any]:
    info_path = _workspace_info_path(workspace)
    if not info_path.exists():
        return {}
    try:
        with info_path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def update_workspace_info(slug: str, *, title: Optional[str] = None) -> Dict[str, Any]:
    workspace = get_workspace(slug)
    info = load_workspace_info(workspace)
    if title is not None:
        if not isinstance(title, str):
            raise WorkspaceError("Workspace title must be a string.")
        cleaned_title = title.strip()
        if cleaned_title:
            info["title"] = cleaned_title
        else:
            info.pop("title", None)

    info_path = _workspace_info_path(workspace)
    try:
        with info_path.open("w", encoding="utf-8") as fh:
            json.dump(info, fh, ensure_ascii=False, indent=2)
    except OSError as exc:
        raise WorkspaceError(f"Failed to update workspace info: {exc}") from exc
    return info


def _state_payload_path() -> Path:
    WORKSPACE_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    return WORKSPACE_STATE_FILE


def set_active_workspace(slug: str) -> Workspace:
    workspace = get_workspace(slug)
    payload = {"slug": workspace.slug}
    with _state_payload_path().open("w", encoding="utf-8") as fh:
        json.dump(payload, fh)
    return workspace


def get_workspace(slug: str) -> Workspace:
    path = WORKSPACE_ROOT / slug
    if not path.exists():
        raise WorkspaceError(f"Workspace '{slug}' does not exist.")
    if not path.is_dir():
        raise WorkspaceError(f"Workspace '{slug}' is not a directory.")
    return Workspace(slug=slug, path=path)


def create_workspace(slug: str, *, title: Optional[str] = None) -> Workspace:
    """Create a new workspace with the given slug and optional title."""
    if not slug or not slug.strip():
        raise WorkspaceError("Workspace slug cannot be empty.")

    # Validate slug format (alphanumeric, hyphens, underscores only)
    cleaned_slug = slugify(slug.strip())
    if not cleaned_slug:
        raise WorkspaceError("Workspace slug contains invalid characters.")

    workspace_path = WORKSPACE_ROOT / cleaned_slug
    if workspace_path.exists():
        raise WorkspaceError(f"Workspace '{cleaned_slug}' already exists.")

    try:
        # Create workspace directory structure
        workspace_path.mkdir(parents=True, exist_ok=False)
        (workspace_path / "records").mkdir(exist_ok=False)
        (workspace_path / LABELS_DIRNAME).mkdir(exist_ok=False)
        (workspace_path / ".thumbnails").mkdir(exist_ok=False)

        # Create workspace.json
        workspace_info = {}
        if title and title.strip():
            workspace_info["title"] = title.strip()

        info_path = workspace_path / WORKSPACE_INFO_FILENAME
        with info_path.open("w", encoding="utf-8") as fh:
            json.dump(workspace_info, fh, ensure_ascii=False, indent=2)

        return Workspace(slug=cleaned_slug, path=workspace_path)
    except OSError as exc:
        # Clean up on failure
        if workspace_path.exists():
            shutil.rmtree(workspace_path, ignore_errors=True)
        raise WorkspaceError(f"Failed to create workspace: {exc}") from exc


def get_active_workspace() -> Optional[Workspace]:
    try:
        with WORKSPACE_STATE_FILE.open("r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except FileNotFoundError:
        return None
    except json.JSONDecodeError:
        return None

    slug = payload.get("slug")
    if not slug:
        return None

    try:
        return get_workspace(slug)
    except WorkspaceError:
        return None


def _records_root(workspace: Workspace) -> Path:
    return workspace.path / "records"


def _labels_root(workspace: Workspace, record_slug: str) -> Path:
    return workspace.path / LABELS_DIRNAME / record_slug


def _record_metadata_path(record_path: Path) -> Path:
    return record_path / RECORD_METADATA_FILENAME


def _metadata_templates_root(workspace: Workspace) -> Path:
    return workspace.path / METADATA_TEMPLATES_DIRNAME


def _sanitize_metadata_template(data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(data, dict):
        return None
    template_id = data.get("id")
    if not isinstance(template_id, str) or not template_id.strip():
        return None
    template_id = template_id.strip()
    label = data.get("label")
    if not isinstance(label, str) or not label.strip():
        label = template_id
    description = data.get("description")
    if description is not None and not isinstance(description, str):
        description = None

    fields_payload = data.get("fields") or []
    if not isinstance(fields_payload, list):
        fields_payload = []

    fields: List[Dict[str, Any]] = []
    for raw_field in fields_payload:
        if not isinstance(raw_field, dict):
            continue
        key = raw_field.get("key")
        if not isinstance(key, str) or not key.strip():
            continue
        key = key.strip()
        field_label = raw_field.get("label")
        if not isinstance(field_label, str) or not field_label.strip():
            field_label = key
        field_type = raw_field.get("type")
        if not isinstance(field_type, str) or not field_type.strip():
            field_type = "text"
        default_value = raw_field.get("default")
        if default_value is None:
            default_value = ""
        required = bool(raw_field.get("required"))
        fields.append(
            {
                "key": key,
                "label": field_label,
                "type": field_type,
                "required": required,
                "default": "" if default_value is None else str(default_value),
            }
        )

    return {
        "id": template_id,
        "label": label,
        **({"description": description} if description else {}),
        "fields": fields,
    }


def list_metadata_templates(workspace: Workspace) -> List[Dict[str, Any]]:
    templates: List[Dict[str, Any]] = []
    seen_ids: set[str] = set()

    templates_root = _metadata_templates_root(workspace)
    if templates_root.exists():
        for path in sorted(templates_root.glob("*.json")):
            try:
                with path.open("r", encoding="utf-8") as fh:
                    raw = json.load(fh)
            except (OSError, json.JSONDecodeError):
                continue
            template = _sanitize_metadata_template(raw)
            if not template:
                continue
            if template["id"] in seen_ids:
                continue
            seen_ids.add(template["id"])
            templates.append(template)

    default_template = _sanitize_metadata_template(DEFAULT_METADATA_TEMPLATE)
    if default_template and default_template["id"] not in seen_ids:
        templates.append(default_template)

    return templates


def _normalize_metadata_values(values: Optional[Dict[str, Any]]) -> Dict[str, str]:
    if not isinstance(values, dict):
        return {}
    normalized: Dict[str, str] = {}
    for key, value in values.items():
        if not isinstance(key, str):
            continue
        key = key.strip()
        if not key:
            continue
        normalized[key] = "" if value is None else str(value)
    return normalized


def _parse_item_id(item_id: str) -> Tuple[str, str]:
    parts = item_id.split("/", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise WorkspaceError("Invalid item identifier.")
    return parts[0], parts[1]


def _load_record_metadata(record_path: Path) -> Dict[str, Any]:
    metadata_path = _record_metadata_path(record_path)
    if not metadata_path.exists():
        return {}
    try:
        with metadata_path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def _derive_record_title(slug: str) -> str:
    candidate = slug.replace("-", " ").replace("_", " ").strip()
    return candidate.title() if candidate else slug


def _count_pages(record_path: Path) -> int:
    pages_dir = record_path / "pages"
    if not pages_dir.exists():
        return 0
    count = 0
    for image_path in pages_dir.rglob("*"):
        if not image_path.is_file():
            continue
        if image_path.suffix.lower() in ALLOWED_EXTENSIONS:
            count += 1
    return count


def _has_annotations(workspace: Workspace, record_slug: str) -> bool:
    """Check if a record has any annotation files with non-empty 'shapes' or 'annotations' arrays."""
    labels_root = _labels_root(workspace, record_slug)
    if not labels_root.exists():
        return False

    # Iterate through .json sidecar files and check their 'shapes' or 'annotations' fields.
    for path in labels_root.glob("*.json"):
        if not path.is_file():
            continue
        try:
            with path.open("r", encoding="utf-8") as fh:
                payload = json.load(fh)
        except (OSError, json.JSONDecodeError):
            # Ignore unreadable/invalid files.
            continue
        if isinstance(payload, dict):
            raw_shapes = payload.get("shapes")
            if isinstance(raw_shapes, list) and len(raw_shapes) > 0:
                return True
            raw_annotations = payload.get("annotations")
            if isinstance(raw_annotations, list) and len(raw_annotations) > 0:
                return True
    return False


def _parse_created_at(metadata: Dict[str, Any], record_path: Path) -> datetime:
    value = metadata.get("created_at")
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=dt_timezone.utc)
            return parsed
        except ValueError:
            pass
    return datetime.fromtimestamp(record_path.stat().st_mtime, tz=dt_timezone.utc)


def _annotation_payload_path(workspace: Workspace, record_slug: str, filename: str) -> Path:
    labels_root = _labels_root(workspace, record_slug)
    return labels_root / Path(filename).with_suffix(".json")


def _shapes_to_annotations(shapes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    annotations: List[Dict[str, Any]] = []
    for index, shape in enumerate(shapes):
        points = shape.get("points")
        if not isinstance(points, list) or not points:
            continue
        numeric_points: List[Tuple[float, float]] = []
        for point in points:
            if (
                isinstance(point, (list, tuple))
                and len(point) >= 2
                and isinstance(point[0], (int, float))
                and isinstance(point[1], (int, float))
            ):
                numeric_points.append((float(point[0]), float(point[1])))
        if not numeric_points:
            continue
        xs = [pt[0] for pt in numeric_points]
        ys = [pt[1] for pt in numeric_points]
        min_x = min(xs)
        max_x = max(xs)
        min_y = min(ys)
        max_y = max(ys)

        raw_group_id = shape.get("group_id")
        if isinstance(raw_group_id, (int, float)) and math.isfinite(raw_group_id):
            normalised_group_id: Optional[int] = int(raw_group_id)
        else:
            normalised_group_id = None

        annotation: Dict[str, Any] = {
            "id": shape.get("id") or f"shape-{index}",
            "text": shape.get("text") or "",
            "label": shape.get("label") or DEFAULT_SHAPE_LABEL,
            "x": min_x,
            "y": min_y,
            "width": max_x - min_x,
            "height": max_y - min_y,
            "rotation": 0.0,
            "order": shape.get("order", index),
            "group_id": normalised_group_id,
        }

        for key, value in shape.items():
            if key in {
                "points",
                "group_id",
                "shape_type",
                "flags",
                "confidence",
                "label",
                "text",
                "order",
            }:
                continue
            annotation[key] = value

        annotations.append(annotation)
    return annotations


def _annotations_to_shapes(annotations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    shapes: List[Dict[str, Any]] = []
    for index, annotation in enumerate(annotations):
        try:
            x = float(annotation.get("x", 0))
            y = float(annotation.get("y", 0))
            width = float(annotation.get("width", 0))
            height = float(annotation.get("height", 0))
        except (TypeError, ValueError):
            continue

        points = [
            [x, y],
            [x + width, y],
            [x + width, y + height],
            [x, y + height],
        ]

        raw_group_id = annotation.get("group_id")
        if isinstance(raw_group_id, (int, float)) and math.isfinite(raw_group_id):
            normalized_group_id: Optional[int] = int(raw_group_id)
        else:
            normalized_group_id = None

        shape: Dict[str, Any] = {
            "id": annotation.get("id") or f"annotation-{index}",
            "label": annotation.get("label") or annotation.get("text") or DEFAULT_SHAPE_LABEL,
            "text": annotation.get("text") or "",
            "points": points,
            "group_id": normalized_group_id,
            "shape_type": annotation.get("shape_type") or "polygon",
            "flags": annotation.get("flags") or {},
            "confidence": annotation.get("confidence"),
            "order": annotation.get("order", index),
        }

        for key, value in annotation.items():
            if key in {
                "id",
                "label",
                "text",
                "x",
                "y",
                "width",
                "height",
                "rotation",
                "order",
                "group_id",
                "shape_type",
                "flags",
                "confidence",
            }:
                continue
            shape[key] = value

        shapes.append(shape)
    return shapes


def load_annotations(workspace: Workspace, item_id: str) -> Dict[str, Any]:
    record_slug, filename = _parse_item_id(item_id)
    sidecar_path = _annotation_payload_path(workspace, record_slug, filename)
    if not sidecar_path.exists():
        return {
            "schema_version": ANNOTATIONS_SCHEMA_VERSION,
            "annotations": [],
            "shapes": [],
            "metadata": {},
            "updated_at": timezone.now().isoformat(),
        }
    try:
        with sidecar_path.open("r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except (json.JSONDecodeError, OSError):
        payload = {}
    if not isinstance(payload, dict):
        payload = {}

    payload.setdefault("schema_version", ANNOTATIONS_SCHEMA_VERSION)

    raw_shapes = payload.get("shapes")
    shapes = raw_shapes if isinstance(raw_shapes, list) else []

    raw_annotations = payload.get("annotations")
    if isinstance(raw_annotations, list):
        annotations = raw_annotations
        if not shapes:
            shapes = _annotations_to_shapes(annotations)
            payload["shapes"] = shapes
    else:
        annotations = _shapes_to_annotations(shapes)

    payload["annotations"] = annotations
    payload["shapes"] = shapes
    payload["updated_at"] = payload.get("updated_at") or timezone.now().isoformat()

    metadata_values = payload.get("metadata")
    payload["metadata"] = _normalize_metadata_values(
        metadata_values if isinstance(metadata_values, dict) else {}
    )
    return payload


def clear_record_annotations(workspace: Workspace, record_slug: str) -> int:
    items = list(iter_items(workspace, record_slug=record_slug))
    cleared = 0
    for item in items:
        save_annotations(
            workspace,
            item.id,
            {
                "annotations": [],
                "shapes": [],
                "metadata": {},
                "ocr_result": {},
            },
        )
        cleared += 1
    return cleared


def save_annotations(workspace: Workspace, item_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    record_slug, filename = _parse_item_id(item_id)
    sidecar_path = _annotation_payload_path(workspace, record_slug, filename)
    sidecar_path.parent.mkdir(parents=True, exist_ok=True)

    preserve_existing_metadata = "metadata" not in data
    existing_payload: Optional[Dict[str, Any]] = None
    if preserve_existing_metadata:
        existing_payload = load_annotations(workspace, item_id)

    shapes_input = data.get("shapes")
    if isinstance(data.get("annotations"), list):
        annotations = data["annotations"]
    elif isinstance(shapes_input, list):
        annotations = _shapes_to_annotations(shapes_input)
    elif existing_payload is not None:
        annotations = existing_payload.get("annotations", [])
    else:
        annotations = []

    if isinstance(shapes_input, list):
        shapes = shapes_input
    else:
        shapes = _annotations_to_shapes(annotations)

    schema_version = data.get("schema_version") or (
        existing_payload.get("schema_version") if existing_payload else None
    )
    if not isinstance(schema_version, int):
        schema_version = ANNOTATIONS_SCHEMA_VERSION

    if "metadata" in data and isinstance(data["metadata"], dict):
        metadata_values = _normalize_metadata_values(data["metadata"])
    elif existing_payload is not None:
        metadata_values = _normalize_metadata_values(existing_payload.get("metadata"))
    else:
        metadata_values = {}

    if "ocr_result" in data and isinstance(data["ocr_result"], dict):
        ocr_result_payload: Optional[Dict[str, Any]] = data["ocr_result"]
    elif existing_payload is not None and isinstance(existing_payload.get("ocr_result"), dict):
        ocr_result_payload = existing_payload["ocr_result"]
    else:
        ocr_result_payload = None

    payload = {
        "schema_version": schema_version,
        "annotations": annotations,
        "shapes": shapes,
        "metadata": metadata_values,
        "updated_at": timezone.now().isoformat(),
    }
    if ocr_result_payload is not None:
        payload["ocr_result"] = ocr_result_payload

    file_payload = {
        "schema_version": schema_version,
        "shapes": shapes,
        "metadata": metadata_values,
        "updated_at": payload["updated_at"],
    }
    if ocr_result_payload is not None:
        file_payload["ocr_result"] = ocr_result_payload

    with sidecar_path.open("w", encoding="utf-8") as fh:
        json.dump(file_payload, fh, ensure_ascii=False, indent=2)

    return payload


def list_records(workspace: Workspace) -> List[Record]:
    records_path = _records_root(workspace)
    if not records_path.exists():
        return []

    records: List[Record] = []
    for record_dir in sorted(records_path.iterdir()):
        if not record_dir.is_dir():
            continue
        metadata = _load_record_metadata(record_dir)
        slug = record_dir.name
        title = metadata.get("title") or _derive_record_title(slug)
        page_count = _count_pages(record_dir)
        created_at = _parse_created_at(metadata, record_dir)
        source = metadata.get("source") if isinstance(metadata.get("source"), dict) else None
        has_annotations = _has_annotations(workspace, slug)
        records.append(
            Record(
                slug=slug,
                title=title,
                created_at=created_at,
                page_count=page_count,
                source=source,
                has_annotations=has_annotations,
            )
        )
    return records


def get_record(workspace: Workspace, slug: str) -> Record:
    record_path = _records_root(workspace) / slug
    if not record_path.exists() or not record_path.is_dir():
        raise RecordError(f"Record '{slug}' does not exist.")
    metadata = _load_record_metadata(record_path)
    title = metadata.get("title") or _derive_record_title(slug)
    page_count = _count_pages(record_path)
    created_at = _parse_created_at(metadata, record_path)
    source = metadata.get("source") if isinstance(metadata.get("source"), dict) else None
    has_annotations = _has_annotations(workspace, slug)
    return Record(
        slug=slug,
        title=title,
        created_at=created_at,
        page_count=page_count,
        source=source,
        has_annotations=has_annotations,
    )


def get_record_metadata_payload(workspace: Workspace, slug: str) -> Dict[str, Any]:
    record_path = _records_root(workspace) / slug
    if not record_path.exists() or not record_path.is_dir():
        raise RecordError(f"Record '{slug}' does not exist.")
    metadata = _load_record_metadata(record_path)
    metadata_block = metadata.get("metadata")
    if not isinstance(metadata_block, dict):
        metadata_block = {}
    template = metadata_block.get("template")
    if not isinstance(template, str) or not template.strip():
        template = None
    values = metadata_block.get("values") if isinstance(metadata_block.get("values"), dict) else {}
    normalized_values = _normalize_metadata_values(values)
    updated_at = metadata_block.get("updated_at")
    if not isinstance(updated_at, str):
        updated_at = None
    payload: Dict[str, Any] = {
        "template": template,
        "values": normalized_values,
    }
    if updated_at:
        payload["updated_at"] = updated_at
    return payload


def update_record_metadata(
    workspace: Workspace,
    slug: str,
    *,
    template: Optional[str],
    values: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    record_path = _records_root(workspace) / slug
    if not record_path.exists() or not record_path.is_dir():
        raise RecordError(f"Record '{slug}' does not exist.")
    metadata = _load_record_metadata(record_path)
    normalized_values = _normalize_metadata_values(values)
    metadata_block: Dict[str, Any] = {
        "template": template or None,
        "values": normalized_values,
        "updated_at": timezone.now().isoformat(),
    }
    metadata["metadata"] = metadata_block
    _write_record_metadata(record_path, metadata)
    return metadata_block


def _write_record_metadata(record_path: Path, payload: Dict[str, Any]) -> None:
    metadata_path = _record_metadata_path(record_path)
    with metadata_path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)


def get_item(workspace: Workspace, item_id: str) -> Item:
    record_slug, filename = _parse_item_id(item_id)
    records_dir = _records_root(workspace)
    record_dir = records_dir / record_slug
    if not record_dir.exists() or not record_dir.is_dir():
        raise WorkspaceError(f"Record '{record_slug}' does not exist.")
    pages_dir = record_dir / "pages"
    source_path = pages_dir / filename
    if not source_path.exists() or not source_path.is_file():
        raise WorkspaceError(f"Page '{item_id}' does not exist.")
    rel_path = source_path.relative_to(workspace.path)
    return Item(
        id=item_id,
        record=record_slug,
        filename=filename,
        rel_path=rel_path,
    )


def get_item_metadata(workspace: Workspace, item_id: str) -> Dict[str, str]:
    payload = load_annotations(workspace, item_id)
    metadata_values = payload.get("metadata")
    return _normalize_metadata_values(metadata_values if isinstance(metadata_values, dict) else {})


def update_item_metadata(
    workspace: Workspace,
    item_id: str,
    metadata: Optional[Dict[str, Any]],
    *,
    merge: bool,
) -> Dict[str, str]:
    # Ensure the item exists.
    get_item(workspace, item_id)
    existing_payload = load_annotations(workspace, item_id)
    existing_metadata = existing_payload.get("metadata")
    existing_metadata = _normalize_metadata_values(
        existing_metadata if isinstance(existing_metadata, dict) else {}
    )
    incoming = _normalize_metadata_values(metadata)
    if merge:
        merged = existing_metadata.copy()
        merged.update(incoming)
        metadata_to_save = merged
    else:
        metadata_to_save = incoming
    existing_payload["metadata"] = metadata_to_save
    saved_payload = save_annotations(workspace, item_id, existing_payload)
    saved_metadata = saved_payload.get("metadata")
    return _normalize_metadata_values(saved_metadata if isinstance(saved_metadata, dict) else {})


def batch_update_items_metadata(
    workspace: Workspace,
    item_ids: Sequence[str],
    metadata: Optional[Dict[str, Any]],
    *,
    merge: bool,
) -> Dict[str, Any]:
    results = {
        "updated": [],
        "failed": [],
    }
    for item_id in item_ids:
        try:
            updated = update_item_metadata(
                workspace,
                item_id,
                metadata,
                merge=merge,
            )
            results["updated"].append({"item": item_id, "metadata": updated})
        except WorkspaceError as exc:
            results["failed"].append({"item": item_id, "error": str(exc)})
    results["updated_count"] = len(results["updated"])
    results["failed_count"] = len(results["failed"])
    return results


def delete_record(workspace: Workspace, slug: str) -> None:
    """Delete a record and all its associated data."""
    record_path = _records_root(workspace) / slug
    if not record_path.exists() or not record_path.is_dir():
        raise RecordError(f"Record '{slug}' does not exist.")

    # Delete the record directory and all its contents
    shutil.rmtree(record_path, ignore_errors=False)

    # Delete associated labels/annotations
    labels_path = _labels_root(workspace, slug)
    if labels_path.exists():
        shutil.rmtree(labels_path, ignore_errors=True)


def create_record_from_upload(
    workspace: Workspace,
    *,
    upload_file: UploadedFile,
    slug: Optional[str] = None,
    title: Optional[str] = None,
) -> Record:
    if upload_file.size == 0:
        raise RecordError("Uploaded檔案為空，無法建立 Record。")

    derived_slug = slugify(slug or Path(upload_file.name).stem)
    if not derived_slug:
        raise RecordError("Record 名稱無效。")

    records_path = _records_root(workspace)
    record_path = records_path / derived_slug
    if record_path.exists():
        raise RecordError(f"Record '{derived_slug}' 已存在，請選擇其他名稱。")

    pages_dir = record_path / "pages"
    copied_files: List[Path] = []
    record_created = False

    with tempfile.TemporaryDirectory() as tmp_dir:
        archive_path = Path(tmp_dir) / "upload.zip"
        with archive_path.open("wb") as buffer:
            for chunk in upload_file.chunks():
                buffer.write(chunk)

        try:
            with zipfile.ZipFile(archive_path) as archive:
                members = [
                    name
                    for name in archive.namelist()
                    if not name.endswith("/") and not name.startswith("__MACOSX/")
                ]
                image_members = [
                    name for name in members if Path(name).suffix.lower() in ALLOWED_EXTENSIONS
                ]
                if not image_members:
                    raise RecordError("壓縮檔內沒有支援的影像格式。")

                record_path.mkdir(parents=True, exist_ok=False)
                record_created = True
                pages_dir.mkdir(parents=True, exist_ok=False)

                for member in sorted(image_members):
                    filename = Path(member).name
                    destination = pages_dir / filename
                    if destination.exists():
                        raise RecordError(f"檔名 {filename} 重複，請整理後再上傳。")
                    with archive.open(member) as src, destination.open("wb") as dst:
                        shutil.copyfileobj(src, dst)
                    copied_files.append(destination)
        except zipfile.BadZipFile as exc:
            raise RecordError("上傳的檔案不是合法的 ZIP 壓縮檔。") from exc
        except Exception:
            if record_created:
                shutil.rmtree(record_path, ignore_errors=True)
            raise

    labels_root = _labels_root(workspace, derived_slug)
    labels_root.mkdir(parents=True, exist_ok=True)
    for page_file in copied_files:
        sidecar = labels_root / Path(page_file.name).with_suffix(".json")
        if not sidecar.exists():
            with sidecar.open("w", encoding="utf-8") as fh:
                json.dump({"annotations": []}, fh, ensure_ascii=False, indent=2)

    created_at = timezone.now()
    metadata_payload = {
        "slug": derived_slug,
        "title": title or _derive_record_title(derived_slug),
        "created_at": created_at.isoformat(),
        "page_count": len(copied_files),
        "source": {"type": "upload", "name": upload_file.name},
    }
    _write_record_metadata(record_path, metadata_payload)

    return Record(
        slug=derived_slug,
        title=metadata_payload["title"],
        created_at=created_at,
        page_count=len(copied_files),
        source=metadata_payload["source"],
    )


def iter_items(workspace: Workspace, record_slug: Optional[str] = None) -> Iterable[Item]:
    records_dir = _records_root(workspace)
    if not records_dir.exists():
        return []

    if record_slug:
        target = records_dir / record_slug
        if not target.exists() or not target.is_dir():
            raise WorkspaceError(f"Record '{record_slug}' does not exist.")
        record_dirs = [target]
    else:
        record_dirs = [d for d in sorted(records_dir.iterdir()) if d.is_dir()]

    for record_dir in record_dirs:
        record_name = record_dir.name
        pages_dir = record_dir / "pages"
        if not pages_dir.exists():
            continue
        for image_path in sorted(pages_dir.rglob("*")):
            if not image_path.is_file():
                continue
            if image_path.suffix.lower() not in ALLOWED_EXTENSIONS:
                continue
            rel_path = image_path.relative_to(workspace.path)
            item_id = f"{record_name}/{image_path.name}"
            yield Item(
                id=item_id,
                record=record_name,
                filename=image_path.name,
                rel_path=rel_path,
            )


def filter_items(
    items: Iterable[Item],
    *,
    query: Optional[str] = None,
    sort: Optional[str] = None,
) -> List[Item]:
    filtered = list(items)
    if query:
        q = query.lower()
        filtered = [
            item
            for item in filtered
            if q in item.filename.lower() or q in item.record.lower()
        ]

    sort_key = (sort or "record").lower()
    if sort_key == "filename":
        filtered.sort(key=lambda item: item.filename)
    else:
        filtered.sort(key=lambda item: (item.record, item.filename))
    return filtered


def paginate_items(items: Sequence[Item], *, page: int, page_size: int) -> Sequence[Item]:
    start = max(page - 1, 0) * page_size
    end = start + page_size
    return items[start:end]
