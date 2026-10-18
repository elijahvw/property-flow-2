#!/usr/bin/env python3
"""Fail CI when infrastructure lacks a deliberate start/stop or retention policy."""
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def validate(root=ROOT):
    config = json.loads((root / "config/dev-power.json").read_text())
    infra = root / "infra/terraform"
    managed = {config[key]["terraform"] for key in ("database", "application")}
    retained = config["retainedResourceTypes"]
    seen = set()
    for directory in (infra / "envs/dev", infra / "modules"):
        for path in directory.rglob("*.tf"):
            if ".terraform" in path.parts:
                continue
            for kind, name in re.findall(r'^\s*resource\s+"([^"]+)"\s+"([^"]+)"\s*\{', path.read_text(), re.M):
                address = str(path.relative_to(infra)) + "#" + kind + "." + name
                seen.add(address)
                if kind in ("aws_ecs_service", "aws_db_instance"):
                    if address not in managed:
                        raise ValueError(f"Add {address} to the development power sequence before shipping it.")
                elif not retained.get(kind):
                    raise ValueError(f"Define start/stop or justified retention for new resource type {kind} in config/dev-power.json.")
    if not managed <= seen:
        raise ValueError("Development power inventory refers to removed infrastructure: " + ", ".join(sorted(managed - seen)))
    values = [config["account"], config["region"], config["database"]["identifier"], config["application"]["cluster"], config["application"]["service"]]
    if any(not re.fullmatch(r"[a-zA-Z0-9-]+", value) for value in values):
        raise ValueError("Invalid development power target.")
    return config, values


def validate_plan(config, plan):
    # Read only addresses/types; plan values can contain credentials and must
    # never be logged, uploaded, or included in an exception.
    managed = {config[key]["address"] for key in ("database", "application")}
    seen = set()

    def visit(module):
        for resource in module.get("resources", []):
            if resource.get("mode") != "managed":
                continue
            address, kind = resource["address"], resource["type"]
            seen.add(address)
            if kind in ("aws_ecs_service", "aws_db_instance"):
                if address not in managed:
                    raise ValueError(f"Add {address} to the development power sequence before applying infrastructure.")
            elif not config["retainedResourceTypes"].get(kind):
                raise ValueError(f"Define lifecycle coverage for planned resource type {kind}.")
        for child in module.get("child_modules", []):
            visit(child)

    visit(plan.get("planned_values", {}).get("root_module", {}))
    if not managed <= seen:
        raise ValueError("The plan removes a managed development power target.")
    if any(row.get("type") == "aws_db_instance" and "delete" in row.get("change", {}).get("actions", []) for row in plan.get("resource_changes", [])):
        raise ValueError("Routine development deployment must not delete or replace the retained database.")


if __name__ == "__main__":
    try:
        config, values = validate()
        if "--plan" in sys.argv:
            path = sys.argv[sys.argv.index("--plan") + 1]
            output = subprocess.run(["terraform", "show", "-json", path], capture_output=True, text=True, check=True)
            validate_plan(config, json.loads(output.stdout))
        print("\t".join(values) if "--runtime" in sys.argv else "Development power inventory covers all Terraform resources.")
    except subprocess.CalledProcessError:
        print("Cannot inspect the infrastructure plan; no plan values were printed.", file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, IndexError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
