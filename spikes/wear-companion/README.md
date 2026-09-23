# Wear companion Data Layer spike

This isolated probe verifies native phone/watch messaging and actual Expo Headless JS startup over a paired emulator connection. It sends only generated `orca-spike-*` request IDs, uses a throwaway signing key, and has no Orca credentials or business actions.

`phone/` and `watch/` compile the same Kotlin sender/listener from `native/`. `headless/` replaces the phone app with an Expo release build whose native listener starts a registered JavaScript task; JavaScript calls the native module to return the acknowledgement. All three APKs use `com.orcaspike.companion` and the same test key. The headless APK bundles JavaScript and runs without Metro.

## Build and pair

Tested on Windows with JDK 17, Node 24.11.0, pnpm 10.24.0, Python 3.13, Android SDK/build-tools 36, native Gradle 8.11.1, and Expo-generated Gradle 9.0.0. The native build pins AGP 8.7.2, Kotlin 2.1.20, and Play Services Wearable 19.0.0. Headless dependencies are pinned to mobile's selected Expo 55.0.27, React Native 0.83.9, and React 19.2.6. Expo warns that its recommended React Native patch is 0.83.6; the selected 0.83.9 built and ran here.

Set `JAVA_HOME` and `ANDROID_HOME`, and put `gradle` 8.11.1, `keytool`, and `adb` on PATH. Run these PowerShell commands from this directory:

```powershell
New-Item -ItemType Directory -Force build | Out-Null
if (!(Test-Path build/debug.keystore)) {
  keytool -genkeypair -keystore build/debug.keystore -storepass android -keypass android -alias androiddebugkey -dname 'CN=Android Debug,O=Android,C=US' -keyalg RSA -keysize 2048 -validity 10000
}
gradle :phone:assembleDebug :watch:assembleDebug :watch:testDebugUnitTest
```

Build the bundled headless phone variant:

```powershell
Set-Location headless
pnpm install --frozen-lockfile --virtual-store-dir "$env:TEMP/orca-hjs-store"
pnpm exec expo prebuild --platform android --no-install --clean
Copy-Item ../build/debug.keystore android/app/debug.keystore
./android/gradlew.bat -p android -I ../short-path-build.gradle :app:assembleRelease -PreactNativeArchitectures=x86_64
Set-Location ..
```

The short pnpm store and Windows-only Gradle build-directory relocation avoid native-build command-line/path failures observed in this worktree. On macOS/Linux, use a short temporary store path and `./android/gradlew`; those hosts were not executed in this pass. `android/` is generated and ignored; clean prebuild followed by the key copy and release build was tested. An isolated copy of the headless sources also passed offline locked installation and Expo native-module discovery; that copied tree was not compiled again. Never commit the key, APKs, Google companion APK, or emulator data.

Create isolated AVDs with a Google Play phone image (API 31 tested) and Wear OS 4/API 33. Follow Android Studio's [Pair Wearable flow](https://developer.android.com/training/wearables/get-started/connect-phone). The phone's AVD metadata must correctly identify its Play Store image. The Pixel Watch app needs Nearby devices permission; Google's [emulator troubleshooting](https://developer.android.com/training/wearables/get-started/emulator) documents this requirement.

This run installed the already-present official Pixel Watch APK from an original AVD opened read-only, without copying app data or accessing its account. Normal Studio setup established Data Layer before the account sign-in step; no account was added. Avoid launching manual setup concurrently with Studio setup: that produced a `showTerms()` state crash here. A force-stop and fresh Studio flow recovered it.

## Run acceptance checks

Identify each serial using `adb devices -l` and `adb -s SERIAL emu avd name`. The serials below are this run's assignments, not stable device identities. The script rejects physical-device serials and intentionally crashes/force-stops only the probe package; use isolated test AVDs.

```powershell
adb -s emulator-5554 install -r phone/build/outputs/apk/debug/phone-debug.apk
adb -s emulator-5556 install -r watch/build/outputs/apk/debug/watch-debug.apk
python verify_transport.py --adb adb --phone emulator-5554 --watch emulator-5556 --mode native --output build/native-run
adb -s emulator-5554 install -r headless/android/app/build/outputs/apk/release/app-release.apk
adb -s emulator-5554 shell am start -n com.orcaspike.companion/.MainActivity
python verify_transport.py --adb adb --phone emulator-5554 --watch emulator-5556 --mode headless --output build/headless-run
```

Choose a new output directory for each run. Exit 0 requires fresh correlated sender and receiver evidence for each required positive case and an explicit acknowledgement timeout for the deliberately unhandled path. Headless delivery additionally requires `NATIVE_RECEIVE`, `HEADLESS_ENTER`, `JS_REPLY`, and `HEADLESS_COMPLETE` for that request. Doze and force-stop are observations, not universal delivery assertions. Each output directory retains command exit codes, endpoint logs, and `results.json`; cleanup restores battery simulation, exits forced idle, and wakes the phone.

For reconnect, install the native phone variant, stop only the test watch with `adb -s WATCH emu kill`, and launch the phone sender. Observe send failure or zero connected nodes. Restart the same watch AVD with its saved data, wait for `sys.boot_completed=1`, then launch the phone sender with a fresh `--es requestId orca-spike-reconnected-ID`. Require a nonempty connected-node list, watch receipt, and correlated phone PONG. Stop task-owned emulators when finished, preserving their AVDs.

## Observed results on 2026-09-23

[Recorded results and log excerpts](evidence/2026-09-23.json) retain request IDs, peer IDs, process transitions, APK hashes, and test outcomes. Full local receipts are under ignored `build/codex-run/`. The paired AVDs are `orca_spike_phone31_codex` (node `83e728ef`) and `orca_spike_wear4_codex` (node `301e868c`).

| Check | Native pair | Headless phone |
| --- | --- | --- |
| Real correlated message | Both directions | Watch → native → JavaScript → native → watch |
| Distinct IDs and nonadjacent replay | Acknowledged; duplicate logged | Acknowledged; JavaScript runs again |
| Phone background | Acknowledged | JavaScript completed |
| Phone process absent, package `stopped=false` after crash | New process acknowledged | New process bootstrapped JavaScript and acknowledged |
| Forced Doze, verified `mState=IDLE` | Acknowledged | JavaScript completed |
| Force-stop, verified `stopped=true` before send | Acknowledged; stopped flag cleared | JavaScript completed; stopped flag cleared |
| Unhandled path, then valid path | Timeout, then acknowledged | Timeout, then JavaScript completed |
| Watch shutdown/restart | Zero nodes, then same node and acknowledgement | Not separately exercised |
| Local replay-window tests | 5 passed | Not applicable |

Force-stop delivery is an observation of these emulator/Play Services versions, not a guarantee for other Android devices. The native 32-ID replay window is process-local and evicts old IDs; it proves no durable exactly-once mutation behavior. The headless probe deliberately has no business action or durable inbox/journal. The unhandled-path timeout does not test an offline durable queue.

Physical Samsung behavior, newer phone APIs, battery/latency budgets, release/Play signing, binding encryption, multi-node isolation, inbox crash recovery, and real Orca socket/action ownership remain untested. This closes emulator transport and JavaScript-bootstrap feasibility only; [the product plan](../../docs/wear-os-command-center-plan.md) retains its implementation approval and release gates. No standalone publication or license decision is made by this spike.
