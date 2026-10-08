#!/usr/bin/env python3
"""Read thermald's active D-Bus policy into JSON; changes no daemon settings.

Run manually: sudo python3 tools/dump_thermal_policy.py | tee /tmp/t2gu-thermal-policy.json
Only the explicitly listed Get methods are callable. Requires busctl and access
allowed by org.freedesktop.thermald's system-bus policy (root on this machine).
The daemon continues running, so this is a sequential snapshot, not an atomic
view of a changing policy. Per-call timestamps and errors remain in the output.
"""

from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time


READ_METHODS = {
    "GetCurrentPreference", "GetSensorCount", "GetSensorInformation",
    "GetZoneCount", "GetZoneInformation", "GetZoneStatus",
    "GetZoneSensorAtIndex", "GetZoneTripAtIndex", "GetCdevCount",
    "GetCdevInformation",
}
MAX_ITEMS = 128


def read_optional(path):
    try:
        return Path(path).read_text().strip()
    except OSError:
        return None


def main():
    calls = []
    snapshot = {
        "utc": datetime.now(timezone.utc).isoformat(),
        "started_monotonic_s": time.monotonic(),
        "platform_profile": read_optional("/sys/firmware/acpi/platform_profile"),
        "ac_online": read_optional("/sys/class/power_supply/AC/online"),
        "calls": calls, "sensors": [], "cooling_devices": [], "zones": [],
    }
    errors = []

    def call(method, signature="", *arguments):
        if method not in READ_METHODS:
            raise ValueError(f"refusing non-read method: {method}")
        record = {"method": method, "arguments": list(arguments),
                  "started_monotonic_s": time.monotonic()}
        calls.append(record)
        command = ["busctl", "--system", "--timeout=3", "--auto-start=no",
                   "--json=short", "call", "org.freedesktop.thermald",
                   "/org/freedesktop/thermald", "org.freedesktop.thermald", method]
        if signature:
            command.extend([signature, *map(str, arguments)])
        try:
            result = subprocess.run(command, capture_output=True, text=True,
                                    timeout=5, check=True)
            reply = json.loads(result.stdout)
            if not isinstance(reply.get("data"), list):
                raise ValueError("unexpected busctl JSON reply")
            record["reply"] = reply
            return reply["data"]
        except subprocess.CalledProcessError as error:
            record["error"] = error.stderr.strip() or str(error)
            raise RuntimeError(record["error"]) from error
        except (ValueError, OSError, subprocess.TimeoutExpired) as error:
            record["error"] = str(error)
            raise
        finally:
            record["finished_monotonic_s"] = time.monotonic()

    def bounded_count(value, description):
        if type(value) is not int or not 0 <= value <= MAX_ITEMS:
            raise ValueError(f"invalid {description} count: {value!r}")
        return value

    try:
        if not shutil.which("busctl"):
            raise RuntimeError("busctl is required")
        snapshot["preference"] = call("GetCurrentPreference")[0]
        counts = {name: bounded_count(call(method)[0], name)
                  for name, method in [("sensors", "GetSensorCount"),
                                       ("cooling_devices", "GetCdevCount"),
                                       ("zones", "GetZoneCount")]}
        snapshot["counts_at_start"] = counts
        for index in range(counts["sensors"]):
            name, path, temperature = call("GetSensorInformation", "u", index)
            snapshot["sensors"].append({"index": index, "name": name,
                                        "path": path, "temperature_mc": temperature})
        for index in range(counts["cooling_devices"]):
            name, minimum, maximum, current = call("GetCdevInformation", "u", index)
            snapshot["cooling_devices"].append({"index": index, "name": name,
                                                "min_state": minimum,
                                                "max_state": maximum,
                                                "current_state": current})
        for index in range(counts["zones"]):
            name, sensors, trips, bound = call("GetZoneInformation", "u", index)
            zone = {"index": index, "name": name, "bound": bound,
                    "active": call("GetZoneStatus", "s", name)[0],
                    "sensors": [], "trips": []}
            snapshot["zones"].append(zone)
            for sensor in range(bounded_count(sensors, "zone sensors")):
                zone["sensors"].append(call("GetZoneSensorAtIndex", "uu", index, sensor)[0])
            for trip in range(bounded_count(trips, "zone trips")):
                temp, kind, sensor, count, devices = call("GetZoneTripAtIndex", "uu", index, trip)
                if len(devices) != bounded_count(count, "trip cooling devices"):
                    raise ValueError("trip cooling-device count/reply mismatch")
                zone["trips"].append({"index": trip, "temperature_mc": temp,
                                      "type_id": kind, "sensor_id": sensor,
                                      "cooling_device_ids": devices})
        snapshot["counts_at_end"] = {
            "sensors": call("GetSensorCount")[0],
            "cooling_devices": call("GetCdevCount")[0],
            "zones": call("GetZoneCount")[0],
        }
        snapshot["platform_profile_at_end"] = read_optional("/sys/firmware/acpi/platform_profile")
        snapshot["ac_online_at_end"] = read_optional("/sys/class/power_supply/AC/online")
    except (RuntimeError, ValueError, IndexError, TypeError, OSError,
            subprocess.TimeoutExpired) as error:
        errors.append(str(error))
    snapshot["errors"] = errors
    snapshot["finished_monotonic_s"] = time.monotonic()
    print(json.dumps(snapshot, indent=2))
    if errors:
        print("Thermal policy snapshot incomplete: " + "; ".join(errors), file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
