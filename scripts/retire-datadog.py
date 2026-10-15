#!/usr/bin/env python3
"""Retire this account's reviewed Datadog integration after Grafana verification.
Dry-run by default. Never fetch secret values, purge buckets, or stop running tasks.
"""
import argparse
import collections
import json
import sys

ACCOUNT = "800754316001"
REGION = "us-east-1"
STACK = "DatadogIntegration"
FORWARDER = "arn:aws:lambda:us-east-1:800754316001:function:DatadogIntegration-ForwarderStack-AX2DGY-Forwarder-gF3jdZbQ14ln"
SECRET = "arn:aws:secretsmanager:us-east-1:800754316001:secret:DdApiKeySecret-CjiCFwe7cTOq-sRBR9N"
BUCKET = "datadogintegration-forwarderstack--forwarderbucket-igigulgawhqc"
REVIEWED_TYPES = {
    "Custom::WorkflowStatus",
    "Custom::DatadogAttachIntegrationPermissionsFunctionTrigger",
    "AWS::Lambda::Function",
    "AWS::Lambda::Permission",
    "AWS::IAM::Role",
    "AWS::Events::Rule",
    "AWS::Events::ApiDestination",
    "AWS::Events::Connection",
    "AWS::SecretsManager::Secret",
    "AWS::S3::Bucket",
    "AWS::S3::BucketPolicy",
    "AWS::CloudFormation::WaitConditionHandle",
    "AWS::Logs::LogGroup",
}


class SafeFailure(RuntimeError):
    pass


def absent(error, code):
    return getattr(error, "response", {}).get("Error", {}).get("Code") == code


def stack_resources(cf):
    try:
        root = cf.describe_stacks(StackName=STACK)["Stacks"][0]
    except Exception as error:
        if absent(error, "ValidationError") and "does not exist" in error.response[
            "Error"
        ].get("Message", ""):
            return []
        raise
    if root.get("EnableTerminationProtection"):
        raise SafeFailure(
            "The integration has termination protection; review it in CloudFormation."
        )
    pending = [root["StackId"]]
    resources = []
    seen = set()
    while pending:
        stack = pending.pop()
        if stack in seen:
            continue
        if len(seen) >= 10 or not stack.startswith(
            "arn:aws:cloudformation:" + REGION + ":" + ACCOUNT + ":stack/" + STACK
        ):
            raise SafeFailure("Unexpected nested stack ownership.")
        seen.add(stack)
        for page in cf.get_paginator("list_stack_resources").paginate(StackName=stack):
            for row in page["StackResourceSummaries"]:
                # A failed root delete retains summaries of already deleted
                # children. They must not be queried or inspected on retry.
                if row.get("ResourceStatus") == "DELETE_COMPLETE":
                    continue
                if row["ResourceType"] == "AWS::CloudFormation::Stack":
                    pending.append(row["PhysicalResourceId"])
                else:
                    resources.append(row)
    for row in resources:
        if row["ResourceType"] not in REVIEWED_TYPES:
            raise SafeFailure(
                "The integration contains an unreviewed resource type; no resources were retired."
            )
        if (
            row["ResourceType"] == "AWS::S3::Bucket"
            and row.get("PhysicalResourceId") != BUCKET
        ):
            raise SafeFailure("Unexpected integration bucket; review before deleting.")
        if (
            row["ResourceType"] == "AWS::SecretsManager::Secret"
            and row.get("PhysicalResourceId") != SECRET
        ):
            raise SafeFailure("Unexpected integration secret; review before deleting.")
    return resources


