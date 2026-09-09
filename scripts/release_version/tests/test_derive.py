import unittest

from scripts.release_version.derive import ReleaseVersionError, derive_manifest_version


class DeriveManifestVersionWellFormedTagsTests(unittest.TestCase):
    def test_derives_series_prefixed_version_from_simple_tag(self):
        self.assertEqual(derive_manifest_version("v1.0.0"), "19.0.1.0.0")

    def test_derives_from_multi_digit_components(self):
        self.assertEqual(derive_manifest_version("v12.34.56"), "19.0.12.34.56")

    def test_zero_components_are_valid(self):
        self.assertEqual(derive_manifest_version("v0.0.0"), "19.0.0.0.0")


class DeriveManifestVersionMalformedTagsTests(unittest.TestCase):
    def test_missing_v_prefix_is_rejected(self):
        with self.assertRaises(ReleaseVersionError) as ctx:
            derive_manifest_version("1.2.3")

        self.assertIn("not a well-formed release tag", str(ctx.exception))

    def test_too_few_components_is_rejected(self):
        with self.assertRaises(ReleaseVersionError) as ctx:
            derive_manifest_version("v1.2")

        self.assertIn("not a well-formed release tag", str(ctx.exception))

    def test_too_many_components_is_rejected(self):
        with self.assertRaises(ReleaseVersionError) as ctx:
            derive_manifest_version("v1.2.3.4")

        self.assertIn("not a well-formed release tag", str(ctx.exception))

    def test_non_numeric_component_is_rejected(self):
        with self.assertRaises(ReleaseVersionError) as ctx:
            derive_manifest_version("v1.x.3")

        self.assertIn("not a well-formed release tag", str(ctx.exception))

    def test_leading_zero_component_is_rejected(self):
        with self.assertRaises(ReleaseVersionError) as ctx:
            derive_manifest_version("v1.02.3")

        self.assertIn("not a well-formed release tag", str(ctx.exception))

    def test_empty_tag_is_rejected(self):
        with self.assertRaises(ReleaseVersionError) as ctx:
            derive_manifest_version("")

        self.assertIn("not a well-formed release tag", str(ctx.exception))

    def test_arbitrary_branch_like_label_is_rejected(self):
        with self.assertRaises(ReleaseVersionError) as ctx:
            derive_manifest_version("dev/19.0")

        self.assertIn("not a well-formed release tag", str(ctx.exception))


class DeriveManifestVersionPreReleaseTagsTests(unittest.TestCase):
    def test_prerelease_suffix_is_rejected_with_its_own_message(self):
        with self.assertRaises(ReleaseVersionError) as ctx:
            derive_manifest_version("v1.2.3-rc.1")

        self.assertIn("pre-release or build-metadata tag", str(ctx.exception))
        self.assertIn("-rc.1", str(ctx.exception))

    def test_named_prerelease_suffix_is_rejected(self):
        with self.assertRaises(ReleaseVersionError) as ctx:
            derive_manifest_version("v1.2.3-beta")

        self.assertIn("pre-release or build-metadata tag", str(ctx.exception))

    def test_build_metadata_suffix_is_rejected(self):
        with self.assertRaises(ReleaseVersionError) as ctx:
            derive_manifest_version("v1.2.3+build.5")

        self.assertIn("pre-release or build-metadata tag", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
