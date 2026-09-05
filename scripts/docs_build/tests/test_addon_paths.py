import unittest
from pathlib import Path

from scripts.docs_build.addon_paths import (
    addon_for_teach_path,
    output_dir_for_addon,
    teach_dir_for_addon,
)


class TeachDirForAddonTests(unittest.TestCase):
    def test_crm_methodology_keeps_the_pre_existing_teach_dir(self):
        self.assertEqual(teach_dir_for_addon("crm_methodology"), Path("docs/teach"))

    def test_other_addons_use_the_hyphenated_convention(self):
        self.assertEqual(teach_dir_for_addon("hosting"), Path("docs/teach-hosting"))


class OutputDirForAddonTests(unittest.TestCase):
    def test_crm_methodology_keeps_the_pre_existing_output_dir(self):
        self.assertEqual(
            output_dir_for_addon("crm_methodology"),
            Path("custom_addons/crm_methodology/static/docs"),
        )

    def test_other_addons_use_the_addon_name(self):
        self.assertEqual(
            output_dir_for_addon("hosting"),
            Path("custom_addons/hosting/static/docs"),
        )


class AddonForTeachPathTests(unittest.TestCase):
    def test_infers_crm_methodology_from_the_default_teach_dir(self):
        self.assertEqual(
            addon_for_teach_path(Path("docs/teach/methodologies.md")), "crm_methodology",
        )

    def test_infers_crm_methodology_from_a_video_project_dir(self):
        self.assertEqual(
            addon_for_teach_path(Path("docs/teach/videos/methodologies")), "crm_methodology",
        )

    def test_infers_another_addon_from_its_hyphenated_teach_dir(self):
        self.assertEqual(
            addon_for_teach_path(Path("docs/teach-hosting/index.md")), "hosting",
        )

    def test_infers_another_addon_from_its_video_project_dir(self):
        self.assertEqual(
            addon_for_teach_path(Path("docs/teach-hosting/videos/index")), "hosting",
        )

    def test_path_outside_any_teach_dir_raises_value_error(self):
        path = Path("docs/adr/0025-thing.md")

        with self.assertRaises(ValueError) as ctx:
            addon_for_teach_path(path)

        self.assertIn(str(path), str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
