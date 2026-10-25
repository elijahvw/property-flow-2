"""Keep development data protection explicit in the reviewed infrastructure."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]


class DatabaseProtectionTests(unittest.TestCase):
    def test_database_has_a_recovery_window_and_deletion_protection(self):
        source = (ROOT / "infra/terraform/modules/rds/main.tf").read_text()
        retention = re.search(r"^\s*backup_retention_period\s*=\s*(\d+)\s*$", source, re.M)
        self.assertIsNotNone(retention, "Make automated backup retention explicit")
        self.assertGreaterEqual(int(retention.group(1)), 7)
        self.assertRegex(source, r"(?m)^\s*deletion_protection\s*=\s*true\s*$")

    def test_power_cycle_preserves_database_without_disabling_protection(self):
        controller = (ROOT / "scripts/dev-power.sh").read_text()
        self.assertNotIn("delete-db-instance", controller)
        self.assertNotIn("--no-deletion-protection", controller)
