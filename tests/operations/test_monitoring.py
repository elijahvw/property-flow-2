import base64
import contextlib
import fnmatch
import importlib.util
import io
import json
from pathlib import Path
import unittest
from types import SimpleNamespace
import urllib.error

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


m = load("grafana-monitoring.py")
d = load("deploy-backend.py")
r = load("retire-datadog.py")


class FakeGrafana:
    def __init__(self):
        self.calls = []
        self.old = {}

    def sources(self):
        return {"metrics": "prom", "logs": "loki", "traces": "tempo"}

    def request(self, method, path, body=None, missing=False):
        self.calls.append((method, path, body))
        if method == "GET":
            if path.startswith("/api/folders?"):
                return self.old.get("/api/folders", [])
            if path.startswith("/api/search?"):
                return self.old.get("/api/search", [])
            return self.old.get(path)
        return {}


class MonitoringTests(unittest.TestCase):
    def cloud_catalog(self):
        return [
            {
                "uid": "grafanacloud-prom",
                "name": "grafanacloud-slimpillar2069-prom",
                "type": "prometheus",
            },
            {
                "uid": "grafanacloud-logs",
                "name": "grafanacloud-slimpillar2069-logs",
                "type": "loki",
            },
            {
                "uid": "grafanacloud-traces",
                "name": "grafanacloud-slimpillar2069-traces",
                "type": "tempo",
            },
            {
                "uid": "grafanacloud-alert-state-history",
                "name": "grafanacloud-slimpillar2069-alert-state-history",
                "type": "loki",
            },
            {
                "uid": "grafanacloud-usage-insights",
                "name": "grafanacloud-slimpillar2069-usage-insights",
                "type": "loki",
            },
            {
                "uid": "grafanacloud-usage",
                "name": "grafanacloud-usage",
                "type": "prometheus",
            },
            {"uid": "custom-logs", "name": "Other application", "type": "loki"},
        ]

    def catalog_api(self, rows):
        api = m.Grafana({"GRAFANA_SERVICE_ACCOUNT_TOKEN": "fixture"})

        def request(method, path):
            self.assertEqual((method, path), ("GET", "/api/datasources"))
            return rows

        api.request = request
        return api

    def test_primary_cloud_sources_are_selected_among_builtin_and_custom_sources(self):
        self.assertEqual(
            self.catalog_api(self.cloud_catalog()).sources(),
            {
                "metrics": "grafanacloud-prom",
                "logs": "grafanacloud-logs",
                "traces": "grafanacloud-traces",
            },
        )

    def test_renaming_primary_sources_does_not_change_selection(self):
        rows = self.cloud_catalog()
        for row in rows:
            row["name"] = "renamed"
        self.assertEqual(self.catalog_api(rows).sources()["logs"], "grafanacloud-logs")

    def test_missing_primary_logs_never_falls_back_to_alert_history(self):
        rows = [
            row for row in self.cloud_catalog() if row["uid"] != "grafanacloud-logs"
        ]
        with self.assertRaisesRegex(m.SafeFailure, "grafanacloud-logs"):
            self.catalog_api(rows).sources()

    def test_primary_uid_with_wrong_signal_type_is_rejected(self):
        rows = self.cloud_catalog()
        rows[1]["type"] = "prometheus"
        with self.assertRaisesRegex(m.SafeFailure, "grafanacloud-logs"):
            self.catalog_api(rows).sources()

    def test_secret_bootstrap_refuses_app_database_or_destructive_changes(self):
        secret = {
            "address": "module.ecr.aws_secretsmanager_secret.grafana[0]",
            "change": {
                "actions": ["create"],
                "after": {"name": "propertyflow-dev-grafana-otlp"},
            },
        }
        m.validate_bootstrap_plan({"resource_changes": [secret]})
        for actions in [["create"], ["update"], ["delete", "create"]]:
            for address in [
                "module.rds.aws_db_instance.app",
                "module.ecs.aws_ecs_service.app",
            ]:
                with self.assertRaises(m.SafeFailure):
                    m.validate_bootstrap_plan(
                        {
                            "resource_changes": [
                                secret,
                                {"address": address, "change": {"actions": actions}},
                            ]
                        }
                    )
        for change in [
            {
                "actions": ["delete", "create"],
                "after": {"name": "propertyflow-dev-grafana-otlp"},
            },
            {"actions": ["create"], "after": {"name": "unrelated-secret"}},
        ]:
            with self.assertRaises(m.SafeFailure):
                m.validate_bootstrap_plan(
                    {"resource_changes": [{**secret, "change": change}]}
                )
        with self.assertRaises(m.SafeFailure):
            m.validate_bootstrap_plan({})
        m.validate_bootstrap_plan(
            {
                "resource_changes": [
                    secret,
                    {
                        "address": "module.rds.aws_db_instance.app",
                        "change": {"actions": ["no-op"]},
                    },
                ]
            }
        )

    def test_secret_bootstrap_checks_plan_before_apply_then_populates_value(self):
        calls = []
        arn = "arn:aws:secretsmanager:us-east-1:800754316001:secret:propertyflow-dev-grafana-otlp-ABC123"
        plan = {
            "resource_changes": [
                {
                    "address": "module.ecr.aws_secretsmanager_secret.grafana[0]",
                    "change": {
                        "actions": ["create"],
                        "after": {"name": "propertyflow-dev-grafana-otlp"},
                    },
                }
            ]
        }

        def runner(args, **kwargs):
            calls.append(args[1])
            self.assertTrue(kwargs["capture_output"])
            return SimpleNamespace(
                returncode=0, stdout=json.dumps(plan) if args[1] == "show" else "{}" if args[1:] == ["output", "-json"] else arn
            )

        class Client:
            def put_secret_value(self, **kwargs):
                calls.append("put-secret")

        env = {
            "GRAFANA_OTLP_ENDPOINT": "https://otlp-gateway-prod-us-east-2.grafana.net/otlp",
            "GRAFANA_OTLP_HEADERS": "Authorization=Basic "
            + base64.b64encode(b"fixture:ingestion-fixture").decode(),
        }
        with contextlib.redirect_stdout(io.StringIO()):
            m.bootstrap_ingestion(env, runner, Client())
        self.assertEqual(calls, ["output", "plan", "show", "apply", "output", "put-secret"])
        calls.clear()
        plan["resource_changes"].append(
            {
                "address": "module.ecs.aws_ecs_service.app",
                "change": {"actions": ["update"]},
            }
        )
        with self.assertRaises(m.SafeFailure):
            m.bootstrap_ingestion(env, runner, Client())
        self.assertEqual(calls, ["output", "plan", "show"])

    def test_existing_secret_is_verified_and_populated_without_terraform_apply(self):
        calls = []
        arn = "arn:aws:secretsmanager:us-east-1:800754316001:secret:propertyflow-dev-grafana-otlp-ABC123"
        metadata = {"ARN": arn, "Name": "propertyflow-dev-grafana-otlp"}
        def runner(args, **kwargs):
            self.assertEqual(args[1:], ["output", "-json"])
            self.assertTrue(kwargs["capture_output"])
            calls.append("output")
            return SimpleNamespace(returncode=0, stdout=json.dumps({"grafana_secret_arn": {"value": arn}}))
        class Client:
            def describe_secret(self, **kwargs):
                calls.append("metadata")
                return metadata
            def put_secret_value(self, **kwargs):
                calls.append("put-secret")
        env = {"GRAFANA_OTLP_ENDPOINT": "https://otlp-gateway-prod-us-east-2.grafana.net/otlp", "GRAFANA_OTLP_HEADERS": "Authorization=Basic " + base64.b64encode(b"fixture:ingestion-fixture").decode()}
        with contextlib.redirect_stdout(io.StringIO()):
            m.bootstrap_ingestion(env, runner, Client())
        self.assertEqual(calls, ["output", "metadata", "put-secret"])
        for invalid in ({**metadata, "DeletedDate": "today"}, {**metadata, "Name": "another-secret"}, {**metadata, "ARN": "another-arn"}):
            metadata = invalid
            calls.clear()
            with self.subTest(metadata=invalid), self.assertRaises(m.SafeFailure):
                m.bootstrap_ingestion(env, runner, Client())
            self.assertEqual(calls, ["output", "metadata"])

    def test_existing_secret_with_foreign_arn_never_calls_aws_or_applies(self):
        def runner(args, **kwargs):
            return SimpleNamespace(returncode=0, stdout=json.dumps({"grafana_secret_arn": {"value": "arn:aws:secretsmanager:us-east-1:000000000000:secret:other-ABC123"}}))
        with self.assertRaises(m.SafeFailure):
            m.bootstrap_ingestion({"GRAFANA_OTLP_ENDPOINT": "https://otlp-gateway-prod-us-east-2.grafana.net/otlp", "GRAFANA_OTLP_HEADERS": "Authorization=Basic " + base64.b64encode(b"fixture:ingestion-fixture").decode()}, runner, object())

    def test_bootstrap_failure_does_not_print_captured_state_or_credentials(self):
        def runner(*args, **kwargs):
            return SimpleNamespace(
                returncode=1, stdout="private state", stderr="private credentials"
            )

        out = io.StringIO()
        with contextlib.redirect_stdout(out), self.assertRaises(m.SafeFailure) as error:
            m.bootstrap_ingestion(
                {
                    "GRAFANA_OTLP_ENDPOINT": "https://otlp-gateway-prod-us-east-2.grafana.net/otlp",
                    "GRAFANA_OTLP_HEADERS": "Authorization=Basic "
                    + base64.b64encode(b"fixture:ingestion-fixture").decode(),
                },
                runner,
            )
        self.assertNotIn("private", str(error.exception) + out.getvalue())

    def test_gateway_validation_rejects_credential_urls_lookalikes_and_insecure_protocols(
        self,
    ):
        for url in [
            "http://otlp-gateway-prod-us-east-2.grafana.net/otlp",
            "https://otlp-gateway-prod.grafana.net.evil/otlp",
            "https://user:secret@otlp-gateway-prod.grafana.net/otlp",
            "https://otlp-gateway-prod.grafana.net/otlp?token=secret",
        ]:
            with self.assertRaises(m.SafeFailure):
                m.validate_endpoint(url)
        self.assertTrue(
            m.validate_endpoint("https://otlp-gateway-prod-us-east-2.grafana.net/otlp")
        )

    def test_only_basic_ingestion_header_is_accepted(self):
        header = (
            "Authorization=Basic%20"
            + base64.b64encode(b"fixture:ingestion-fixture").decode()
        )
        self.assertEqual(m.validate_headers(header), header)
        for value in [
            "Bearer token",
            "Authorization=Basic xyz",
            "Authorization=Basic xxx\nX-Injected=bad",
            "export OTEL_EXPORTER_OTLP_HEADERS=x",
        ]:
            with self.assertRaises(m.SafeFailure):
                m.validate_headers(value)

    def test_store_uses_put_only_and_never_prints_secret(self):
        class Client:
            def put_secret_value(self, **kwargs):
                self.value = kwargs

        client = Client()
        header = (
            "Authorization=Basic "
            + base64.b64encode(b"fixture:ingestion-fixture").decode()
        )
        env = {
            "GRAFANA_OTLP_ENDPOINT": "https://otlp-gateway-prod-us-east-2.grafana.net/otlp",
            "GRAFANA_OTLP_HEADERS": header,
            "GRAFANA_SECRET_ARN": "arn:aws:secretsmanager:us-east-1:800754316001:secret:propertyflow-dev-grafana-otlp-ABC123",
        }
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            m.store_ingestion(env, client)
        self.assertEqual(json.loads(client.value["SecretString"]), {"headers": header})
        self.assertNotIn(header, out.getvalue())
        with self.assertRaises(m.SafeFailure):
            m.store_ingestion(
                {
                    **env,
                    "GRAFANA_SECRET_ARN": env["GRAFANA_SECRET_ARN"].replace(
                        "800754316001", "111111111111"
                    ),
                },
                client,
            )

    def test_credentialed_requests_cannot_redirect(self):
        with self.assertRaises(m.SafeFailure):
            m.NoRedirect().redirect_request(
                None, None, 302, "moved", {}, "https://evil.example"
            )

    def test_wrong_stack_fails_before_request(self):
        with self.assertRaises(m.SafeFailure):
            m.Grafana(
                {
                    "GRAFANA_URL": "https://evil.example",
                    "GRAFANA_SERVICE_ACCOUNT_TOKEN": "fixture",
                }
            )

    def test_provisioning_is_scoped_and_new_alerts_are_paused(self):
        api = FakeGrafana()
        with contextlib.redirect_stdout(io.StringIO()):
            m.provision(api)
        posts = [row for row in api.calls if row[0] == "POST"]
        rules = [
            row[2] for row in posts if row[1] == "/api/v1/provisioning/alert-rules"
        ]
        self.assertEqual(len(rules), 8)
        self.assertTrue(all(rule["isPaused"] for rule in rules))
        self.assertTrue(all(rule["folderUID"] == m.FOLDER for rule in rules))
        dashboard = next(row[2] for row in posts if row[1] == "/api/dashboards/db")
        self.assertEqual(dashboard["folderUid"], m.FOLDER)
        self.assertNotIn("METRICS_UID", json.dumps(dashboard))

    def test_provisioning_preserves_enabled_alert_and_refuses_uid_collision(self):
        api = FakeGrafana()
        api.old["/api/v1/provisioning/alert-rules/pf-dev-heartbeat"] = {
            "folderUID": m.FOLDER,
            "labels": {"service": "propertyflow"},
            "isPaused": False,
        }
        with contextlib.redirect_stdout(io.StringIO()):
            m.provision(api)
        self.assertFalse(
            next(
                body
                for method, path, body in api.calls
                if method == "PUT" and path.endswith("pf-dev-heartbeat")
            )["isPaused"]
        )
        api = FakeGrafana()
        api.old["/api/folders"] = [{"uid": m.FOLDER, "title": "Other team"}]
        with self.assertRaises(m.SafeFailure):
            m.provision(api)
        self.assertFalse(any(row[0] != "GET" for row in api.calls))

    def test_verification_requires_all_three_signals(self):
        class API(FakeGrafana):
            def request(self, method, path, **kwargs):
                if "/api/v1/query?" in path:
                    return {"data": {"result": [1]}}
                if "/loki/" in path:
                    return {"data": {"result": []}}
                return {"traces": [1]}

        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(
            m.SafeFailure
        ):
            m.verify(API())

    def test_immutable_deployment_refuses_legacy_task_and_endpoint_mismatch(self):
        task = {
            "family": "propertyflow-dev",
            "containerDefinitions": [
                {
                    "name": "app",
                    "image": "previous",
                    "environment": [
                        {
                            "name": "OTEL_EXPORTER_OTLP_ENDPOINT",
                            "value": "https://expected",
                        }
                    ],
                    "secrets": [
                        {
                            "name": "OTEL_EXPORTER_OTLP_HEADERS",
                            "valueFrom": "secret-ref",
                        }
                    ],
                }
            ],
            "revision": 5,
        }
        with self.assertRaises(ValueError):
            d.candidate(
                {
                    **task,
                    "containerDefinitions": task["containerDefinitions"]
                    + [{"name": "datadog-agent", "image": "legacy"}],
                },
                "new",
                "https://expected",
            )
        with self.assertRaises(ValueError):
            d.candidate(task, "new", "https://wrong")
        result = d.candidate(task, "immutable-sha", "https://expected")
        self.assertNotIn("revision", result)
        self.assertEqual(result["containerDefinitions"][0]["image"], "immutable-sha")

    def test_rollout_does_not_accept_circuit_breaker_rollback(self):
        class STS:
            def get_caller_identity(self):
                return {"Account": d.ACCOUNT}

        class ECS:
            updated = False

            def describe_services(self, **kwargs):
                return {
                    "services": [
                        {
                            "taskDefinition": "old",
                            "desiredCount": 1,
                            "runningCount": 1,
                            "pendingCount": 0,
                        }
                    ]
                }

            def describe_task_definition(self, **kwargs):
                return {
                    "taskDefinition": {
                        "family": "propertyflow-dev",
                        "containerDefinitions": [
                            {
                                "name": "app",
                                "image": "old",
                                "environment": [
                                    {
                                        "name": "OTEL_EXPORTER_OTLP_ENDPOINT",
                                        "value": "https://expected",
                                    }
                                ],
                                "secrets": [{"name": "OTEL_EXPORTER_OTLP_HEADERS"}],
                            }
                        ],
                    }
                }

            def register_task_definition(self, **kwargs):
                return {"taskDefinition": {"taskDefinitionArn": "new"}}

            def update_service(self, **kwargs):
                self.updated = True

            def get_waiter(self, *args):
                return self

            def wait(self, **kwargs):
                pass

        ecs = ECS()
        with self.assertRaisesRegex(ValueError, "rolled back"):
            d.deploy(
                ecs,
                STS(),
                {
                    "GITHUB_SHA": "a" * 40,
                    "REPOSITORY_URL": d.ACCOUNT
                    + ".dkr.ecr.us-east-1.amazonaws.com/propertyflow-dev-app",
                    "GRAFANA_OTLP_ENDPOINT": "https://expected",
                },
            )
        self.assertTrue(ecs.updated)

    def test_retirement_wrong_account_is_read_only(self):
        class STS:
            def get_caller_identity(self):
                return {"Account": "111111111111"}

        with self.assertRaises(r.SafeFailure):
            r.retire({"sts": STS()}, True)

    def test_cleanup_policy_covers_name_only_and_id_arns_without_neighbor_access(self):
        policy = json.loads(
            (ROOT / "infra/iam/propertyflow-observability-deploy.json").read_text()
        )
        for action, resource in [
            (
                "events:DeleteApiDestination",
                "api-destination/datadog-agent-resource-update-intake-destination",
            ),
            (
                "events:DeleteConnection",
                "connection/datadog-agent-resource-update-intake-connection",
            ),
        ]:
            patterns = [
                p
                for statement in policy["Statement"]
                if action in statement["Action"]
                for p in statement["Resource"]
            ]
            base = "arn:aws:events:us-east-1:800754316001:" + resource
            for arn in [base, base + "/fixture-id"]:
                self.assertTrue(any(fnmatch.fnmatchcase(arn, p) for p in patterns), arn)
            for arn in [
                base + "-other",
                base + "-other/fixture-id",
                base.replace("800754316001", "111111111111"),
                base.replace("us-east-1", "us-west-2"),
            ]:
                self.assertFalse(
                    any(fnmatch.fnmatchcase(arn, p) for p in patterns), arn
                )

    def test_partial_cleanup_skips_deleted_children_but_keeps_retained_resources(self):
        root = (
            "arn:aws:cloudformation:us-east-1:800754316001:stack/DatadogIntegration/id"
        )
        visited = []

        class CF:
            def describe_stacks(self, **kwargs):
                return {"Stacks": [{"StackId": root}]}

            def get_paginator(self, *args):
                return self

            def paginate(self, **kwargs):
                visited.append(kwargs["StackName"])
                return [
                    {
                        "StackResourceSummaries": [
                            {
                                "ResourceType": "AWS::CloudFormation::Stack",
                                "PhysicalResourceId": root + "-deleted-child",
                                "ResourceStatus": "DELETE_COMPLETE",
                            },
                            {
                                "ResourceType": "AWS::S3::Bucket",
                                "PhysicalResourceId": r.BUCKET,
                                "ResourceStatus": "DELETE_COMPLETE",
                            },
                            {
                                "ResourceType": "AWS::SecretsManager::Secret",
                                "PhysicalResourceId": r.SECRET,
                                "ResourceStatus": "DELETE_SKIPPED",
                            },
                        ]
                    }
                ]

        remaining = r.stack_resources(CF())
        self.assertEqual(visited, [root])
        self.assertEqual([row["PhysicalResourceId"] for row in remaining], [r.SECRET])

    def test_retirement_refuses_nonempty_bucket_before_any_mutation(self):
        class CF:
            def describe_stacks(self, **kw):
                return {
                    "Stacks": [
                        {
                            "StackId": "arn:aws:cloudformation:us-east-1:800754316001:stack/DatadogIntegration/id"
                        }
                    ]
                }

            def get_paginator(self, *a):
                return self

            def paginate(self, **kw):
                return [
                    {
                        "StackResourceSummaries": [
                            {
                                "ResourceType": "AWS::S3::Bucket",
                                "PhysicalResourceId": r.BUCKET,
                            }
                        ]
                    }
                ]

        class S3:
            def list_object_versions(self, **kw):
                return {"Versions": [{"Key": "preserve-me"}]}

        with self.assertRaisesRegex(r.SafeFailure, "no longer empty"):
            r.plan(CF(), None, S3(), None)

    def test_retirement_refuses_new_unreviewed_data_resources(self):
        class CF:
            def describe_stacks(self, **kw):
                return {
                    "Stacks": [
                        {
                            "StackId": "arn:aws:cloudformation:us-east-1:800754316001:stack/DatadogIntegration/id"
                        }
                    ]
                }

            def get_paginator(self, *a):
                return self

            def paginate(self, **kw):
                return [
                    {
                        "StackResourceSummaries": [
                            {
                                "ResourceType": "AWS::RDS::DBInstance",
                                "PhysicalResourceId": "preserve-data",
                            }
                        ]
                    }
                ]

        with self.assertRaisesRegex(r.SafeFailure, "unreviewed resource"):
            r.stack_resources(CF())

    def test_readiness_alert_converts_failed_zero_into_true_threshold(self):
        rule = next(
            row for row in m.alert_rules("fixture") if row["uid"] == "pf-dev-readiness"
        )
        self.assertEqual(rule["condition"], "B")
        self.assertIn("< bool ", rule["data"][0]["model"]["expr"])
        self.assertEqual(
            rule["data"][1]["model"]["conditions"][0]["evaluator"]["params"], [0.5]
        )


