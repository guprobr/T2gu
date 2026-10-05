"""Sequential real-asset startup checks with deadlines and a Linux RSS guard."""

import argparse
import json
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--chapters", type=int, nargs="+", default=list(range(1, 26)))
    parser.add_argument("--rss-limit-mib", type=int, default=3072)
    parser.add_argument("--timeout", type=float, default=60)
    parser.add_argument("--logs", type=Path)
    args = parser.parse_args()
    if not Path("/proc/self/status").exists():
        parser.error("the RSS guard requires Linux /proc")
    if any(ch < 1 or ch > 25 for ch in args.chapters):
        parser.error("chapters must be between 1 and 25; sandbox is not supported")
    if args.rss_limit_mib <= 0 or not math.isfinite(args.timeout) or args.timeout <= 0:
        parser.error("RSS limit and timeout must be positive")
    binary = args.binary.resolve()
    if not binary.is_file():
        parser.error("build the T2guRegression binary first")
    root = Path(__file__).resolve().parents[1]
    logs = args.logs or Path(tempfile.mkdtemp(prefix="t2gu-chapter-smoke-"))
    logs.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, QT_QPA_PLATFORM="offscreen", T2GU_RENDERER="software")
    # Default to this checkout; preserve an explicit asset override.
    env.setdefault("T2GU_ASSET_DIR", str(root / "assets"))
    results = []
    print("Logs: " + str(logs.resolve()), flush=True)
    for chapter in args.chapters:
        path = logs / ("chapter%d.log" % chapter)
        start = time.monotonic()
        peak_kib = 0
        killed = None
        with path.open("w") as log:
            process = subprocess.Popen(
                [str(binary), "--chapter-smoke", str(root / "assets/maps" / ("chapter%d.json" % chapter))],
                stdout=log, stderr=log, env=env)
            try:
                while process.poll() is None:
                    try:
                        status = Path("/proc/%d/status" % process.pid).read_text()
                        match = re.search(r"VmRSS:\s+(\d+)", status)
                        if match:
                            rss_kib = int(match[1])
                            peak_kib = max(peak_kib, rss_kib)
                            if rss_kib > args.rss_limit_mib * 1024:
                                killed = "rss_limit"
                    except FileNotFoundError:
                        pass
                    if time.monotonic() - start > args.timeout:
                        killed = killed or "timeout"
                    if killed:
                        process.kill()
                        break
                    time.sleep(0.1)
                process.wait()
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
        data = path.read_text(errors="replace")
        diagnostics = [line for line in data.splitlines()
                       if re.search(r"error|warning|fatal|assert|failed|runtime error|AddressSanitizer", line, re.I)]
        # Qt probes an optional NVIDIA VDPAU backend even on machines without
        # it. Preserve this exact known diagnostic separately; do not suppress
        # other media failures or weaken the engine/sanitizer checks.
        optional = [line for line in diagnostics if re.fullmatch(
            r"Failed to open VDPAU backend libvdpau_nvidia\.so: cannot open shared object file: No such file or directory", line)]
        diagnostics = [line for line in diagnostics if line not in optional]
        result = dict(chapter=chapter, exit=process.returncode, killed=killed,
                      seconds=round(time.monotonic() - start, 2),
                      peak_rss_mib=round(peak_kib / 1024, 1),
                      populated=bool(re.search(r"^POPULATED party=", data, re.M)),
                      complete=bool(re.search(r"^CHAPTER_SMOKE_COMPLETE$", data, re.M)),
                      diagnostics=diagnostics, optional_backend_diagnostics=optional)
        result["passed"] = (result["exit"] == 0 and not killed and result["populated"]
                            and result["complete"] and not diagnostics)
        results.append(result)
        (logs / "summary.json").write_text(json.dumps(results, indent=2) + "\n")
        print(json.dumps(result), flush=True)
    return 0 if all(result["passed"] for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
