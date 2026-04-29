import io
import json
import tempfile
import zipfile
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase

from . import services as record_services
from .importing import (
    LayoutDetectionError,
    commit_record_upload_plan,
    detect_record_upload_folder_layout,
    is_zip_entry_inside_staging,
    natural_sort_names,
    plan_record_upload,
    validate_page_filename,
)
from .services import (
    RecordError,
    Workspace,
    WorkspaceError,
    create_record_from_upload,
    create_records_from_file_batch,
    create_records_from_upload,
    commit_staged_record_upload,
    delete_workspace,
    discard_staged_record_upload,
    export_workspace_to_zip,
    import_workspace_from_upload,
    list_records,
    preview_records_from_upload,
)


MINIMAL_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de"
    "0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082"
)


def _zip_upload(filename: str, image_name: str) -> SimpleUploadedFile:
    return _zip_upload_entries(filename, {image_name: MINIMAL_PNG})


def _zip_upload_entries(filename: str, entries: dict[str, bytes]) -> SimpleUploadedFile:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, payload in entries.items():
            archive.writestr(name, payload)
    return SimpleUploadedFile(
        filename,
        buffer.getvalue(),
        content_type="application/zip",
    )


class RecordUploadTests(SimpleTestCase):
    def test_create_record_from_upload_accepts_unicode_filename_slug(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            workspace = Workspace(slug="demo", path=Path(tmp_dir))
            upload = _zip_upload("測試書.zip", "頁面-001.png")

            record = create_record_from_upload(workspace, upload_file=upload)

            self.assertEqual(record.slug, "測試書")
            self.assertEqual(record.page_count, 1)
            page_path = workspace.path / "records" / "測試書" / "pages" / "頁面-001.png"
            label_path = workspace.path / "labels" / "測試書" / "頁面-001.json"
            self.assertTrue(page_path.is_file())
            self.assertTrue(label_path.is_file())

            metadata_path = workspace.path / "records" / "測試書" / "metadata.json"
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            self.assertEqual(metadata["source"]["name"], "測試書.zip")

    def test_create_records_from_zip_root_images_uses_zip_name_as_record(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            workspace = Workspace(slug="demo", path=Path(tmp_dir))
            upload = _zip_upload_entries(
                "第一冊.zip",
                {
                    "2.jpg": b"image-2",
                    "1.jpg": b"image-1",
                },
            )

            result = create_records_from_upload(workspace, upload_file=upload)

            self.assertEqual(result.imported, 2)
            self.assertEqual(result.skipped, 0)
            self.assertEqual(result.failed, 0)
            self.assertEqual([record.slug for record in result.records], ["第一冊"])
            self.assertEqual(
                (workspace.path / "records" / "第一冊" / "pages" / "1.jpg").read_bytes(),
                b"image-1",
            )
            self.assertTrue((workspace.path / "labels" / "第一冊" / "1.json").is_file())

    def test_create_records_from_zip_subfolders_creates_multiple_records(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            workspace = Workspace(slug="demo", path=Path(tmp_dir))
            upload = _zip_upload_entries(
                "books.zip",
                {
                    "第一冊/001.jpg": b"book-1",
                    "第二冊/001.webp": b"book-2",
                },
            )

            result = create_records_from_upload(workspace, upload_file=upload)

            self.assertEqual(result.imported, 2)
            self.assertEqual(result.skipped, 0)
            self.assertEqual(result.failed, 0)
            self.assertEqual([record.slug for record in result.records], ["第一冊", "第二冊"])
            self.assertTrue((workspace.path / "records" / "第一冊" / "pages" / "001.jpg").is_file())
            self.assertTrue((workspace.path / "records" / "第二冊" / "pages" / "001.webp").is_file())

    def test_create_records_from_upload_skips_duplicate_pages(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            workspace = Workspace(slug="demo", path=Path(tmp_dir))
            existing_page = workspace.path / "records" / "第一冊" / "pages" / "001.jpg"
            existing_label = workspace.path / "labels" / "第一冊" / "001.json"
            existing_page.parent.mkdir(parents=True)
            existing_label.parent.mkdir(parents=True)
            existing_page.write_bytes(b"old")
            existing_label.write_text('{"annotations": [{"id": "keep"}]}', encoding="utf-8")

            upload = _zip_upload_entries(
                "第一冊.zip",
                {
                    "001.jpg": b"new",
                    "002.jpg": b"second",
                },
            )

            result = create_records_from_upload(workspace, upload_file=upload)

            self.assertEqual(result.imported, 1)
            self.assertEqual(result.skipped, 1)
            self.assertEqual(result.failed, 0)
            self.assertEqual(existing_page.read_bytes(), b"old")
            self.assertEqual(
                existing_label.read_text(encoding="utf-8"),
                '{"annotations": [{"id": "keep"}]}',
            )
            self.assertTrue((workspace.path / "records" / "第一冊" / "pages" / "002.jpg").is_file())

    def test_create_records_from_upload_rejects_workspace_import_structure(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            workspace = Workspace(slug="demo", path=Path(tmp_dir))
            upload = _zip_upload_entries(
                "workspace.zip",
                {
                    "records/第一冊/pages/001.jpg": b"image",
                    "labels/第一冊/001.json": b'{"annotations": []}',
                },
            )

            with self.assertRaisesMessage(RecordError, "Workspace Import"):
                create_records_from_upload(workspace, upload_file=upload)

    def test_preview_records_from_upload_does_not_commit_until_confirmed(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            workspace = Workspace(slug="demo", path=Path(tmp_dir))
            upload = _zip_upload_entries(
                "第一冊.zip",
                {
                    "001.jpg": b"image",
                },
            )

            preview = preview_records_from_upload(workspace, upload_file=upload)

            self.assertEqual(preview.plan.new_page_count, 1)
            self.assertFalse((workspace.path / "records" / "第一冊").exists())

            result = commit_staged_record_upload(workspace, upload_id=preview.upload_id)

            self.assertEqual(result.imported, 1)
            self.assertTrue((workspace.path / "records" / "第一冊" / "pages" / "001.jpg").is_file())

    def test_discard_staged_record_upload_removes_preview_files(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            workspace = Workspace(slug="demo", path=Path(tmp_dir))
            upload = _zip_upload_entries("第一冊.zip", {"001.jpg": b"image"})

            preview = preview_records_from_upload(workspace, upload_file=upload)
            session_path = record_services.RECORD_UPLOAD_STAGING_ROOT / preview.upload_id
            self.assertTrue(session_path.exists())

            discard_staged_record_upload(upload_id=preview.upload_id)

            self.assertFalse(session_path.exists())
            self.assertFalse((workspace.path / "records" / "第一冊").exists())

    def test_create_records_from_file_batch_imports_bare_folder_as_single_record(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            workspace = Workspace(slug="demo", path=Path(tmp_dir))
            files = [
                SimpleUploadedFile("001.jpg", b"image-1"),
                SimpleUploadedFile("002.jpg", b"image-2"),
            ]

            result = create_records_from_file_batch(
                workspace,
                upload_files=files,
                relative_paths=["001.jpg", "002.jpg"],
                root_name="第一冊",
            )

            self.assertEqual(result.imported, 2)
            self.assertEqual([record.slug for record in result.records], ["第一冊"])
            self.assertTrue((workspace.path / "records" / "第一冊" / "pages" / "001.jpg").is_file())

    def test_create_records_from_file_batch_imports_subfolders_as_multiple_records(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            workspace = Workspace(slug="demo", path=Path(tmp_dir))
            files = [
                SimpleUploadedFile("001.jpg", b"book-1"),
                SimpleUploadedFile("001.jpg", b"book-2"),
            ]

            result = create_records_from_file_batch(
                workspace,
                upload_files=files,
                relative_paths=["第一冊/001.jpg", "第二冊/001.jpg"],
                root_name="upload",
            )

            self.assertEqual(result.imported, 2)
            self.assertEqual([record.slug for record in result.records], ["第一冊", "第二冊"])
            self.assertTrue((workspace.path / "records" / "第一冊" / "pages" / "001.jpg").is_file())
            self.assertTrue((workspace.path / "records" / "第二冊" / "pages" / "001.jpg").is_file())


class RecordUploadLayoutDetectorTests(SimpleTestCase):
    def test_detects_bare_folder_with_supported_images(self):
        layout = detect_record_upload_folder_layout(
            {
                "001.jpg": None,
                "002.PNG": None,
                "notes.txt": None,
            },
            root_name="第一冊",
        )

        self.assertEqual(layout.kind, "bare_folder")
        self.assertEqual(len(layout.records), 1)
        self.assertEqual(layout.records[0].title, "第一冊")
        self.assertEqual(
            [file.name for file in layout.records[0].files],
            ["001.jpg", "002.PNG"],
        )

    def test_detects_folder_of_subfolders(self):
        layout = detect_record_upload_folder_layout(
            {
                "第一冊": {
                    "001.jpg": None,
                    "002.jpeg": None,
                },
                "第二冊": {
                    "001.tif": None,
                },
            },
            root_name="upload",
        )

        self.assertEqual(layout.kind, "folder_of_subfolders")
        self.assertEqual([record.title for record in layout.records], ["第一冊", "第二冊"])
        self.assertEqual(
            [file.name for file in layout.records[0].files],
            ["001.jpg", "002.jpeg"],
        )

    def test_ignores_unsupported_extensions_before_detection(self):
        layout = detect_record_upload_folder_layout(
            {
                "第一冊": {
                    "001.webp": None,
                    "readme.md": None,
                },
                "第二冊": {
                    "001.tiff": None,
                    "scan.pdf": None,
                },
                "notes.txt": None,
            },
            root_name="upload",
        )

        self.assertEqual(layout.kind, "folder_of_subfolders")
        self.assertEqual([record.title for record in layout.records], ["第一冊", "第二冊"])

    def test_ignores_archive_noise_before_detection(self):
        layout = detect_record_upload_folder_layout(
            {
                "__MACOSX": {
                    "junk": None,
                },
                ".git": {
                    "config": None,
                },
                ".svn": {
                    "entries": None,
                },
                ".DS_Store": None,
                "Thumbs.db": None,
                "001.jpg": None,
            },
            root_name="第一冊",
        )

        self.assertEqual(layout.kind, "bare_folder")
        self.assertEqual([file.name for file in layout.records[0].files], ["001.jpg"])

    def test_rejects_mixed_images_and_folders_at_root(self):
        with self.assertRaises(LayoutDetectionError) as context:
            detect_record_upload_folder_layout(
                {
                    "001.jpg": None,
                    "第一冊": {
                        "002.jpg": None,
                    },
                }
            )

        self.assertEqual(context.exception.code, "mixed_root")

    def test_rejects_nested_record_folder(self):
        with self.assertRaises(LayoutDetectionError) as context:
            detect_record_upload_folder_layout(
                {
                    "第一冊": {
                        "chapter-1": {
                            "001.jpg": None,
                        },
                    },
                }
            )

        self.assertEqual(context.exception.code, "nested_record_folder")

    def test_rejects_workspace_import_structure(self):
        with self.assertRaises(LayoutDetectionError) as context:
            detect_record_upload_folder_layout(
                {
                    "records": {
                        "第一冊": {
                            "pages": {
                                "001.jpg": None,
                            },
                        },
                    },
                    "labels": {
                        "第一冊": {
                            "001.json": None,
                        },
                    },
                }
            )

        self.assertEqual(context.exception.code, "workspace_import")

    def test_rejects_upload_without_supported_images(self):
        with self.assertRaises(LayoutDetectionError) as context:
            detect_record_upload_folder_layout(
                {
                    "notes.txt": None,
                    ".DS_Store": None,
                }
            )

        self.assertEqual(context.exception.code, "no_supported_images")


class RecordUploadNameHelperTests(SimpleTestCase):
    def test_natural_sort_orders_numeric_filename_parts(self):
        self.assertEqual(
            natural_sort_names(["10.jpg", "1.jpg", "2.jpg", "page-11.png", "page-3.png"]),
            ("1.jpg", "2.jpg", "10.jpg", "page-3.png", "page-11.png"),
        )

    def test_natural_sort_preserves_unicode_names(self):
        self.assertEqual(
            natural_sort_names(["第10頁.jpg", "第2頁.jpg", "第1頁.jpg"]),
            ("第1頁.jpg", "第2頁.jpg", "第10頁.jpg"),
        )

    def test_detector_applies_natural_sort_to_image_files(self):
        layout = detect_record_upload_folder_layout(
            {
                "10.jpg": None,
                "1.jpg": None,
                "2.jpg": None,
                "scan.pdf": None,
            },
            root_name="第一冊",
        )

        self.assertEqual(
            [file.name for file in layout.records[0].files],
            ["1.jpg", "2.jpg", "10.jpg"],
        )

    def test_validate_page_filename_accepts_unicode_spaces_and_symbols(self):
        validate_page_filename("羅 家倫-第01頁 (修訂版).jpg")

    def test_validate_page_filename_rejects_path_traversal_and_separators(self):
        unsafe_names = [
            "../001.jpg",
            "001/002.jpg",
            "001\\002.jpg",
            "page..jpg",
            "001\x00.jpg",
        ]

        for name in unsafe_names:
            with self.subTest(name=name):
                with self.assertRaises(LayoutDetectionError) as context:
                    validate_page_filename(name)
                self.assertEqual(context.exception.code, "unsafe_filename")

    def test_zip_entry_must_resolve_inside_staging_root(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            staging_root = Path(tmp_dir)

            self.assertTrue(is_zip_entry_inside_staging("第一冊/001.jpg", staging_root))
            self.assertFalse(is_zip_entry_inside_staging("../escape.jpg", staging_root))
            self.assertFalse(is_zip_entry_inside_staging("/absolute/escape.jpg", staging_root))
            self.assertFalse(is_zip_entry_inside_staging("第一冊/../../escape.jpg", staging_root))
            self.assertFalse(is_zip_entry_inside_staging("第一冊/001\x00.jpg", staging_root))


class RecordUploadPlannerTests(SimpleTestCase):
    def test_plan_marks_all_pages_new_for_new_record(self):
        layout = detect_record_upload_folder_layout(
            {
                "2.jpg": None,
                "1.jpg": None,
            },
            root_name="第一冊",
        )

        plan = plan_record_upload(
            layout,
            existing_pages_by_record={},
            title="Upload preview",
        )

        self.assertEqual(plan.title, "Upload preview")
        self.assertEqual(plan.new_page_count, 2)
        self.assertEqual(plan.skipped_count, 0)
        self.assertEqual(plan.records[0].title, "第一冊")
        self.assertEqual(plan.records[0].new_page_count, 2)
        self.assertEqual([file.name for file in plan.records[0].files], ["1.jpg", "2.jpg"])
        self.assertEqual([file.action for file in plan.records[0].files], ["import", "import"])

    def test_plan_appends_to_existing_record_and_skips_duplicate_pages(self):
        layout = detect_record_upload_folder_layout(
            {
                "001.jpg": None,
                "002.jpg": None,
                "003.jpg": None,
            },
            root_name="第一冊",
        )

        plan = plan_record_upload(
            layout,
            existing_pages_by_record={"第一冊": {"001.jpg", "003.jpg"}},
            title="Upload preview",
        )

        self.assertEqual(plan.new_page_count, 1)
        self.assertEqual(plan.skipped_count, 2)
        self.assertEqual(plan.records[0].new_page_count, 1)
        self.assertEqual(plan.records[0].skipped_count, 2)
        self.assertEqual(
            [(file.name, file.action, file.reason) for file in plan.records[0].files],
            [
                ("001.jpg", "skip", "page_exists"),
                ("002.jpg", "import", ""),
                ("003.jpg", "skip", "page_exists"),
            ],
        )

    def test_plan_summarizes_multiple_records(self):
        layout = detect_record_upload_folder_layout(
            {
                "第一冊": {
                    "001.jpg": None,
                    "002.jpg": None,
                },
                "第二冊": {
                    "001.jpg": None,
                    "002.jpg": None,
                },
            }
        )

        plan = plan_record_upload(
            layout,
            existing_pages_by_record={
                "第一冊": {"001.jpg"},
                "第二冊": {"001.jpg", "002.jpg"},
            },
            title="Upload preview",
        )

        self.assertEqual(plan.new_page_count, 1)
        self.assertEqual(plan.skipped_count, 3)
        self.assertEqual(
            [(record.title, record.new_page_count, record.skipped_count) for record in plan.records],
            [
                ("第一冊", 1, 1),
                ("第二冊", 0, 2),
            ],
        )

    def test_plan_rejects_unsafe_page_filename(self):
        layout = detect_record_upload_folder_layout(
            {
                "page..jpg": None,
            },
            root_name="第一冊",
        )

        with self.assertRaises(LayoutDetectionError) as context:
            plan_record_upload(
                layout,
                existing_pages_by_record={},
                title="Upload preview",
            )

        self.assertEqual(context.exception.code, "unsafe_filename")


class RecordUploadCommitTests(SimpleTestCase):
    def test_commit_copies_new_pages_and_creates_empty_sidecars(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            staging_root = root / "staging"
            records_root = root / "records"
            labels_root = root / "labels"
            staging_root.mkdir()
            (staging_root / "001.jpg").write_bytes(b"image-1")
            (staging_root / "002.jpg").write_bytes(b"image-2")

            layout = detect_record_upload_folder_layout(
                {
                    "001.jpg": None,
                    "002.jpg": None,
                },
                root_name="第一冊",
            )
            plan = plan_record_upload(
                layout,
                existing_pages_by_record={},
                title="Upload preview",
            )

            result = commit_record_upload_plan(
                plan,
                staging_root=staging_root,
                records_root=records_root,
                labels_root=labels_root,
            )

            self.assertEqual(result.imported, 2)
            self.assertEqual(result.skipped, 0)
            self.assertEqual(result.failed, 0)
            self.assertEqual((records_root / "第一冊" / "pages" / "001.jpg").read_bytes(), b"image-1")
            self.assertTrue((labels_root / "第一冊" / "001.json").is_file())
            label_payload = json.loads((labels_root / "第一冊" / "001.json").read_text())
            self.assertEqual(label_payload, {"annotations": []})

    def test_commit_skips_existing_pages_without_touching_existing_labels(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            staging_root = root / "staging"
            records_root = root / "records"
            labels_root = root / "labels"
            staging_root.mkdir()
            (staging_root / "001.jpg").write_bytes(b"new-image")
            existing_page = records_root / "第一冊" / "pages" / "001.jpg"
            existing_label = labels_root / "第一冊" / "001.json"
            existing_page.parent.mkdir(parents=True)
            existing_label.parent.mkdir(parents=True)
            existing_page.write_bytes(b"old-image")
            existing_label.write_text('{"annotations": [{"id": "keep"}]}', encoding="utf-8")

            layout = detect_record_upload_folder_layout({"001.jpg": None}, root_name="第一冊")
            plan = plan_record_upload(
                layout,
                existing_pages_by_record={"第一冊": {"001.jpg"}},
                title="Upload preview",
            )

            result = commit_record_upload_plan(
                plan,
                staging_root=staging_root,
                records_root=records_root,
                labels_root=labels_root,
            )

            self.assertEqual(result.imported, 0)
            self.assertEqual(result.skipped, 1)
            self.assertEqual(result.failed, 0)
            self.assertEqual(existing_page.read_bytes(), b"old-image")
            self.assertEqual(existing_label.read_text(encoding="utf-8"), '{"annotations": [{"id": "keep"}]}')

    def test_commit_reports_failed_copy_and_continues(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            staging_root = root / "staging"
            records_root = root / "records"
            labels_root = root / "labels"
            staging_root.mkdir()
            (staging_root / "001.jpg").write_bytes(b"image-1")

            layout = detect_record_upload_folder_layout(
                {
                    "001.jpg": None,
                    "002.jpg": None,
                },
                root_name="第一冊",
            )
            plan = plan_record_upload(
                layout,
                existing_pages_by_record={},
                title="Upload preview",
            )

            result = commit_record_upload_plan(
                plan,
                staging_root=staging_root,
                records_root=records_root,
                labels_root=labels_root,
            )

            self.assertEqual(result.imported, 1)
            self.assertEqual(result.skipped, 0)
            self.assertEqual(result.failed, 1)
            self.assertEqual(result.failures[0].record_title, "第一冊")
            self.assertEqual(result.failures[0].filename, "002.jpg")
            self.assertTrue((records_root / "第一冊" / "pages" / "001.jpg").is_file())


class WorkspaceImportTests(SimpleTestCase):
    def test_delete_workspace_removes_directory_and_clears_active_state(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            workspaces_root = Path(tmp_dir) / "workspaces"
            state_file = Path(tmp_dir) / "state.json"
            workspace_path = workspaces_root / "demo"
            (workspace_path / "records").mkdir(parents=True)
            (workspace_path / "labels").mkdir()
            state_file.write_text('{"slug": "demo"}', encoding="utf-8")

            old_root = record_services.WORKSPACE_ROOT
            old_state_file = record_services.WORKSPACE_STATE_FILE
            record_services.WORKSPACE_ROOT = workspaces_root
            record_services.WORKSPACE_STATE_FILE = state_file
            try:
                delete_workspace("demo")
            finally:
                record_services.WORKSPACE_ROOT = old_root
                record_services.WORKSPACE_STATE_FILE = old_state_file

            self.assertFalse(workspace_path.exists())
            self.assertFalse(state_file.exists())

    def test_import_workspace_copies_records_labels_and_uses_requested_title(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            workspaces_root = Path(tmp_dir) / "workspaces"
            upload = _zip_upload_entries(
                "export.zip",
                {
                    "exported/records/第一冊/pages/001.jpg": b"image",
                    "exported/labels/第一冊/001.json": b'{"bad json"',
                    "exported/workspace.json": '{"title": "匯出的標題", "ignored": true}'.encode(
                        "utf-8"
                    ),
                },
            )

            old_root = record_services.WORKSPACE_ROOT
            record_services.WORKSPACE_ROOT = workspaces_root
            try:
                result = import_workspace_from_upload(
                    upload_file=upload,
                    workspace_name="新工作區",
                )
            finally:
                record_services.WORKSPACE_ROOT = old_root

            workspace_path = workspaces_root / "新工作區"
            self.assertEqual(result.workspace.slug, "新工作區")
            self.assertEqual(result.imported, 1)
            self.assertTrue((workspace_path / "records" / "第一冊" / "pages" / "001.jpg").is_file())
            self.assertEqual(
                (workspace_path / "labels" / "第一冊" / "001.json").read_text(encoding="utf-8"),
                '{"bad json"',
            )
            workspace_info = json.loads((workspace_path / "workspace.json").read_text(encoding="utf-8"))
            self.assertEqual(workspace_info, {"title": "新工作區"})

    def test_list_records_reports_completion_from_sidecars(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            workspace = Workspace(slug="demo", path=Path(tmp_dir))
            pages_dir = workspace.path / "records" / "第一冊" / "pages"
            labels_dir = workspace.path / "labels" / "第一冊"
            pages_dir.mkdir(parents=True)
            labels_dir.mkdir(parents=True)
            (pages_dir / "001.jpg").write_bytes(b"image-1")
            (pages_dir / "002.jpg").write_bytes(b"image-2")
            (labels_dir / "001.json").write_text(
                json.dumps({"completed": True}, ensure_ascii=False),
                encoding="utf-8",
            )
            (labels_dir / "002.json").write_text(
                json.dumps({"completed": False, "shapes": [{"label": "text"}]}, ensure_ascii=False),
                encoding="utf-8",
            )

            records = list_records(workspace)

            self.assertEqual(len(records), 1)
            self.assertEqual(records[0].completed_count, 1)
            self.assertEqual(records[0].completion_percent, 50)
            self.assertTrue(records[0].has_annotations)

    def test_export_workspace_zip_excludes_thumbnails(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            workspace = Workspace(slug="demo", path=Path(tmp_dir) / "demo")
            (workspace.path / "records" / "第一冊" / "pages").mkdir(parents=True)
            (workspace.path / "labels" / "第一冊").mkdir(parents=True)
            (workspace.path / ".thumbnails" / "records" / "第一冊" / "pages").mkdir(parents=True)
            (workspace.path / "records" / "第一冊" / "pages" / "001.jpg").write_bytes(b"image")
            (workspace.path / "labels" / "第一冊" / "001.json").write_text("{}", encoding="utf-8")
            (workspace.path / "workspace.json").write_text('{"title": "Demo"}', encoding="utf-8")
            (workspace.path / ".thumbnails" / "records" / "第一冊" / "pages" / "001.jpg").write_bytes(
                b"thumb"
            )

            archive_path = export_workspace_to_zip(workspace)
            try:
                with zipfile.ZipFile(archive_path) as archive:
                    names = set(archive.namelist())
            finally:
                archive_path.unlink(missing_ok=True)

            self.assertIn("demo/records/第一冊/pages/001.jpg", names)
            self.assertIn("demo/labels/第一冊/001.json", names)
            self.assertIn("demo/workspace.json", names)
            self.assertNotIn("demo/.thumbnails/records/第一冊/pages/001.jpg", names)

    def test_import_workspace_ignores_thumbnails(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            workspaces_root = Path(tmp_dir) / "workspaces"
            upload = _zip_upload_entries(
                "export.zip",
                {
                    "records/第一冊/pages/001.jpg": b"image",
                    "labels/第一冊/001.json": b"{}",
                    ".thumbnails/records/第一冊/001.jpg": b"thumb",
                },
            )

            old_root = record_services.WORKSPACE_ROOT
            record_services.WORKSPACE_ROOT = workspaces_root
            try:
                import_workspace_from_upload(upload_file=upload, workspace_name="demo")
            finally:
                record_services.WORKSPACE_ROOT = old_root

            self.assertFalse((workspaces_root / "demo" / ".thumbnails").exists())

    def test_import_workspace_requires_records_and_labels(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            workspaces_root = Path(tmp_dir) / "workspaces"
            upload = _zip_upload_entries(
                "export.zip",
                {
                    "records/第一冊/pages/001.jpg": b"image",
                },
            )

            old_root = record_services.WORKSPACE_ROOT
            record_services.WORKSPACE_ROOT = workspaces_root
            try:
                with self.assertRaisesMessage(WorkspaceError, "records/ 或 labels/"):
                    import_workspace_from_upload(upload_file=upload, workspace_name="demo")
            finally:
                record_services.WORKSPACE_ROOT = old_root

    def test_import_workspace_rejects_existing_slug(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            workspaces_root = Path(tmp_dir) / "workspaces"
            (workspaces_root / "demo").mkdir(parents=True)
            upload = _zip_upload_entries(
                "export.zip",
                {
                    "records/第一冊/pages/001.jpg": b"image",
                    "labels/第一冊/001.json": b"{}",
                },
            )

            old_root = record_services.WORKSPACE_ROOT
            record_services.WORKSPACE_ROOT = workspaces_root
            try:
                with self.assertRaisesMessage(WorkspaceError, "already exists"):
                    import_workspace_from_upload(upload_file=upload, workspace_name="demo")
            finally:
                record_services.WORKSPACE_ROOT = old_root
