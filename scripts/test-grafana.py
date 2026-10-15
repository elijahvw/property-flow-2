#!/usr/bin/env python3
"""Exercise the actual Grafana dashboard/rule APIs in an isolated tmpfs container."""
import contextlib
import io
import base64
import importlib.util
import json
from pathlib import Path
import subprocess
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "monitoring", ROOT / "scripts/grafana-monitoring.py"
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


container = None
try:
    image = docker("image", "inspect", "grafana/grafana:13.2.2", "--format", "{{.Id}}")
    password = uuid.uuid4().hex
    container = docker(
        "run",
        "--detach",
        "--pull",
        "never",
        "--name",
        "pf-grafana-" + uuid.uuid4().hex,
        "--memory",
        "512m",
        "--publish",
        "127.0.0.1::3000",
        "--tmpfs",
        "/var/lib/grafana:rw,uid=472,gid=0",
        "--env",
        "GF_SECURITY_ADMIN_PASSWORD=" + password,
        "--env",
        "GF_ANALYTICS_REPORTING_ENABLED=false",
        "--env",
        "GF_ANALYTICS_CHECK_FOR_UPDATES=false",
        "--env",
        "GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES=false",
        image,
    )
    info = json.loads(docker("inspect", container))[0]
    assert info["HostConfig"]["Tmpfs"]["/var/lib/grafana"] == "rw,uid=472,gid=0"
    port = info["NetworkSettings"]["Ports"]["3000/tcp"][0]
    assert port["HostIp"] == "127.0.0.1"
    origin = "http://127.0.0.1:" + port["HostPort"]
    for attempt in range(120):
        try:
            if urllib.request.urlopen(origin + "/api/health", timeout=1).status == 200:
                break
        except Exception:
            time.sleep(0.5)
    else:
        raise AssertionError("isolated Grafana startup timed out")

    def request(method, path, body=None):
        req = urllib.request.Request(
            origin + path,
            method=method,
            headers={
                "Authorization": "Basic "
                + base64.b64encode(("admin:" + password).encode()).decode(),
                "Content-Type": "application/json",
            },
            data=None if body is None else json.dumps(body).encode(),
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.load(response)

    # Reproduce Cloud's complete signal catalogue, including the extra Loki
    # sources that blocked the first real deployment.
    for uid, kind in [
        ("grafanacloud-prom", "prometheus"),
        ("grafanacloud-logs", "loki"),
        ("grafanacloud-traces", "tempo"),
        ("grafanacloud-alert-state-history", "loki"),
        ("grafanacloud-usage-insights", "loki"),
        ("grafanacloud-usage", "prometheus"),
    ]:
        request(
            "POST",
            "/api/datasources",
            {
                "name": uid.replace("grafanacloud-", "grafanacloud-slimpillar2069-"),
                "uid": uid,
                "type": kind,
                "access": "proxy",
                "url": "http://127.0.0.1:1",
            },
        )
    account = request(
        "POST", "/api/serviceaccounts", {"name": "fixture-editor", "role": "Editor"}
    )
    token = request(
        "POST",
        "/api/serviceaccounts/" + str(account["id"]) + "/tokens",
        {"name": "fixture"},
    )["key"]
    api = m.Grafana({"GRAFANA_SERVICE_ACCOUNT_TOKEN": token})
    api.url = origin  # Test-only transport override; never uses a cloud endpoint or real credentials.
    with contextlib.redirect_stdout(io.StringIO()):
        m.provision(api)
    dashboard = request("GET", "/api/dashboards/uid/" + m.DASHBOARD)
    assert len(dashboard["dashboard"]["panels"]) == 13
    assert api.sources() == {
        "metrics": "grafanacloud-prom",
        "logs": "grafanacloud-logs",
        "traces": "grafanacloud-traces",
    }
    for rule in m.alert_rules("grafanacloud-prom"):
        saved = request("GET", "/api/v1/provisioning/alert-rules/" + rule["uid"])
        assert saved["isPaused"] and saved["condition"] == "B"
        assert saved["data"][0]["datasourceUid"] == "grafanacloud-prom"
    with contextlib.redirect_stdout(io.StringIO()):
        m.provision(api)  # Repeated setup must update existing resources safely.
    print(
        "PASS: real Grafana API accepts the dashboard and all eight paused alert rules with an Editor account; repeated provisioning succeeds."
    )
finally:
    if container:
        docker("rm", "--force", container)
