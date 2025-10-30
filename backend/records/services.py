from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional, Sequence

from django.conf import settings


WORKSPACE_STATE_FILE: Path = settings.WORKSPACE_STATE_FILE
WORKSPACE_ROOT: Path = settings.WORKSPACES_ROOT
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}


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


class WorkspaceError(Exception):
    """Raised when workspace operations fail."""


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


def iter_items(workspace: Workspace) -> Iterable[Item]:
    records_dir = workspace.path / "records"
    if not records_dir.exists():
        return

    for record_dir in sorted(records_dir.iterdir()):
        if not record_dir.is_dir():
            continue
        record_slug = record_dir.name
        pages_dir = record_dir / "pages"
        if not pages_dir.exists():
            continue
        for image_path in sorted(pages_dir.rglob("*")):
            if not image_path.is_file():
                continue
            if image_path.suffix.lower() not in ALLOWED_EXTENSIONS:
                continue
            rel_path = image_path.relative_to(workspace.path)
            item_id = f"{record_slug}/{image_path.name}"
            yield Item(
                id=item_id,
                record=record_slug,
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
