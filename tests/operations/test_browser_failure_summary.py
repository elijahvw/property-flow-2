import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("browser_failure_summary", ROOT / "scripts/browser-failure-summary.py")
SUMMARY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SUMMARY)


class BrowserFailureSummaryTests(unittest.TestCase):
    def test_bounds_errors_and_omits_network_and_sensitive_messages(self):
        events = [
            {"type": "console", "messageType": "error", "text": "Invalid blocker state transition"},
            {"type": "event", "method": "pageError", "params": {"error": {"message": "Page failed https://fixture.local/path?private=secret"}}},
            {"type": "console", "messageType": "error", "text": "access_token=do-not-copy"},
            *[{"type": "console", "messageType": "error", "text": f"failure {index}"} for index in range(12)],
        ]
        with tempfile.TemporaryDirectory(prefix="propertyflow-trace-unit-") as directory:
            with ZipFile(Path(directory) / "trace.zip", "w") as archive:
                archive.writestr("0-trace.trace", "\n".join(json.dumps(event) for event in events))
                archive.writestr("0-trace.network", "fictional-sensitive-network-payload")
            with contextlib.redirect_stdout(io.StringIO()):
                SUMMARY.summarize(directory)
            text = (Path(directory) / "browser-failures.json").read_text()
            result = json.loads(text)
            self.assertEqual(len(result["traces"][0]["errors"]), 10)
            self.assertEqual(result["traces"][0]["omittedErrors"], 5)
            self.assertIn("Invalid blocker state transition", text)
            for forbidden in ["private=secret", "do-not-copy", "fictional-sensitive-network-payload"]:
                self.assertNotIn(forbidden, text)
            self.assertEqual((Path(directory) / "browser-failures.json").stat().st_mode & 0o777, 0o600)

    def test_bounds_trace_count_and_preserves_unreadable_artifact_diagnostic(self):
        with tempfile.TemporaryDirectory(prefix="propertyflow-trace-unit-") as directory:
            for index in range(22):
                path = Path(directory) / f"failure-{index:02}"
                path.mkdir()
                (path / "trace.zip").write_text("broken archive")
            with contextlib.redirect_stdout(io.StringIO()):
                SUMMARY.summarize(directory)
            result = json.loads((Path(directory) / "browser-failures.json").read_text())
            self.assertEqual(len(result["traces"]), 20)
            self.assertEqual(result["omittedTraces"], 2)
            self.assertIn("Unreadable trace", result["traces"][0]["diagnostic"])


if __name__ == "__main__":
    unittest.main()
