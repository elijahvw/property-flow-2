import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("release_snapshot", Path(__file__).resolve().parents[2] / "scripts/release-snapshot.py")
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)


class SnapshotTests(unittest.TestCase):
    env = {"GITHUB_SHA": "a" * 40, "GITHUB_RUN_ID": "42", "GITHUB_RUN_ATTEMPT": "1"}
    current = "propertyflow-dev-pre-aaaaaaaaaaaa-42-1"

    def row(self, index):
        name = f"propertyflow-dev-pre-bbbbbbbbbbbb-{index}-1"
        return {"DBSnapshotIdentifier": name, "DBInstanceIdentifier": snapshot.DATABASE,
            "DBSnapshotArn": f"arn:aws:rds:us-east-1:{snapshot.ACCOUNT}:snapshot:{name}",
            "Status": "available", "SnapshotType": "manual", "SnapshotCreateTime": f"2026-10-{index:02}T12:00:00Z"}

    def client(self, rows, *, account=snapshot.ACCOUNT, fail_wait=False, fail_tags=False, current_ready=True, untagged=()):
        calls = []
        current = self.row(16)
        current.update(DBSnapshotIdentifier=self.current, DBSnapshotArn=f"arn:aws:rds:us-east-1:{snapshot.ACCOUNT}:snapshot:{self.current}", Status="available" if current_ready else "creating")

        def call(*args):
            calls.append(args)
            operation = args[1]
            if operation == "get-caller-identity": return {"Account": account}
            if operation == "create-db-snapshot": return {"DBSnapshot": copy.deepcopy(current)}
            if operation == "wait":
                if fail_wait: raise RuntimeError("Snapshot not available")
                return {}
            if operation == "describe-db-snapshots": return {"DBSnapshots": [current, *rows]}
            if operation == "list-tags-for-resource":
                if fail_tags: raise RuntimeError("Tag permission denied")
                tags = {} if args[-1] in untagged else snapshot.TAGS
                return {"TagList": [{"Key": k, "Value": v} for k, v in tags.items()]}
            if operation == "delete-db-snapshot": return {}
            raise AssertionError(args)
        return call, calls

    def test_waits_for_verified_snapshot_then_retains_latest_five(self):
        call, calls = self.client([self.row(i) for i in range(1, 8)])
        self.assertEqual(snapshot.preserve(call, self.env), self.current)
        deleted = {args[-1] for args in calls if args[1] == "delete-db-snapshot"}
        self.assertEqual(deleted, {self.row(i)["DBSnapshotIdentifier"] for i in range(1, 4)})
        operations = [args[1] for args in calls]
        self.assertLess(operations.index("wait"), operations.index("delete-db-snapshot"))
        self.assertLess(max(i for i, op in enumerate(operations) if op == "list-tags-for-resource"), operations.index("delete-db-snapshot"))

    def test_never_deletes_unrelated_wrong_account_or_untagged_backups(self):
        other = self.row(1); other["DBInstanceIdentifier"] = "other-db"
        foreign = self.row(2); foreign["DBSnapshotArn"] = foreign["DBSnapshotArn"].replace(snapshot.ACCOUNT, "000000000000")
        automated = self.row(3); automated["SnapshotType"] = "automated"
        unrelated = self.row(4); unrelated["DBSnapshotIdentifier"] = "important-manual-backup"
        untagged = self.row(5)
        pending = self.row(6); pending["Status"] = "creating"
        call, calls = self.client([other, foreign, automated, unrelated, untagged, pending], untagged=[untagged["DBSnapshotArn"]])
        snapshot.preserve(call, self.env)
        self.assertFalse(any(args[1] == "delete-db-snapshot" for args in calls))

    def test_no_cleanup_without_available_current_point_or_tag_discovery(self):
        for options in ({"fail_wait": True}, {"current_ready": False}, {"fail_tags": True}):
            call, calls = self.client([self.row(i) for i in range(1, 8)], **options)
            with self.subTest(options=options), self.assertRaises((ValueError, RuntimeError)):
                snapshot.preserve(call, self.env)
            self.assertFalse(any(args[1] == "delete-db-snapshot" for args in calls))

    def test_wrong_account_and_bad_run_make_no_mutations(self):
        for account, env in (("000000000000", self.env), (snapshot.ACCOUNT, {**self.env, "GITHUB_RUN_ID": "42;unsafe"})):
            call, calls = self.client([], account=account)
            with self.subTest(account=account, env=env), self.assertRaises(ValueError):
                snapshot.preserve(call, env)
            self.assertEqual([args[1] for args in calls], ["get-caller-identity"])

    def test_start_does_not_wait_or_prune_and_verify_never_creates_again(self):
        call, calls = self.client([])
        self.assertEqual(snapshot.start(call, self.env), self.current)
        self.assertEqual([args[1] for args in calls], ["get-caller-identity", "create-db-snapshot"])
        calls.clear()
        self.assertEqual(snapshot.verify(call, self.env), self.current)
        self.assertNotIn("create-db-snapshot", [args[1] for args in calls])
        self.assertIn("wait", [args[1] for args in calls])

    def test_workflow_overlaps_snapshot_and_build_but_fences_rollout(self):
        path = Path(__file__).resolve().parents[2] / ".github/workflows/deploy-dev.yml"
        backend = path.read_text().split("  deploy-backend:\n", 1)[1].split("\n  deploy-frontend:", 1)[0]
        self.assertLess(backend.index("run: bash scripts/dev-power.sh start-database"), backend.index("run: python3 scripts/release-snapshot.py start"))
        self.assertLess(backend.index("run: python3 scripts/release-snapshot.py start"), backend.index("name: Build and push backend image"))
        self.assertLess(backend.index("name: Build and push backend image"), backend.index("run: python3 scripts/release-snapshot.py verify"))
        self.assertLess(backend.index("run: python3 scripts/release-snapshot.py verify"), backend.index("name: Roll out and verify immutable ECS release"))
        for action in ["start", "verify"]:
            self.assertIn("if: needs.terraform-changes.outputs.migration_snapshot == 'true'\n        run: python3 scripts/release-snapshot.py " + action, backend)