def plan(cf, logs, s3, ecs):
    resources = stack_resources(cf)
    if any(row["ResourceType"] == "AWS::S3::Bucket" for row in resources):
        page = s3.list_object_versions(Bucket=BUCKET, MaxKeys=1)
        if page.get("Versions") or page.get("DeleteMarkers"):
            raise SafeFailure(
                "The integration bucket is no longer empty. No objects were deleted; review its contents."
            )
    subscriptions = []
    for page in logs.get_paginator("describe_log_groups").paginate():
        for group in page.get("logGroups", []):
            for batch in logs.get_paginator("describe_subscription_filters").paginate(
                logGroupName=group["logGroupName"]
            ):
                for row in batch.get("subscriptionFilters", []):
                    if row["destinationArn"] == FORWARDER:
                        if group["logGroupName"] != "/ecs/propertyflow-dev":
                            raise SafeFailure(
                                "Another log group uses the integration. Review that dependency before retiring it."
                            )
                        subscriptions.append(
                            {
                                "logGroupName": group["logGroupName"],
                                "filterName": row["filterName"],
                            }
                        )
    current = ecs.describe_services(
        cluster="propertyflow-dev-cluster", services=["propertyflow-dev"]
    )
    if current.get("failures") or not current.get("services"):
        raise SafeFailure(
            "The app service must exist and be healthy before retirement."
        )
    service = current["services"][0]
    if (
        service["runningCount"] < 1
        or service["pendingCount"]
        or len(service["deployments"]) != 1
    ):
        raise SafeFailure(
            "Wait for the app rollout and draining tasks to finish before retirement."
        )
    protected = {d["taskDefinition"] for d in service["deployments"]}
    for page in ecs.get_paginator("list_tasks").paginate(
        cluster="propertyflow-dev-cluster"
    ):
        tasks = page.get("taskArns", [])
        if tasks:
            for task in ecs.describe_tasks(
                cluster="propertyflow-dev-cluster", tasks=tasks
            )["tasks"]:
                protected.add(task["taskDefinitionArn"])
    definitions = []
    for status in ["ACTIVE", "INACTIVE"]:
        for page in ecs.get_paginator("list_task_definitions").paginate(
            familyPrefix="propertyflow-dev", status=status
        ):
            for arn in page.get("taskDefinitionArns", []):
                row = ecs.describe_task_definition(taskDefinition=arn)["taskDefinition"]
                if row["family"] != "propertyflow-dev":
                    continue
                if any(
                    "datadog" in c["name"].lower() or "datadog/" in c["image"].lower()
                    for c in row["containerDefinitions"]
                ):
                    if arn in protected:
                        raise SafeFailure(
                            "A legacy monitoring task is still attached or running; no tasks were stopped."
                        )
                    definitions.append({"arn": arn, "status": status})
    return {
        "resources": resources,
        "subscriptions": subscriptions,
        "definitions": definitions,
    }


def retire(clients, execute=False):
    if clients["sts"].get_caller_identity()["Account"] != ACCOUNT:
        raise SafeFailure("Unexpected AWS account.")
    state = plan(clients["cf"], clients["logs"], clients["s3"], clients["ecs"])
    print(
        json.dumps(
            {
                "stack": STACK,
                "managed_resource_counts": dict(
                    collections.Counter(r["ResourceType"] for r in state["resources"])
                ),
                "app_log_subscriptions": len(state["subscriptions"]),
                "unused_legacy_task_definitions": len(state["definitions"]),
                "execute": execute,
            }
        )
    )
    if not execute:
        return
    for row in state["subscriptions"]:
        clients["logs"].delete_subscription_filter(**row)
    if state["resources"]:
        clients["cf"].delete_stack(StackName=STACK)
        clients["cf"].get_waiter("stack_delete_complete").wait(
            StackName=STACK, WaiterConfig={"Delay": 15, "MaxAttempts": 120}
        )
    # Some Forwarder templates retain their API-key secret. Schedule recovery-safe
    # deletion of only the exact inventoried ARN; EventBridge owns its own managed secret.
    try:
        secret = clients["secrets"].describe_secret(SecretId=SECRET)
        if not secret.get("DeletedDate"):
            clients["secrets"].delete_secret(SecretId=SECRET, RecoveryWindowInDays=7)
    except Exception as error:
        if not absent(error, "ResourceNotFoundException"):
            raise
    for row in state["definitions"]:
        if row["status"] == "ACTIVE":
            clients["ecs"].deregister_task_definition(taskDefinition=row["arn"])
    arns = [row["arn"] for row in state["definitions"]]
    for start in range(0, len(arns), 10):
        response = clients["ecs"].delete_task_definitions(
            taskDefinitions=arns[start : start + 10]
        )
        if response.get("failures"):
            raise SafeFailure(
                "Some unused legacy task definitions need operator review."
            )
    print(
        "Retired the reviewed AWS integration, log subscription, retained API-key secret and unused agent task definitions."
    )
    print(
        "Repository credentials and Datadog-side token revocation/subscription cancellation require the account owner; see the runbook."
    )


if __name__ == "__main__":
    import boto3

    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    try:
        clients = {
            name: boto3.client(service, region_name=REGION)
            for name, service in [
                ("sts", "sts"),
                ("cf", "cloudformation"),
                ("logs", "logs"),
                ("s3", "s3"),
                ("ecs", "ecs"),
                ("secrets", "secretsmanager"),
            ]
        }
        retire(clients, args.execute)
    except SafeFailure as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print(
            "AWS retirement did not finish. Inspect CloudFormation and resource status; no secret values were retrieved or printed.",
            file=sys.stderr,
        )
        sys.exit(1)
