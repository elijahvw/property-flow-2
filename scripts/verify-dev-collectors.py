#!/usr/bin/env python3
"""Check running Alloy containers without fetching task environment values."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]


def verify(expected=False, attempts=24, delay=5, runner=subprocess.run, sleep=time.sleep):
    config = json.loads((ROOT / "config/dev-power.json").read_text())
    cluster = config["application"]["cluster"]
    service = config["application"]["service"]

    def aws(*args):
        result = runner(["aws", "--region", config["region"], *args, "--output", "json"],
                        text=True, capture_output=True, check=False)
        if result.returncode:
            raise ValueError("Cannot inspect ECS collector readiness; check ECS read permissions. No task environment was printed.")
        return json.loads(result.stdout)

    current = aws("ecs", "describe-services", "--cluster", cluster, "--services", service,
                  "--query", "services[0].{taskDefinition:taskDefinition,desiredCount:desiredCount}")
    if not current or current["desiredCount"] < 1:
        raise ValueError("Development service is not requested to run.")
    names = aws("ecs", "describe-task-definition", "--task-definition", current["taskDefinition"],
                "--query", "taskDefinition.containerDefinitions[].name")
    if "alloy" not in names:
        if expected:
            raise ValueError("Alloy is enabled in GitHub but absent from the service. Apply the reviewed infrastructure first.")
        print("Alloy is not enabled in the current application task.")
        return

    for attempt in range(attempts):
        tasks = aws("ecs", "list-tasks", "--cluster", cluster, "--service-name", service,
                    "--desired-status", "RUNNING", "--query", "taskArns")
        if tasks:
            rows = aws("ecs", "describe-tasks", "--cluster", cluster, "--tasks", *tasks,
                       "--query", "{failures:failures,tasks:tasks[].{definition:taskDefinitionArn,status:lastStatus,containers:containers[].{name:name,status:lastStatus,health:healthStatus}}}")
            active = rows["tasks"]
            if (not rows.get("failures") and len(active) == current["desiredCount"]
                    and all(row["definition"] == current["taskDefinition"] and row["status"] == "RUNNING"
                            and any(c["name"] == "alloy" and c["status"] == "RUNNING" and c.get("health") == "HEALTHY"
                                    for c in row["containers"]) for row in active)):
                print("Alloy is running and locally ready in every current application task. Fleet ingestion is a separate check.")
                return
        if attempt + 1 < attempts:
            sleep(delay)
    raise ValueError("Alloy did not become healthy in the current application tasks. Inspect the alloy CloudWatch log stream; application availability is independent.")


def main():
    try:
        verify(expected=os.environ.get("GRAFANA_ALLOY_ENABLED") == "true")
    except (ValueError, KeyError, OSError) as error:
        print("Collector readiness verification failed: " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
