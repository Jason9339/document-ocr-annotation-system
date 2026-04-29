from __future__ import annotations

import json
import re
import shutil
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Mapping, Tuple


SUPPORTED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}
IGNORED_FILE_NAMES = {".DS_Store", "Thumbs.db"}
IGNORED_DIRECTORY_NAMES = {"__MACOSX", ".git", ".svn"}
_NATURAL_SORT_RE = re.compile(r"(\d+)")


@dataclass(frozen=True)
class RecordUploadFile:
    name: str
    relative_path: PurePosixPath


@dataclass(frozen=True)
class RecordUploadCandidate:
    title: str
    files: Tuple[RecordUploadFile, ...]


@dataclass(frozen=True)
class RecordUploadLayout:
    kind: str
    records: Tuple[RecordUploadCandidate, ...]


@dataclass(frozen=True)
class PlannedRecordUploadFile:
    name: str
    relative_path: PurePosixPath
    action: str
    reason: str = ""


@dataclass(frozen=True)
class PlannedRecordUpload:
    title: str
    files: Tuple[PlannedRecordUploadFile, ...]
    new_page_count: int
    skipped_count: int


@dataclass(frozen=True)
class RecordUploadPlan:
    title: str
    records: Tuple[PlannedRecordUpload, ...]
    new_page_count: int
    skipped_count: int


@dataclass(frozen=True)
class RecordUploadFailure:
    record_title: str
    filename: str
    reason: str


@dataclass(frozen=True)
class RecordUploadCommitResult:
    imported: int
    skipped: int
    failed: int
    failures: Tuple[RecordUploadFailure, ...]


class LayoutDetectionError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def detect_record_upload_folder_layout(
    tree: Mapping[str, Any],
    *,
    root_name: str = "upload",
) -> RecordUploadLayout:
    """Classify an in-memory folder tree for Record Upload.

    The tree is intentionally plain data: each key is an entry name, a mapping value is a
    folder, and any non-mapping value is a file.
    """
    entries = _visible_entries(tree)
    folders = {name: value for name, value in entries.items() if _is_folder(value)}
    image_files = _image_file_names(entries)

    if "records" in folders and "labels" in folders:
        raise LayoutDetectionError(
            "workspace_import",
            "This looks like a full workspace import. Use Workspace Import instead.",
        )

    if image_files and folders:
        raise LayoutDetectionError(
            "mixed_root",
            "Images and folders cannot be mixed at the upload root.",
        )

    if image_files:
        return RecordUploadLayout(
            kind="bare_folder",
            records=(
                RecordUploadCandidate(
                    title=root_name,
                    files=tuple(
                        RecordUploadFile(name=name, relative_path=PurePosixPath(name))
                        for name in image_files
                    ),
                ),
            ),
        )

    if folders:
        records = []
        for folder_name in sorted(folders):
            child_entries = _visible_entries(folders[folder_name])
            child_folders = {
                name: value for name, value in child_entries.items() if _is_folder(value)
            }
            if child_folders:
                raise LayoutDetectionError(
                    "nested_record_folder",
                    "Record folders cannot contain nested folders.",
                )
            child_images = _image_file_names(child_entries)
            if not child_images:
                raise LayoutDetectionError(
                    "no_supported_images",
                    f"Record folder '{folder_name}' has no supported image files.",
                )
            records.append(
                RecordUploadCandidate(
                    title=folder_name,
                    files=tuple(
                        RecordUploadFile(
                            name=name,
                            relative_path=PurePosixPath(folder_name) / name,
                        )
                        for name in child_images
                    ),
                )
            )
        return RecordUploadLayout(kind="folder_of_subfolders", records=tuple(records))

    raise LayoutDetectionError(
        "no_supported_images",
        "Upload does not contain supported image files.",
    )


def plan_record_upload(
    layout: RecordUploadLayout,
    *,
    existing_pages_by_record: Mapping[str, Iterable[str]],
    title: str,
) -> RecordUploadPlan:
    records = []
    total_new = 0
    total_skipped = 0

    for candidate in layout.records:
        existing_pages = set(existing_pages_by_record.get(candidate.title, ()))
        planned_files = []
        new_count = 0
        skipped_count = 0

        for upload_file in candidate.files:
            validate_page_filename(upload_file.name)
            if upload_file.name in existing_pages:
                planned_files.append(
                    PlannedRecordUploadFile(
                        name=upload_file.name,
                        relative_path=upload_file.relative_path,
                        action="skip",
                        reason="page_exists",
                    )
                )
                skipped_count += 1
                continue

            planned_files.append(
                PlannedRecordUploadFile(
                    name=upload_file.name,
                    relative_path=upload_file.relative_path,
                    action="import",
                )
            )
            new_count += 1

        records.append(
            PlannedRecordUpload(
                title=candidate.title,
                files=tuple(planned_files),
                new_page_count=new_count,
                skipped_count=skipped_count,
            )
        )
        total_new += new_count
        total_skipped += skipped_count

    return RecordUploadPlan(
        title=title,
        records=tuple(records),
        new_page_count=total_new,
        skipped_count=total_skipped,
    )


