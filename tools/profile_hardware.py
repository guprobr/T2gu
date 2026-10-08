#!/usr/bin/env python3
"""Manually launch a command with read-only Linux hardware/perf diagnostics."""

import argparse
from datetime import datetime, timezone
import glob
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time


def discover(patterns):
    return sorted({path for pattern in patterns for path in glob.glob(pattern)})


def read_values(paths):
    values = {}
    for path in paths:
        try:
            values[path] = Path(path).read_text().strip()
        except OSError:
            values[path] = None
    return values


def write_record(stream, **values):
    stream.write(json.dumps({"monotonic_s": time.monotonic(), **values}) + "\n")
    stream.flush()


def write_snapshot(stream, paths):
    started = time.monotonic()
    values = read_values(paths)
    write_record(stream, read_started_monotonic_s=started, values=values)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path("/tmp/t2gu-maze-hardware"))
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command
    if command[:1] == ["--"]:
        command = command[1:]
    if not command:
        parser.error("supply a command after --")
    if not shutil.which("perf"):
        parser.error("perf is required")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    # Refuse to overwrite a previous capture. Choose another directory or
    # archive its contents before repeating the manual comparison.
    paths = [args.output_dir / name for name in
             ("metadata.json", "hardware.jsonl", "game-events.jsonl", "counters.csv")]
    if any(path.exists() for path in paths):
        parser.error("capture files already exist; choose a new --output-dir")

    settings = discover([
        "/sys/devices/system/cpu/intel_pstate/*",
        "/sys/devices/system/cpu/cpu*/cpufreq/scaling_driver",
        "/sys/devices/system/cpu/cpu*/cpufreq/scaling_governor",
        "/sys/devices/system/cpu/cpu*/cpufreq/scaling_min_freq",
        "/sys/devices/system/cpu/cpu*/cpufreq/scaling_max_freq",
        "/sys/devices/system/cpu/cpu*/cpufreq/energy_performance_preference",
        "/sys/firmware/acpi/platform_profile",
        "/sys/firmware/acpi/platform_profile_choices",
        "/sys/class/platform-profile/*/name",
        "/sys/bus/pci/devices/0000:00:04.0/power_limits/*",
        "/sys/bus/pci/devices/0000:00:0b.0/power_limits/*",
        "/sys/bus/platform/devices/INT3401:00/power_limits/*",
        "/sys/class/thermal/thermal_zone*/type",
        "/sys/class/thermal/thermal_zone*/policy",
        "/sys/class/thermal/thermal_zone*/mode",
        "/sys/class/thermal/thermal_zone*/trip_point_*_type",
        "/sys/class/thermal/thermal_zone*/trip_point_*_temp",
        "/sys/class/thermal/thermal_zone*/trip_point_*_hyst",
        "/sys/bus/platform/devices/INTC1040*/uuids/current_uuid",
        "/sys/bus/platform/devices/INTC1040*/uuids/available_uuids",
        "/sys/class/hwmon/hwmon*/name",
        "/sys/class/hwmon/hwmon*/temp*_label",
        "/sys/class/power_supply/*/type",
        "/sys/class/powercap/intel-rapl*/name",
        "/sys/class/powercap/intel-rapl*/constraint_*_name",
        "/sys/class/thermal/cooling_device*/type",
        "/sys/class/thermal/cooling_device*/max_state",
    ])
    sensors = discover([
        "/sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq",
        "/sys/devices/system/cpu/cpu*/thermal_throttle/*throttle_count",
        "/sys/class/thermal/thermal_zone*/temp",
        "/sys/class/hwmon/hwmon*/temp*_input",
        "/sys/class/drm/card*/gt/gt*/rps_act_freq_mhz",
        "/sys/class/drm/card*/gt/gt*/rps_cur_freq_mhz",
        "/sys/class/power_supply/*/online",
        "/sys/class/power_supply/*/status",
        "/sys/class/power_supply/*/current_max",
        "/sys/class/power_supply/*/voltage_max",
        "/sys/class/power_supply/*/power_now",
        "/sys/class/power_supply/*/current_now",
        "/sys/class/power_supply/*/voltage_now",
        "/sys/class/power_supply/*/capacity",
        "/sys/class/power_supply/*/temp",
        "/sys/class/power_supply/*/health",
        "/sys/class/power_supply/*/usb_type",
        "/sys/class/power_supply/*/input_current_limit",
        "/sys/class/power_supply/*/input_voltage_limit",
        "/sys/class/power_supply/*/input_power_limit",
        "/sys/class/powercap/intel-rapl*/constraint_*_power_limit_uw",
        "/sys/class/powercap/intel-rapl*/constraint_*_time_window_us",
        "/sys/class/powercap/intel-rapl*/enabled",
        "/sys/class/thermal/cooling_device*/cur_state",
        "/sys/devices/system/cpu/cpu*/cpufreq/scaling_governor",
        "/sys/devices/system/cpu/cpu*/cpufreq/scaling_max_freq",
        "/sys/devices/system/cpu/cpu*/cpufreq/scaling_min_freq",
        "/sys/devices/system/cpu/intel_pstate/max_perf_pct",
        "/sys/devices/system/cpu/intel_pstate/min_perf_pct",
        "/sys/devices/system/cpu/intel_pstate/no_turbo",
        "/sys/firmware/acpi/platform_profile",
    ])
    perf_command = ["perf", "stat", "-I", "250", "-x", ";", "--no-big-num",
                    "-e", "cycles:u,ref-cycles:u,task-clock", "-o", str(paths[3]),
                    "--", *command]
    paths[0].write_text(json.dumps({
        "utc": datetime.now(timezone.utc).isoformat(),
        "monotonic_s": time.monotonic(), "command": perf_command,
        "pause_between_scans_s": 0.25, "settings": read_values(settings),
        "environment": {key: value for key, value in os.environ.items()
                        if key.startswith("T2GU_") or key in
                        ("QT_QPA_PLATFORM", "always_flush_cache", "mesa_glthread",
                         "intel_disable_threaded_context", "INTEL_DEBUG")},
    }, indent=2) + "\n")
    print(f"[hardware] capture directory: {args.output_dir}", flush=True)
    # LC_NUMERIC only stabilizes perf's CSV numbers; it changes no driver,
    # governor, thermal setting, cache option or rendering schedule.
    environment = os.environ.copy()
    environment["LC_NUMERIC"] = "C"
    with paths[1].open("x") as hardware, paths[2].open("x") as events:
        write_snapshot(hardware, sensors)
        child = subprocess.Popen(perf_command, stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, text=True,
                                 errors="replace", env=environment)

        def copy_output():
            for line in child.stdout:
                write_record(events, text=line.rstrip("\n"))
                sys.stdout.write(line)
                sys.stdout.flush()

        reader = threading.Thread(target=copy_output, daemon=True)
        reader.start()
        try:
            while child.poll() is None:
                write_snapshot(hardware, sensors)
                time.sleep(0.25)
        except KeyboardInterrupt:
            # In a terminal, the same interrupt reaches perf and the game.
            child.wait()
        finally:
            child.wait()
            reader.join()
            child.stdout.close()
            write_snapshot(hardware, sensors)
    print(f"[hardware] command exited with status {child.returncode}", flush=True)
    return child.returncode if child.returncode >= 0 else 128 - child.returncode


if __name__ == "__main__":
    sys.exit(main())
