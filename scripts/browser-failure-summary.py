"""Summarize bounded console/page errors from retained Playwright traces.

Reads only event lines from *.trace members, never network bodies, headers,
snapshots or resources. Traces remain the authoritative failure evidence.
"""
import json
import os
from pathlib import Path
import re
import sys
from zipfile import BadZipFile, ZipFile

MAX_TRACES = 20
MAX_ERRORS = 10
MAX_MESSAGE = 600
MAX_EVENT_BYTES = 1024 * 1024


def safe_message(value):
    text = str(value)
    # Tests use fictional accounts, but keep this derived summary conservative.
    if re.search(r"password|authorization|cookie|(?:access|refresh|id)[_-]?token|client[_-]?secret", text, re.I):
        return "[Sensitive-looking message omitted; inspect the local trace under the normal privacy rules.]"
    text = re.sub(r"(https?://)[^/\s@]+@", r"\1[redacted]@", text)
    text = re.sub(r"(https?://[^\s?#]+)[?#][^\s]*", r"\1[query omitted]", text)
    return text[:MAX_MESSAGE]


def trace_errors(path):
    errors, omitted = [], 0
    with ZipFile(path) as archive:
        for member in archive.infolist():
            if not member.filename.endswith(".trace"):
                continue
            with archive.open(member) as lines:
                while True:
                    line = lines.readline(MAX_EVENT_BYTES + 1)
                    if not line:
                        break
                    # Skip oversized records in chunks, never loading them whole.
                    if len(line) > MAX_EVENT_BYTES:
                        while line and not line.endswith(b"\n"):
                            line = lines.readline(MAX_EVENT_BYTES + 1)
                        continue
                    try:
                        event = json.loads(line)
                    except (ValueError, UnicodeDecodeError):
                        continue
                    message = None
                    if event.get("type") == "console" and event.get("messageType") == "error":
                        message = event.get("text", "")
                    elif event.get("type") == "event" and event.get("method") == "pageError":
                        error = event.get("params", {}).get("error", {})
                        message = error.get("message", "") if isinstance(error, dict) else error
                    if message is None:
                        continue
                    if len(errors) < MAX_ERRORS:
                        errors.append({"kind": "console" if event.get("type") == "console" else "pageerror", "message": safe_message(message)})
                    else:
                        omitted += 1
    return {"trace": str(path), "errors": errors, "omittedErrors": omitted}


def summarize(directory):
    directory = Path(directory)
    paths = sorted(directory.rglob("trace.zip"))
    traces = []
    for path in paths[:MAX_TRACES]:
        try:
            traces.append(trace_errors(path))
        except (BadZipFile, OSError):
            traces.append({"trace": str(path), "errors": [], "diagnostic": "Unreadable trace; retain the original artifact."})
    if not paths:
        print("No retained browser failure traces.")
        return
    result = {"traces": traces, "omittedTraces": max(0, len(paths) - MAX_TRACES)}
    target = directory / "browser-failures.json"
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump(result, output, indent=2)
        output.write("\n")
    print(f"Browser failure summary: {target} ({len(traces)} traces, {sum(len(trace['errors']) for trace in traces)} retained errors).")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: browser-failure-summary.py ARTIFACT_DIRECTORY")
    summarize(sys.argv[1])
