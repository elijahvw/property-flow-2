#!/usr/bin/env python3
"""Roll ECS to the immutable image; fail if the circuit breaker restored an old release."""
import os
import re
import sys

ACCOUNT = "800754316001"
CLUSTER = "propertyflow-dev-cluster"
SERVICE = "propertyflow-dev"
FIELDS = (
    "family",
    "taskRoleArn",
    "executionRoleArn",
    "networkMode",
    "containerDefinitions",
    "volumes",
    "placementConstraints",
    "requiresCompatibilities",
    "cpu",
    "memory",
    "pidMode",
    "ipcMode",
    "proxyConfiguration",
    "inferenceAccelerators",
    "ephemeralStorage",
    "runtimePlatform",
)


def candidate(definition, image, endpoint, alloy_enabled=None):
    if definition.get("family") != SERVICE:
        raise ValueError("Unexpected task family.")
    containers = definition["containerDefinitions"]
    names = [container["name"] for container in containers]
    if names not in (["app"], ["app", "alloy"]):
        raise ValueError(
            "Apply the reviewed infrastructure before deploying the backend."
        )
    app = containers[0]
    if alloy_enabled is not None and ("alloy" in names) != alloy_enabled:
        raise ValueError("Apply the reviewed Alloy infrastructure setting before deploying the backend.")
    if "alloy" in names:
        alloy = containers[1]
        if (alloy.get("image") != "grafana/alloy:v1.21.1" or alloy.get("essential") is not False
                or alloy.get("portMappings") or not alloy.get("healthCheck")):
            raise ValueError("Alloy must use the reviewed image, private readiness check and nonessential lifecycle.")
        refs = {row["name"]: row["valueFrom"] for row in alloy.get("secrets", [])}
        if not re.fullmatch(r"arn:aws:secretsmanager:us-east-1:800754316001:secret:propertyflow-dev-grafana-otlp-[A-Za-z0-9]{6}:alloy_token::", refs.get("GRAFANA_ALLOY_TOKEN", "")):
            raise ValueError("Alloy is missing its scoped runtime token reference.")
        if any(row["name"] == "GRAFANA_ALLOY_TOKEN" for row in alloy.get("environment", [])):
            raise ValueError("Alloy credentials must not be stored in the task environment definition.")
    env = {row["name"]: row["value"] for row in app.get("environment", [])}
    if any(key.startswith(("DD_", "DATADOG_")) for key in env):
        raise ValueError("Legacy monitoring configuration remains in the task.")
    if not endpoint or env.get("OTEL_EXPORTER_OTLP_ENDPOINT") != endpoint:
        raise ValueError("Apply the configured Grafana endpoint before deployment.")
    if not any(
        row["name"] == "OTEL_EXPORTER_OTLP_HEADERS" for row in app.get("secrets", [])
    ):
        raise ValueError("The task is missing its ingestion-secret reference.")
    result = {key: definition[key] for key in FIELDS if key in definition}
    # Caller owns the response object. Only this runtime task-registration request contains env values.
    app["image"] = image
    return result


def deploy(ecs, sts, env=os.environ):
    if sts.get_caller_identity()["Account"] != ACCOUNT:
        raise ValueError("Unexpected AWS account.")
    revision = env.get("GITHUB_SHA", "")
    repository = env.get("REPOSITORY_URL", "")
    if (
        not re.fullmatch("[a-f0-9]{40}", revision)
        or repository
        != ACCOUNT + ".dkr.ecr.us-east-1.amazonaws.com/propertyflow-dev-app"
    ):
        raise ValueError("Unexpected immutable image target.")
    services = ecs.describe_services(cluster=CLUSTER, services=[SERVICE])
    if services.get("failures") or len(services.get("services", [])) != 1:
        raise ValueError("Development service is unavailable.")
    service = services["services"][0]
    definition = ecs.describe_task_definition(taskDefinition=service["taskDefinition"])[
        "taskDefinition"
    ]
    task = ecs.register_task_definition(
        **candidate(
            definition, repository + ":" + revision, env.get("GRAFANA_OTLP_ENDPOINT"),
            env.get("GRAFANA_ALLOY_ENABLED", "false") == "true",
        )
    )["taskDefinition"]["taskDefinitionArn"]
    count = max(1, service["desiredCount"])
    ecs.update_service(
        cluster=CLUSTER,
        service=SERVICE,
        taskDefinition=task,
        desiredCount=count,
        forceNewDeployment=True,
    )
    ecs.get_waiter("services_stable").wait(
        cluster=CLUSTER,
        services=[SERVICE],
        WaiterConfig={"Delay": 15, "MaxAttempts": 60},
    )
    actual = ecs.describe_services(cluster=CLUSTER, services=[SERVICE])["services"][0]
    if (
        actual["taskDefinition"] != task
        or actual["runningCount"] != count
        or actual["pendingCount"] != 0
    ):
        raise ValueError(
            "The deployment rolled back or did not reach the requested release. Inspect ECS events."
        )
    print("ECS is running the requested immutable backend release " + revision + ".")


if __name__ == "__main__":
    import boto3

    try:
        deploy(
            boto3.client("ecs", region_name="us-east-1"),
            boto3.client("sts", region_name="us-east-1"),
        )
    except ValueError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print(
            "ECS deployment failed. Inspect the service events; task environment values were not printed.",
            file=sys.stderr,
        )
        sys.exit(1)
