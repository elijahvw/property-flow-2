import importlib.util
from pathlib import Path
import unittest
ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("release_plan", ROOT / "scripts/plan-dev-release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

class ReleasePlanTests(unittest.TestCase):
    versions = {"infrastructure": "infra-version", "backend": "backend-version", "frontend": "frontend-version"}
    def plan(self, paths):
        return release.plan(self.versions, "head", diff=lambda _base, _head: paths)
    def test_frontend_only(self):
        self.assertEqual(self.plan(["client/src/App.tsx"]), {"infrastructure": False, "backend": False, "frontend": True})
    def test_backend_only(self):
        self.assertEqual(self.plan(["server/src/index.ts"]), {"infrastructure": False, "backend": True, "frontend": False})
    def test_infrastructure_deploys_runtime_dependencies(self):
        self.assertTrue(all(self.plan(["infra/terraform/modules/ecr/main.tf"]).values()))
    def test_docs_tests_and_ci_do_not_deploy(self):
        self.assertFalse(any(self.plan(["docs/setup.md", "client/tests/a.test.cjs", "server/tests/a.test.mjs", "tests/operations/test_release_plan.py", ".github/workflows/ci.yml"]).values()))
    def test_root_lockfile_deploys_both_apps(self):
        wanted = self.plan(["package-lock.json"])
        self.assertFalse(wanted["infrastructure"])
        self.assertTrue(wanted["backend"] and wanted["frontend"])
    def test_missing_or_nonancestor_baseline_falls_back_to_full_release(self):
        self.assertTrue(all(release.plan({}, "head", diff=lambda *_: None).values()))
    def test_each_component_uses_its_own_successful_version(self):
        wanted = release.plan(self.versions, "head", diff=lambda base, _head:
            ["client/src/App.tsx"] if base == "frontend-version" else [])
        self.assertEqual(wanted, {"infrastructure": False, "backend": False, "frontend": True})
    def test_failed_and_skipped_components_keep_their_previous_versions(self):
        state = release.completed_state(self.versions, "new-head", {"infrastructure": "success", "backend": "success", "frontend": "failure"}, False)
        self.assertEqual(state["versions"], {"infrastructure": "infra-version", "backend": "new-head", "frontend": "frontend-version"})
    def test_force_all_and_terraform_overrides(self):
        self.assertTrue(all(release.plan(self.versions, "head", diff=lambda *_: [], force=True).values()))
        wanted = release.plan(self.versions, "head", diff=lambda *_: [], terraform="always")
        self.assertTrue(all(wanted.values()))
        self.assertFalse(release.plan({}, "head", diff=lambda *_: None, terraform="never")["infrastructure"])

    def test_github_credential_is_not_forwarded_to_artifact_storage(self):
        request = release.urllib.request.Request("https://api.github.com/artifact", headers={"Authorization": "Bearer private-token"})
        redirected = release.SafeRedirect().redirect_request(request, None, 302, "Found", {}, "https://signed-artifacts.example/blob")
        self.assertIsNone(redirected.get_header("Authorization"))
