#!/usr/bin/env bash
set -euo pipefail
export AWS_PAGER=""
ACTION="${1:-}"
case "$ACTION" in start|stop|start-database) ;; *) echo "Usage: bash scripts/dev-power.sh start|stop|start-database" >&2; exit 2 ;; esac
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# Validate before any cloud call. Never silently omit a new service/database.
targets=$(python3 "$script_dir/validate-dev-power.py" --runtime)
IFS=$'\t' read -r EXPECTED_ACCOUNT AWS_REGION DB CLUSTER SERVICE <<< "$targets"
export AWS_REGION
export AWS_DEFAULT_REGION="$AWS_REGION"
account=$(aws sts get-caller-identity --query Account --output text)
[[ "$account" == "$EXPECTED_ACCOUNT" ]] || { echo "Unexpected AWS account: $account" >&2; exit 1; }
if [[ "$ACTION" != "start-database" ]]; then
service_status=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --query 'services[0].status' --output text)
[[ "$service_status" == "ACTIVE" ]] || { echo "Development service is missing or inactive. Deploy it first." >&2; exit 1; }
fi

db_status() {
  aws rds describe-db-instances --db-instance-identifier "$DB" --query 'DBInstances[0].DBInstanceStatus' --output text
}
wait_for_db() {
  local target="$1" status attempt
  for ((attempt=1; attempt<=${DB_WAIT_ATTEMPTS:-80}; attempt++)); do
    status=$(db_status)
    [[ "$status" == "$target" ]] && return 0
    case "$status" in starting|stopping|available|stopped|backing-up) ;; *) echo "Unexpected database state: $status" >&2; return 1 ;; esac
    echo "Waiting for database to become $target (currently $status)."
    sleep "${DB_WAIT_SECONDS:-30}"
  done
  echo "Database did not reach $target within the wait limit." >&2
  return 1
}
set_backend_count() {
  local count="$1" observed
  aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --desired-count "$count" >/dev/null
  aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"
  observed=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --query 'services[0].[desiredCount,runningCount,pendingCount]' --output text)
  [[ "$observed" == "$count"$'\t'"$count"$'\t0' ]] || { echo "Backend did not reach the requested task count: $observed" >&2; return 1; }
}

# Only a first infrastructure deployment may proceed without an existing DB.
error_file=$(mktemp)
if status=$(db_status 2>"$error_file"); then
  rm -f "$error_file"
else
  if [[ "$ACTION" == "start-database" && "${2:-}" == "--allow-missing" ]] && grep -q '(DBInstanceNotFound)' "$error_file"; then
    rm -f "$error_file"
    echo "Database does not exist yet; Terraform will create it."
    exit 0
  fi
  cat "$error_file" >&2
  rm -f "$error_file"
  exit 1
fi
if [[ "$ACTION" == "start" || "$ACTION" == "start-database" ]]; then
  if [[ "$status" == "stopping" ]]; then
    wait_for_db stopped
    status=stopped
  fi
  case "$status" in
    stopped) aws rds start-db-instance --db-instance-identifier "$DB" >/dev/null ;;
    # An existing backup must finish before deployment readiness is established.
    available|starting|backing-up) ;;
    *) echo "Cannot start from database state: $status" >&2; exit 1 ;;
  esac
  wait_for_db available
  if [[ "$ACTION" == "start" ]]; then
    set_backend_count 1
    echo "Development database is available and backend is running."
  else
    echo "Development database is available for deployment."
  fi
else
  # Finish stopping the application before disconnecting its database.
  set_backend_count 0
  if [[ "$status" == "starting" || "$status" == "backing-up" ]]; then
    wait_for_db available
    status=available
  fi
  case "$status" in
    available) aws rds stop-db-instance --db-instance-identifier "$DB" >/dev/null ;;
    stopped|stopping) ;;
    *) echo "Cannot stop from database state: $status" >&2; exit 1 ;;
  esac
  wait_for_db stopped
  echo "Backend and database are stopped; data is retained."
  echo "Storage, load balancer and some networking charges continue. RDS automatically restarts after seven days."
fi
