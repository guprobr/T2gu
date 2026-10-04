"""Prove the Linux chapter guard rejects incomplete, failed and oversized runs."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile


def main():
    checker = Path(__file__).with_name("chapter_smoke.py")
    cases = [
        ("ok", "print('POPULATED party=1');print('CHAPTER_SMOKE_COMPLETE')", 0, None),
        ("missing_population", "print('CHAPTER_SMOKE_COMPLETE')", 1, None),
        ("missing_completion", "print('POPULATED party=1');print('NOT_CHAPTER_SMOKE_COMPLETE')", 1, None),
        ("nonzero", "print('POPULATED party=1');print('CHAPTER_SMOKE_COMPLETE');raise SystemExit(3)", 1, None),
        ("diagnostic", "print('POPULATED party=1');print('CHAPTER_SMOKE_COMPLETE');print('warning: fixture')", 1, None),
        ("timeout", "import time;time.sleep(30)", 1, "timeout"),
        ("memory", "import time;x=bytearray(64*1024*1024);time.sleep(30)", 1, "rss_limit"),
    ]
    with tempfile.TemporaryDirectory(prefix="t2gu smoke guard ") as temporary:
        root = Path(temporary)
        for name, source, expected, killed in cases:
            binary = root / name
            binary.write_text("#!" + sys.executable + "\n" + source + "\n")
            binary.chmod(0o755)
            logs = root / (name + " logs")
            command = [sys.executable, str(checker), "--binary", str(binary),
                       "--chapters", "15", "--logs", str(logs), "--timeout", "2"]
            if name == "memory":
                command += ["--rss-limit-mib", "32"]
            run = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 text=True, timeout=10)
            if run.returncode != expected:
                raise AssertionError((name, run.returncode, run.stdout))
            result = json.loads((logs / "summary.json").read_text())[0]
            if result["killed"] != killed:
                raise AssertionError((name, result))
    print("Chapter smoke guard passed clean exit, markers, diagnostics, timeout and RSS cases")


if __name__ == "__main__":
    main()
