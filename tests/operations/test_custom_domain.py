import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest
from unittest.mock import MagicMock
from urllib.error import URLError

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("custom_domain", ROOT / "scripts/verify-dev-domain.py")
domain_check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(domain_check)


class CustomDomainTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.config = Path(self.directory.name) / "domain.json"
        self.domain = {"hostname": "propertyflow.saasapps.cloud", "certificate_arn": "fixture"}
        self.write(self.domain)
        self.open_url = MagicMock()
        self.response = self.open_url.return_value.__enter__.return_value
        self.response.status = 200
        self.response.url = "https://propertyflow.saasapps.cloud/"

    def write(self, value):
        self.config.write_text(json.dumps({"frontend_custom_domain": value, "app_origin": "https://drfbeumseaytt.cloudfront.net"}))

    def test_public_url_uses_committed_domain_and_explicit_rollback_origin(self):
        self.assertEqual(domain_check.public_url(self.config), "https://propertyflow.saasapps.cloud")
        self.write(None)
        self.assertEqual(domain_check.public_url(self.config), "https://drfbeumseaytt.cloudfront.net")
        self.config.write_text(json.dumps({"frontend_custom_domain": None, "app_origin": ""}))
        with self.assertRaises(ValueError):
            domain_check.public_url(self.config)

    def output_step(self, fail_output=""):
        # Execute the actual workflow shell against pre-upgrade state, which has
        # every existing output but no public_app_url. No Terraform/AWS is used.
        workflow = (ROOT / ".github/workflows/deploy-dev.yml").read_text()
        step = workflow.split("      - name: Get Outputs\n", 1)[1].split("\n  deploy-backend:", 1)[0]
        script = textwrap.dedent(step.split("        run: |\n", 1)[1])
        binary = Path(self.directory.name) / "terraform"
        binary.write_text('#!/bin/sh\n[ "$3" != "public_app_url" ] || exit 1\n[ "$3" != "$FAIL_OUTPUT" ] || exit 1\nprintf "legacy-%s\\n" "$3"\n')
        binary.chmod(0o755)
        output = Path(self.directory.name) / "outputs"
        result = subprocess.run(["bash", "-euo", "pipefail", "-c", script], cwd=ROOT, env={**os.environ, "PATH": f"{self.directory.name}:{os.environ['PATH']}", "GITHUB_OUTPUT": str(output), "FAIL_OUTPUT": fail_output}, capture_output=True, text=True)
        return result, output.read_text()

    def test_skipped_terraform_exports_url_without_new_remote_state_output(self):
        result, output = self.output_step()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("public_app_url=https://propertyflow.saasapps.cloud\n", output)
        self.assertIn("cloudfront_distribution_id=legacy-cloudfront_distribution_id\n", output)
        self.assertIn("grafana_secret_arn=legacy-grafana_secret_arn\n", output)

    def test_missing_existing_state_output_fails_instead_of_publishing_empty_value(self):
        result, output = self.output_step("repository_url")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("repository_url=", output)
        self.assertNotIn("ecs_service_name=", output)

    def test_static_homepage_passes_without_requiring_running_backend(self):
        self.assertIn("HTTPS verified", domain_check.verify(self.config, self.open_url))
        self.open_url.assert_called_once_with("https://propertyflow.saasapps.cloud/", timeout=15)

    def test_pending_certificate_or_unresolved_dns_stops_deployment(self):
        self.open_url.side_effect = URLError("TLS validation failed")
        with self.assertRaisesRegex(RuntimeError, "Complete ACM validation"):
            domain_check.verify(self.config, self.open_url)

    def test_redirect_to_old_hostname_does_not_establish_custom_domain_readiness(self):
        self.response.url = "https://drfbeumseaytt.cloudfront.net/"
        with self.assertRaisesRegex(ValueError, "own HTTPS homepage"):
            domain_check.verify(self.config, self.open_url)

    def test_http_downgrade_and_error_response_are_rejected(self):
        for url, status in [("http://propertyflow.saasapps.cloud/", 200), ("https://propertyflow.saasapps.cloud/", 503)]:
            self.response.url, self.response.status = url, status
            with self.assertRaises(ValueError):
                domain_check.verify(self.config, self.open_url)

    def test_explicit_rollback_skips_domain_gate(self):
        self.write(None)
        self.assertIn("explicitly disabled", domain_check.verify(self.config, self.open_url))
        self.open_url.assert_not_called()

    def test_missing_config_or_hostname_cannot_silently_disable_the_domain(self):
        self.config.write_text("{}")
        with self.assertRaises(KeyError):
            domain_check.verify(self.config, self.open_url)
        self.write({"hostname": "https://propertyflow.saasapps.cloud/"})
        with self.assertRaises(ValueError):
            domain_check.verify(self.config, self.open_url)
        self.open_url.assert_not_called()

    def test_deployment_retains_versioned_domain_and_gates_before_mutations(self):
        config = json.loads((ROOT / "infra/terraform/envs/dev/custom-domain.auto.tfvars.json").read_text())["frontend_custom_domain"]
        self.assertEqual(config["hostname"], "propertyflow.saasapps.cloud")
        self.assertRegex(config["certificate_arn"], r"^arn:aws:acm:us-east-1:800754316001:certificate/")
        workflow = (ROOT / ".github/workflows/deploy-dev.yml").read_text()
        self.assertNotIn("TF_VAR_frontend_custom_domain", workflow)
        self.assertLess(workflow.index("run: python3 scripts/verify-dev-domain.py"), workflow.index("python3 scripts/grafana-monitoring.py bootstrap-ingestion"))
        self.assertLess(workflow.index("run: python3 scripts/verify-dev-domain.py"), workflow.index("terraform apply -input=false dev.tfplan"))
        self.assertIn("PUBLIC_URL: ${{ needs.terraform.outputs.public_app_url }}", workflow)
        self.assertIn('aws cloudfront create-invalidation --distribution-id ${{ needs.terraform.outputs.cloudfront_distribution_id }} --paths "/*"', workflow)
