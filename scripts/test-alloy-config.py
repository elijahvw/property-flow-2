#!/usr/bin/env python3
"""Render the real template and validate both modes using the pinned Alloy build."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    template = ROOT / "infra/terraform/modules/ecr/alloy/config.alloy.tftpl"
    terraform = os.environ.get("TERRAFORM_BINARY", "terraform")
    binary = os.environ.get("ALLOY_BINARY")
    with tempfile.TemporaryDirectory(prefix="propertyflow-alloy-config-") as directory:
        folder = Path(directory)
        for experimental in (False, True):
            arguments = {"fleet_url": "https://fleet-management-prod-028.grafana.net", "fleet_id": "1877143",
                         "environment": "isolated", "ecs_metrics_enabled": experimental}
            expression = "jsonencode(templatefile(" + json.dumps(str(template)) + "," + json.dumps(arguments) + "))"
            rendered = subprocess.run([terraform, "console"], input=expression + "\n", cwd=folder,
                                      text=True, capture_output=True, check=True)
            config = json.loads(json.loads(rendered.stdout))
            path = folder / "config.alloy"
            path.write_text(config)
            level = "experimental" if experimental else "generally-available"
            if binary:
                command = [binary, "validate", "--stability.level=" + level, str(path)]
            else:
                command = ["docker", "run", "--rm", "--network", "none", "--entrypoint", "/bin/alloy",
                           "--mount", f"type=bind,src={folder},dst=/config,readonly", "grafana/alloy:v1.21.1",
                           "validate", "--stability.level=" + level, "/config/config.alloy"]
            subprocess.run(command, check=True)
            print("Validated Alloy configuration: " + level)


if __name__ == "__main__":
    main()
