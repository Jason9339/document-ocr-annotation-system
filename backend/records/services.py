from __future__ import annotations

import json
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

    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "slug": self.slug,
            "title": self.title,
            "created_at": self.created_at.isoformat(),
            "page_count": self.page_count,
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


def load_annotations(workspace: Workspace, item_id: str) -> Dict[str, Any]:
    record_slug, filename = _parse_item_id(item_id)
    sidecar_path = _annotation_payload_path(workspace, record_slug, filename)
    if not sidecar_path.exists():
        return {
            "schema_version": ANNOTATIONS_SCHEMA_VERSION,
            "annotations": [],
            "updated_at": timezone.now().isoformat(),
        }
    try:
        with sidecar_path.open("r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except (json.JSONDecodeError, OSError):
        return {
            "schema_version": ANNOTATIONS_SCHEMA_VERSION,
            "annotations": [],
            "updated_at": timezone.now().isoformat(),
        }
    if not isinstance(payload, dict):
        return {
            "schema_version": ANNOTATIONS_SCHEMA_VERSION,
            "annotations": [],
            "updated_at": timezone.now().isoformat(),
        }
    payload.setdefault("schema_version", ANNOTATIONS_SCHEMA_VERSION)
    payload.setdefault("annotations", [])
    payload["updated_at"] = payload.get("updated_at") or timezone.now().isoformat()
    return payload


def save_annotations(workspace: Workspace, item_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    record_slug, filename = _parse_item_id(item_id)
    sidecar_path = _annotation_payload_path(workspace, record_slug, filename)
    sidecar_path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "schema_version": data.get("schema_version") or ANNOTATIONS_SCHEMA_VERSION,
        "annotations": data.get("annotations") or [],
        "updated_at": timezone.now().isoformat(),
    }

    with sidecar_path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)

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
        records.append(
            Record(
                slug=slug,
                title=title,
                created_at=created_at,
                page_count=page_count,
                source=source,
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
    return Record(
        slug=slug,
        title=title,
        created_at=created_at,
        page_count=page_count,
        source=source,
    )


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
