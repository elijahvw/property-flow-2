#!/usr/bin/env python3
"""Configure only Property Flow's Grafana resources; never print credentials or API bodies."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
STACK = "https://slimpillar2069.grafana.net"
FOLDER = "propertyflow-dev"
DASHBOARD = "propertyflow-dev-operations"


class SafeFailure(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise SafeFailure(
            "Grafana redirected a credentialed request; check the configured stack URL."
        )


def validate_endpoint(value):
    if not re.fullmatch(
        r"https://otlp-gateway-[a-z0-9-]+\.grafana\.net/otlp", value or ""
    ):
        raise SafeFailure(
            "Set GRAFANA_OTLP_ENDPOINT to the HTTPS gateway URL ending /otlp."
        )
    return value


def validate_headers(value):
    # Accept the SDK's encoded space or literal space, but never arbitrary headers.
    decoded = urllib.parse.unquote(value or "")
    if not re.fullmatch(r"Authorization=Basic [A-Za-z0-9+/]+={0,2}", decoded):
        raise SafeFailure(
            "GRAFANA_OTLP_HEADERS must contain the generated Authorization=Basic value only."
        )
    try:
        credentials = base64.b64decode(decoded.split(" ", 1)[1], validate=True)
        if b":" not in credentials or len(credentials) < 12:
            raise ValueError()
    except ValueError:
        raise SafeFailure(
            "GRAFANA_OTLP_HEADERS contains invalid Basic credentials."
        ) from None
    return value


def validate_secret_arn(arn):
    if not re.fullmatch(
        r"arn:aws:secretsmanager:us-east-1:800754316001:secret:propertyflow-dev-grafana-otlp-[A-Za-z0-9]{6}",
        arn,
    ):
        raise SafeFailure("Unexpected development ingestion-secret ARN.")
    return arn


def store_ingestion(env=os.environ, client=None):
    validate_endpoint(env.get("GRAFANA_OTLP_ENDPOINT"))
    headers = validate_headers(env.get("GRAFANA_OTLP_HEADERS"))
    arn = validate_secret_arn(env.get("GRAFANA_SECRET_ARN", ""))
    if client is None:
        import boto3

        client = boto3.client("secretsmanager", region_name="us-east-1")
    # Put only. Never retrieve a secret; neither token nor decoded credentials are logged.
    client.put_secret_value(
        SecretId=arn,
        SecretString=json.dumps({"headers": headers}),
        ClientRequestToken=str(uuid.uuid4()),
    )
    print("Stored the write-only ingestion credential for ECS injection.")


def validate_bootstrap_plan(plan):
    """A targeted bootstrap must never mutate the app, database or dependencies."""
    address = "module.ecr.aws_secretsmanager_secret.grafana[0]"
    if not any(
        row.get("address") == address for row in plan.get("resource_changes", [])
    ):
        raise SafeFailure(
            "Ingestion-secret metadata is missing from the bootstrap plan."
        )
    for row in plan.get("resource_changes", []):
        change = row.get("change", {})
        actions = change.get("actions", [])
        if actions in (["no-op"], ["read"]):
            continue
        if (
            row.get("address") != address
            or actions not in (["create"], ["update"])
            or (change.get("after") or {}).get("name")
            != "propertyflow-dev-grafana-otlp"
        ):
            raise SafeFailure(
                "Ingestion bootstrap would change resources beyond the reviewed secret metadata; aborting before apply."
            )


def bootstrap_ingestion(env=os.environ, runner=subprocess.run, client=None):
    validate_endpoint(env.get("GRAFANA_OTLP_ENDPOINT"))
    validate_headers(env.get("GRAFANA_OTLP_HEADERS"))
    directory = ROOT / "infra/terraform/envs/dev"

    def terraform(*args):
        # Plan JSON/state may contain existing app secrets. Capture privately;
        # never emit subprocess output, even on a failed command.
        result = runner(
            ["terraform", *args],
            cwd=directory,
            env=env,
            text=True,
            capture_output=True,
        )
        if result.returncode:
            raise SafeFailure(
                "Ingestion-secret bootstrap failed; inspect Terraform permissions/state. No app update was attempted."
            )
        return result.stdout

    # Existing installations do not need a targeted infrastructure apply.
    # Module input dependencies can bring unrelated tag/database changes into
    # that plan. Keep those changes behind the ordinary full-plan review.
    outputs = json.loads(terraform("output", "-json"))
    existing = outputs.get("grafana_secret_arn", {}).get("value")
    if existing:
        arn = validate_secret_arn(existing)
        if client is None:
            import boto3

            client = boto3.client("secretsmanager", region_name="us-east-1")
        metadata = client.describe_secret(SecretId=arn)
        if metadata.get("ARN") != arn or metadata.get("Name") != "propertyflow-dev-grafana-otlp" or metadata.get("DeletedDate"):
            raise SafeFailure("Existing ingestion-secret metadata is unavailable or unexpected.")
        store_ingestion({**env, "GRAFANA_SECRET_ARN": arn}, client)
        print("Existing ingestion secret is populated before the full infrastructure plan/apply.")
        return

    terraform(
        "plan",
        "-input=false",
        "-target=module.ecr.aws_secretsmanager_secret.grafana",
        "-out=ingestion-bootstrap.tfplan",
    )
    validate_bootstrap_plan(
        json.loads(terraform("show", "-json", "ingestion-bootstrap.tfplan"))
    )
    terraform("apply", "-input=false", "ingestion-bootstrap.tfplan")
    arn = terraform("output", "-raw", "grafana_secret_arn").strip()
    store_ingestion({**env, "GRAFANA_SECRET_ARN": arn}, client)
    print("Ingestion secret is populated before the full infrastructure plan/apply.")


class Grafana:
    def __init__(self, env=os.environ, opener=None):
        self.url = env.get("GRAFANA_URL", STACK).rstrip("/")
        if self.url != STACK:
            raise SafeFailure(
                "Unexpected Grafana stack. This release targets slimpillar2069 only."
            )
        self.token = env.get("GRAFANA_SERVICE_ACCOUNT_TOKEN", "")
        if not self.token or any(c.isspace() for c in self.token):
            raise SafeFailure(
                "Set GRAFANA_SERVICE_ACCOUNT_TOKEN to an Editor service-account token."
            )
        self.opener = opener or urllib.request.build_opener(NoRedirect())

    def request(self, method, path, body=None, missing=False):
        if not path.startswith("/api/") or "\n" in path:
            raise SafeFailure("Unexpected Grafana API path.")
        request = urllib.request.Request(
            self.url + path,
            method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={
                "Authorization": "Bearer " + self.token,
                "Content-Type": "application/json",
                "X-Disable-Provenance": "true",
            },
        )
        try:
            with self.opener.open(request, timeout=15) as response:
                data = response.read(2_000_001)
                if len(data) > 2_000_000:
                    raise SafeFailure("Grafana response exceeded the safety limit.")
                return json.loads(data) if data else {}
        except urllib.error.HTTPError as error:
            if missing and error.code == 404:
                return None
            raise SafeFailure(
                f'Grafana API returned HTTP {error.code} for {method} {path.split("?")[0]}.'
            ) from None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            raise SafeFailure(
                "Grafana connection failed; check network, stack URL and service-account permissions."
            ) from None

    def sources(self):
        rows = self.request("GET", "/api/datasources")
        selected = {}
        # Cloud also provisions Loki sources for alert history and usage
        # insights. Match the primary stack UIDs, independent of display names,
        # rather than treating every source of a signal's type as app data.
        for name, kind, uid in [
            ("metrics", "prometheus", "grafanacloud-prom"),
            ("logs", "loki", "grafanacloud-logs"),
            ("traces", "tempo", "grafanacloud-traces"),
        ]:
            candidates = [
                row for row in rows if row.get("type") == kind and row.get("uid") == uid
            ]
            if len(candidates) != 1:
                raise SafeFailure(
                    f"Expected the primary hosted {kind} data source ({uid}); review the stack data sources."
                )
            selected[name] = candidates[0]["uid"]
        return selected


def scope_application_metrics(expression):
    """Only the intended service/environment; never aggregate another stack app."""
    scope = 'service_name="propertyflow-server",deployment_environment="dev"'
    return re.sub(
        r'(propertyflow_[a-z_]+)(\{[^}]*\})?',
        lambda match: match[1] + '{' + scope + (',' + match[2][1:-1] if match[2] else '') + '}',
        expression,
    )


def alert_rules(metrics_uid):
    definitions = [
        (
            "heartbeat",
            "Application telemetry missing",
            "absent(propertyflow_process_uptime_seconds) or (time() - max(timestamp(propertyflow_process_uptime_seconds)) > 120)",
            "2m",
            "critical",
        ),
        (
            "readiness",
            "Database readiness failing",
            "max(propertyflow_readiness) < 1",
            "2m",
            "critical",
        ),
        (
            "errors",
            "API error rate above 5%",
            'sum(rate(propertyflow_http_requests_total{http_route!~"/api/(ready|health|telemetry)",http_response_status_code=~"5.."}[5m])) / clamp_min(sum(rate(propertyflow_http_requests_total{http_route!~"/api/(ready|health|telemetry)"}[5m])),0.001) > 0.05',
            "5m",
            "critical",
        ),
        (
            "latency",
            "API p95 latency above two seconds",
            'histogram_quantile(0.95,sum by(le)(rate(propertyflow_http_duration_seconds_bucket{http_route!~"/api/(ready|health|telemetry)"}[5m]))) > 2',
            "5m",
            "warning",
        ),
        (
            "memory",
            "App RSS above 400 MiB",
            'max(propertyflow_process_memory_bytes{type="rss"}) > 419430400',
            "5m",
            "warning",
        ),
        (
            "cpu",
            "App CPU above 85% of allocated capacity",
            "max(propertyflow_process_cpu_ratio) > 0.85",
            "5m",
            "warning",
        ),
        (
            "billing",
            "Rent billing has not completed successfully",
            "time() - max(propertyflow_worker_last_success_seconds) > 300",
            "3m",
            "critical",
        ),
        (
            "browser",
            "Browser operation failures",
            'sum(increase(propertyflow_browser_operations_total{operation_outcome="error"}[10m])) > 5',
            "2m",
            "warning",
        ),
    ]
    result = []
    for name, title, expression, period, severity in definitions:
        expression = scope_application_metrics(expression)
        result.append(
            {
                "uid": "pf-dev-" + name,
                "title": title,
                "ruleGroup": "propertyflow-dev",
                "folderUID": FOLDER,
                "condition": "B",
                "for": period,
                "noDataState": "OK",
                "execErrState": "Error",
                "isPaused": True,
                "labels": {
                    "service": "propertyflow",
                    "environment": "dev",
                    "severity": severity,
                },
                "annotations": {
                    "summary": title,
                    "runbook_url": "https://github.com/elijahvw/property-flow-2/blob/main/docs/open-observability.md",
                },
                "data": [
                    {
                        "refId": "A",
                        "relativeTimeRange": {"from": 600, "to": 0},
                        "datasourceUid": metrics_uid,
                        "model": {
                            "refId": "A",
                            "expr": re.sub(
                                r"(?<![<>=!])([<>])(?![=])", r"\1 bool ", expression
                            ),
                            "instant": True,
                            "range": False,
                            "format": "table",
                            "intervalMs": 15000,
                            "maxDataPoints": 43200,
                            "datasource": {"type": "prometheus", "uid": metrics_uid},
                        },
                    },
                    {
                        "refId": "B",
                        "relativeTimeRange": {"from": 0, "to": 0},
                        "datasourceUid": "__expr__",
                        "model": {
                            "refId": "B",
                            "type": "threshold",
                            "expression": "A",
                            "conditions": [
                                {
                                    "evaluator": {"type": "gt", "params": [0.5]},
                                    "operator": {"type": "and"},
                                    "query": {"params": ["B"]},
                                    "reducer": {"type": "last", "params": []},
                                    "type": "query",
                                }
                            ],
                        },
                    },
                ],
            }
        )
    return result


def provision(api):
    sources = api.sources()
    folders = api.request("GET", "/api/folders?limit=1000")
    existing = next((row for row in folders if row.get("uid") == FOLDER), None)
    if existing and existing.get("title") != "Property Flow · Dev":
        raise SafeFailure("Dedicated folder UID already belongs to another resource.")
    if not existing:
        api.request(
            "POST", "/api/folders", {"uid": FOLDER, "title": "Property Flow · Dev"}
        )
    dashboard = json.loads(
        (ROOT / "monitoring/propertyflow-dashboard.json").read_text()
    )
    # Replace only our symbolic datasource references; leave Grafana template variables intact.
    encoded = json.dumps(dashboard)
    for key in sources:
        encoded = encoded.replace('"' + key.upper() + '_UID"', '"' + sources[key] + '"')
    dashboard = json.loads(encoded)
    matches = api.request(
        "GET",
        "/api/search?"
        + urllib.parse.urlencode({"dashboardUIDs": DASHBOARD, "limit": 1000}),
    )
    old = next((row for row in matches if row.get("uid") == DASHBOARD), None)
    if old and (
        old.get("title") != dashboard["title"] or old.get("folderUid") != FOLDER
    ):
        raise SafeFailure(
            "Dedicated dashboard UID already belongs to another resource."
        )
    api.request(
        "POST",
        "/api/dashboards/db",
        {
            "dashboard": dashboard,
            "folderUid": FOLDER,
            "overwrite": True,
            "message": "Property Flow monitoring configuration",
        },
    )
    for rule in alert_rules(sources["metrics"]):
        old = api.request(
            "GET", "/api/v1/provisioning/alert-rules/" + rule["uid"], missing=True
        )
        if old:
            if (
                old.get("folderUID") != FOLDER
                or old.get("labels", {}).get("service") != "propertyflow"
            ):
                raise SafeFailure(
                    "Dedicated alert UID already belongs to another resource."
                )
            rule["isPaused"] = old.get(
                "isPaused", True
            )  # Reprovisioning never silently changes notification state.
        api.request(
            "PUT" if old else "POST",
            "/api/v1/provisioning/alert-rules" + ("/" + rule["uid"] if old else ""),
            rule,
        )
    print(
        "Provisioned the Property Flow dashboard and eight alert rules. New rules are paused pending contact-point review."
    )
    print(STACK + "/d/" + DASHBOARD)


def verify(api, attempts=1, delay=10):
    sources = api.sources()
    revision = os.environ.get("GITHUB_SHA", "")
    if revision and not re.fullmatch("[a-f0-9]{40}", revision):
        raise SafeFailure("Unexpected release revision.")
    metric_query = (
        'propertyflow_build_info{build_version="' + revision + '"}'
        if revision
        else "propertyflow_process_uptime_seconds"
    )
    log_query = '{service_name="propertyflow-server"}' + (
        ' | service_version="' + revision + '"' if revision else ""
    )
    trace_query = (
        '{resource.service.name="propertyflow-server"'
        + (' && resource.service.version="' + revision + '"' if revision else "")
        + "}"
    )
    for attempt in range(attempts):
        now = int(time.time())
        metric = api.request(
            "GET",
            "/api/datasources/proxy/uid/"
            + sources["metrics"]
            + "/api/v1/query?"
            + urllib.parse.urlencode({"query": metric_query}),
        )
        logs = api.request(
            "GET",
            "/api/datasources/proxy/uid/"
            + sources["logs"]
            + "/loki/api/v1/query_range?"
            + urllib.parse.urlencode(
                {
                    "query": log_query,
                    "limit": 1,
                    "start": (now - 1800) * 1_000_000_000,
                    "end": now * 1_000_000_000,
                }
            ),
        )
        traces = api.request(
            "GET",
            "/api/datasources/proxy/uid/"
            + sources["traces"]
            + "/api/search?"
            + urllib.parse.urlencode(
                {"q": trace_query, "limit": 1, "start": now - 1800, "end": now}
            ),
        )
        present = [
            bool(metric.get("data", {}).get("result")),
            bool(logs.get("data", {}).get("result")),
            bool(traces.get("traces")),
        ]
        if all(present):
            print(
                "Grafana contains recent application metrics, Loki logs and Tempo traces."
            )
            return
        print(
            "Waiting for signals: "
            + ", ".join(
                name
                for name, ok in zip(["metrics", "logs", "traces"], present)
                if not ok
            )
        )
        if attempt + 1 < attempts:
            time.sleep(delay)
    raise SafeFailure(
        "Hosted signal verification is incomplete. Keep the previous monitoring integration until reviewed."
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "action",
        choices=[
            "preflight",
            "bootstrap-ingestion",
            "store-ingestion",
            "provision",
            "verify",
        ],
    )
    parser.add_argument("--attempts", type=int, default=1)
    args = parser.parse_args()
    if args.action == "preflight":
        validate_endpoint(os.environ.get("GRAFANA_OTLP_ENDPOINT"))
        validate_headers(os.environ.get("GRAFANA_OTLP_HEADERS"))
        Grafana()
        print("Grafana configuration is present and structurally valid.")
    elif args.action == "store-ingestion":
        store_ingestion()
    elif args.action == "bootstrap-ingestion":
        bootstrap_ingestion()
    elif args.action == "provision":
        provision(Grafana())
    else:
        verify(Grafana(), max(1, min(args.attempts, 12)))


if __name__ == "__main__":
    try:
        main()
    except SafeFailure as failure:
        print(str(failure), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print(
            "Monitoring setup failed. Inspect permissions and resource status; credentials were not printed.",
            file=sys.stderr,
        )
        sys.exit(1)