class RetirementLifecycleTests(unittest.TestCase):
    def clients(self, legacy_running=False, other_group=False):
        mutations = []

        class Pager:
            def __init__(self, operation):
                self.operation = operation

            def paginate(self, **kwargs):
                if self.operation == "list_stack_resources":
                    return [
                        {
                            "StackResourceSummaries": [
                                {
                                    "ResourceType": "AWS::IAM::Role",
                                    "PhysicalResourceId": "DatadogIntegrationRole",
                                }
                            ]
                        }
                    ]
                if self.operation == "describe_log_groups":
                    return [
                        {
                            "logGroups": [
                                {
                                    "logGroupName": (
                                        "/other"
                                        if other_group
                                        else "/ecs/propertyflow-dev"
                                    )
                                }
                            ]
                        }
                    ]
                if self.operation == "describe_subscription_filters":
                    return [
                        {
                            "subscriptionFilters": [
                                {"filterName": "legacy", "destinationArn": r.FORWARDER}
                            ]
                        }
                    ]
                if self.operation == "list_tasks":
                    return [{"taskArns": []}]
                if self.operation == "list_task_definitions":
                    return [
                        {
                            "taskDefinitionArns": (
                                ["old"] if kwargs["status"] == "ACTIVE" else []
                            )
                        }
                    ]
                raise AssertionError("Unexpected API")

        class Client:
            def get_paginator(self, operation):
                return Pager(operation)

        class CF(Client):
            def describe_stacks(self, **kwargs):
                return {
                    "Stacks": [
                        {
                            "StackId": "arn:aws:cloudformation:us-east-1:800754316001:stack/DatadogIntegration/id"
                        }
                    ]
                }

            def delete_stack(self, **kwargs):
                mutations.append("delete-stack")

            def get_waiter(self, name):
                return self

            def wait(self, **kwargs):
                mutations.append("wait-stack-deleted")

        class Logs(Client):
            def delete_subscription_filter(self, **kwargs):
                mutations.append("remove-subscription")

        class ECS(Client):
            def describe_services(self, **kwargs):
                return {
                    "services": [
                        {
                            "runningCount": 1,
                            "pendingCount": 0,
                            "deployments": [
                                {"taskDefinition": "old" if legacy_running else "new"}
                            ],
                        }
                    ]
                }

            def describe_task_definition(self, **kwargs):
                return {
                    "taskDefinition": {
                        "family": "propertyflow-dev",
                        "containerDefinitions": [
                            {
                                "name": "datadog-agent",
                                "image": "vendor/agent",
                                "environment": [
                                    {
                                        "name": "DD_API_KEY",
                                        "value": "private-fixture-key",
                                    }
                                ],
                            }
                        ],
                    }
                }

            def deregister_task_definition(self, **kwargs):
                mutations.append("deregister-agent")

            def delete_task_definitions(self, **kwargs):
                mutations.append("delete-agent-definition")
                return {}

        class Secrets:
            def describe_secret(self, **kwargs):
                return {}

            def delete_secret(self, **kwargs):
                self.recovery = kwargs["RecoveryWindowInDays"]
                mutations.append("schedule-secret-delete")

        class STS:
            def get_caller_identity(self):
                return {"Account": r.ACCOUNT}

        return {
            "sts": STS(),
            "cf": CF(),
            "logs": Logs(),
            "s3": object(),
            "ecs": ECS(),
            "secrets": Secrets(),
        }, mutations

    def test_retirement_dry_run_has_no_mutations_and_no_credential_output(self):
        clients, changes = self.clients()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            r.retire(clients)
        self.assertEqual(changes, [])
        self.assertNotIn("private-fixture-key", output.getvalue())

    def test_retirement_orders_dependency_cleanup_and_retains_secret_recovery(self):
        clients, changes = self.clients()
        with contextlib.redirect_stdout(io.StringIO()):
            r.retire(clients, True)
        self.assertEqual(
            changes,
            [
                "remove-subscription",
                "delete-stack",
                "wait-stack-deleted",
                "schedule-secret-delete",
                "deregister-agent",
                "delete-agent-definition",
            ],
        )
        self.assertEqual(clients["secrets"].recovery, 7)

    def test_retirement_does_not_stop_or_delete_attached_agent_tasks(self):
        clients, changes = self.clients(legacy_running=True)
        with self.assertRaisesRegex(r.SafeFailure, "still attached or running"):
            r.retire(clients, True)
        self.assertEqual(changes, [])

    def test_other_forwarder_dependency_blocks_all_retirement_mutations(self):
        clients, changes = self.clients(other_group=True)
        with self.assertRaisesRegex(r.SafeFailure, "Another log group"):
            r.retire(clients, True)
        self.assertEqual(changes, [])


if __name__ == "__main__":
    unittest.main()
