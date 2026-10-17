#!/usr/bin/env python3
"""Keep a verified restore point before migrations; retain five workflow backups."""
import datetime
import json
import os
import re
import subprocess
import argparse

ACCOUNT = "800754316001"
DATABASE = "propertyflow-dev-db"
PREFIX = "propertyflow-dev-pre-"
TAGS = {"Application": "propertyflow", "Environment": "dev", "BackupPurpose": "pre-migration"}
KEEP = 5


def aws(*arguments):
    result = subprocess.run(
        ["aws", "--region", "us-east-1", *arguments, "--output", "json"],
        check=True, capture_output=True, text=True,
    )
    return json.loads(result.stdout) if result.stdout.strip() else {}


def snapshot_name(env):
    revision, run, attempt = (env.get(key, "") for key in ("GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"))
    if not re.fullmatch(r"[a-f0-9]{40}", revision) or not re.fullmatch(r"[0-9]+", run) or not re.fullmatch(r"[0-9]+", attempt):
        raise ValueError("Expected an identified GitHub release run.")
    return f"{PREFIX}{revision[:12]}-{run}-{attempt}"


def start(call=aws, env=os.environ):
    if call("sts", "get-caller-identity")["Account"] != ACCOUNT:
        raise ValueError("Unexpected AWS account.")
    snapshot = snapshot_name(env)
    created = call("rds", "create-db-snapshot", "--db-instance-identifier", DATABASE,
        "--db-snapshot-identifier", snapshot, "--tags", json.dumps([{"Key": k, "Value": v} for k, v in TAGS.items()]))["DBSnapshot"]
    if created["DBSnapshotIdentifier"] != snapshot or created["DBInstanceIdentifier"] != DATABASE:
        raise ValueError("Unexpected snapshot target.")
    print("Database restore point started; the image can build while RDS prepares it.")
    return snapshot


def verify(call=aws, env=os.environ):
    if call("sts", "get-caller-identity")["Account"] != ACCOUNT:
        raise ValueError("Unexpected AWS account.")
    snapshot = snapshot_name(env)
    call("rds", "wait", "db-snapshot-available", "--db-snapshot-identifier", snapshot)
    rows = call("rds", "describe-db-snapshots", "--db-instance-identifier", DATABASE, "--snapshot-type", "manual")["DBSnapshots"]
    current = next((r for r in rows if r["DBSnapshotIdentifier"] == snapshot), None)
    if not current or current["Status"] != "available" or current["DBInstanceIdentifier"] != DATABASE:
        raise ValueError("The new restore point is not available; no backups were removed.")
    owned = []
    # Gather and validate every candidate before deleting anything. Unrelated,
    # untagged, automated and in-progress snapshots are never removed.
    pattern = re.compile(re.escape(PREFIX) + r"[a-f0-9]{12}-[0-9]+-[0-9]+")
    for row in rows:
        name = row["DBSnapshotIdentifier"]
        if not pattern.fullmatch(name) or row["DBInstanceIdentifier"] != DATABASE or row.get("SnapshotType") != "manual" or row["Status"] != "available":
            continue
        arn = row["DBSnapshotArn"]
        if arn != f"arn:aws:rds:us-east-1:{ACCOUNT}:snapshot:{name}":
            continue
        tags = call("rds", "list-tags-for-resource", "--resource-name", arn)["TagList"]
        if not TAGS.items() <= {t["Key"]: t["Value"] for t in tags}.items():
            continue
        created_on = datetime.datetime.fromisoformat(row["SnapshotCreateTime"].replace("Z", "+00:00"))
        if created_on.tzinfo is None:
            raise ValueError("Snapshot time is missing its timezone.")
        owned.append((created_on, name))
    if snapshot not in {name for _, name in owned}:
        raise ValueError("The new restore point is missing its workflow tags.")
    # Keep this run's verified point even when another deployment created a
    # newer snapshot; keep the four newest remaining workflow points as well.
    older = sorted((r for r in owned if r[1] != snapshot), reverse=True)
    for _, name in older[KEEP - 1:]:
        call("rds", "delete-db-snapshot", "--db-snapshot-identifier", name)
    print("Pre-migration restore point available: " + snapshot)
    return snapshot


def preserve(call=aws, env=os.environ):
    start(call, env)
    return verify(call, env)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", nargs="?", choices=["start", "verify", "preserve"], default="preserve")
    action = parser.parse_args().action
    try:
        preserved = {"start": start, "verify": verify, "preserve": preserve}[action]()
        if action != "start" and os.environ.get("GITHUB_STEP_SUMMARY"):
            with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
                summary.write(f"Pre-migration database restore point: {preserved}. Retain the five latest workflow-owned backups.\n")
    except subprocess.CalledProcessError as error:
        print(error.stderr)
        raise SystemExit("Database restore-point preparation failed; backend rollout must not proceed.")
    except Exception:
        raise SystemExit("Database restore-point preparation failed; backend rollout must not proceed. Check AWS snapshot permissions and status.")


if __name__ == "__main__":
    main()
