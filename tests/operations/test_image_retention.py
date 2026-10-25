"""Protect deploy/rollback images from accidental lifecycle broadening."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ImageRetentionTests(unittest.TestCase):
    def test_cleanup_can_never_match_tagged_releases(self):
        policy = json.loads((ROOT / "infra/terraform/modules/ecr/image-lifecycle-policy.json").read_text())
        self.assertTrue(policy["rules"], "Expected an explicit cleanup policy")
        for rule in policy["rules"]:
            selection = rule["selection"]
            self.assertEqual(selection["tagStatus"], "untagged", "Never expire SHA-tagged active or rollback images")
            self.assertEqual(selection["countType"], "sinceImagePushed")
            self.assertEqual(selection["countUnit"], "days")
            self.assertGreaterEqual(selection["countNumber"], 30, "Allow time for interrupted builds and diagnosis")
            self.assertEqual(rule["action"]["type"], "expire")
            self.assertNotIn("tagPatternList", selection)
            self.assertNotIn("tagPrefixList", selection)

    def test_reviewed_policy_is_used_and_has_power_coverage(self):
        source = (ROOT / "infra/terraform/modules/ecr/lifecycle.tf").read_text()
        self.assertIn('repository = aws_ecr_repository.app.name', source)
        self.assertIn('file("${path.module}/image-lifecycle-policy.json")', source)
        inventory = json.loads((ROOT / "config/dev-power.json").read_text())
        self.assertTrue(inventory["retainedResourceTypes"]["aws_ecr_lifecycle_policy"])
