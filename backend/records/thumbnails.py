from __future__ import annotations

from pathlib import Path, PurePosixPath

from PIL import Image


THUMBNAIL_SIZE = (320, 320)


def ensure_thumbnail(workspace, relative_path: PurePosixPath) -> Path:
    """
    Ensure a thumbnail exists for the given page inside the workspace.
    Returns the thumbnail path on disk.
    """
    source = workspace.path / relative_path
    if not source.exists():
        raise FileNotFoundError(source)

    thumb_root = workspace.path / ".thumbnails"
    thumb_rel = Path(relative_path).with_suffix(".jpg")
    thumb_path = thumb_root / thumb_rel
    thumb_path.parent.mkdir(parents=True, exist_ok=True)

    if thumb_path.exists():
        if thumb_path.stat().st_mtime >= source.stat().st_mtime:
            return thumb_path

    with Image.open(source) as img:
        img = img.convert("RGB")
        img.thumbnail(THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
        img.save(thumb_path, format="JPEG", quality=85, optimize=True)

    return thumb_path
