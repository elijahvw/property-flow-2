#!/usr/bin/env python3
"""Evaluate the shipped alert queries with Prometheus against synthetic fixtures."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "monitoring", ROOT / "scripts/grafana-monitoring.py"
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
queries = {
    row["uid"]: row["data"][0]["model"]["expr"] for row in m.alert_rules("fixture")
}
scenarios = [
    {
        "name": "missing telemetry and failed readiness",
        "interval": "1m",
        "input_series": [{"series": "propertyflow_readiness", "values": "0+0x10"}],
        "promql_expr_test": [
            {
                "expr": queries["pf-dev-heartbeat"],
                "eval_time": "6m",
                "exp_samples": [{"labels": "{}", "value": 1}],
            },
            {
                "expr": queries["pf-dev-readiness"],
                "eval_time": "6m",
                "exp_samples": [{"labels": "{}", "value": 1}],
            },
        ],
    },
    {
        "name": "healthy readiness and resource pressure",
        "interval": "1m",
        "input_series": [
            {"series": "propertyflow_readiness", "values": "1+0x10"},
            {"series": "propertyflow_process_uptime_seconds", "values": "0+60x10"},
            {"series": "propertyflow_process_cpu_ratio", "values": ".9+0x10"},
            {
                "series": 'propertyflow_process_memory_bytes{type="rss"}',
                "values": "450000000+0x10",
            },
            {"series": "propertyflow_worker_last_success_seconds", "values": "0+0x10"},
            {
                "series": 'propertyflow_browser_operations_total{operation_outcome="error"}',
                "values": "0+2x10",
            },
        ],
        "promql_expr_test": [
            {
                "expr": queries["pf-dev-" + name],
                "eval_time": "6m",
                "exp_samples": [{"labels": "{}", "value": value}],
            }
            for name, value in [
                ("readiness", 0),
                ("heartbeat", 0),
                ("cpu", 1),
                ("memory", 1),
                ("billing", 1),
                ("browser", 1),
            ]
        ],
    },
    {
        "name": "ordinary traffic exceeds error threshold",
        "interval": "1m",
        "input_series": [
            {
                "series": 'propertyflow_http_requests_total{http_route="/api/properties",http_response_status_code="200"}',
                "values": "0+90x10",
            },
            {
                "series": 'propertyflow_http_requests_total{http_route="/api/properties",http_response_status_code="503"}',
                "values": "0+10x10",
            },
            {
                "series": 'propertyflow_http_requests_total{http_route="/api/ready",http_response_status_code="200"}',
                "values": "0+1000x10",
            },
        ],
        "promql_expr_test": [
            {
                "expr": queries["pf-dev-errors"],
                "eval_time": "6m",
                "exp_samples": [{"labels": "{}", "value": 1}],
            }
        ],
    },
    {
        "name": "slow API latency",
        "interval": "1m",
        "input_series": [
            {
                "series": 'propertyflow_http_duration_seconds_bucket{http_route="/api/properties",le="2"}',
                "values": "0+0x10",
            },
            {
                "series": 'propertyflow_http_duration_seconds_bucket{http_route="/api/properties",le="5"}',
                "values": "0+100x10",
            },
            {
                "series": 'propertyflow_http_duration_seconds_bucket{http_route="/api/properties",le="+Inf"}',
                "values": "0+100x10",
            },
        ],
        "promql_expr_test": [
            {
                "expr": queries["pf-dev-latency"],
                "eval_time": "6m",
                "exp_samples": [{"labels": "{}", "value": 1}],
            }
        ],
    },
]
# Match the deployed resource labels. The production queries intentionally do
# not aggregate metrics from other services or environments.
scenarios[0]["promql_expr_test"][0]["exp_samples"][0]["labels"] = '{service_name="propertyflow-server",deployment_environment="dev"}'
for scenario in scenarios:
    for series in scenario["input_series"]:
        series["series"] = m.scope_application_metrics(series["series"])
scenarios.append({
    "name": "another service cannot hide this app's missing telemetry",
    "interval": "1m",
    "input_series": [{
        "series": 'propertyflow_process_uptime_seconds{service_name="other-service",deployment_environment="dev"}',
        "values": "0+60x10",
    }],
    "promql_expr_test": [{
        "expr": queries["pf-dev-heartbeat"], "eval_time": "6m",
        "exp_samples": [{"labels": '{service_name="propertyflow-server",deployment_environment="dev"}', "value": 1}],
    }],
})
with tempfile.TemporaryDirectory(prefix="pf-promql-") as directory:
    # Prometheus runs as an unprivileged user. These synthetic, nonsecret
    # fixtures must be traversable on Linux bind mounts as well as Docker Desktop.
    Path(directory).chmod(0o755)
    path = Path(directory) / "rules.json"
    path.write_text(
        json.dumps({"rule_files": [], "evaluation_interval": "1m", "tests": scenarios})
    )
    path.chmod(0o644)
    subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "--pull",
            "never",
            "--entrypoint",
            "/bin/promtool",
            "--mount",
            "type=bind,source=" + directory + ",target=/tests,readonly",
            "prom/prometheus:v3.15.0",
            "test",
            "rules",
            "/tests/rules.json",
        ],
        check=True,
    )
