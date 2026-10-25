import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


monitoring = load("grafana-monitoring.py")
deployment = load("deploy-backend.py")
collectors = load("verify-dev-collectors.py")
ARN = "arn:aws:secretsmanager:us-east-1:800754316001:secret:propertyflow-dev-grafana-otlp-ABC123"


class AlloyCredentialTests(unittest.TestCase):
    def test_enabled_collector_requires_separate_token_before_any_cloud_or_plan_call(self):
        for token in ("", "Bearer private", "glc_short", "glc_" + "private\n" * 5):
            with self.subTest(token_present=bool(token)), self.assertRaises(monitoring.SafeFailure) as caught:
                monitoring.alloy_credentials({"GRAFANA_ALLOY_ENABLED": "true", "GRAFANA_ALLOY_TOKEN": token})
            self.assertNotIn("private", str(caught.exception))
        self.assertEqual(monitoring.alloy_credentials({}), {})
        with self.assertRaises(monitoring.SafeFailure):
            monitoring.alloy_credentials({"GRAFANA_ALLOY_ENABLED": "yes"})

    def test_invalid_collector_token_prevents_bootstrap_and_cloud_calls(self):
        def unexpected(*args, **kwargs):
            self.fail("Invalid credentials must fail before Terraform or AWS.")
        with self.assertRaises(monitoring.SafeFailure):
            monitoring.bootstrap_ingestion({
                "GRAFANA_OTLP_ENDPOINT": "https://otlp-gateway-prod-us-east-3.grafana.net/otlp",
                "GRAFANA_OTLP_HEADERS": "Authorization=Basic Zml4dHVyZTppbmdlc3Rpb24tZml4dHVyZQ==",
                "GRAFANA_ALLOY_ENABLED": "true",
            }, runner=unexpected, client=object())

    def test_one_put_contains_both_credentials_without_reads_or_output(self):
        token = "glc_" + "isolated-token" * 3
        header = "Authorization=Basic Zml4dHVyZTppbmdlc3Rpb24tZml4dHVyZQ=="
        values = []
        class Client:
            def put_secret_value(self, **kwargs):
                values.append(json.loads(kwargs["SecretString"]))
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            monitoring.store_ingestion({"GRAFANA_OTLP_ENDPOINT": "https://otlp-gateway-prod-us-east-3.grafana.net/otlp",
                                        "GRAFANA_OTLP_HEADERS": header, "GRAFANA_SECRET_ARN": ARN,
                                        "GRAFANA_ALLOY_ENABLED": "true", "GRAFANA_ALLOY_TOKEN": token}, Client())
        self.assertEqual(values, [{"headers": header, "alloy_token": token}])
        self.assertNotIn(token, output.getvalue())
        self.assertNotIn(header, output.getvalue())


class AlloyDeploymentTests(unittest.TestCase):
    def definition(self):
        return {"family": "propertyflow-dev", "containerDefinitions": [
            {"name": "app", "image": "old", "environment": [{"name": "OTEL_EXPORTER_OTLP_ENDPOINT", "value": "https://expected"}], "secrets": [{"name": "OTEL_EXPORTER_OTLP_HEADERS", "valueFrom": ARN + ":headers::"}]},
            {"name": "alloy", "image": "grafana/alloy:v1.21.1", "essential": False, "healthCheck": {"command": ["CMD-SHELL", "readiness"]}, "secrets": [{"name": "GRAFANA_ALLOY_TOKEN", "valueFrom": ARN + ":alloy_token::"}]}
        ]}

    def test_rollout_preserves_collector(self):
        definition = self.definition()
        original = copy.deepcopy(definition["containerDefinitions"][1:])
        result = deployment.candidate(definition, "immutable", "https://expected", True)
        self.assertEqual(result["containerDefinitions"][0]["image"], "immutable")
        self.assertEqual(result["containerDefinitions"][1:], original)

    def test_runtime_setting_requires_infrastructure_to_match(self):
        for enabled, with_alloy in ((False, True), (True, False)):
            definition = self.definition()
            if not with_alloy:
                definition["containerDefinitions"].pop()
            with self.subTest(enabled=enabled), self.assertRaisesRegex(ValueError, "infrastructure"):
                deployment.candidate(definition, "new", "https://expected", enabled)

    def test_reject_unreviewed_images_public_ports_plaintext_tokens_and_foreign_secret(self):
        for change in ({"image": "grafana/alloy:latest"}, {"essential": True}, {"portMappings": [{"containerPort": 12345}]},
                       {"environment": [{"name": "GRAFANA_ALLOY_TOKEN", "value": "private"}]},
                       {"secrets": [{"name": "GRAFANA_ALLOY_TOKEN", "valueFrom": ARN.replace("800754316001", "000000000000") + ":alloy_token::"}]}):
            definition = self.definition()
            definition["containerDefinitions"][1].update(change)
            with self.subTest(fields=list(change)), self.assertRaises(ValueError):
                deployment.candidate(definition, "new", "https://expected", True)


class AlloyReadinessTests(unittest.TestCase):
    def run_check(self, names=None, tasks=None, expected=True, failures=None):
        calls = []
        responses = [
            {"taskDefinition": "current", "desiredCount": 1},
            names if names is not None else ["app", "alloy"],
            ["task-1"],
            {"failures": failures or [], "tasks": tasks if tasks is not None else [{"definition": "current", "status": "RUNNING", "containers": [{"name": "alloy", "status": "RUNNING", "health": "HEALTHY"}]}]}
        ]
        def runner(args, **kwargs):
            calls.append(args)
            self.assertTrue(kwargs["capture_output"])
            return SimpleNamespace(returncode=0, stdout=json.dumps(responses[len(calls)-1]))
        collectors.verify(expected=expected, attempts=1, delay=0, runner=runner)
        return calls

    def test_healthy_collector_requires_current_revision_and_no_task_failures(self):
        with contextlib.redirect_stdout(io.StringIO()):
            calls = self.run_check()
        self.assertTrue(all("--query" in args for args in calls))
        self.assertTrue(all("environment" not in args[args.index("--query") + 1] for args in calls))
        with self.assertRaises(ValueError):
            self.run_check(failures=[{"reason": "MISSING"}])

    def test_stopped_unhealthy_absent_or_old_revision_cannot_pass(self):
        for row in ({"definition": "old", "status": "RUNNING", "containers": [{"name": "alloy", "status": "RUNNING", "health": "HEALTHY"}]},
                    {"definition": "current", "status": "RUNNING", "containers": [{"name": "alloy", "status": "STOPPED", "health": "UNKNOWN"}]},
                    {"definition": "current", "status": "RUNNING", "containers": [{"name": "alloy", "status": "RUNNING", "health": "UNHEALTHY"}]},
                    {"definition": "current", "status": "RUNNING", "containers": [{"name": "app", "status": "RUNNING"}]}):
            with self.subTest(row=row), self.assertRaises(ValueError):
                self.run_check(tasks=[row])

    def test_disabled_is_explicit_but_expected_collector_cannot_be_missing(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(len(self.run_check(names=["app"], expected=False)), 2)
        with self.assertRaisesRegex(ValueError, "absent"):
            self.run_check(names=["app"], expected=True)


if __name__ == "__main__":
    unittest.main()