def commit_record_upload_plan(
    plan: RecordUploadPlan,
    *,
    staging_root: Path,
    records_root: Path,
    labels_root: Path,
) -> RecordUploadCommitResult:
    imported = 0
    skipped = 0
    failures = []

    for record in plan.records:
        pages_dir = records_root / record.title / "pages"
        record_labels_root = labels_root / record.title

        for planned_file in record.files:
            if planned_file.action == "skip":
                skipped += 1
                continue

            try:
                validate_page_filename(planned_file.name)
                source = staging_root / Path(*planned_file.relative_path.parts)
                destination = pages_dir / planned_file.name
                sidecar = record_labels_root / PurePosixPath(planned_file.name).with_suffix(
                    ".json"
                ).name

                if destination.exists():
                    skipped += 1
                    continue

                pages_dir.mkdir(parents=True, exist_ok=True)
                record_labels_root.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
                if not sidecar.exists():
                    with sidecar.open("w", encoding="utf-8") as fh:
                        json.dump({"annotations": []}, fh, ensure_ascii=False, indent=2)
                imported += 1
            except (OSError, LayoutDetectionError) as exc:
                failures.append(
                    RecordUploadFailure(
                        record_title=record.title,
                        filename=planned_file.name,
                        reason=str(exc),
                    )
                )

    return RecordUploadCommitResult(
        imported=imported,
        skipped=skipped,
        failed=len(failures),
        failures=tuple(failures),
    )


def record_upload_plan_to_dict(plan: RecordUploadPlan) -> dict[str, Any]:
    return {
        "title": plan.title,
        "new_page_count": plan.new_page_count,
        "skipped_count": plan.skipped_count,
        "records": [
            {
                "title": record.title,
                "new_page_count": record.new_page_count,
                "skipped_count": record.skipped_count,
                "files": [
                    {
                        "name": upload_file.name,
                        "relative_path": upload_file.relative_path.as_posix(),
                        "action": upload_file.action,
                        "reason": upload_file.reason,
                    }
                    for upload_file in record.files
                ],
            }
            for record in plan.records
        ],
    }


def record_upload_plan_from_dict(payload: Mapping[str, Any]) -> RecordUploadPlan:
    records = []
    for raw_record in payload.get("records", []):
        files = []
        for raw_file in raw_record.get("files", []):
            files.append(
                PlannedRecordUploadFile(
                    name=str(raw_file.get("name", "")),
                    relative_path=PurePosixPath(str(raw_file.get("relative_path", ""))),
                    action=str(raw_file.get("action", "")),
                    reason=str(raw_file.get("reason", "")),
                )
            )
        records.append(
            PlannedRecordUpload(
                title=str(raw_record.get("title", "")),
                files=tuple(files),
                new_page_count=int(raw_record.get("new_page_count", 0)),
                skipped_count=int(raw_record.get("skipped_count", 0)),
            )
        )
    return RecordUploadPlan(
        title=str(payload.get("title", "")),
        records=tuple(records),
        new_page_count=int(payload.get("new_page_count", 0)),
        skipped_count=int(payload.get("skipped_count", 0)),
    )


def _visible_entries(tree: Mapping[str, Any]) -> Mapping[str, Any]:
    return {
        name: value
        for name, value in tree.items()
        if not _is_ignored_entry(name, is_folder=_is_folder(value))
    }


def _is_folder(value: Any) -> bool:
    return isinstance(value, Mapping)


def _image_file_names(entries: Mapping[str, Any]) -> Tuple[str, ...]:
    return natural_sort_names(
        name
        for name, value in entries.items()
        if not _is_folder(value) and _is_supported_image_name(name)
    )


def _is_supported_image_name(name: str) -> bool:
    return PurePosixPath(name).suffix.lower() in SUPPORTED_IMAGE_EXTENSIONS


def _is_ignored_entry(name: str, *, is_folder: bool) -> bool:
    if is_folder:
        return name in IGNORED_DIRECTORY_NAMES
    return name in IGNORED_FILE_NAMES


def natural_sort_names(names: Iterable[str]) -> Tuple[str, ...]:
    return tuple(sorted(names, key=_natural_sort_key))


def validate_page_filename(name: str) -> None:
    if "\x00" in name:
        raise LayoutDetectionError("unsafe_filename", "Filenames cannot contain null bytes.")
    if "/" in name or "\\" in name:
        raise LayoutDetectionError(
            "unsafe_filename",
            "Filenames cannot contain path separators.",
        )
    if ".." in name:
        raise LayoutDetectionError("unsafe_filename", "Filenames cannot contain '..'.")


def is_zip_entry_inside_staging(entry_name: str, staging_root: Path) -> bool:
    if "\x00" in entry_name or "\\" in entry_name:
        return False

    entry_path = PurePosixPath(entry_name)
    if entry_path.is_absolute() or any(part == ".." for part in entry_path.parts):
        return False

    root = staging_root.resolve()
    destination = (root / Path(*entry_path.parts)).resolve()
    return destination == root or root in destination.parents


def _natural_sort_key(name: str) -> Tuple[Any, ...]:
    return tuple(
        int(part) if part.isdigit() else part.casefold()
        for part in _NATURAL_SORT_RE.split(name)
    )
