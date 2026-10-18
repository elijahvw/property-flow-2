import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ScannerStartupTests(unittest.TestCase):
    def run_startup(self, failures):
        source = (ROOT / "infra/terraform/modules/ecr/main.tf").read_text()
        scanner = re.split(r'name\s*=\s*"document-scanner"', source, maxsplit=1)[1]
        command = json.loads(re.search(r'command\s*=\s*(\[[^\n]+\])', scanner).group(1))[0]
        self.assertRegex(scanner.split("environment", 1)[0], r"essential\s*=\s*false")
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            scripts = {
                "freshclam": '#!/bin/sh\nn=$(cat "$COUNT" 2>/dev/null || echo 0)\necho $((n+1)) > "$COUNT"\necho update >> "$TRACE"\ntest "$n" -ge "$FAILURES"\n',
                "sleep": '#!/bin/sh\nexit 0\n',
                "initialize": '#!/bin/sh\necho initialize >> "$TRACE"\n',
            }
            for name, content in scripts.items():
                path = folder / name
                path.write_text(content)
                path.chmod(0o700)
            environment = {**os.environ, "PATH": str(folder) + ":/usr/bin:/bin", "COUNT": str(folder / "count"), "TRACE": str(folder / "trace"), "FAILURES": str(failures)}
            subprocess.run(["/bin/sh", "-c", command.replace("exec /init", "exec " + shlex.quote(str(folder / "initialize")))], env=environment, check=True, timeout=5, capture_output=True)
            return (folder / "trace").read_text().splitlines()

    def test_success_updates_before_initializing(self):
        self.assertEqual(self.run_startup(0), ["update", "initialize"])

    def test_transient_failure_retries_before_initializing(self):
        self.assertEqual(self.run_startup(1), ["update", "update", "initialize"])

    def test_outage_is_bounded_and_periodic_updater_can_recover(self):
        self.assertEqual(self.run_startup(10), ["update", "update", "update", "initialize"])
