"""Exercise two already-paired emulators with the fixed, credential-free probe."""

import argparse
import json
from pathlib import Path
import re
import subprocess
import time
import uuid
import xml.etree.ElementTree as ET


PACKAGE = "com.orcaspike.companion"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--adb", required=True)
parser.add_argument("--phone", required=True)
parser.add_argument("--watch", required=True)
parser.add_argument("--mode", choices=("native", "headless"), required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
if args.phone == args.watch:
    parser.error("Two distinct emulator serials are required")
if not all(serial.startswith("emulator-") for serial in (args.phone, args.watch)):
    parser.error("This harness is scoped to emulators")
args.output.mkdir(parents=True, exist_ok=False)
results = []
run_id = uuid.uuid4().hex[:12]


def adb(serial, *command, allowed=(0,)):
    result = subprocess.run(
        [args.adb, "-s", serial, *command],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30,
    )
    with (args.output / "commands.log").open("a", encoding="utf-8") as log:
        log.write(json.dumps({"serial": serial, "argv": command, "exit": result.returncode,
                              "stdout": result.stdout, "stderr": result.stderr}) + "\n")
    if result.returncode not in allowed:
        raise RuntimeError(f"adb {serial} {command}: {result.stderr or result.stdout}")
    return result.stdout


def logs(serial):
    return adb(serial, "logcat", "-d", "-v", "threadtime", "-s", "OrcaSpike:I",
               "OrcaSpikeListener:I", "OrcaSpikeHeadless:I", "ReactNativeJS:I", "AndroidRuntime:E")


def ping(sender, receiver, case, request_id=None, expect=True):
    request_id = request_id or f"orca-spike-{run_id}-{case}"
    before = logs(sender)
    receiver_before = logs(receiver)
    pattern = rf"PONG_RECEIVED requestId={re.escape(request_id)} peer=(\S+) correlated=true"
    previous_receipts = len(re.findall(pattern, before))
    adb(sender, "shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity",
        "-f", "0x20000000", "--es", "requestId", request_id,
        "--ez", "unhandledPath", "true" if expect is False else "false")
    deadline = time.monotonic() + 20
    while True:
        current = logs(sender)
        new = current[len(before):] if current.startswith(before) else current
        receipts = list(re.finditer(pattern, current))
        receipt = receipts[-1] if len(receipts) > previous_receipts else None
        timed_out = f"ACK_TIMEOUT requestId={request_id}" in new
        if receipt or timed_out or time.monotonic() >= deadline:
            break
        time.sleep(0.25)
    receiver_log = logs(receiver)
    delivered = receipt is not None
    observed = "acknowledged" if delivered else "ack-timeout" if timed_out else "no-receipt"
    result = {"case": case, "requestId": request_id, "outcome": observed,
              "peer": receipt.group(1) if receipt else None}
    if delivered:
        if args.mode == "headless":
            required = [f"NATIVE_RECEIVE requestId={request_id}",
                        f"HEADLESS_ENTER requestId={request_id}",
                        f"JS_REPLY requestId={request_id}",
                        f"HEADLESS_COMPLETE requestId={request_id}"]
        else:
            required = [f"PING received, requestId={request_id}"]
        deadline = time.monotonic() + 2
        while not all(receiver_log.count(value) > receiver_before.count(value) for value in required):
            if time.monotonic() >= deadline:
                break
            time.sleep(0.1)
            receiver_log = logs(receiver)
        result["receiverEvidence"] = all(
            receiver_log.count(value) > receiver_before.count(value) for value in required
        )
        if not result["receiverEvidence"]:
            raise AssertionError(f"{case}: acknowledgement without required receiver evidence")
    results.append(result)
    print(json.dumps(result), flush=True)
    if expect is True and not delivered:
        raise AssertionError(f"{case}: no correlated acknowledgement")
    if expect is False and (delivered or not timed_out):
        raise AssertionError(f"{case}: expected explicit acknowledgement timeout")
    return request_id


try:
    for serial in (args.phone, args.watch):
        adb(serial, "emu", "avd", "name")
    if args.mode == "native":
        ping(args.phone, args.watch, "phone-to-watch")
    first = ping(args.watch, args.phone, "watch-to-phone")
    ping(args.watch, args.phone, "distinct-id")
    ping(args.watch, args.phone, "nonadjacent-replay", request_id=first)
    if args.mode == "native":
        assert f"duplicate PING for requestId={first}" in logs(args.phone)

    adb(args.phone, "shell", "input", "keyevent", "KEYCODE_HOME")
    ping(args.watch, args.phone, "background")
    previous_pid = adb(args.phone, "shell", "pidof", PACKAGE).strip()
    adb(args.phone, "shell", "am", "crash", PACKAGE)
    deadline = time.monotonic() + 15
    while adb(args.phone, "shell", "pidof", PACKAGE, allowed=(0, 1)).strip():
        dump = adb(args.phone, "shell", "uiautomator", "dump", "/sdcard/orca-probe-window.xml")
        if "dumped to" in dump:
            root = ET.fromstring(adb(args.phone, "shell", "cat", "/sdcard/orca-probe-window.xml"))
            for node in root.iter("node"):
                if node.get("resource-id") == "android:id/aerr_close":
                    left, top, right, bottom = map(int, re.findall(r"\d+", node.attrib["bounds"]))
                    adb(args.phone, "shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))
        if time.monotonic() >= deadline:
            raise AssertionError("Crash injection did not stop the probe process")
        time.sleep(0.2)
    package_state = adb(args.phone, "shell", "dumpsys", "package", PACKAGE)
    assert "stopped=false" in package_state
    ping(args.watch, args.phone, "crash-cold")
    next_pid = adb(args.phone, "shell", "pidof", PACKAGE).strip()
    assert next_pid and next_pid != previous_pid
    results[-1].update({"previousPid": previous_pid, "newPid": next_pid, "packageStopped": False})

    adb(args.phone, "shell", "dumpsys", "battery", "unplug")
    adb(args.phone, "shell", "input", "keyevent", "KEYCODE_SLEEP")
    adb(args.phone, "shell", "dumpsys", "deviceidle", "force-idle")
    assert "mState=IDLE" in adb(args.phone, "shell", "dumpsys", "deviceidle")
    ping(args.watch, args.phone, "doze", expect=None)
    adb(args.phone, "shell", "dumpsys", "deviceidle", "unforce")
    adb(args.phone, "shell", "dumpsys", "battery", "reset")
    adb(args.phone, "shell", "input", "keyevent", "KEYCODE_WAKEUP")

    adb(args.phone, "shell", "am", "force-stop", PACKAGE)
    assert "stopped=true" in adb(args.phone, "shell", "dumpsys", "package", PACKAGE)
    ping(args.watch, args.phone, "force-stop", expect=None)
    results[-1]["packageStoppedBefore"] = True
    results[-1]["packageStoppedAfter"] = "stopped=true" in adb(args.phone, "shell", "dumpsys", "package", PACKAGE)
    adb(args.phone, "shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity")
    ping(args.watch, args.phone, "explicit-relaunch")
    ping(args.watch, args.phone, "unhandled-path", expect=False)
    ping(args.watch, args.phone, "handled-path-restored")
finally:
    adb(args.phone, "shell", "dumpsys", "deviceidle", "unforce")
    adb(args.phone, "shell", "dumpsys", "battery", "reset")
    adb(args.phone, "shell", "input", "keyevent", "KEYCODE_WAKEUP")
    for label, serial in (("phone", args.phone), ("watch", args.watch)):
        (args.output / f"{label}.log").write_text(logs(serial), encoding="utf-8")
    (args.output / "results.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
