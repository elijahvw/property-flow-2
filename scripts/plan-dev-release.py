#!/usr/bin/env python3
"""Plan releases from the latest completed manual dev release's component state."""
import io
import json
import os
import re
import subprocess
import urllib.request
from urllib.parse import urlsplit
import zipfile

COMPONENTS = ("infrastructure", "backend", "frontend")
ACCOUNT = "800754316001"

def relevant(component, path):
    if path.startswith(("docs/", "tests/", "client/tests/", "server/tests/")):
        return False
    if path in (".github/workflows/ci.yml", "README.md"):
        return False
    if component == "infrastructure":
        return path.startswith("infra/terraform/")
    if path in ("package.json", "package-lock.json", ".github/workflows/deploy-dev.yml", "scripts/plan-dev-release.py"):
        return True
    if component == "backend":
        return path.startswith(("server/", "monitoring/")) or path in ("scripts/dev-power.sh", "scripts/grafana-monitoring.py", "scripts/deploy-backend.py")
    return path.startswith("client/") or path == "scripts/verify-dev-public.sh"

def changed_files(base, head):
    if not base or not re.fullmatch(r"[0-9a-f]{40}", base):
        return None
    check = subprocess.run(["git", "merge-base", "--is-ancestor", base, head], capture_output=True)
    if check.returncode:
        return None
    return subprocess.check_output(["git", "diff", "--name-only", base, head], text=True).splitlines()

def plan(versions, head, diff=changed_files, force=False, terraform="auto"):
    wanted = {}
    for component in COMPONENTS:
        files = diff(versions.get(component), head)
        wanted[component] = force or files is None or any(relevant(component, path) for path in files)
    if terraform == "always":
        wanted["infrastructure"] = True
    elif terraform == "never":
        wanted["infrastructure"] = False
    # Infrastructure changes can affect API settings, addresses and runtime config.
    if wanted["infrastructure"]:
        wanted["backend"] = wanted["frontend"] = True
    return wanted

def completed_state(previous, head, results, infrastructure_applied):
    versions = {name: previous.get(name) for name in COMPONENTS}
    for name in COMPONENTS:
        if results.get(name) == "success" and (name != "infrastructure" or infrastructure_applied):
            versions[name] = head
    return {"account": ACCOUNT, "versions": versions}

class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        redirected = super().redirect_request(request, file_pointer, code, message, headers, new_url)
        if redirected is not None and urlsplit(request.full_url).netloc != urlsplit(new_url).netloc:
            redirected.remove_header("Authorization")
        return redirected

def api(path):
    request = urllib.request.Request("https://api.github.com/" + path, headers={
        "Authorization": "Bearer " + os.environ["GITHUB_TOKEN"],
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urllib.request.build_opener(SafeRedirect()).open(request, timeout=20) as response:
        return response.read()

def previous_state(repo):
    artifacts = json.loads(api(f"repos/{repo}/actions/artifacts?name=dev-release-state&per_page=100"))["artifacts"]
    for artifact in sorted(artifacts, key=lambda value: value["id"], reverse=True):
        run_info = artifact.get("workflow_run", {})
        if artifact["expired"] or run_info.get("head_branch") != "main":
            continue
        run = json.loads(api(f"repos/{repo}/actions/runs/{run_info['id']}"))
        if (run["status"] != "completed" or run["event"] != "workflow_dispatch"
                or run["path"] != ".github/workflows/deploy-dev.yml"
                or run["head_repository"]["full_name"] != repo or run["head_branch"] != "main"):
            continue
        archive = api(f"repos/{repo}/actions/artifacts/{artifact['id']}/zip")
        with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
            state = json.loads(zipped.read("release-state.json"))
        if state.get("account") != ACCOUNT:
            raise ValueError("Unexpected account in release state")
        return state["versions"]
    return {}

def main():
    head = os.environ["GITHUB_SHA"]
    if os.environ.get("RECORD_STATE") == "true":
        previous = json.loads(os.environ["PREVIOUS_VERSIONS"])
        results = json.loads(os.environ["COMPONENT_RESULTS"])
        state = completed_state(previous, head, results, os.environ["INFRASTRUCTURE_APPLIED"] == "true")
        with open("release-state.json", "w") as output:
            json.dump(state, output)
        return
    previous = previous_state(os.environ["GITHUB_REPOSITORY"])
    wanted = plan(previous, head, force=os.environ.get("FORCE_ALL") == "true",
                  terraform=os.environ.get("RUN_TERRAFORM", "auto"))
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        for component, enabled in wanted.items():
            output.write(f"{component}={str(enabled).lower()}\n")
        output.write("previous_versions=" + json.dumps(previous, separators=(",", ":")) + "\n")
        output.write("reason=changes since each component's last successful deployment\n")
    summary = "\n".join(f"- {name}: {'deploy' if enabled else 'unchanged; skip'}" for name, enabled in wanted.items())
    print(summary)
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
        output.write("### Development release plan\n" + summary + "\n")

if __name__ == "__main__":
    main()
