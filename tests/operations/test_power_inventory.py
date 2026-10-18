import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("power_inventory", ROOT / "scripts/validate-dev-power.py")
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)


class PowerInventoryTests(unittest.TestCase):
    def test_current_infrastructure_has_explicit_power_or_retention_policy(self):
        config, _ = inventory.validate()
        self.assertEqual(config["application"]["service"], "propertyflow-dev")

    def test_new_worker_or_database_cannot_silently_escape_shutdown(self):
        for kind in ("aws_ecs_service", "aws_db_instance", "aws_instance"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "config").mkdir()
                (root / "infra/terraform/modules/rds").mkdir(parents=True)
                (root / "infra/terraform/modules/ecr").mkdir()
                (root / "infra/terraform/envs/dev").mkdir(parents=True)
                (root / "config/dev-power.json").write_text((ROOT / "config/dev-power.json").read_text())
                (root / "infra/terraform/modules/rds/main.tf").write_text('resource "aws_db_instance" "postgresql" {}')
                (root / "infra/terraform/modules/ecr/main.tf").write_text('resource "aws_ecs_service" "app" {}\nresource "' + kind + '" "new_worker" {}')
                with self.assertRaisesRegex(ValueError, "power sequence|new resource type"):
                    inventory.validate(root)

    def test_removed_target_is_not_treated_as_successful_coverage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "config").mkdir()
            (root / "config/dev-power.json").write_text((ROOT / "config/dev-power.json").read_text())
            with self.assertRaisesRegex(ValueError, "removed infrastructure"):
                inventory.validate(root)

    def test_compiled_plan_covers_nested_modules_and_blocks_database_replacement(self):
        config, _ = inventory.validate()
        resources = [{"address": config[key]["address"], "type": kind, "mode": "managed"} for key, kind in [("database", "aws_db_instance"), ("application", "aws_ecs_service")]]
        plan = {"planned_values": {"root_module": {"child_modules": [{"resources": resources}]}}}
        inventory.validate_plan(config, plan)
        resources.append({"address": "module.new_worker.aws_ecs_service.app", "type": "aws_ecs_service", "mode": "managed"})
        with self.assertRaisesRegex(ValueError, "power sequence"):
            inventory.validate_plan(config, plan)
        resources.pop()
        plan["resource_changes"] = [{"type": "aws_db_instance", "change": {"actions": ["delete", "create"]}}]
        with self.assertRaisesRegex(ValueError, "delete or replace"):
            inventory.validate_plan(config, plan)
