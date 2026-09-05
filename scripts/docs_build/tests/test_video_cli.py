import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.docs_build.video_cli import DocsBuildError, main, render_video


def _fake_runner(returncode=0, stderr="", write_output=True):
    """Return a stand-in for `subprocess.run` that never actually shells out.

    Simulates the effect of a real `hyperframes render` call: on success, it
    writes bytes at the `--output` path the command was given (real
    `hyperframes render` writes the file itself; this test double writes an
    empty stand-in instead of rendering an actual video).
    """

    def runner(command):
        if write_output and returncode == 0:
            output_path = Path(command[command.index("--output") + 1])
            output_path.write_bytes(b"fake-mp4-bytes")
        return subprocess.CompletedProcess(command, returncode, stdout="", stderr=stderr)

    return runner


class RenderVideoTests(unittest.TestCase):
    def _make_project(self, tmp: str, name: str = "my-video") -> Path:
        project_dir = Path(tmp) / name
        project_dir.mkdir(parents=True)
        (project_dir / "hyperframes.json").write_text("{}", encoding="utf-8")
        return project_dir

    def test_missing_project_directory_fails_clearly(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp) / "does-not-exist"
            output_dir = Path(tmp) / "out"

            with self.assertRaises(DocsBuildError) as ctx:
                render_video(project_dir, output_dir, runner=_fake_runner())

            self.assertIn(str(project_dir), str(ctx.exception))

    def test_directory_without_hyperframes_json_is_not_an_authored_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp) / "not-a-project"
            project_dir.mkdir()
            output_dir = Path(tmp) / "out"

            with self.assertRaises(DocsBuildError) as ctx:
                render_video(project_dir, output_dir, runner=_fake_runner())

            self.assertIn("hyperframes.json", str(ctx.exception))

    def test_renders_to_output_dir_named_after_the_project_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = self._make_project(tmp, name="sales-methodology-vs-odoo-crm")
            output_dir = Path(tmp) / "out"

            output_path = render_video(project_dir, output_dir, runner=_fake_runner())

            self.assertEqual(output_path, output_dir / "sales-methodology-vs-odoo-crm.mp4")
            self.assertTrue(output_path.is_file())

    def test_invokes_hyperframes_render_with_the_project_dir_and_output_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = self._make_project(tmp)
            output_dir = Path(tmp) / "out"
            captured = []

            def runner(command):
                captured.append(command)
                return _fake_runner()(command)

            render_video(project_dir, output_dir, runner=runner)

            [command] = captured
            self.assertIn("hyperframes", command)
            self.assertIn("render", command)
            self.assertIn(str(project_dir), command)
            self.assertIn(str(output_dir / f"{project_dir.name}.mp4"), command)

    def test_never_authors_only_renders_the_existing_project_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = self._make_project(tmp)
            (project_dir / "index.html").write_text("<html>original</html>", encoding="utf-8")
            output_dir = Path(tmp) / "out"

            render_video(project_dir, output_dir, runner=_fake_runner())

            self.assertEqual(
                (project_dir / "index.html").read_text(encoding="utf-8"), "<html>original</html>",
            )

    def test_nonzero_exit_from_hyperframes_render_fails_with_stderr(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = self._make_project(tmp)
            output_dir = Path(tmp) / "out"

            with self.assertRaises(DocsBuildError) as ctx:
                render_video(
                    project_dir,
                    output_dir,
                    runner=_fake_runner(returncode=1, stderr="ffmpeg not found"),
                )

            self.assertIn("ffmpeg not found", str(ctx.exception))

    def test_success_exit_but_no_output_file_written_still_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = self._make_project(tmp)
            output_dir = Path(tmp) / "out"

            with self.assertRaises(DocsBuildError) as ctx:
                render_video(project_dir, output_dir, runner=_fake_runner(write_output=False))

            self.assertIn(str(output_dir / f"{project_dir.name}.mp4"), str(ctx.exception))

    def test_missing_npx_on_path_fails_clearly(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = self._make_project(tmp)
            output_dir = Path(tmp) / "out"

            with mock.patch("shutil.which", return_value=None):
                with self.assertRaises(DocsBuildError) as ctx:
                    render_video(project_dir, output_dir, runner=_fake_runner())

            self.assertIn("npx", str(ctx.exception))


class MainAddonInferenceTests(unittest.TestCase):
    def test_infers_addon_output_dir_from_the_project_dirs_teach_prefix(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project_dir = root / "docs" / "teach-hosting" / "videos" / "index"
            project_dir.mkdir(parents=True)
            (project_dir / "hyperframes.json").write_text("{}", encoding="utf-8")

            with mock.patch("scripts.docs_build.video_cli.render_video") as render_mock:
                render_mock.return_value = project_dir / "fake.mp4"
                exit_code = main([str(project_dir)])

            self.assertEqual(exit_code, 0)
            render_mock.assert_called_once_with(
                project_dir, Path("custom_addons") / "hosting" / "static" / "docs",
            )

    def test_crm_methodology_project_dir_still_infers_the_original_output_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project_dir = root / "docs" / "teach" / "videos" / "methodologies"
            project_dir.mkdir(parents=True)
            (project_dir / "hyperframes.json").write_text("{}", encoding="utf-8")

            with mock.patch("scripts.docs_build.video_cli.render_video") as render_mock:
                render_mock.return_value = project_dir / "fake.mp4"
                exit_code = main([str(project_dir)])

            self.assertEqual(exit_code, 0)
            render_mock.assert_called_once_with(
                project_dir, Path("custom_addons") / "crm_methodology" / "static" / "docs",
            )

    def test_a_project_dir_outside_any_teach_dir_fails_clearly(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp) / "somewhere" / "else"
            project_dir.mkdir(parents=True)

            with mock.patch("scripts.docs_build.video_cli.render_video") as render_mock:
                exit_code = main([str(project_dir)])

            self.assertEqual(exit_code, 1)
            render_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
