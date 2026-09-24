# Orca for Wear OS: command center plan

| Field              | Value                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status | **Full companion implementation and internal physical installation authorized by Dhiman on 2026-09-23; implementation active, end-to-end acceptance incomplete. Public repository publication, Play release, and merge are not authorized.** |
| Calibration        | **standard** — an incumbent `wear/` prototype and Orca mobile's existing seams exist; this is reconciliation and gap-closing, not a from-scratch design |
| Observed target | Samsung Galaxy Watch8 Classic SM-L500 and SM-S928B phone, both API 36, observed through ADB on 2026-09-23; marketed Wear OS version and product UI/input gates remain separate checks |
| Minimum product    | Phone-assisted host pairing, account-usage visibility, agent status, structured message viewing/sending, and notification parity with Orca mobile |

## Decision summary

Build a dedicated Expo and React Native Wear OS application at the repository root, `wear/` — its own independent pnpm workspace, matching where the incumbent prototype already sits and keeping the whole portable phone-independent surface in one directory. Do not nest it inside `mobile/`: the root `pnpm-workspace.yaml` already declares `packages: []` specifically to keep `mobile/` out of the root package graph (its own comment states why — root's `patchedDependencies` conflict with auto-discovered nested workspaces), and reusing that same isolation for `wear/` avoids inventing a new root-tooling assumption. Keep its Expo, React Native, React, TypeScript, routing, test, formatting, and lint stack aligned with Orca mobile's through an automated version-parity check that reads both `mobile/package.json` and `wear/package.json` — two independently locked workspaces, not one shared lockfile, matching what already exists on disk today and reducing exactly one dependency-graph entanglement the eventual public-repository extraction would otherwise have to unwind. Share platform-neutral TypeScript contracts, projections, and design-token *values* (a parity contract enforced by a checked fixture test, not a cross-workspace import — see "Extraction-ready architecture" below); build watch-specific screens rather than shrinking phone layouts.

Kotlin remains only at the Android boundary that JavaScript cannot own safely: Wear Data Layer listeners, Keystore-backed binding crypto, background service/bootstrap, inbox admission, and rotary integration if React Native cannot meet the physical-device gate. The Expo config plugin owns generated manifests. This is a deliberate maintainability trade-off against Google's Compose recommendation. Expo and React Native do not document Wear OS as a separate first-class target, so Phase 0 must prove packaging, startup, navigation, input, accessibility, memory, and battery behavior on the actual watch before product work continues.

For the first release, keep the Android phone as the only client paired to each Orca runtime and exchange a deliberately narrow, versioned watch model over the Wear OS Data Layer.

The watch must not receive the phone's Orca device token, arbitrary RPC access, or a background WebSocket. It receives compact state snapshots and can submit only fixed, validated actions. The phone translates those actions onto the existing mobile RPC paths.

This is the recommended minimum because it:

- reuses Orca mobile's proven direct/relay E2EE, reconnect, replay, and mixed-version behavior;
- avoids granting the watch the current `mobile` scope, whose allowlist includes far more than command-center functions;
- uses the system's existing phone-to-watch notification bridge instead of creating duplicates;
- avoids a permanent watch radio connection and its battery cost;
- remains reversible: minimum runtime changes are additive, capability-gated workspace-routed native-chat read/subscribe, receipt-backed send, and post-auth mobile capability negotiation; existing clients keep their current paths and E2EE authentication frames.

A direct watch-to-runtime client is out of scope for this plan, not a later phase of it. The incumbent `wear/` prototype implements exactly that removed design — see the Phase 0 evidence re-verification below — and independent review confirmed it stores a real `mobile`-scope Orca device token on-watch and forwards arbitrary methods including `terminal.send`, `browser.*`, and `files.*` with no server-side Wear-specific allowlist (`src/main/runtime/runtime-rpc.ts` `MOBILE_RPC_METHOD_ALLOWLIST`; no `WEAR_RPC_METHOD_ALLOWLIST` exists anywhere in the runtime). That is precisely the authority-on-watch risk decision 1 exists to prevent, so this plan does not carry it forward as a conditional future phase; a direct client would be an entirely separate initiative requiring its own server-owned Wear grant, narrow allowlist, no-phone enrollment, Hermes/mobile crypto conformance, and push strategy, proposed and approved on its own merits rather than inherited from this document.

At fork-base source commit `4065d053cf942c1879379ebd8f1b50dda5568ff8`, `mobile/package.json` pins Expo `^55.0.27`, React Native `^0.83.9`, React `^19.2.6`, TypeScript `6.0.3`, Vitest `^4.1.9`, oxlint `^1.71.0`, and oxfmt `^0.52.0`; `mobile/app.json` enables the New Architecture. Implementation must copy the current mobile pins at branch time and keep them synchronized, rather than treating these plan-time versions as permanent.

### Approval decisions

Dhiman authorized the full companion scope on 2026-09-23, including the independent Wear workspace, phone-only runtime authority, all paired machines, and terminal-backed plus structured agent parity. This supersedes the earlier spike-only and phase-permission restrictions. Reversible in-scope implementation may proceed through the phases below; security and evidence requirements remain acceptance gates. Internal sideload acceptance is separate from unrequested Play publication. A signing-incompatible production phone install blocks only that deployment lane: never uninstall or overwrite it, change production pairings, or expose credentials to make a test pass. Inventory and conversation validation use existing configured agents; a reply test requires an exactly identified idle session and only a harmless bounded acknowledgement through the watch path. Busy sessions remain untouched.

1. **Companion-first boundary:** the phone remains the paired Orca client for the minimum release. The watch can show cached state offline, but live state and commands depend on the phone's Orca connection.
2. **Independent-workspace stack (revised 2026-09-23; supersedes the earlier "shared mobile workspace" wording):** use a dedicated Expo/React Native app at root `wear/`, its own pnpm workspace (matching the incumbent prototype's location), version-parity-checked against `mobile/` rather than lockfile-shared with it. Do not port phone screen layouts or the terminal WebView. Keep Kotlin confined to the shared Expo Wear module and generated Android integration, living inside the portable `wear/` tree so it stays extraction-ready.
3. **Package and signing:** use `com.stably.orca.mobile` and ensure the installed phone and watch APKs have the same app-signing certificate. Internal builds may be APKs; Play delivery uses a Wear-enabled AAB on the dedicated Wear OS track. The Play upload key may differ from the app-signing key. (The incumbent `wear/` prototype uses `com.dhi13man.orcawear`, which cannot satisfy this decision without a package change — see the evidence re-verification above.)
4. **New dependencies:** the Wear app starts with the exact Expo/React Native/React/TypeScript versions already pinned by mobile, verified by an automated version-parity check across the two independent workspaces (decision 2). Approve Google Play Services Wearable and any watch-only navigation, rotary, or native dependency only after version, license, provenance, New Architecture, API-floor, and 64-bit/native-binary review. A dependency is not approved merely because a React Native wrapper exists.
5. **Notification scope — two different limits, not one:** minimum parity means system-bridged phone notifications plus an in-app watch event feed. Two distinct cases must not be conflated: (a) **honestly out of scope** — the phone is absent, the user has force-stopped Orca mobile, or no phone is paired at all; there is no mechanism that can reach the watch in these states, and the UI must say so plainly (unavailable, not silently stale). (b) **core required reliability, not excluded** — the phone app is merely backgrounded, screen-off, or reclaimed by ordinary Android Doze/process-management while never force-stopped; Android's `WearableListenerService`/Data Layer wake path is designed to survive exactly this, and the minimum release must prove it does, not assume it. Phase 0/1 must demonstrate the watch's own dashboard/attention state actually refreshes (not just that the OS-level system-notification bridge, a separate and already-reliable Android mechanism, keeps working) while the phone is background/screen-off/Doze. If that cannot be proved, this is a named Phase 0 feasibility-gate **failure** to report, not something covered by "the system notification bridge still works" — open-socket-only or notification-mirroring-only coverage does not satisfy this decision. Phone-absent or force-stopped killed-process push (case a) genuinely remains out of the minimum release.
6. **Hardware target:** confirm the exact watch model, Wear OS version, connectivity variant, and rotating-input behavior from Settings -> About before physical acceptance testing.
7. **Safe native-chat runtime change:** approve additive execution-host-routed native-chat read/subscribe plus receipt-reserved atomic send. The SSH portion includes a capability-gated relay handler, one-use primary-channel identity proof, connection-incarnation-scoped negotiation, and a stable cross-process send reservation/receipt store outside versioned relay installs. Existing reads cannot resolve SSH-host transcripts safely, and the existing React-owned mobile input lease/raw `terminal.send` cannot authorize a background watch send to the exact current agent.
8. **Android API floor:** require Wear OS 4/API 33 or newer on the watch and Android 12/API 31 or newer on the companion phone for the Wear feature. Android Keystore did not add ECDH key-agreement purpose until API 31, and there is no API 31 Wear OS release lane. Older phones may continue using Orca mobile but cannot enroll a watch. Do not add a weaker software-key compatibility path without separate approval.
9. **Windows SSH send boundary (interim state, not a release-completion waiver):** local Windows runtimes retain full command support. A Windows SSH relay advertises atomic send only if a no-directory-mutation receipt ledger passes forced crash/power-cut durability evidence; until that evidence exists, its conversations are read-only with an explicit unsupported/update-required state. That read-only state is **honest interim behavior while durability is unproven, not a satisfied "all paired machines" requirement** — "ALL paired machines and ALL agent types" (Product framing) supersedes treating it as an acceptable permanent release outcome. Before Phase 3 can call the minimum product done, either (a) the Windows-relay durability evidence is produced and atomic send is proved, or (b) Dhiman explicitly approves a scope reduction that excludes Windows SSH hosts from full "all machines" send parity for this release, recorded as its own decision, not silently inherited from this fallback. Adding a native Windows durability dependency, if needed to close (a), requires separate approval.
10. **No direct watch-to-runtime client (new 2026-09-23):** the direct-client architecture is out of scope for this plan entirely, not a conditional Phase 4. The incumbent `wear/` prototype already implements it and independent review found it holds full `mobile`-scope runtime authority on-watch (see the evidence re-verification above) — the exact risk decision 1 exists to prevent. A future direct-client initiative, if ever pursued, is a separate proposal on its own merits.
11. **Structured agent-session parity is in-scope starting Phase 0/1 (revised 2026-09-23 — two filters, not one, and messaging is a separate problem from inventory):** `session-tab-agent-status-projection.ts` applies two independent restrictions, not one: `structuredVisible` (line 20-23) hides every structured `agent-session` tab whenever `clientKind === 'mobile'`, full stop; separately, even a client that *does* see structured tabs (`clientKind === 'runtime'` with the capability declared, or `clientKind === undefined`) retains only `agent === 'codex'` structured tabs and filters out other kinds (line 25-27). Reaching genuine "all agent types" requires resolving both, and inventory visibility alone is not messaging parity: structured sessions send through `StructuredAgentSessionOutbox` (`queued`/`dispatching`/`unconfirmed`, `delivery-unknown`/`failed` — `src/shared/structured-agent-session-outbox.ts`), a different state machine from native-chat's `accepted`/`rejected`/`unknown`, and reading them goes through `projectStructuredItemToNativeChat` (`src/shared/structured-agent-session-projection.ts`), not the raw PTY transcript path. Approve, as a bounded scope: (a) a capability-gated exception to the `mobile`-client-kind inventory filter so paired mobile-family clients can *see* structured tabs in the catalog, landing in Phase 1 as originally planned; and (b) a Phase 0 code-audit prerequisite, ahead of any implementation claim, to determine the exact transcript-read and send mapping from `StructuredAgentSessionOutbox`/`projectStructuredItemToNativeChat` onto the watch's action envelope — per supported agent kind (explicitly naming whether Codex structured sessions are covered or remain a further-named gap) and per host path (local/SSH/paired-runtime). Do not invent a new runtime endpoint and do not fall back to raw `terminal.send` for a structured session; if the audit finds no safe mapping for a given agent kind or host path by the time Phase 2 needs it, that combination is an explicit, named gap blocking full "all-agent" completion, not a silently narrowed claim. This is a runtime/mobile change that also affects Orca mobile's own phone screens, not a watch-only addition. Old, non-capability-declaring clients keep exactly today's compatibility behavior — nothing here changes what they see.

### Decision register

| Decision                                                                         | Owner                                | Evidence required before product code                                                             | State                             |
| -------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------- |
| Companion-first minimum, notification scope, and safe native-chat runtime change | Dhiman                               | Approval of decisions 1, 5, and 7                                                                 | Approved                          |
| Independent-workspace Expo/React Native stack (revised)                          | Dhiman and Orca implementation owner | Re-confirmation of revised decision 2; toolchain-compile and standalone-extraction evidence closed 2026-09-23 (spike log below); physical Expo-on-Wear feasibility (startup, navigation, rotary, TalkBack, memory on-device) still requires a physical watch | Open — build/extraction evidence closed, physical evidence still blocked |
| Package, signing, version-code, and Play topology                                | Android release owner                | Debug-key fingerprints inspected 2026-09-23 (spike log below) — mobile/wear applicationId mismatch confirmed; the identical debug-key fingerprint between the two keystores is an unexplained fact, not confirmed meaningless (an earlier "universal AGP default" explanation was withdrawn as false); real release/Play-signed certificate fingerprints and export evidence still required | Open — applicationId mismatch confirmed, debug-key coincidence unexplained, real release evidence outstanding |
| Watch enrollment, payload, retention, and disclosures                            | Orca security/privacy reviewer       | Threat-model and final-schema review                                                              | Open                              |
| Physical device/API support, Wear API 33 floor, and phone API 31 floor           | Dhiman and Orca implementation owner | Approval of decisions 6 and 8; on-device Settings/ADB and Google Play Services evidence           | Open                              |
| Windows SSH atomic-send capability                                               | Dhiman and Orca runtime reviewer     | Approval of revised decision 9; a 2026-09-23 probe modeled the documented write/fsync/rename sequence (not the production module) with orderly self-exits (not a forced kill) at its step boundaries and found no corruption — a real but very narrow sanity check on the algorithm's design, not crash-safety evidence for the production code (spike log below); real crash/power-cut durability evidence against the actual implementation, **or** Dhiman's explicit approval of a named "all machines" scope reduction excluding Windows SSH hosts, both remain outstanding | Open — no meaningful evidence toward decision 9 closed yet |
| No direct watch-to-runtime client                                                | Dhiman                               | Approval of new decision 10                                                                        | Approved 2026-09-23              |
| Structured agent-session inventory + messaging parity                            | Dhiman and Orca implementation owner | Approval of revised decision 11; Phase 0 code audit closed 2026-09-23 (spike log below) — the real RPC gap was `agentSession.*` absent from `MOBILE_RPC_METHOD_ALLOWLIST`; per-agent-kind/host-path Phase 2 acceptance remains open | Open — local Codex inventory/read/send implemented; other provider and host paths, installed acceptance outstanding |

The full product scope is authorized; remaining phase gates require evidence, not another phase-permission request. No calendar deadline is invented; each open row remains an acceptance requirement for the phase that consumes it.

### Evidence re-verification — 2026-09-23

This pass re-read the repository at branch `Dhi13man/ship-orca-wearos`, HEAD `b48130a57a774653fe19ffc14c5885632e9e61e6`, re-ran the primary-source research this plan depends on, and incorporated an independent read-only reviewer's findings (adjudicated below; no code was built, tested, or modified by either pass).

**1. An untracked prototype at root `wear/` is a working implementation of this plan's rejected direct-client design, holding real mobile-scope runtime authority — not a partial start on the approved companion architecture.** `wear/` is a second, independent Expo app with its own `pnpm-workspace.yaml`/`pnpm-lock.yaml`. Concrete, file:line-grounded findings:

   - **It holds the phone's exact authority, not a narrower watch grant.** `wear/src/orca/pairing.ts:7-14` accepts an Orca pairing code carrying `scope: 'mobile' | 'runtime'` — the same code minted for the real phone app — and `wear/App.tsx:38` only rejects `scope === 'runtime'`; a `mobile`-scope code is accepted, persisted in `expo-secure-store` (`wear/src/orca/pairing-store.ts:9-29`), and presented on every request as `client: { id: pairedDeviceId, type: 'mobile' }` (`wear/src/orca/direct-orca-client.ts:125`). `MOBILE_RPC_METHOD_ALLOWLIST` in `src/main/runtime/runtime-rpc.ts` includes `browser.*`, `files.*`, `clipboard.*`, `accounts.*` mutation, and `terminal.send`; no `WEAR_RPC_METHOD_ALLOWLIST` exists anywhere in the runtime to narrow this. This is a code-path finding about what the app is built to do, not a claim that a live credential is sitting on a paired watch right now — no device was inspected and no token contents were read.
   - **A from-scratch E2EE reimplementation, not reuse.** `wear/src/orca/e2ee.ts` reimplements Orca's E2EE v2 handshake with `tweetnacl` independently of the mobile app's crypto module; byte-level parity against the real runtime's server-side handshake was not verified by either pass.
   - **A raw `terminal.send` sender**, not the plan's fenced/fixed `sendAgentMessage` action (`wear/src/orca/direct-orca-client.ts:105-143`) — the same unsafe fallback the plan's Phase 2 design exists to avoid.
   - **Wrong package/signing identity.** `wear/app.json:18` sets `"package": "com.dhi13man.orcawear"`, not the approved `com.stably.orca.mobile` (confirmed at `mobile/android/app/build.gradle:98,100`). `AndroidManifest.xml` additionally sets `standalone=true` and `usesCleartextTraffic=true`, both inconsistent with the approved companion build contract; note that cleartext transport does not by itself mean the application-layer E2EE payload is exposed in plaintext, only that the outer channel offers weaker protections (e.g., no TLS-level authentication) than the plan's model assumes.
   - **A forked, non-parity design-token set.** `wear/src/wear-theme.ts` defines its own `wearColors` palette. One value (`secondary`/`muted: '#a1a1a1'`) does happen to match `mobile/src/theme/mobile-theme.ts`'s `textSecondary`/`textMuted` — so this is not a zero-overlap fork — but the palette is not derived from or checked against `mobile-theme.ts`, and most values (`background: '#0a0a0a'` vs. `bgBase: '#111111'`, etc.) diverge; spacing/radii/typography scales are inlined per-file rather than shared at all.
   - **Single-host, local-execution-only scope.** `PairingOffer` encodes one `endpoint`; there is no host catalog. `direct-orca-client.ts:74-76` and `agent-conversation.tsx:30-31` gate read/send on `agent.execution === 'local'`, so SSH/paired-runtime/folder-workspace agents are permanently disabled in the UI. This is real code evidence that the scaffold does not attempt "all agents on all paired machines" — it is additional grounding for, not a substitute for, this plan's own product framing below.
   - **No nudge path.** No notification listener, headless task, WorkManager, or Data Layer client anywhere in the tree; agent state updates only on manual pull-to-refresh.
   - **A hand-rolled local/remote classifier** (`runtime-dashboard.ts:83-91`, inferring `local`/`remote`/`unverifiable` from whether `connectionId` is null or `wsl:`-prefixed) duplicates logic this plan assigns to `worktree.ps`/`WorktreeCatalogSnapshotClient`/`session.tabs.subscribeAll` instead of reusing it — a live risk if the heuristic ever diverges from the canonical classifier on an edge case, per AGENTS.md's reuse-before-reimplementing rule.

   This worker (and the independent reviewer) did not modify, delete, or otherwise touch `wear/`, and this plan does not require it to be discarded — that decision belongs to Dhiman (decision register above), not to this document. This plan's rejection is scoped to `wear/`'s **authority and transport paths**: the direct-to-runtime pairing/E2EE/RPC stack (`wear/src/orca/*`) and its build/package identity are not reused, full stop. That rejection does not extend to `wear/`'s presentation layer. Genuinely reusable, evaluable UI mechanics observed in the code — the pairing-code UX pattern, an accepted/rejected/unknown send vocabulary that correctly avoids auto-retry on ambiguity, a round-screen-aware inset calculation, `WearButton`'s 48×48dp-floor layout, and error/empty-state structure — are candidates worth evaluating for reuse in `wear/`'s Phase 1+ screens once the underlying data/transport is replaced with the approved companion architecture; nothing here mandates porting them either, only that they not be dismissed sight-unseen as "different by construction" when the construction in question is layout and button styling, not authority or transport. Evaluate and port what holds up during Phase 1 UI work; do not rewrite proven presentation code for its own sake.

**2. The plan's earlier "Wear OS 7 is now GA" claim did not hold up under a second, direct re-fetch and is withdrawn.** A prior pass of this reconciliation cited `developer.android.com/training/wearables/versions/7/changes` for both an exact "2026-06-16" ship date and a "general availability" status; a direct re-fetch of that same page confirms it states the Android 17/API 37 mapping but contains no date and no general-availability wording at all — neither claim is supported by the cited source, and both are removed rather than partially kept. What remains, grounded only in what the page actually says: Wear OS 7 corresponds to Android 17/API level 37. Its release/preview status and the exact watch's actual installed OS are unverified by this document; Phase 0 must read the real value from the physical device rather than from any online claim, dated, GA-labeled, or otherwise. This does not change the approved API 33 floor (decision 8 still stands as the minimum).

| Decision                                                    | Owner  | Evidence required before product code                                                                  | State |
| ------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------- | ----- |
| Reconcile or discard the untracked `wear/` direct-client prototype | Dhiman | Explicit choice: archive outside the repo, delete, or scope as its own separately approved initiative, never folded into this plan's Phases 0-3 | Open  |

Whatever Dhiman decides for `wear/`, if any build from it was ever installed on a physical watch and paired against a real Orca runtime — this worker did not check whether that happened — that pairing used a `mobile`-scope device token indistinguishable, at the runtime's authorization layer, from a real phone (see finding 1 above). Before treating that possibility as closed: confirm on the runtime side whether any `mobile`-scope device token was ever issued to a non-Orca-mobile client and, if one was, revoke it through the existing device-registry removal path — the same mechanism that already retires a lost or replaced phone. This is a revocation-hygiene check, not a code change, and it is independent of whichever resolution the decision-register row above lands on.

## Goals

### Product framing

The watch answers three questions without pulling out the phone: **who needs me, what are they doing, and can I unblock them?** That is a phone-companion job-to-be-done, not a mini Android app — it is scoped to attention (which host/agent needs the user), agent state (what every paired host's agents are doing), usage (is a provider about to rate-limit), and a fast phone handoff (send a short reply, or escalate to the phone for anything larger). Every screen in "Product and interaction design" below maps to one of those four jobs; a feature that does not serves the phone app, not the watch.

"ALL paired machines and ALL agent types" is a scope commitment, not an aspiration: every host the user has paired with Orca belongs in the watch's catalog with no subset, and both terminal-backed and structured agent sessions belong in the watch's agent inventory. Two clarifications keep this bounded rather than unbounded, matching "complete discovery is not unbounded subscriptions or scrolling transcripts" — neither is a coverage exclusion:

- **Host catalog completeness vs. live-connection concurrency are different things.** Every paired host is always visible with its cached/stale state. Only a bounded number hold a concurrently *live* socket at once — a background-concurrency policy sized from Phase 0's radio/battery evidence and the on-screen host's own slot, never a fixed number chosen in advance and never a reason a host is missing from the catalog (see Phase 1 below).
- **Structured agent-session parity is bounded and in-scope, but inventory visibility and messaging are separate problems.** The current `session-tab-agent-status-projection.ts` publishes Codex structured tabs to mobile clients that negotiate `agent-session.structured.v1`; old clients remain filtered. The phone's Wear inventory observer negotiates that capability and counts these rows, but does not yet publish their identities to the watch. Structured sessions use a different outbox/state model (`StructuredAgentSessionOutbox`) from terminal-backed native chat. Reaching complete inventory and messaging across every agent kind and host path still requires the Phase 2 acceptance gates; the current capability and count do not prove structured replies.
- **Usage is deduplicated by provider account, not by host count.** The same Claude or Codex account can be paired on multiple hosts; the dashboard and per-host usage screens present one true figure per *verified* provider account (see `wear.dashboard.v1`'s `usageGroups[]` design in "Phone/watch contract"), never N potentially-conflicting copies that could each claim a different remaining-quota number for the same account. An account whose identity the phone cannot verify across hosts stays explicitly separate rather than being guessed-merged.

- Pair the watch with Orca's Android companion and discover every one of the phone's paired Orca hosts without rescanning every desktop code.
- Show deduplicated, per-verified-account Claude and Codex usage with the same session/weekly/reset semantics and last-updated honesty as mobile, not a per-host copy that can disagree with itself; other providers and inactive accounts are shown as out of scope, not silently omitted as if covered.
- Catalog every paired host and show live/cached terminal-backed *and* structured agent sessions that the mobile runtime projects across local, SSH, and paired-runtime hosts, including folder workspaces and Git worktrees.
- Open a selected agent's recent conversation and send a short typed or dictated message through the atomic host method, with a real end-to-end reply round trip — not a stub that only renders a local echo. Terminal-backed agents use the native-chat path this plan specifies in full; structured agents get the same catalog visibility starting Phase 1, with messaging following per agent-kind/host path only as the Phase 0 code-audit and Phase 2 acceptance in decision 11 prove each one safe — not assumed complete on the same schedule as terminal-backed messaging.
- Preserve Orca's mutation outcome vocabulary: `accepted`, `rejected`, or `unknown`; never silently retry an ambiguous send.
- Surface Orca notifications on the watch without duplicates and provide replay-backed recent events in the app, driven by an actual push/refresh mechanism rather than manual pull-to-refresh only.
- Remain glanceable, round-screen safe, rotary-operable, TalkBack-readable, and explicit about stale/unverifiable state.

## Non-goals for the minimum release

- Full terminal rendering or raw terminal input.
- Browser control, file editing, source-control actions, PR review, account switching, workspace creation/removal, or SSH setup.
- Internal `orchestration.*` mailbox access. User messages use the native-chat surface and its dedicated safe-send method.
- Image/audio attachments, raw microphone streaming, or long-form transcript browsing.
- A direct runtime credential on the watch, and a direct watch-to-runtime client of any kind (see "Decision summary" above — this is out of scope, not a conditional later phase).
- Phone-absent real-time notifications, FCM/relay push infrastructure, complications, or Wear OS 7/API 37-specific surfaces beyond the approved API 33 floor (its release/preview status is unverified — see the evidence re-verification above — but it is out of scope for the minimum release either way, which targets API 33+).
- Manual edits under generated `mobile/android` or `wear/android`; Expo prebuild would erase them.

## Current Orca architecture

### Existing reusable seams

| Need                              | Existing source of truth                                                                    | Planned watch projection                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Host connection and compatibility | `mobile/src/transport/host-logical-client.ts`, `status.get`, mobile direct/relay transport  | Phone publishes compatible/unavailable state; watch never handles runtime credentials in the minimum release |
| Account usage                     | `accounts.subscribe` and `accounts.list`; `mobile/src/components/account-usage-state.ts`    | Per-host provider usage, reset labels, and generated-at timestamp                                            |
| Agent inventory                   | `session.tabs.subscribeAll`, with `session.tabs.listAll` fallback                           | Compact host/workspace/agent rows; preserve authoritative vs incomplete inventory semantics                  |
| Conversation view                 | Existing local `nativeChat.*` plus new capability-gated workspace-routed read/subscribe     | Recent local/SSH messages; execution host owns transcript access; subscribe only while the view is open      |
| Message send                      | Existing ambiguity/lease/PTY primitives plus new `nativeChat.sendMessage` and receipt query | Fixed `sendAgentMessage` action returning accepted/rejected/unknown without raw `terminal.send` fallback     |
| Notifications                     | `notifications.subscribe`, `notifications.getMissedSince`, mobile watermark/dedupe logic    | System-bridged notification plus a bounded in-app event projection                                           |
| Remote semantics                  | `docs/reference/ssh-execution-boundary.md`                                                  | Host owns execution; disconnect means `unverifiable`, never inferred `exited`                                |
| Mixed versions                    | `src/shared/protocol-version.ts`, `docs/reference/remote-wire-compatibility.md`             | Versioned phone/watch contract and explicit capability fallback                                              |

The runtime currently has only `mobile` and `runtime` device scopes. `MOBILE_RPC_METHOD_ALLOWLIST` in `src/main/runtime/runtime-rpc.ts` includes account mutation, files, Git, browser control, settings, terminals, and workspace mutation. Hiding those controls in the watch UI would not remove their authority. This is why the minimum design keeps the runtime credential on the phone.

The user-facing message path is not the internal orchestration mailbox. Agent discovery comes from `session.tabs.subscribeAll`. Existing native-chat transcript resolution is local/WSL and cannot silently serve SSH workspaces, so the watch path adds execution-host-routed read/subscribe capability that accepts opaque workspace/session identity and fails closed when the SSH host is unreachable. Sending adds capability-gated `nativeChat.sendMessage` because mobile's current composer safety depends on a React-owned input lease and the host rejects a combined guarded `terminal.send` body-plus-submit. Local sends use the main runtime's existing settled-prompt writer and local durable receipt. For SSH, the relay first durably reserves the mutation; only a proved reservation lets the main runtime revalidate the exact published session and invoke its existing settled-prompt state machine through the remote PTY provider. The relay then records the outcome. Any ambiguous begin/write/complete boundary stays pending/`unknown` and is never resent. Old hosts or relays expose status but no unsafe chat fallback.

### Minimum architecture

```mermaid
flowchart LR
  subgraph H[Execution boundary]
    R[Orca runtime<br/>local, SSH, or paired host]
  end

  subgraph P[Android phone trust boundary]
    M[Existing Orca mobile<br/>E2EE direct or relay client]
    X[Wear projection and<br/>action executor]
    J[Durable command journal]
    M <--> X
    X <--> J
  end

  subgraph G[Google Wear Data Layer]
    D[Encrypted expiring dashboard<br/>and transient pages/actions]
  end

  subgraph W[Watch application boundary]
    C[Expo and React Native<br/>command center]
    K[Local sensitive-minimized cache]
    S[Wear OS system<br/>notification surface]
    C <--> K
  end

  R <-->|Existing pinned-key E2EE RPC| M
  X <-->|Same package, signature,<br/>and enrolled binding| D
  D <--> C
  M -->|Android notification bridge| S
```

The watch (`C`) has no edge to the runtime (`R`) in this diagram, direct or optional. Decision 10 rejects the direct watch-to-runtime client entirely; there is no later-phase path for this plan to leave a dotted line toward.

### Pairing and command sequence

```mermaid
sequenceDiagram
  actor U as User
  participant W as Wear app
  participant D as Wear Data Layer
  participant P as Orca Android app
  participant R as Orca runtime

  U->>P: Pair host using existing Orca flow
  U->>W: Open Orca on approved watch
  W->>D: Enrollment hello with watch install ID and nonce
  D->>P: Candidate watch
  P-->>U: Confirm matching watch fingerprint
  P->>D: Node-targeted binding key after confirmation
  P->>R: Existing E2EE status and subscriptions
  P->>D: Publish bound, AEAD-encrypted dashboard
  D-->>W: Persisted encrypted dashboard
  W-->>U: Hosts, usage, and agent state

  U->>W: Send short agent message
  W->>D: Fixed action with requestId and expectedRevision
  D->>P: Best-effort command delivery
  P->>P: Validate action, target, revision, and journal
  P->>R: nativeChat.sendMessage with target epoch/version and mutation ID
  R-->>P: accepted/rejected receipt, or queryable pending state
  P->>D: Acknowledge exact outcome
  D-->>W: accepted, rejected, or unknown
  W-->>U: Show outcome#59; never auto-retry unknown
```

## Phone/watch contract

The Data Layer contract is not a tunnel for raw Orca RPC. It is a separate, smallest-useful surface owned by the mobile companion.

### Extraction-ready architecture

`wear-companion-contract` and `expo-wear-data-layer` (below) are colocated inside this Orca checkout only so the feature can be built against the real mobile/backend stack it depends on; colocation is a workspace-management convenience, not evidence of a decision to publish. If a personal public OSS repository is considered later, it applies only after this plan is fully implemented, reviewed, and Dhiman is satisfied with it — and only after a separate license/provenance/asset audit and explicit approval, none of which this document performs or brings closer. Publication, license selection, and branding/package renaming all wait for that future, explicit user decision.

The boundary this plan actually holds today:

- **Everything portable lives inside `wear/`.** The watch app, its native Data Layer transport (`wear/packages/expo-wear-data-layer`), and the public product contract (`wear/packages/wear-companion-contract`) are all under one directory, importing no React, Expo, Node, or desktop-runtime code from outside it.
- **The Orca-specific adapter stays in `mobile/`.** Everything that knows about Orca's runtime RPC, device registry, or account/session model — the phone-side projection, publication, and command-executor code under `mobile/src/wear/` — lives in `mobile/`, which depends inward on `wear/`'s contract package. `wear/` never imports from `mobile/` or any other desktop-only tree; the dependency edge points one way only.
- **A standalone `wear/` build requires nothing from `mobile/`.** `wear/`'s own install, typecheck, lint, test, and prebuild run from a clean checkout of `wear/` alone (plus its own `packages/` members) — no build step reaches into `mobile/`, the repository root, or any sibling directory, and no fixture references a private credential.
- **The extraction smoke test is exactly that claim, executed.** Copy only `wear/` (and nothing else) into an empty temporary tree, `pnpm install && pnpm build && pnpm test` from there with no sibling directories present, and require it to succeed using only its own committed public fixtures. This is a Phase 0/3 verification item, not aspirational text — if the copy-and-build fails, the boundary above is not actually true yet.

An extracted `wear/` repository passing that smoke test is still not, on its own, a working product: Google Data Layer requires the watch and its paired phone app to share an application ID and installed signing certificate (decision 3), so a plucked-out watch codebase cannot interoperate with an arbitrary Orca phone install unless a compatible signed phone counterpart is published and maintained alongside it — extraction is a two-sided distribution problem, not just a source-code boundary. This plan does not solve that now; it deliberately avoids building a generic multi-backend transport framework for a hypothetical future consumer, keeping one small versioned phone/watch contract and one Orca-specific adapter. Whenever extraction is actually pursued, it needs its own decisions for shipping-artifact/phone-bridge ownership, coordinated application-ID/signing configuration (no keys ever committed to either repository), and a reproducible paired-build smoke test proving the extracted watch app and its phone counterpart still interoperate after the split — named here as a future prerequisite, not undertaken by this document.

| Contract concern                                                                                          | Single owner                                                                             |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Action/product schema, projections, canonicalization, and public TypeScript API                           | The language-neutral manifest and generated TypeScript in `wear-companion-contract`      |
| Generated phone/watch manifests and role-specific services/features                                       | The `expo-wear-data-layer` config plugin                                                 |
| Data Layer calls, Keystore crypto, service lifecycle, native inbox, and reject-before-JS action admission | Kotlin in `expo-wear-data-layer`, with admission code generated from the shared manifest |
| Phone execution, watch state, and React Native UI                                                         | TypeScript in the consuming Expo app; shared packages contain no app/runtime imports     |

### Companion binding

Before any snapshot or action, the phone and watch complete `wear.binding.v1`:

```text
wear.binding.v1 = {
  schemaVersion,
  bindingId,
  phoneInstallId,
  watchInstallId,
  phoneNodeId,
  watchNodeId,
  issuedAt
}
```

- The phone and watch each generate a stable random install ID and a fresh, non-exportable P-256 ECDH enrollment keypair in Android Keystore. Data Layer node IDs are transport observations, not durable authorization.
- The enrollment hello carries the one-time public key and nonce. The user confirms a short fingerprint derived from both install IDs, public keys, and nonces on both screens. The phone then creates a random binding ID and 256-bit binding key.
- After confirmation, the native modules derive a bootstrap key with ECDH plus HKDF-SHA-256, wrap the binding key with AES-GCM, and send it only to the selected node with `MessageClient`. Each side stores the binding key under a device-local non-exportable Android Keystore wrapping key, deletes the one-time ECDH key, and never exposes raw key material to JavaScript.
- Native modules protect every envelope with AES-256-GCM. The binding ID, schema version, path, publisher epoch, revision/request ID, and expiry are authenticated additional data; nonces are unique per binding/key. Data Item paths are namespaced as `/orca/wear/v1/{bindingId}/...`, but paths are routing—not confidentiality.
- Persistent Data Items contain ciphertext only and are readable only after successful bound-key decryption. Commands/read pages use node-targeted `MessageClient` and the same AEAD envelope.
- Node change, app reinstall, or phone replacement requires explicit rebind. Binding removal durably records `removalDeadlineAt = now + 24 hours`, marks the binding revoked, rejects its commands, stops publication, publishes an AEAD-protected tombstone, and immediately deletes every non-tombstone phone-owned Data Item for that binding.
- The phone retains only the tombstone, wrapped binding key, and metadata-only revocation record until the watch acknowledges removal or `removalDeadlineAt` passes. Either terminal event deletes the tombstone, remaining Data Items, native inbox rows/counters, key, and binding record. Cleanup runs on acknowledgement, the deadline worker, and startup/service-entry reconciliation; a powered-off phone performs overdue cleanup before any later publication. A watch that misses the tombstone cannot resume the revoked binding: its cached dashboard expires within 24 hours, later traffic is rejected as an unknown binding, and the UI requires re-enrollment.
- Multiple-phone and multiple-watch tests prove that snapshots and commands cannot cross bindings even though the apps share package/signing identity.

### Persistent dashboard envelope

```text
wear.dashboard.v1 = {
  schemaVersion,
  bindingId,
  publisherEpoch,
  revision,
  generatedAt,
  expiresAt,
  companionState,
  hostPage: { total, included, truncated, nextCursor },
  usagePage: { total, included, truncated, nextCursor },
  usageGroups: [{
    groupKey,
    provider: "claude" | "codex",
    identityConfidence: "verified" | "unverified",
    sourceHostIds: [hostId, ...],
    readingHostId: hostId,
    providerUsage: wear.providerUsage.v1
  }],
  hosts: [{
    hostId,
    displayName,
    connectionState,
    inventoryAuthority,
    usageGroupKeys: { claude: groupKey | null, codex: groupKey | null },
    agentCounts: { total, working, needsAttention },
    lastActivityAt
  }]
}
```

The per-host `accountUsage: { claude, codex }` shape this plan previously specified cannot provide the per-account deduplication "Usage is deduplicated by provider account" (Goals) promises: keying usage by provider name alone, once per host, gives no way to know whether two hosts' `claude` entries are the *same* Claude account or two different ones. `usageGroups[]` fixes this by making the account, not the host, the unit of identity, and `hosts[].usageGroupKeys` is a reference into it rather than an embedded copy.

- **`groupKey` is a binding-scoped opaque identifier, not a raw account identifier.** The phone determines account identity equivalence locally — by comparing whatever real per-host identity field `accounts.subscribe` already exposes for that provider — and only ever emits a derived opaque key across the boundary; the underlying account ID, email, or organization/workspace identifier this comparison used never crosses it. A `groupKey` is scoped to the current binding (rebinding invalidates and regenerates it) so it cannot function as a durable cross-binding correlation identifier either.
- **Dedup only follows verified identity, never a display string.** `identityConfidence: "verified"` means the phone actually matched real per-host account-identity fields, not provider name or account display text — two hosts merge into one `usageGroups` entry only under `"verified"`. `identityConfidence: "unverified"` means the phone could not establish that match (an old host exposing no comparable identity, or an ambiguous read); an unverified entry always has exactly one `sourceHostIds` member and is never merged with another entry, verified or not, on the strength of matching provider name or label alone.
- **Conflicting snapshots are labeled, not summed.** Multiple hosts contributing to one verified group can observe the same underlying account at different freshness. `providerUsage` reflects the most recently `updatedAt` reading among `sourceHostIds`; percentages and window figures across sources are never averaged or added together, and `readingHostId` identifies the host that supplied the shown reading.
- **Scope stays exactly what mobile already exposes as active.** Only the active Claude/Codex accounts each paired host currently declares through `accounts.subscribe` are covered. Other providers and inactive accounts are not silently folded into "unavailable" or omitted as if they don't exist — the phone and watch UI must show them as explicitly out of scope (not exposed by this schema) rather than implying coverage that isn't there.

`providerUsage` is a closed, persisted projection rather than an `AccountsSnapshot` copy:

```text
wear.providerUsage.v1 = {
  status: "idle" | "fetching" | "ok" | "error" | "unavailable",
  session: wear.usageWindow.v1 | null,
  weekly: wear.usageWindow.v1 | null,
  updatedAt
}

wear.usageWindow.v1 = {
  usedPercent,
  windowMinutes,
  resetsAt
}
```

Rules:

- IDs are opaque host-issued values. The watch never constructs paths or infers Git support.
- The phone maps only the declared active-provider rate-limit fields into `providerUsage`; it never spreads or serializes `AccountsSnapshot`. `wear.providerUsage.v1` and `wear.usageWindow.v1` are frozen, closed security sub-schemas whose generated decoders reject unknown fields, and so is `usageGroups[]`'s own shape — an unknown field on a group entry fails decode rather than passing through. Adding a usage field requires a new capability-negotiated schema version/path rather than an optional v1 extension. Fixtures containing account IDs, email addresses, organization/workspace identifiers, runtime targets, inactive-account lists, reset-credit details, free-form error/reset descriptions, or a `groupKey` that is anything other than the phone's own opaque generated value (e.g., a raw ID, email, or predictable hash of one) must fail.
- Dashboard content excludes device tokens, relay credentials, account identifiers, workspace/session IDs, workspace/agent names, notification content, file paths, raw terminal output, and transcripts.
- `inventoryAuthority` distinguishes an authoritative empty inventory from an incomplete/old-host result.
- The serialized authenticated envelope is capped at 32 KiB, including its 133-byte native header, nonce, and tag; dashboard plaintext is capped at 32,635 bytes. Hosts sort by connected/most-recent state with opaque ID tie-breakers. Both host rows and whole usage groups report `total`, `included`, `truncated`, and `nextCursor`; retained groups keep all contributing host IDs and their freshest reading. Clipping is never presented as complete data. Paged retrieval of omitted groups/hosts remains an integration requirement.
- Every screen shows the relevant generated-at time when state is not live.
- Loss of contact maps to `unverifiable`; it does not become `exited`, `done`, or any synonym.
- The phone keeps one current dashboard item per binding and deletes superseded/expired revision-specific items. A bounded cleanup ledger retains paths for timed-out or superseded Data Layer writes so a late completion cannot overwrite or delete a newer revision; transitional items may coexist until cleanup. Each dashboard has a 24-hour expiry that the watch enforces even while offline. The watch persists only the decrypted sensitive-minimized dashboard in app-private no-backup storage. Agent pages, inbox pages, and chat content are never placed in a persistent Data Item, DataStore, or Tile.

Acceptance for `usageGroups`:

- Two hosts reporting the same verified account identity produce exactly one `usageGroups` entry with both hosts in `sourceHostIds`.
- Two hosts reporting distinct verified accounts for the same provider produce two distinct entries with disjoint `sourceHostIds`.
- A host whose identity cannot be verified always gets its own single-source entry; it is never merged into another entry by provider-name or display-string matching alone.
- When sources within one verified group disagree, the shown `providerUsage` is the most-recently-updated source's reading with its provenance visible, never a sum or average across sources.

### Transient detail envelope

```text
wear.detailPage.v1 = {
  schemaVersion,
  bindingId,
  requestId,
  publisherEpoch,
  revision,
  generatedAt,
  expiresAt,
  pageType,
  page: { total, included, nextCursor },
  items
}
```

`pageType` is initially `hostCatalog`, `hostAgents`, or `notificationInbox`. Host-agent items carry their exact opaque `workspaceId`, `workspaceKind`, `sessionTabId`, runtime `publicationEpoch`, and `snapshotVersion`; those fences are per workspace, never one pair per host. Responses are AEAD-protected, node-targeted `MessageClient` messages, capped at 32 KiB, held only in watch memory, and discarded on navigation, expiry, process death, binding change, or node loss. Needs-attention agents sort first, then live/most-recent activity, with opaque ID tie-breakers. Notification pages contain redacted session catch-up entries only.

### Action envelope

```text
wear.action.v1 = {
  schemaVersion,
  bindingId,
  requestId,
  expiresAt,
  action,
  target,
  publisherEpoch,
  expectedRevision,
  targetPublicationEpoch,
  targetSnapshotVersion,
  payload
}
```

The initial action enum is limited to:

- `readHostPage`: request another transient dashboard-compatible host page;
- `readHostAgents`: request one transient, paged agent list for a current host;
- `readNotificationsPage`: request one transient, redacted session-catch-up page;
- `openConversation`: request a recent structured-chat projection for one current session;
- `renewConversation`: extend the exact current conversation lease while its screen remains visible;
- `closeConversation`: stop that projection and clear transient content;
- `sendAgentMessage`: send one short text message to the exact current session;
- `requestPhoneHandoff`: ask the phone to open the exact current host/workspace/agent locally, via a phone-local notification deep link, for anything the watch itself can't or shouldn't do (see "Phone handoff" above);
- `refresh`: ask the phone to refresh its existing subscriptions.

No envelope may contain an arbitrary RPC method, and every action has a closed payload schema that rejects unknown fields. A language-neutral action manifest in `wear-companion-contract` is the sole authority for action discriminants, fields, limits, and canonicalization order; generation produces the TypeScript decoder and the narrow Kotlin admission validator used before JavaScript wakes. Every read request carries binding ID, publisher epoch, revision, collection/host identity, and opaque cursor; unavailable, stale, expired, and end-of-page are distinct retry-safe results. For mutation actions, the phone additionally validates the exact target workspace's runtime publication epoch and snapshot version. The journal key is `(bindingId, requestId)` and contains a canonical action hash, immutable target fences, state, and result—not message text. It rejects same-ID/different-input reuse, replays the same receipt for same-ID/same-input, and marks pending before host I/O. The host mutation ID is binding-namespaced. Local receipts live in the main runtime; SSH reservations/receipts live on the relay and are queried through the main runtime. Missing acknowledgement remains `unknown`, not a resend.

Admission limits are fixed contract constants, not user configuration: an encrypted action is at most 8 KiB, decoded `payload` is at most 4 KiB, every opaque ID/cursor is at most 256 UTF-8 bytes, and `sendAgentMessage` text is nonblank and at most 2 KiB UTF-8. One action executes per binding and one headless host-client acquisition executes process-wide. The native listener keeps at most eight pending entries per binding within the 64-entry global inbox, admits at most 30 read/lease actions per rolling minute with burst four, admits at most 10 sends per rolling minute with a two-second minimum gap, admits one refresh per ten seconds, and admits at most one `requestPhoneHandoff` per five seconds so a stuck watch screen cannot spam the phone with duplicate notifications. It authenticates, decrypts, checks schema/binding/expiry/size/rate/concurrency, and returns an encrypted `rejected` reason before waking JavaScript when a limit fails. Native coarse-window state prevents a JS restart from resetting admission. TypeScript, Kotlin, and runtime fixtures must prove byte-identical UTF-8 counting and boundary behavior; the runtime independently enforces the message ceiling.

The native action inbox uses an explicit crash-safe lifecycle: insert `pending`, atomically claim with a short claim deadline, let JS durably record the same hash/fences, then delete the ciphertext only after JS confirms journal handoff. A crash before the JS journal expires/requeues the claim only while the action itself remains valid; a crash after the journal write dedupes through that journal and deletes the native row without another host mutation. Native rejection is never inserted. Startup/service-entry GC deletes expired rows, successful handoff deletes claimed rows, and binding removal/uninstall clears the binding's rows and counters. These transitions are tested at every boundary so encrypted prompt text cannot linger or exhaust capacity.

Conversation capacity is also fixed: one active conversation lease per binding, four total in the phone process, and four per execution host or relay process. Opening another conversation for the same binding must cancel and receive teardown acknowledgement for the old lease before replacement; an unverified cancellation or a full process/host budget returns `rejected: busy` and creates no stream. Each remote lease is keyed to the authenticated phone, binding, publisher epoch, and lease ID and hard-expires no later than 120 seconds after its last valid renewal. While the phone process is alive, close, node loss, binding removal, and reconnect each attempt acknowledged remote cancellation. Before opening, the phone persists one closed cleanup record containing only `{ bindingId, phonePublisherEpoch, hostId, leaseId, expiresAt }`; it contains no workspace, session, agent, or transcript identity and is capped by the four-lease phone limit. On the next authenticated connection, restart reconciliation asks each reachable execution host/relay to cancel stale owner epochs and waits for acknowledgement before replacement; unreachable cleanup remains `rejected: busy` until server expiry. Cancellation acknowledgement or hard expiry deletes the record, and startup GC removes expired records. Process death cannot send a teardown callback, and restart cleanup never extends the original deadline.

## Product and interaction design

### Navigation

Three top-level screens, matching "who needs me, what are they doing, can I unblock them" directly rather than a generic dashboard-plus-drilldown shape:

1. **Attention (default screen):** companion state, stale timestamp, and every needs-attention agent ranked across every paired host — this also carries the redacted, session-scoped Orca event feed (the former standalone "Inbox"); selecting an event or agent opens the exact host/workspace when valid and selects an agent only when current inventory proves a unique match.
2. **Agents:** the full host catalog; selecting a host opens its agent list, and selecting an agent opens its detail route.
3. **Usage:** deduplicated, per-provider-account Claude/Codex usage across every paired host (see "Usage is deduplicated by provider account" above) — its own top-level screen, not folded under a per-host view, because "is a provider about to rate-limit" is a standalone job, not something the user should have to already be inside a specific host to check.

Detail routes, reached from Attention or Agents, not top-level themselves:

4. **Host:** account usage and agents for one host.
5. **Agent:** concise state and recent structured messages.
6. **Compose message:** system keyboard and system speech-to-text for a short message.
7. **Phone handoff:** an explicit action available from the Agent and Compose routes, not a screen of its own — see "Phone handoff" below.

Offline mode shows the encrypted dashboard's host/usage/count summary only. Agent identities, event rows, and conversations require the enrolled phone node to answer a transient read; the UI says "Phone unavailable" rather than presenting retained sensitive detail as current.

#### Phone handoff

"A fast phone handoff... escalate to the phone for anything larger" (Product framing) needs an actual mechanism, not just a product statement — it was missing from the action enum below. `requestPhoneHandoff` is a new fixed action, fenced to the exact current target (host/workspace/session identity, `targetPublicationEpoch`, `targetSnapshotVersion` — the same target fencing every other target-bound action already uses) so it can never open the wrong agent on the phone. On receipt, the phone's action executor does not attempt to silently foreground Orca mobile — Android does not generally allow a background process to bring another app's activity to the foreground without a user gesture. Instead it posts a phone-local, high-priority system notification (from the already-running phone process, not a new push mechanism) carrying a deep link that opens Orca mobile directly to that exact host/workspace/agent when tapped. Acceptance: a `requestPhoneHandoff` action against a live target produces exactly one phone-local notification, opening the exact target on tap, within a bounded latency budget set in Phase 0; a stale/superseded target is rejected the same way every other target-fenced action is, and the watch shows the outcome (`accepted`/`rejected`/`unknown`), never a silent no-op.

The minimum release does not add a Tile. A cached quick-status Tile is the first optional glance surface after the app passes freshness and battery gates; it performs no network work and only deep-links into the app.

### Visual contract

- Use React Native primitives, Expo Router, and small Wear-specific components. Do not import phone screen components, mobile Material components, the terminal WebView, or shadcn components.
- `wear/` defines its own token module (colors, spacing, radii, typography) inside the portable tree — it cannot cleanly import `mobile/src/theme/mobile-theme.ts` across an independent-workspace boundary (decision 2), and forcing that import would itself be the kind of cross-tree private-import/root-tooling assumption this plan avoids. Instead, `wear/`'s token *values* are contractually pinned to match `mobile-theme.ts`'s current values, enforced by a checked parity fixture test that lives in `mobile/` (the only tree that can see both) and fails on drift. This is not the same rule as literal reuse, but it produces the same outcome — one token source of truth, no independently invented palette — while keeping `wear/` extraction-ready. Keep both aligned with `docs/STYLEGUIDE.md` and the canonical CSS tokens in `src/renderer/src/assets/main.css`; do not invent new values in either file.
- Preserve Orca's quiet monochrome hierarchy. Color communicates state; it does not decorate.
- Use a dark-first black background, round-edge-safe layouts, visible scroll indication, hardware/software back, and swipe-to-dismiss only where the tested navigation implementation supports it correctly.
- Keep watch-only layout metrics beside the Wear components. They may adapt shared tokens to round screens but cannot invent colors, typography roles, or shadow tiers.

Design-system pass verification (2026-09-23): `mobile/src/theme/mobile-theme.ts` (73 lines — colors, spacing, radii, typography) is the correct, current incumbent token source. `docs/STYLEGUIDE.md`'s resolution order is unaffected — this plan does not define a competing token authority, only a second, contractually-pinned module holding the same values for a workspace that cannot import the first directly. The navigation model above (Attention/Agents/Usage top-level, Host/Agent/Compose as detail routes, plus the Phone handoff action) is round-watch-native rather than a shrunk phone IA: it is organized around attention/agents/usage/handoff directly, not around the phone's tab structure, and none of it imports `src/renderer/src/assets/main.css` or desktop CSS. The untracked `wear/` prototype (see the Phase 0 evidence re-verification above) is the concrete counter-example the parity-fixture requirement exists to prevent: `wear/src/wear-theme.ts` forks an unchecked `wearColors` palette with no relationship to `mobile-theme.ts` at all (one incidental shared value, `#a1a1a1`, does not make it a parity-checked contract) — cited here as evidence an unchecked second token file drifts, not as something this plan endorses or extends.

### Accessibility and device ergonomics

- Use React Native accessibility roles, labels, state descriptions, and semantic focus order without repeating visible labels; verify the resulting Android accessibility tree with TalkBack.
- Keep interactive targets at least 48 x 48 dp, respect system font scaling, keep essential text at least 12 sp, and keep nonessential text at least 10 sp.
- Make all essential scrolling and selection work with rotary input; validate the user's actual bezel/crown behavior.
- Test small-round 192 dp and large-round 227 dp profiles, every supported font scale, state restoration after process death, startup splash/icon/name quality, and the physical Samsung watch. The startup splash uses a 48 x 48 dp icon on black with no edge clipping.
- Use system speech recognition for dictation; do not capture or stream raw audio.
- Configure sensitive-preview redaction on the phone notification that Android bridges, then validate Samsung lock-state behavior. The React Native inbox follows the same redaction policy.

## Architecture alternatives

| Option                                        | Advantages                                                                                                                                           | Blocking costs and risks                                                                                                                                             | Decision                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Expo/React Native watch plus phone/Data Layer | Shares the maintained mobile language, dependency graph, contracts, projections, tokens, and tests; keeps narrow watch authority and phone transport | Expo has no documented first-class Wear target; native services/config remain; JS startup, memory, rotary, round navigation, background wake, and battery need proof | **Direction approved; feasibility unproven**            |
| Kotlin/Compose watch plus phone/Data Layer    | Google's supported Wear UI path, mature Wear components, predictable platform behavior                                                               | Duplicates the TypeScript product layer and design-token mapping; increases two-stack maintenance                                                                    | **Fallback only if Phase 0 fails and Dhiman approves** |
| Direct Expo/React Native watch client         | Reuses TypeScript transport/crypto and supports independent foreground operation                                                                     | New Wear grant/allowlist, no-phone pairing, Hermes/runtime conformance, secure storage, mixed-version suite, FCM-class push work, and — demonstrated by the incumbent `wear/` prototype — real risk of shipping full `mobile`-scope runtime authority onto the watch without a server-side allowlist | **Rejected for this plan (decision 10)**               |
| Full phone UI or terminal port                | Feature breadth                                                                                                                                      | Violates glanceable interaction, cannot reuse the WebView terminal on Wear, and grants unnecessary authority                                                         | **Rejected**                                           |

The direct approach is out of scope for this plan (decision 10), not a fallback to reach for if the companion path stalls. If the companion path ever fails its feasibility gates and phone-independent operation is genuinely required, that is a new, separately proposed and reviewed initiative — not a change to this document.

"Direction approved; feasibility unproven" does not override this document's overall **Pending approval** status (header table) or any open decision-register row — it means only that, among the architecture options compared, this is the one worth spending Phase 0 evidence-gathering effort on. Two different gates apply at two different times, and neither substitutes for the other: **Phase 0 authorization** is Dhiman saying "go spend the effort to find out" — it does not require tests, physical-device evidence, or any of Phase 0's own deliverables to already exist, because producing that evidence is what Phase 0 is for. **The release gates** (decisions 2/3/4/6/8/9/10/11, the Phase 0-3 exit gates, and the Definition of Done) are the full evidence-backed bar that must pass, with every required item proved, tested, or explicitly named as a still-open gap, before product code ships. A label of "approved" anywhere in this document binds only the gate it is attached to — an approved direction does not imply approved evidence, and approved evidence for one phase does not imply the next phase's gate is pre-cleared.

## Research findings

### Industry patterns

- Google recommends Compose for Wear OS and watch-specific components, with short, glanceable interactions rather than shrinking a phone app. This plan knowingly chooses the mobile Expo/React Native stack for shared maintenance and makes platform-quality evidence a release gate rather than claiming framework parity.
- Expo documents Android, Apple, and web platform integration plus custom native modules, but does not document Wear OS as a separate supported target. Expo's monorepo and standalone-module flows can share TypeScript and Kotlin modules across two apps; they do not prove that a Wear UI is acceptable.
- Data Layer is a multi-node phone/watch network. It requires matching package names and installed-app signatures, but those facts authenticate the app family rather than the user's selected companion. `DataClient` is persistent, limited to 100 KB per item, and eventually synchronized; `MessageClient` is connected-only and best-effort with no built-in retry.
- Phone notifications bridge to the watch by default. Independent phone and watch producers create duplicates unless bridging/dismissal ownership is explicitly coordinated.
- Watch Wi-Fi/LTE networking has very high battery impact. Long-lived background sockets are not an acceptable push strategy; deferred work belongs in WorkManager and independent push belongs in FCM-class infrastructure.
- Wear builds are separate targeted artifacts even when they share a Play listing and package identity with the phone app. Play accepts an AAB on the Wear OS track and generates/signs installed APKs; the upload key is not necessarily the app-signing key.
- Android Keystore supports non-exportable ECDH key agreement through `PURPOSE_AGREE_KEY` only from API 31. The minimum therefore requires API 31 on the companion phone and the first real watch release above that floor, Wear OS 4/API 33, instead of inventing a weaker compatibility branch.

### Ecosystem and tools

- UI and product logic: `wear/`'s pinned Expo SDK, React Native, React, Expo Router, TypeScript, Vitest, oxlint, and oxfmt versions, version-parity-checked against `mobile/`'s (decision 2) rather than sharing its lockfile. `wear/pnpm-workspace.yaml` already declares itself as a self-contained single-package workspace (`packages: [.]`) — Phase 0 adds `wear/packages/expo-wear-data-layer` and `wear/packages/wear-companion-contract` as members of *that* workspace, not `mobile/`'s. `mobile/` gains a dependency edge into `wear/packages/wear-companion-contract` and `wear/packages/expo-wear-data-layer` (a `link:`-style reference across the two independent workspaces, not a shared lockfile entry) so the phone app can consume the same generated contract and the same Data Layer module in its `role: 'phone'` config. The root `pnpm-workspace.yaml`'s existing `packages: []` isolation (already in place to keep `mobile/` out of the root graph) is unchanged; `mobile/packages/expo-two-way-audio` is unaffected.
- Phone/watch transport: Google Play Services Wearable Data Layer through one shared standalone Expo Android module that survives clean prebuild for both apps.
- Local state: React Native reads and writes the sensitive-minimized dashboard through the native module's app-private, no-backup, expiring store. Room is not added unless profiling proves a structured cache is required.
- Verification: Vitest and React Native renderer tests for shared/watch TypeScript, Kotlin unit/instrumentation tests for native boundaries, Wear emulators, the physical Samsung device, TalkBack, rotary input, Android Studio Power Profiler, Perfetto/Battery Historian, and Play closed-track pre-launch reports.

### Risks and pitfalls

- Installed-APK signing mismatch can make Data Layer fail even when both apps install successfully; a GitHub-sideloaded phone and Play-installed watch are a specific risk.
- Package/signature and Data Layer node identity do not authorize one selected companion. An app-level enrolled binding is required before state or commands flow.
- Expo-generated Android code is disposable; both apps' integration must live in the shared Expo module and its config plugin.
- Sharing the language does not make phone UI watch-safe. All watch screens, list virtualization, navigation transitions, back behavior, rotary events, keyboard/dictation, startup, and memory ceilings require watch-specific implementation and physical evidence.
- Phone JS and sockets may be suspended. A native listener waking the process does not prove that Expo JS and Orca's React-owned clients are ready. The minimum command experience is viable only if Gate 0 proves a concrete cold-process/headless owner across foreground, background, screen-off, and Doze states. A force-stopped app must fail unavailable without queuing a later mutation.
- A `WearableListenerService` does not register a React Native Headless JS task by itself. The custom app entry, `AppRegistry.registerHeadlessTask`, native `HeadlessJsTaskService`, and manifest service must all survive clean Expo prebuild and cold-start testing.
- `MessageClient` is not a durable queue. Missing acknowledgements become `unknown`, not an automatic retry.
- A broad `mobile` credential on the watch would turn a small UI compromise into file, Git, browser, and terminal authority.
- Old hosts can publish incomplete session inventories. Absence is not closure without the authoritative-inventory capability.
- Direct and bridged notifications can duplicate. The minimum has exactly one notification producer: the phone.
- Sensitive prompt text can leak through logs, Data Items, lock-screen previews, backups, or crash reports unless explicitly excluded.
- Phone-owned Data Items can outlive watch uninstall and repopulate a reinstall; companion removal and rollback must delete them explicitly.
- A disconnected SSH execution host is unverifiable, not dead.
- SSH relay installs are content-versioned and old/new processes can overlap. Native-chat receipt state cannot live inside a versioned install or rely on one process's mutex; initial-channel identity and capabilities also cannot be inferred from process reachability.
- Wear OS 7 corresponds to Android 17/API 37 per `developer.android.com/training/wearables/versions/7/changes`; its GA/preview release status is not established by that page and is not asserted by this document (a prior "GA" claim here was withdrawn after a direct re-fetch found no such wording on the cited source). It is not a minimum dependency at the approved API 33 floor either way, and Samsung upgrade eligibility plus the watch's actual installed version remain unconfirmed until Phase 0 reads Settings → About.

### Community sentiment

Not assessed. Technical research was deliberately limited to repository evidence and primary platform/manufacturer sources, so no community claim is used to justify the architecture.

### Recommendations

1. Prove signing, Data Layer wake/freshness, notification ownership, and idle battery on the physical watch before building product UI.
2. Ship read-only status first, then bounded commands on the same narrow contract.
3. Keep the minimum runtime delta to post-auth mobile capability negotiation and the narrow execution-host-routed native-chat read/subscribe/send/receipt surface; do not add a presentation-specific aggregate RPC without payload/radio evidence.
4. Treat phone-independent direct operation and killed-process push as one security/product expansion, not incidental polish.
5. Measure payload/radio cost before adding `wear.summary` or a new runtime stream; the phone can cheaply project existing subscriptions.

### Sources and evidence strength

Admiralty codes use source reliability/content credibility: `A1` is authoritative and directly verified; `A2` is authoritative but preview or time-sensitive; `B2` is a first-party manufacturer/library source with product or provenance caveats.

- A1 — Orca source files and tests cited in this plan; direct repository evidence at fork-base commit `4065d053cf942c1879379ebd8f1b50dda5568ff8`.
- A1 — [Compose for Wear OS](https://developer.android.com/training/wearables/compose), [Wear design principles](https://developer.android.com/training/wearables/principles), and [Wear accessibility](https://developer.android.com/training/wearables/accessibility).
- A1 — [Data Layer overview](https://developer.android.com/training/wearables/data/overview), [Data Items and the 100 KB limit](https://developer.android.com/training/wearables/data/data-items), [Data Layer client types](https://developer.android.com/training/wearables/data/client-types), and [Wear authentication](https://developer.android.com/training/wearables/apps/auth-wear).
- A1 — [Android Keystore ECDH example](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec), [`PURPOSE_AGREE_KEY` API floor](https://developer.android.com/reference/android/security/keystore/KeyProperties#PURPOSE_AGREE_KEY), and [Wear OS 4/API 33 platform mapping](https://developer.android.com/training/wearables/versions/4/changes).
- A1 — [Wear notification bridging](https://developer.android.com/training/wearables/notifications/bridger), [network communication](https://developer.android.com/training/wearables/data/network-communication), and [power guidance](https://developer.android.com/training/wearables/apps/power).
- A1 — [React Native Headless JS on Android](https://reactnative.dev/docs/headless-js-android), including native task-service and JavaScript registration requirements.
- A1 — [Expo monorepo support](https://docs.expo.dev/guides/monorepos/), [Expo autolinking and duplicate verification](https://docs.expo.dev/modules/autolinking/), [standalone Expo modules](https://docs.expo.dev/modules/use-standalone-expo-module-in-your-project/), [Expo Modules API](https://docs.expo.dev/modules/get-started/), and [Expo config-plugin mods](https://docs.expo.dev/config-plugins/mods/). These support the shared-workspace/native-boundary design; they do not advertise Wear OS as a first-class Expo target.
- A1 — [React Native native-platform integration](https://reactnative.dev/docs/native-platform) for the Kotlin boundary exposed to shared TypeScript.
- A1 — [Wear packaging](https://developer.android.com/training/wearables/packaging), [Android App Bundles](https://developer.android.com/guide/app-bundle), [Android app signing](https://developer.android.com/studio/publish/app-signing), [Play target API policy](https://developer.android.com/google/play/requirements/target-sdk), and [Wear app quality](https://developer.android.com/docs/quality-guidelines/wear-app-quality).
- A1 — [Dedicated Play form-factor tracks](https://support.google.com/googleplay/android-developer/answer/13295490) and [Wear OS 64-bit requirement](https://developer.android.com/blog/posts/get-your-wear-os-apps-ready-for-the-64-bit-requirement).
- A2 — [Wear OS 7 behavior changes](https://developer.android.com/training/wearables/versions/7/changes); confirms the Android 17/API 37 mapping only. A prior pass of this document reclassified this source to A1 and added a general-availability claim and a "2026-06-16" ship date; a direct re-fetch on 2026-09-23 found neither a date nor GA wording on this page, so both claims are withdrawn and the source stays A2 (official but preview/version-mapping guidance, not confirmed release status). Not a minimum dependency — decision 8's API 33 floor still governs — but the device confirmed in Phase 0 may already be on Wear OS 7.
- A2 — [Android developer verification](https://developer.android.com/developer-verification); authoritative, time-sensitive release policy.
- B2 — [Samsung Galaxy Watch8 specifications](https://news.samsung.com/global/samsung-galaxy-watch8-series-ultra-comfort-from-sleep-to-workout); manufacturer-primary, with model/market variation requiring on-device confirmation.

## Security and privacy model

### Trust boundaries

1. Orca runtime to Android phone: existing per-device token, pinned desktop key, direct/relay E2EE, and runtime scope enforcement.
2. Android phone application: owns host credentials, validates watch actions, projects least data, and journals mutations.
3. Wear Data Layer: same-package/same-signature phone/watch transport that may traverse Google's infrastructure.
4. Watch process and storage: displays sensitive agent content on a wearable and keeps only a bounded, sensitive-minimized, locally expiring cache.

### Threat controls

| Threat                                          | Required control                                                                                                                                                                    | Verification                                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Watch compromise gains broad runtime authority  | No runtime credential on watch; fixed action enum; no arbitrary RPC forwarding                                                                                                      | Static contract test rejects unknown action/method fields; secret scan of Data Layer payload fixtures |
| Replayed/duplicated send                        | Unique request ID, expected revision, durable pending-before-send journal, no automatic mutation retry                                                                              | Crash-before/after-send tests yield one send or `unknown`, never two sends                            |
| Stale target sends to the wrong agent           | Validate host/session/terminal mapping against current phone inventory and expected revision                                                                                        | Target-change/reconnect tests reject stale commands                                                   |
| Lost acknowledgement hides a possible mutation  | Preserve accepted/rejected/unknown and require user verification before manual resend                                                                                               | Network-cut tests at each write/ack boundary                                                          |
| Forged/wrong companion or watch                 | User-confirmed install binding, Keystore-held AES key, AEAD envelopes, namespaced ciphertext paths; node ID is transport evidence only                                              | Mismatched signature, wrong key/binding, multiple-node confidentiality, rebind, and removal tests     |
| Unproved or replaced SSH relay accepts chat     | One-use primary-channel proof or existing reconnect credential; capability state keyed to target and connection incarnation; reject `unproved`, missing, malformed, or stale state  | Initial/reconnect/unproved negatives and old/new relay replacement tests                              |
| Enrolled watch drains battery or floods actions | Native reject-before-JS byte/rate/concurrency limits; one process-wide headless acquisition; fixed conversation lease/stream caps; runtime message-size and receipt-capacity checks | Boundary, rolling-window, concurrent-binding/lease, restart, and sustained-flood tests                |
| Sensitive transcript persists                   | Crash-safe native inbox deletion; selected-conversation projection only; 20-message/32-KiB cap; phone-enforced lease expiry; no transcript in Data Item, DataStore, or Tile         | Inbox handoff/GC, drop-close, node-loss, restart, backup, reinstall, and lease-expiry inspection      |
| Lock-screen disclosure                          | Minimal/redacted notification preview and device-lock checks before transcript display                                                                                              | Locked-watch notification and conversation tests on Samsung device                                    |
| Secret/content logging                          | Structured redacted logs; no tokens, prompts, transcripts, or Data Item bodies in analytics/crash logs                                                                              | Log capture and automated secret/content assertions                                                   |
| Google transport/data-processing expansion      | Minimize payload, document Data Layer use in privacy/data-safety records, and do not add a new Orca backend                                                                         | Privacy review against final schemas and Play disclosures                                             |
| False remote-process verdict                    | Preserve `live` / `unverifiable` / `exited` exactly; no status inference from contact loss                                                                                          | SSH disconnect and relay-loss contract tests                                                          |

The minimum release adds no Orca cloud processor and sends no runtime credential through Google Data Layer. It does send bounded state and user-requested message content between the user's paired phone and watch; the final schema and retention behavior therefore require privacy review.

## Implementation phases

The minimum product is complete only after Phases 0-3; there is no Phase 4 in this plan (see decision 10 and "Direct foreground client: removed from this plan").

### Phase 0: decisions and authorized feasibility spike

Complexity: **medium**

Depends on: Phase 0A has no code/dependency authorization; Phase 0B requires explicit spike authorization after Phase 0A

#### Gate 0A — no-code/read-only decisions

1. Confirm the physical device model, Wear OS build/API, screen geometry, connectivity variant, rotary behavior, companion-phone API, and Google Play Services availability. The initial watch build contract is JDK 17, `minSdk 33`, `compileSdk 36`, `targetSdk 36`, required `android.hardware.type.watch`, and `com.google.android.wearable.standalone=false`; the companion feature requires phone API 31. Record any evidence-backed change in the decision register before product code.
2. Inspect the current downloadable Android APK certificate, Play/package ownership, and mobile build workflow. Freeze the spike to mobile's then-current Expo/React Native/React/TypeScript versions, select exact AGP/Kotlin/Google Play Services Wearable versions produced or required by that Expo SDK, and review licenses, provenance, New Architecture support, API/ABI floors, and Expo prebuild behavior. Record the proposed AAB/track, app-signing ownership, disjoint version-code range, dependency set, and explicit Phase 0B scope; obtain Dhiman's spike authorization.

#### Spike evidence log — 2026-09-23 (Dhiman-authorized after a47bb39e6)

Dhiman authorized this isolated feasibility spike. This log records what was actually executed against the real toolchain/codebase — commands, exit codes, and results — not another plan rewrite. No product code was written; no real agent session, paired device, or user workload was touched. **Correction to an earlier version of this log:** it previously claimed `wear/` source files were "verified unmodified by mtime" — that is not a real verification; no reliable per-file baseline (checksums recorded before this pass, compared after) was ever established, and an mtime spot-check is not a substitute for one. No preservation claim for `wear/`'s contents is made here one way or the other. What is directly known: this pass's own edits only ever wrote to files outside the repository (isolated temp copies, this worker's scratchpad) except for one in-place Gradle build in an earlier session of this spike, whose generated `app/build`, `android/build`, `app/.cxx`, and `.gradle` output directories were subsequently deleted — and per this task's explicit instruction, no further deletion of source or caches was performed in this pass.

**Environment discovery.** JDK 17.0.20 (Microsoft build) at `C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot`; Android SDK at `%LOCALAPPDATA%\OrcaDevTools\AndroidSdk` with platforms `android-31/33/36` and build-tools `35.0.0`/`36.0.0` installed; `adb` 1.0.41 present. `adb devices -l` returned an empty device list both at spike start and re-checked at the end — **no physical device or emulator was connected during that initial pass**. Seven pre-configured AVDs exist (`orca_phone_api31_e2e`, `orca_phone_api31_play`, `orca_phone_api36_e2e`, `orca_wear4_large_round`, `orca_wear4_small_round`, `orca_wear6_large_round`, `orca_wear6_small_round`) but none were booted — emulator pairing was outside that initial static pass; the later authorized continuation below completed it.

**Structured agent-session RPC audit (decision 11 prerequisite).** Traced the actual read/send surface for structured sessions, not just the inventory filter:

- `agentSession.send`, `.history`, `.subscribe`, `.unsubscribe` (`src/main/runtime/rpc/methods/structured-agent-session.ts:108-230`) are the real structured-session read/send RPC methods — a separate surface from `nativeChat.*`, not an extension of it.
- `MOBILE_RPC_METHOD_ALLOWLIST` (`src/main/runtime/runtime-rpc.ts:200-260`) contains `nativeChat.readSession`, `.subscribe`, `.unsubscribe` (terminal/PTY-transcript only, no send method yet) and **no `agentSession.*` entry at all**. Confirmed with an isolated static probe (reproduce: `node -e` script parsing the allowlist literal from `runtime-rpc.ts`, asserting `agentSession.` absent and the three `nativeChat.*` entries present) — exit code 0, assertion `PASS`.
- `projectStructuredItemToNativeChat`/`projectStructuredItemsToNativeChat` (`src/shared/structured-agent-session-projection.ts:82-107`) are called only from `src/renderer/src/components/native-chat/structured-agent-session-message-projection.ts` — a desktop **renderer-side presentation helper**, not a main-process RPC method. It cannot be reused to expose structured content over `nativeChat.*` to a remote client.
- Structured session records do carry `executionHostId` (`src/shared/agent-session-record.ts:26`), so local/SSH/paired-runtime host identity already exists in the data model.

**Conclusion, correcting the plan's decision 11 scope:** reaching structured-session messaging parity is not "extend a filter" — it requires building an entirely new mobile-allowlisted `agentSession.*`-equivalent read/subscribe/send RPC surface that does not exist for any non-desktop client today. This is a materially larger Phase 1/2 item than previously scoped and is recorded as such in the decision register below.

**Existing test exercise (no new product tests added, existing suite run narrowly, not the full repo).** All commands used `vitest run --config config/vitest.config.ts <file>` from the repo root:

| Files | Tests | Result | Duration |
| --- | --- | --- | --- |
| `session-tab-agent-status-projection.test.ts` | 5 | 5 passed | 377ms |
| `runtime-rpc-request-authorization.test.ts` | 9 | 9 passed | 23.4s |
| `native-chat.test.ts` + `structured-agent-session.test.ts` | 47 | 47 passed | 6.7s |

`config/scripts/ensure-native-runtime.mjs` (the repo's usual `pnpm test` prerequisite) failed rebuilding an unrelated native module (`@vscode/windows-process-tree`, a pre-existing environment gap unrelated to this feature); vitest was invoked directly instead since these are pure TypeScript unit tests with no native-module dependency.

**Package/signing/build-config inspection (public certificate fingerprints only — no private key material read).** `keytool -list -v` against both `mobile/android/app/debug.keystore` and `wear/android/app/debug.keystore` (password `android`, the conventional debug-keystore password) both report identical SHA-256 `FA:C6:...:9C`. **Correction to an earlier version of this log:** that identical fingerprint is a real, specific fact, but this log previously explained it as "the universal AGP default debug key present on every developer machine" — that explanation is false. The Android Gradle Plugin auto-generates a debug keystore per machine/checkout when none exists; it does not embed one fixed, globally-shared key pair, so two distinct keystores matching byte-for-byte is not an expected default. The actual mechanism producing an identical key across these two specific keystores in this checkout — a shared dev-tooling provisioning step, one keystore copied to seed the other, or something else — was not investigated and is **unverified**; it should not be read as either "meaningless" or "meaningful" pairing evidence without that investigation. `mobile/android/app/build.gradle:98,100` confirms `applicationId 'com.stably.orca.mobile'`; `wear/android/app/build.gradle:90,92` confirms `applicationId 'com.dhi13man.orcawear'` — package identities remain mismatched exactly as the earlier evidence re-verification found, independent of the debug-key question. `wear/android/app/src/main/AndroidManifest.xml:17` confirms `standalone=true` (plan requires `false`). `wear/android/gradle.properties:63-65` confirms `minSdkVersion=33`, `compileSdkVersion=36`, `targetSdkVersion=36` — this specific SDK floor already matches the plan's Gate 0A build contract, a genuine positive finding independent of the rejected architecture. No real release/Play signing certificate exists anywhere in this checkout (correctly — one should never be committed); that comparison remains unavailable until a real signed build exists.

**Toolchain build probe (Expo/RN/Gradle compile feasibility only — not companion/Data Layer/headless proof, not a device test).** Copied `wear/` into an isolated temp directory (not the preserved prototype), ran `pnpm install --frozen-lockfile` (629 packages, 8.7s) there, then `./gradlew.bat assembleDebug --offline` with a direct, non-piped exit-status capture: `REAL_GRADLE_EXIT_STATUS=0`. Produced a real signed `app-debug.apk` (135,744,237 bytes), independently verified with `apksigner verify --print-certs` (SHA-256 matches the debug keystore above) and `aapt2 dump badging` (`com.dhi13man.orcawear`, versionCode 1, minSdk 33, targetSdk 36). **Scope correction:** this proves only that JDK 17 + this Android SDK + AGP + Kotlin 2.1.20 + the pinned Expo modules can compile and package the *incumbent, rejected prototype's* specific source into an installable APK on this machine — toolchain portability for that one codebase, nothing more. It is not evidence for the future, not-yet-built companion architecture (different transport, different package identity, different theme, per the earlier evidence re-verification), it says nothing about the rejected prototype's architecture being acceptable, and it says nothing about on-device startup, Data Layer pairing, or Headless JS wake, all of which remain unverified by this item. (An initial in-place run of this same command inside the real `wear/android` was corrected after coordinator review: its generated `app/build`, `android/build`, `app/.cxx`, and `.gradle` output were deleted to restore that directory's build state, and the probe was re-run from the isolated copy with a properly captured exit status.)

**Windows durable-write probe — re-scoped, not crash safety.** `src/main/durable-file-write.ts:11-13,17-20` documents and its `syncDirectory`/`syncDirectorySync` functions confirm in code that Windows cannot fsync a directory handle; the catch block explicitly treats that as expected. Wrote an isolated Node script (scratch temp directory only, no repo or user data touched) that **reimplements** the documented write-tmp/fsync/rename/best-effort-dirsync sequence — not the production module itself — and calls `process.exit(137)` at three boundaries between steps, then inspects the destination file from the parent. **Correction to an earlier version of this log:** this was previously reported as "Tested" evidence for "process-kill mid-sequence does not corrupt the destination," a production-safety claim. That overstates it on two counts: (1) the probe exercises a hand-written model of the algorithm, not `durable-file-write.ts` itself, so it says nothing about the production code's actual behavior, only about whether the *documented sequence* is sound in principle; (2) `process.exit()` is Node's own orderly, voluntary termination call, not a forced kill or crash — it does not interrupt a syscall mid-flight or model process death the way `SIGKILL`/a real crash would. What the probe actually showed, honestly scoped: across three orderly self-exits at the modeled sequence's step boundaries, the destination file was always either the prior complete content or the new complete content, never partial — evidence that the *documented algorithm*, as modeled, degrades safely at clean step boundaries. It is not evidence about the production module, not evidence about a true process kill, and nowhere close to the power-cut evidence decision 9 actually requires (a genuine power cut can lose data the OS believed was durable but the disk had not yet persisted, which this probe cannot simulate at all). Decision 9 remains fully open; this probe does not close any part of it.

**Extraction-boundary isolated fixture (JS/TS layer).** Copied only `wear/` (stripped of `node_modules`/build caches) into an empty temp directory with no sibling directories present, then ran, all from that isolated copy: `pnpm install --frozen-lockfile` (629 packages, 12.8s) → `pnpm run typecheck` (`tsc --noEmit`, clean, no errors) → `pnpm run test` (`vitest run`, 3 files, 11 tests, all passed, 302ms) → `pnpm run lint` (`oxlint`, clean). This is real, direct evidence for the "Extraction-ready architecture" section's standalone-build claim at the JS/TS layer. The Android/Gradle side was not independently re-extracted for this check since it is identical source already proven buildable above; a full paired-build extraction smoke test (decision-register item, requires a real phone counterpart) remains a later, separate prerequisite.

**Emulator transport and actual Headless JS verification (2026-09-23).** The authorized continuation paired isolated `orca_spike_phone31_codex` (Google Play API 31, node `83e728ef`) and `orca_spike_wear4_codex` (Wear OS 4/API 33, node `301e868c`) through Android Studio's normal Pair Wearable flow. The existing official Pixel Watch APK was copied from an original AVD opened read-only, without app data or account access. Nearby devices permission and a fresh Studio setup recovered a companion-app state crash; Data Layer connected before sign-in. No protected-component denial was bypassed and no account was added. Earlier claims that absent Studio or CLI-only access made emulator pairing impossible are withdrawn: Studio was installed and controlled through the available desktop tooling. The original phone-launch failure remains an unreproduced observation, not a proven multidex defect.

The probe now shares native sender/listener code between phone and watch, sends unique request IDs, correlates acknowledgements to both ID and peer, and keeps a bounded 32-ID process-local replay window. A separate Expo 55.0.27 / React Native 0.83.9 phone release build registers `OrcaCompanionPing`; its native listener starts `HeadlessJsTaskService`, JavaScript calls `CompanionProbe.reply`, and the watch receives the correlated PONG. This ran with bundled JavaScript, without Metro or a foreground service. A clean Expo Android prebuild, test-key copy, and release rebuild also passed; Expo's recommended RN patch is 0.83.6, while 0.83.9 matches the selected mobile dependency and was the version executed.

Commands and reproducible setup are in [the spike README](../spikes/wear-companion/README.md); [the retained receipt](../spikes/wear-companion/evidence/2026-09-23.json) contains APK hashes, request/peer IDs, endpoint log excerpts, and process transitions. Local full logs and command exit codes remain under `spikes/wear-companion/build/codex-run/`. Native `:phone:assembleDebug :watch:assembleDebug :watch:testDebugUnitTest`, clean headless `:app:assembleRelease`, and both final `verify_transport.py` modes exited 0. Five local JVM tests passed; these are separate from real cross-device evidence.

| Gate | Observed result |
| --- | --- |
| Native Data Layer exchange | Both directions acknowledged, with matching receiver and sender logs |
| Distinct IDs and nonadjacent replay | Native duplicate recognized and re-acknowledged; headless JavaScript invoked again, with no business mutation |
| Phone background and process death | Both variants acknowledged; after `am crash`, PID absent and `stopped=false` were checked before a new process received the message; the headless process entered and completed JavaScript |
| Forced Doze | `mState=IDLE` verified before send; both variants acknowledged |
| Force-stop | `stopped=true` verified before send; both variants nevertheless woke and acknowledged, clearing the flag on this emulator/Play Services combination |
| Missing acknowledgement | Deliberately unhandled path timed out after 10 seconds; the next valid-path request acknowledged in both variants |
| Disconnect/reconnect | Watch shutdown caused `TARGET_NODE_NOT_CONNECTED`, then zero nodes; restart restored the same watch node and a correlated PONG |
| Same test package/signature | All three APKs use `com.orcaspike.companion` and the same throwaway debug certificate; generated headless listener/task registration survived clean prebuild |
| Local replay-window logic | Five JVM tests passed, including nonadjacent replay and eviction |
| Physical Samsung, newer phone APIs, battery/latency, release signing | Not tested; emulator receipts do not close these release gates |
| Product binding, durable inbox/journal, socket ownership, real actions | Not implemented or tested by this credential-free probe |

Force-stop delivery is an observation, not a supported product promise or evidence that Android will always permit background work. The planned product must handle denial, expiry, and unknown outcomes; the emulator result also means force-stop alone cannot be used as a deterministic no-delivery oracle. Native replay detection is volatile and bounded; headless replay executes JavaScript again. Neither proves durable exactly-once action handling.

Earlier static/build evidence above remains limited to its stated scope: the 61 existing tests, structured-session RPC audit, incumbent-prototype extraction/build checks, debug-certificate inspection, and modeled durable-write sanity check do not establish the missing product properties. No Phase 1 implementation, release/Play key change, public extraction, or license decision is authorized by these results.

#### Gate 0B — isolated, explicitly authorized spike

Gate 0B runs on an isolated feasibility branch and ships nothing. Artifacts are classified before work starts:

- **Throwaway:** spike bindings/keys/Data Items, signing artifacts, prototype screens, benchmark captures, and any shortcut used only to answer feasibility.
- **Promotable on pass:** mobile-workspace wiring, stack/autolinking gates, the generated contract pipeline, shared Expo module, process-level host owner, background lease, and journal scaffolding, but only when each meets normal source/test/review standards.

No promotable artifact enters the product branch until every Phase 0 decision-register row required by Phase 1 is closed. Promotion is a reviewed Phase 1 change, not evidence that the spike itself is production-ready.

1. Set `wear/pnpm-workspace.yaml` members to exactly `.`, `packages/expo-wear-data-layer`, and `packages/wear-companion-contract` inside `wear/`'s own already-independent workspace; do not add these to `mobile/pnpm-workspace.yaml` or the repository-root workspace. `mobile/` depends on `wear/packages/expo-wear-data-layer` and `wear/packages/wear-companion-contract` through a relative `link:`-style dependency, not `workspace:*` (the two apps are not in one pnpm workspace); each side installs frozen from its own lockfile. Add an automated `mobile/scripts/check-wear-stack-parity.mjs` gate that reads both `mobile/package.json` and `wear/package.json` and rejects drift in Expo, React Native, React, TypeScript, Vitest, oxlint, and oxfmt versions between phone and watch. Run Expo Doctor and Expo autolinking verification from both app roots, then assert one resolved copy and peer context for React, React Native, Expo Modules Core, Expo Router, screens, gesture handler, Reanimated, Worklets, and the Wear native module within each workspace. Duplicate native modules or differing module paths fail the gate.
2. Create one standalone `wear/packages/expo-wear-data-layer/` module used by both Expo apps. Both app configs explicitly invoke its plugin as `['@orca/expo-wear-data-layer', { role: 'phone' }]` or `['@orca/expo-wear-data-layer', { role: 'watch' }]`; prebuild fails when the role is absent. The plugin owns role-specific manifest integration: only the phone gets `WearHeadlessActionService`, each artifact gets only its required filtered Data Layer listeners, and only the watch gets watch hardware and standalone metadata. Snapshot both generated manifests after clean prebuild. Prove same-package/same-installed-signature Data Layer round trips and both manifest contracts, then generate, build, and launch the candidate internal Wear APK/AAB; compare its installed certificate with the phone and Play-generated APK, and inspect every native dependency/ABI for 64-bit compliance. Finalize the signing, release, toolchain, dependency, and SBOM rows before Phase 1.
3. Implement and threat-test `wear.binding.v1`: one-time Keystore P-256 enrollment keys, public-key/nonce fingerprint confirmation on both screens, ECDH/HKDF bootstrap, node-targeted wrapped binding key, deletion of enrollment keys, AES-GCM envelopes with unique nonces/AAD, namespaced ciphertext paths, removal tombstone, rebind, node migration, and multiple-phone/watch confidentiality/isolation. Implement the durable 24-hour removal deadline and idempotent acknowledgement/deadline/startup cleanup before storing product data. Prove immediate non-tombstone deletion plus terminal deletion of tombstone, key, inbox state, and binding for acknowledgement, never-acknowledged offline/uninstalled watches, phone death before deadline, late acknowledgement, and reinstall without stale repopulation. A package signature or reachable node alone never authorizes data or commands.
4. Prove the command process owner, actual Headless JS startup, inbox lifecycle, and admission limits. Extract the host-client registry from React refs into one process-level owner used by both `RpcClientProvider` and headless entrypoints. Add a custom phone entry that registers the Wear task with `AppRegistry.registerHeadlessTask` before importing Expo Router, plus a native `HeadlessJsTaskService` declared by the shared module. Choose and test one explicit foreground-delivery contract: either allow the non-UI headless task in foreground or route foreground events directly to the same process owner. Add a deadline-bound, user-initiated background acquisition lease to the endpoint supervisor: reuse an existing UI socket, allow one explicit cold/background connection, then release/close it when no UI or action owner remains. The native listener authenticates and bounds an action before wake, then stores only authenticated ciphertext in the eight-per-binding/64-global inbox; JS atomically claims it, durably writes `(bindingId, requestId, canonicalHash, state)`, confirms handoff, and causes native deletion. Never drain a 30-second-expired action. Test task registration after clean prebuild, every insert/claim/journal/delete crash boundary, startup/expiry/binding-removal GC, size/rate/concurrency rejection, arrival while foreground, UI open/close races, cold start on the API 31 phone floor, background, screen-off, Doze, duplicate-socket prevention, lease release, full/corrupt inbox, and force-stop as unavailable/no queued mutation. If target-SDK behavior requires a foreground service or ongoing notification for this path, the minimum command gate fails.
5. Prove the React Native Wear shell on Wear API 33 before Phase 1, 192-dp and 227-dp round emulators, and the physical watch: cold/warm launch, Expo Router transitions, hardware/software back, swipe-to-dismiss where used, rotary scrolling/selection, system keyboard and dictation, TalkBack tree/focus, every supported font scale, process restoration, peak memory, and JS/UI frame behavior. A native rotary adapter is allowed only if this test demonstrates the need.
6. Measure Data Layer freshness/acknowledgement and notification bridge/dismissal/ongoing behavior, then capture idle/interactive power for both devices, including listener wakeups, publication rate, CPU, jobs, radio/network, screen-off work, React Native cold start, and swipe-dismiss. As part of this measurement, size and record the fair background host-recovery rotation from Phase 1 step 5: pick and justify a concrete maximum-staleness-per-host bound and a maximum missed-event-to-watch window against the measured battery/radio cost, so no catalogued host can silently starve past a named, evidence-backed ceiling. If no such rotation fits the battery budget, record that as a gate failure with the numbers that show it, not as an assumption. Performance and power evidence uses a minified release Hermes APK generated by clean prebuild, with no Metro or development client; retain a debuggable build only for functional diagnosis. Archive the build variant, JS engine, native dependency set, and bundle evidence with the budgets. Require zero unexpected idle work.

Expected new files:

- `wear/package.json`
- `wear/app.json`
- `wear/index.ts`
- `wear/tsconfig.json`
- `wear/metro.config.js`
- `wear/vitest.config.ts`
- `wear/app/_layout.tsx`
- `wear/app/index.tsx`
- `wear/src/binding/companion-binding-store.ts`
- `wear/src/theme/wear-layout-metrics.ts`
- `wear/assets/` Wear launcher/splash resources derived from existing Orca assets
- `wear/packages/expo-wear-data-layer/package.json`
- `wear/packages/expo-wear-data-layer/tsconfig.json`
- `wear/packages/expo-wear-data-layer/expo-module.config.json`
- `wear/packages/expo-wear-data-layer/app.plugin.js`
- `wear/packages/expo-wear-data-layer/android/build.gradle`
- `wear/packages/expo-wear-data-layer/android/src/main/AndroidManifest.xml`
- `wear/packages/expo-wear-data-layer/android/src/main/java/expo/modules/orcawear/ExpoWearDataLayerModule.kt`
- `wear/packages/expo-wear-data-layer/android/src/main/java/expo/modules/orcawear/WearDataLayerListenerService.kt`
- `wear/packages/expo-wear-data-layer/android/src/main/java/expo/modules/orcawear/WearHeadlessActionService.kt`
- `wear/packages/expo-wear-data-layer/android/src/main/java/expo/modules/orcawear/WearInboundActionStore.kt`
- `wear/packages/expo-wear-data-layer/android/src/main/java/expo/modules/orcawear/WearBindingStore.kt`
- `wear/packages/expo-wear-data-layer/src/index.ts`
- `wear/packages/wear-companion-contract/package.json`
- `wear/packages/wear-companion-contract/tsconfig.json`
- `wear/packages/wear-companion-contract/schema/wear-action.v1.json`, the language-neutral discriminant/field/bound/canonical-order authority
- `wear/packages/wear-companion-contract/scripts/generate-wear-action-contract.mjs`
- `wear/packages/wear-companion-contract/src/index.ts`
- generated TypeScript decoder/constants and Kotlin admission-validator outputs, plus a check-mode generation gate
- golden unknown-field, UTF-8-boundary, canonicalization, and cross-language fixture tests
- `mobile/src/wear/wear-headless-action-task.ts`
- `mobile/index.ts`, registering the headless task before importing `expo-router/entry`
- `mobile/src/wear/wear-command-journal.ts`, initially exercised by a non-mutating `status.get` spike before Phase 2 enables writes
- `mobile/src/transport/host-client-process-owner.ts`
- `mobile/src/transport/background-host-action-lease.ts`
- `mobile/scripts/check-wear-stack-parity.mjs`

Existing files touched:

- `mobile/package.json`, adding `wear/packages/expo-wear-data-layer` and `wear/packages/wear-companion-contract` as relative dependencies (not `workspace:*`, decision 2)
- `mobile/app.json`
- `mobile/src/transport/client-context.tsx`
- `mobile/src/transport/host-logical-client.ts`
- `mobile/src/transport/mobile-endpoint-supervisor.ts`
- `.github/workflows/mobile-android-release.yml` only if signing evidence shows the downloadable phone build must change to align installed app-signing identity

Exit gate:

- Phone and watch each install frozen from their own lockfile; the cross-workspace stack-parity, Expo Doctor, autolinking, single-native-resolution, and per-project typecheck/test gates pass. Clean prebuild/build succeeds from a clean checkout on Windows and Linux/macOS CI; both app configs run the role-explicit shared plugin; generated manifests match their snapshots and contain only the role-appropriate services/features; and the watch launcher starts with the required resources.
- Same-installed-signature physical phone/watch exchange and explicit companion binding succeed after clean prebuild; wrong/multiple nodes fail closed.
- A clean-prebuild cold process reaches the registered native service and Headless JS task, services a bounded command through the shared process owner without a second socket, and atomically deletes ciphertext after durable journal handoff. Action lease release closes unused background transport, while force-stop/missed deadlines produce unavailable/no mutation.
- The physical watch passes the React Native startup, navigation, back, rotary, input, TalkBack, font-scale, memory, frame, and process-restoration gates. If not, stop and return with evidence; do not grow a half-native UI without Dhiman approving the Kotlin/Compose fallback.
- No duplicate notification is observed.
- The watch's own dashboard/attention state (not just the OS-level system-notification bridge) is proved to refresh while the phone is background, screen-off, or in Doze but not force-stopped (decision 5b). If this cannot be proved, the gate fails and is reported as a named gap, not silently narrowed to "notifications still arrive."
- SDK/manifest, signing, release, dependency, 64-bit, privacy, and no-idle-work gates pass.
- If an explicit watch command cannot reliably reach an otherwise available phone companion, stop. Read-only may continue only as a labeled technical preview; satisfying the stated minimum requires fixing the companion path or explicit user approval to change the requirement — there is no direct-client fallback to fall back to (decision 10).

Rollback: delete every spike-owned Data Item and binding key on both devices; remove all spike-only app/package/workflow files; and revert every existing phone workspace, config, entrypoint, transport, process-owner, and release-workflow change listed above. No runtime credential or migration exists. A promotable artifact is retained only after the gate passes and it is accepted into Phase 1 by normal review.

### Phase 1: read-only companion command center

Complexity: **large**

Depends on: Phase 0

1. Finalize `wear.binding.v1`, persistent `wear.dashboard.v1`, transient `wear.detailPage.v1`, and fixed actions in the platform-neutral `wear-companion-contract`, which may import no React, Expo, Node, or desktop-runtime code. Keep TypeScript product decoders strict on required v1 fields and tolerant only of explicitly designated non-sensitive envelope additions. The frozen `wear.providerUsage.v1` and `wear.usageWindow.v1` security sub-schemas reject every unknown field; additions use a new negotiated version/path. Generate the native action discriminant/bounds validator from the same language-neutral action manifest; Kotlin owns authenticated-envelope and pre-JavaScript admission checks but does not duplicate dashboard or projection models.
2. Keep the existing direct and relay E2EE v2 authentication frames byte-exact. After authentication, read an optional `client-capabilities.set.v1` server capability from `status.get`; only when advertised, call additive `client.capabilities.set` before `session.tabs.subscribeAll`. The client declaration affects negotiated publication behavior, never authorization. Missing, malformed, method-not-found, reconnect, or old-runtime responses retain incomplete legacy inventory semantics. The runtime advertises `session-tabs.authoritative-inventory.v1` only after the publisher correctly handles snapshot/update/removal, runtime `publicationEpoch`/`snapshotVersion`, old-host absence, reconnect, and mixed versions.
3. Project the complete host catalog, `worktree.ps` through the existing `WorktreeCatalogSnapshotClient`, `accounts.subscribe`, and `session.tabs.subscribeAll`. Join only on opaque host/worktree IDs; preserve catalog unavailable/invalid separately from authoritative empty, folder/Git kind, execution-host identity, staleness, and SSH verdicts.
4. Extend `session-tab-agent-status-projection.ts`'s `clientKind !== 'mobile'` structured-visibility check with a capability-gated exception (decision 11) so a paired mobile-family client that declares the new capability sees structured `agent-session` tabs in inventory, alongside terminal-backed tabs. This lands once, in the runtime, and benefits Orca mobile's own phone screens too — it is not a watch-only branch. Old runtimes and clients that never declare the capability keep today's terminal-only behavior; the separate Codex-specific tab filter is untouched by this step and is explicitly scoped to the Phase 0 code audit and Phase 2 acceptance (decision 11), not resolved here. This step delivers inventory visibility only — it does not claim structured-session messaging, which depends on the still-pending audit of `StructuredAgentSessionOutbox`'s send/read mapping.
5. Extract the existing shared host-client registry from `RpcClientProvider` into a process-owned seam before background Wear work acquires clients; no `host-client-process-owner.ts` exists in this checkout yet. Apply a bounded live-socket budget: the on-screen host always holds a slot, and a small number of additional background hosts stay live so their agent/notification state doesn't go stale the moment attention moves away — sized from Phase 0's measured radio/battery cost, not chosen in advance. Mobile's own Home screen already applies the same kind of bound today (`HOME_AUTO_CONNECT_LIMIT` in `mobile/src/transport/home-host-auto-connect.ts:3`) as prior art for the mechanism, not as this feature's number. This is a concurrency bound, not a product exclusion: **every** paired host remains in the catalog and is selectable regardless of count; hosts outside the live budget show cached/stale state and acquire a slot on selection, exactly as mobile's own `useAllHostClients`/`selectHomeAutoConnectHostIds` pattern already does for the phone. A `HostObservationCoordinator` owns one account and notification subscription per acquired host, fans normalized/deduped events to Home and Wear, and never schedules the phone notification twice. Own exactly one `subscribeAll` per acquired host and extend direct/relay cleanup to issue `session.tabs.unsubscribeAll`.
   An uncapped catalog with hosts sitting outside the live budget "until selected" is not by itself a sufficient fleet-attention mechanism — a host the user rarely opens could silently starve, going stale indefinitely while its agents need attention. The `HostObservationCoordinator` therefore also runs a bounded, fair background recovery schedule: every catalogued host outside the live budget gets a short, low-cost state-refresh turn on a fixed rotation (not first-come/most-recent-only), so no host can be starved past a named ceiling regardless of how often the user opens it. Phase 0's feasibility gate must produce and record concrete, measurable targets for this rotation — a maximum staleness bound per host (e.g. "no catalogued host's dashboard entry is older than N minutes") and a maximum missed-event window before a needs-attention transition is guaranteed to reach the watch — sized from real radio/battery measurement, not asserted without evidence; if no such schedule can meet a usable freshness target within the battery budget, that is a Phase 0 gate failure to report, not a silently narrower product.
6. Publish only meaningful dashboard changes as one AEAD-encrypted, 24-hour-expiring Data Item per binding. Construct `usageGroups[]` field-by-field before encryption and persistence: compare each active provider account's real per-host identity field (from `accounts.subscribe`) locally on the phone, assign a binding-scoped opaque `groupKey` per verified-identical account, mark anything the phone cannot verify as its own `identityConfidence: "unverified"` entry, and set each host's `usageGroupKeys` to reference the resulting groups — never merge by provider name or display string alone, and never let a raw account/organization identifier reach the encrypted payload. Negative fixtures prove that account and organization identifiers, runtime targets, inactive accounts, free-form descriptions, buckets, credits, and a non-opaque `groupKey` all cannot cross the boundary. Host-agent and notification pages are bound/epoch/revision/cursor-fenced, node-targeted transient replies. Every ciphertext envelope has a 32-KiB cap, deterministic ordering, completeness metadata, explicit unavailable/expired failures, and fixtures below Data Layer's 100-KB ceiling.
7. Build watch-specific React Native dashboard, host, usage, agent-list, offline, incompatible, no-companion, GMS-unavailable, and error states, covering both terminal-backed and structured agent rows with the same status/freshness treatment. Reuse shared mobile design tokens (via the parity-checked token module, "Visual contract" below) and platform-neutral account-usage formatting/state functions, not phone screen components. Persist only sensitive-minimized host labels, counts/status, usage, and timestamps through the native module's app-private store with `allowBackup=false`/data-extraction denial; do not persist workspace/agent names, notification bodies, or transcripts.
8. Project a redacted, session-scoped notification catch-up list from the phone's existing replay/dedupe path, so agent-needs-attention state reaches the watch through an actual push/refresh signal rather than requiring the user to manually reopen and pull-to-refresh. It is not archival and navigates to an exact host/workspace only; select an agent only when current inventory proves one unique target. Ship mandatory phone enrollment management for fingerprint confirmation/cancellation, status, rebind, removal, and offline/lost-watch removal. Add schema/size/paging, post-auth capability negotiation, multi-node, privacy, enrollment mismatch/cancel/removal, never-acknowledged deadline cleanup, phone-death/startup reconciliation, late-acknowledgement, reinstall, accessibility, state-restoration, process-death, and reconnect tests.
9. Implement `requestPhoneHandoff` in `wear-phone-handoff-executor.ts`: validate the action's target fences against current inventory exactly as every other target-bound action does, then post one phone-local system notification (the phone's own `NotificationManager`, not a new push path) with a deep link that opens Orca mobile directly to that host/workspace/agent. Journal the action like any other so a stale/superseded target is rejected and a missing acknowledgement is `unknown`, never silently dropped or retried. Measure end-to-end latency from watch tap to phone-local notification post in Phase 0/1 testing and record it as the acceptance budget referenced in "Phone handoff" above.

Expected new phone files:

- `mobile/src/wear/wear-data-contract.ts`
- `mobile/src/wear/wear-dashboard-projection.ts`
- `mobile/src/wear/wear-dashboard-publication.ts`
- `mobile/src/wear/wear-detail-page-projection.ts`
- `mobile/src/wear/wear-notification-projection.ts`
- `mobile/src/transport/mobile-runtime-capabilities.ts`
- `mobile/src/transport/host-observation-coordinator.ts`
- `mobile/src/wear/wear-phone-handoff-executor.ts`, posting the phone-local deep-link notification for `requestPhoneHandoff`
- corresponding `*.test.ts` files

Expected new watch files:

- `wear/src/data/phone-dashboard-repository.ts`
- `wear/src/data/wear-dashboard-store.ts`
- `wear/src/data/wear-detail-page-repository.ts`
- `wear/src/components/wear-screen.tsx`
- `wear/app/index.tsx`, the top-level **Attention** screen (default), folding in the former standalone inbox/event feed
- `wear/app/agents.tsx`, the top-level **Agents** screen (full host catalog)
- `wear/app/usage.tsx`, the top-level **Usage** screen (deduplicated per-provider-account usage across every paired host)
- `wear/app/hosts/[hostId].tsx`
- `wear/app/hosts/[hostId]/usage.tsx`
- `wear/app/hosts/[hostId]/agents.tsx`
- focused Vitest/React Native renderer tests beside each domain, including event-feed paging, expiry, redaction, exact-target deep links, and phone-handoff notification/deep-link tests

The generated watch manifest and no-backup/data-extraction resources come from `expo-wear-data-layer`'s config plugin, not hand-edited `wear/android` files.

Existing files touched:

- `mobile/src/transport/client-context.tsx` and `mobile/src/transport/use-all-host-clients.ts` become UI consumers/adapters of `host-client-process-owner.ts`; the Wear coordinator and headless task acquire the process owner directly and must not depend on React hooks or create a second socket stack
- `mobile/src/transport/host-status-gates.ts` and `mobile/src/transport/host-logical-client.ts` for capability-gated post-auth negotiation on both direct and relay paths; E2EE v2 auth framing remains unchanged
- `mobile/src/transport/rpc-client-terminal-subscription.ts` for `session.tabs.unsubscribeAll` cleanup
- `mobile/src/worktree/worktree-catalog-snapshot-client.ts` for workspace labels/kind/execution-host identity
- `mobile/src/home/use-mobile-home-host-connections.ts` to consume the process-level observation coordinator instead of independently owning account/notification streams
- `mobile/src/notifications/mobile-notifications.ts` to expose already-normalized replay events without adding a second scheduler/subscription
- `mobile/app/settings.tsx` and `mobile/app/_layout.tsx` for the mandatory Watches entry/status route and enrollment/removal navigation

Additional new phone file:

- `mobile/app/watches.tsx` as the mandatory confirm/cancel/status/rebind/remove companion-management screen, showing offline/lost-watch removal as pending only until acknowledgement or the fixed deadline, then terminally removed

Expected runtime negotiation changes:

- `src/shared/protocol-version.ts` for the server-advertised `client-capabilities.set.v1` capability
- `src/main/runtime/rpc/methods/client-capabilities.ts` for the registered, mobile-allowlisted `client.capabilities.set` method
- `src/main/runtime/rpc/runtime-client-capabilities.ts`, reusing its bounded parser rather than defining a second accepted language
- `src/main/runtime/rpc/core.ts` for a narrow trusted connection-capability setter available only when the authenticated transport supplies it
- `src/main/runtime/rpc/mobile-socket-wiring.ts` and `src/main/runtime/runtime-rpc.ts` to bind the setter to the authenticated `connectionId` and update that socket's registry entry
- `src/main/runtime/rpc/methods/session-tab-agent-status-projection.ts` (decision 11): extend the `clientKind !== 'mobile'` structured-visibility check with the capability declared above, so a mobile-family client that opts in sees structured `agent-session` tabs in inventory; unchanged for clients that don't declare it, and the separate Codex-specific structured-tab filter is untouched by this change (see decision 11)
- focused direct/relay, old-runtime, one-shot/idempotency, changed-value rejection, disconnect/reconnect clearing, publication, structured-agent-session-visibility (capability declared/undeclared, mobile phone screens and watch alike), and byte-exact E2EE v2 auth tests

The first valid declaration owns the connection. Repeating the identical set is idempotent; a different second set is rejected. The registry update affects only subsequent requests/subscriptions on that authenticated connection and is cleared with the socket. Reconnect starts empty and renegotiates after `status.get`.

Exit gate:

- Allowed usage percentages, window lengths, reset timestamps, status, and freshness match the same active-provider host snapshot rendered by mobile; `usageGroups[]` deduplicates only verified-identical accounts across hosts (per the acceptance list above), unverified identities stay separate, and no other account-snapshot field is serialized.
- Every paired host is cataloged with no exclusion by count; only the live-socket budget is bounded, sized from Phase 0 evidence, and selection moves that budget without creating a parallel socket.
- Structured `agent-session` tabs render in inventory for a capability-declaring client, matching what Orca mobile's own phone screens show once decision 11's inventory step lands; a client that never declares the capability is unaffected. This gate covers inventory visibility only — structured-session messaging is Phase 2's audit-dependent acceptance criterion (decision 11), not claimed here.
- `requestPhoneHandoff` against a live target produces exactly one phone-local notification opening the exact target within the measured latency budget; a stale/superseded target is rejected the same way as every other target-fenced action, and the watch never shows a silent no-op.
- Authoritative empty, incomplete old-host, stale, disconnected, revoked, folder workspace, and SSH-unverifiable cases render distinctly.
- Direct/relay post-auth capability negotiation, old-runtime auth compatibility, `subscribeAll` cleanup/replay, 32-KiB encrypted dashboard/transient-page boundaries, paging, Data Item expiry/deletion, reinstall, and multi-node ciphertext-confidentiality tests pass.
- Mismatched/cancelled enrollment, rebind, online removal, and offline/lost/uninstalled-watch removal reach terminal cleanup on acknowledgement or the fixed deadline, including phone death/restart and late acknowledgement, on the physical phone/watch pair.
- No credential, account/email/organization/workspace identifier, runtime target, free-form account description, file path, workspace/agent name, transcript, notification body, or raw terminal content appears in prohibited storage/log fixtures.
- TalkBack, rotary, font scaling, 192 dp, 227 dp, and physical-watch checks pass.

Rollback: explicit companion removal or a signed phone update durably starts the same removal state machine: reject further publication/actions, publish the tombstone, immediately delete non-tombstone phone-owned Data Items, and delete all remaining phone-owned binding state on acknowledgement or the fixed 24-hour deadline. Startup/service-entry reconciliation completes overdue cleanup after phone downtime. Watch-owned state clears only when the watch receives the tombstone or its local cache expires and re-enrollment handling replaces the unknown binding; an offline watch cannot be mutated at the phone's deadline. Play withdrawal alone does not deactivate it.

### Phase 2: structured chat and bounded commands

Complexity: **large**

Depends on: Phase 1 and a passing Phase 0 action-delivery gate

1. Define additive `native-chat.execution-host.v1` and `native-chat.atomic-send.v1` capabilities plus workspace-routed read/subscribe/unsubscribe and SSH send-reserve/complete/query schemas. Extend the shared language-neutral Wear action manifest with the Phase 2 actions/results, then regenerate both TypeScript decoders and Kotlin admission code. Extend `relay.status` with optional native-chat capabilities, `primary-channel-proof.v1`, and a relay incarnation ID. Probe on every establish and reconnect, key state to SSH target plus multiplexer/connection incarnation, and clear it before teardown; missing, malformed, method-not-found, or stale responses fail closed to status-only. These optional additive wire changes do not bump the protocol version, an old main ignores the new status fields, and a new main sends no new method to an old relay.
2. Prove the initial SSH relay channel before native-chat admission without changing the pre-negotiation framing. A current relay returns a random, short-lived, one-use challenge in the optional status proof; over the same exclusive SSH stdio channel, a new main calls additive `relay.attestPrimary` only when advertised. The relay consumes the challenge and binds a `RelayClientSessionIdentity` to that connection incarnation. The challenge never appears in argv, environment, logs, or durable state. Reconnect continues using the existing endpoint credential. Native-chat handlers reject `unproved` identity; old relays remain usable for their existing methods but status-only for native chat. Then implement `nativeChat.sendMessage` in the main runtime against opaque tab/session identity, terminal binding, the exact target workspace's runtime `publicationEpoch`/`snapshotVersion`, and a host mutation ID derived from `(bindingId, watchRequestId)`. Local/WSL sends validate and write under one local receipt operation. For SSH, main first asks the proved, capability-advertising relay to atomically persist a pending reservation bound to that identity, canonical hash, remote PTY identity, and exact fences. Only a proved reservation response permits main to revalidate the same provider session as live, sendable, input-unlocked, and at a settled prompt, then call its existing `sendTerminalAgentPrompt` state machine through the current remote PTY provider. A missing/ambiguous reservation response performs no write and returns `unknown`.
3. Extract/reuse Orca's canonical hashing, receipt-state-machine, and durable-file-write behavior. The main runtime uses an isolated SQLite receipt table for local/WSL. SSH relay state lives at a stable schema-versioned root conceptually `~/.orca-remote/native-chat-send-receipts/v1/`, resolved with `path.join(homedir(), ...)`, outside every `relay-<content-version>` install and its garbage collector. Use cross-process atomic per-mutation creation and monotonic terminal records—never a shared JSON rewrite or only an in-process mutex—so overlapping old/new relay processes cannot both reserve one ID. Per-binding admission and global pruning/quota run under cross-process exclusive leases with owner/incarnation metadata, bounded expiry, and atomic stale-lock quarantine; inability to prove the lease fails closed. On POSIX, durable publication requires temp-file fsync, atomic publication, and containing-directory fsync. Node cannot directory-fsync on Windows, so a Windows relay must instead prove a fixed-capacity, pre-created ledger whose mutation path uses checksummed/generation-tagged in-place or append records plus file `fsync`/`FlushFileBuffers`, with no create/rename/delete dependency after capability activation. Forced child-process and VM/power-cut recovery must show that no acknowledged reservation disappears or becomes resendable; until it does, the relay omits `native-chat.atomic-send.v1`. Corrupt/partial rows quarantine and fail closed on every platform. After the existing main writer definitively settles, main asks relay to complete accepted/rejected; if the write or completion boundary is ambiguous, relay remains pending/`unknown`. Same ID/hash returns the stored state without another write; changed input is rejected. After 24 hours, an unresolved pending row becomes a terminal `unknown` tombstone rather than becoming resendable; retain terminal receipts/tombstones for 30 days. Cap unresolved rows at 16 per binding and retained terminal rows at 2,000 total on each store so Wear cannot exhaust the orchestration ledger or relay disk; full/corrupt persistence fails closed. The phone journal mirrors the hash/fences, persists pending before host I/O, and resolves lost phone/runtime or runtime/relay acknowledgements through `nativeChat.getSendReceipt`, which routes SSH queries to the current proved relay and never resends.
4. Implement `openConversation`/`renewConversation`/`closeConversation` with the workspace-routed native-chat read/subscribe surface and a phone-owned lease: random lease ID, authenticated phone/binding/publisher-epoch owner, 120-second host-enforced absolute expiry after the last valid renewal, and 30-second renewal while visible. Persist the closed, four-entry-bounded cleanup record before open and delete it only on acknowledged cancellation, including successful restart reconciliation, or hard expiry. While alive, the phone sends acknowledged best-effort cancellation on close, binding removal, node disconnect, SSH loss, or host reconnect. Phone death sends nothing; the next authenticated connection asks reachable hosts/relays to cancel stale owner epochs, while unreachable leases remain busy until their original expiry. Enforce one lease per binding, four total phone leases, and four streams per execution-host/relay process; replacement requires proved teardown or expiry and otherwise fails busy. Add a capability-gated relay-side native-chat handler registered by `RelayRuntimeServices`; route the main runtime through the owning SSH multiplexer/provider. The relay owns transcript resolution and an acknowledged, sequenced stream with explicit cancellation, bounded credit/backpressure, one stream per lease, and disposal on reconnect/transport loss. Failure never falls back to local paths. Return at most 20 messages and 32 KiB over transient acknowledged messages; never Data Items/DataStore. A missed read may be requested again because it is non-mutating.
5. Add React Native conversation/composer routes with the system keyboard, system speech-to-text, explicit unavailable/update-required/rejected/unknown states, and no optimistic “sent” claim before an accepted receipt. Disable sending when current state is not proven sendable.
6. Fence all actions with binding, phone publisher epoch, snapshot revision, runtime publication epoch, snapshot version, and current target identity. Subscription frames may replay; unary mutations never auto-replay. A written-without-ack mutation stays unknown until receipt reconciliation.
7. Test exact-session changes, stale/colliding revisions, same-ID same/different payload, size/rate/concurrency/lease-cap boundaries and sustained floods, double taps, reservation-without-write, write-without-complete, receipt replay/pruning/full-ledger behavior, concurrent old/new relay same-ID/admission/prune races and stale-lock recovery, receipt survival across relay upgrade/install GC, POSIX file/directory crash cuts, Windows fixed-ledger child-process and VM/power cuts plus capability omission on failure, initial/expired/replayed primary proof, credentialed reconnect, unproved rejection, capability clearing/reprobe on every connection incarnation, new-main/old-relay and old-main/new-relay transitions, phone/main/relay process death at every boundary, phone kill with no teardown callback, cleanup-record field/storage negatives and four-entry cap, orphan-record startup GC, early restart reconciliation, unreachable host/relay expiry and capacity release, direct/relay migration, stream replacement/cancellation/backpressure, revocation, old hosts, dropped close/renewal, node loss, watch death, and transient-content cleanup.

Expected new phone files:

- `mobile/src/wear/wear-command-executor.ts`
- `mobile/src/wear/wear-conversation-projection.ts`
- `mobile/src/wear/wear-conversation-lease.ts`
- `mobile/src/wear/wear-companion-coordinator.ts`
- `mobile/src/transport/headless-host-action-client.ts`, using the shared process owner and bounded background lease without creating a persistent or duplicate socket
- focused `*.test.ts` files

Expected new watch files:

- `wear/src/commands/wear-command-repository.ts`
- `wear/src/conversation/wear-conversation-store.ts`
- `wear/app/hosts/[hostId]/agents/[agentId].tsx`
- `wear/app/hosts/[hostId]/agents/[agentId]/compose.tsx`
- focused Vitest/React Native renderer tests

Existing files reused before modification:

- `mobile/src/wear/wear-command-journal.ts`, promoting the Phase 0 handoff proof to the full hash/receipt contract
- `mobile/src/session/use-mobile-native-chat-session.ts`
- `mobile/src/transport/host-logical-client.ts`
- `mobile/src/transport/rpc-delivery-ambiguity.ts`
- `src/shared/runtime-terminal-contracts.ts`

Expected runtime contract/method changes:

- `src/shared/protocol-version.ts`
- `src/shared/native-chat-send-contracts.ts`
- `src/shared/native-chat-execution-host-contracts.ts`
- `src/shared/relay-primary-channel-auth.ts` for the one-use launch proof and identity contract
- `src/main/runtime/rpc/methods/native-chat.ts`
- `src/main/runtime/native-chat/native-chat-execution-host-reader.ts`, routing local reads to the existing resolver and SSH reads to the owning provider with no cross-host fallback
- `src/main/runtime/native-chat/native-chat-send-coordinator.ts`, retaining the existing main-runtime settled-prompt state machine and wrapping SSH writes in relay reserve/complete/query
- `src/main/runtime/runtime-rpc.ts`
- `src/main/runtime/rpc/orchestration-mutation-executor.ts`, extracting/generalizing the durable receipt mechanism instead of cloning it
- `src/main/runtime/native-chat/native-chat-send-receipt-store.ts`
- `src/relay/native-chat-handler.ts` and focused stream/authorization tests
- `src/relay/native-chat-send-receipt-store.ts` and `src/relay/native-chat-send-receipt-paths.ts` for cross-process begin/complete/query at the stable state root, plus a fixed-capacity Windows ledger strategy only if its gate passes
- `src/relay/relay-runtime-services.ts` for handler registration and lifecycle disposal
- `src/relay/relay-primary-channel.ts` and `src/relay/dispatcher.ts` for primary launch identity and unproved rejection
- `src/relay/relay-daemon.ts` for optional native-chat capability/incarnation advertisement
- `src/main/ssh/ssh-relay-session.ts` for launch proof, establish/reconnect probing, incarnation-scoped state, teardown clearing, and method dispatch
- `src/main/durable-file-write.ts`, reused or narrowly extracted for POSIX file-and-directory durability; Windows uses file flush without claiming directory fsync equivalence
- the runtime SQLite schema/migration files required for the isolated receipt table
- focused native-chat send, primary/reconnect authorization, incarnation capability, receipt durability/concurrency/upgrade-GC, capacity, restart, relay/SSH integration, backpressure/cancellation, and mixed-version tests

These existing files should change only if extracting a transport-neutral function avoids parallel behavior; React hooks must not be forced into the non-React publisher.

Exit gate:

- Message order and stable IDs survive reconnect and replay. Local transcript content disappears on close or process death; remote streams disappear on acknowledged cancellation or within the fixed server expiry. Restart reconciliation cancels reachable orphaned leases without extending their deadlines, and unreachable leases release capacity at expiry.
- SSH transcript reads/subscriptions execute on the owning host, and SSH contact loss is `unverifiable` with no local filesystem fallback.
- Initial and reconnect relay channels have proved per-incarnation identity before native-chat use; `unproved` is rejected, capabilities are reprobed per incarnation, and no cached capability survives teardown/replacement.
- Exactly one settled prompt write occurs for repeated delivery of one binding/request ID across local and SSH execution. For SSH, no write starts without a proved durable relay reservation; any reservation/write/completion ambiguity stays unknown. Cross-binding same IDs do not collide, changed-input reuse is rejected, main/relay restart and receipt lookup reconcile without resending, concurrent relay versions cannot double-reserve, and receipts survive relay upgrade/install GC without growing storage unbounded.
- POSIX receipt crash cuts pass file-and-directory durability. Windows SSH atomic send is advertised only after fixed-ledger child-process and power-cut evidence passes; otherwise the same host remains read-only for native chat with no raw fallback, and this phase's exit gate does **not** treat that read-only state as satisfying "all paired machines" send parity — see decision 9. Local Windows send is unaffected.
- Every host/write/receipt boundary produces an evidence-backed accepted, rejected, or unknown result.
- The watch cannot invoke an RPC outside the fixed action enum or send to a stale/foreign target.
- Old hosts or relays never fall back to unsafe raw sending.

Rollback: a signed phone update stops advertising the action capability, deletes pending bound actions, and leaves installed watches on the Phase 1 read-only surface. Play-track withdrawal alone is not a control for already installed apps.

### Phase 3: verification, release, and operational readiness

Complexity: **large**

Depends on: Phases 0-2

1. Add Wear stack-parity, typecheck, oxlint, oxfmt, Vitest/React Native renderer, clean-prebuild, Android unit/instrumentation, and bundle lanes without weakening existing max-lines rules. Pin the Phase 0-approved Google Play Services Wearable and native toolchain versions through the shared Expo module and generated build, then verify dependency provenance/SBOM/licenses.
2. Build internal APKs and a Play Wear-enabled AAB from `wear/` with a disjoint version-code range, `minSdk 33`, `compileSdk/targetSdk 36`, required `android.hardware.type.watch`, `standalone=false`, `allowBackup=false`/data-extraction denial, matching application ID/app-signing certificate, and no universal phone/watch APK. Inspect the AAB/APKs and every native `.so` for the Wear OS 64-bit requirement, in force since 2026-09-15 (already active, not a future deadline, as of this plan's 2026-09-23 revision).
3. Run the lowest companion lane on an API 31 phone, and the watch emulator matrix across Wear OS 4/API 33 and Wear OS 6, 192-dp and 227-dp round profiles, every supported font scale, startup/state restoration, process death/force-stop, network/node transitions, no/outdated Google Play Services, and old/new phone/host versions. Verify that a pre-31 companion stays on ordinary Orca mobile and gets an explicit unsupported-for-Wear state rather than any software-key fallback.
4. Run physical Samsung acceptance across Bluetooth-proxied, Wi-Fi, and LTE where available; include screen-off/Doze, rotary, TalkBack focus order, lock/redaction, startup icon/name, notification bridge/dismissal, intentionally absent ongoing notifications, direct/relay phone-host paths, SSH, and folder workspaces.
5. Compare Android Studio Power Profiler, Perfetto, and Battery Historian evidence for both watch and phone with Phase 0. Block release on agreed-budget regression or any unexpected idle listener/job/radio/React Native work; verify no background watch socket or Tile network work exists.
6. Register/verify package ownership and the Wear OS form factor in Play Console, use dedicated Wear testing/production tracks, upload the AAB and Wear-specific icon/screenshots/listing, opt into Wear review, and block release until review/pre-launch quality, app-signing, installed cross-channel certificate, Data Layer, privacy/data-safety, supported-market/GMS, developer-verification, and rollback evidence passes.

Expected new workflow files:

- `.github/workflows/wear-android-ci.yml`
- `.github/workflows/wear-android-release.yml`

Required existing test families to extend or cross-check:

- `mobile/src/transport/rpc-client-delivery-ambiguity.test.ts`
- `mobile/src/transport/rpc-client-connect-wait-replay.test.ts`
- `mobile/src/transport/stable-logical-rpc-client.test.ts`
- `mobile/src/notifications/mobile-notifications.test.ts`
- `mobile/src/notifications/notification-watermark-seed-race.test.ts`
- `src/main/runtime/session-tabs-inventory-publication.test.ts`

Exit gate:

- All automated lanes pass with no waiver, including phone/watch JavaScript-stack parity and clean Expo regeneration.
- Physical-device, battery, accessibility, signing, notification, mixed-version, SSH, and folder-workspace evidence passes.
- An installed build can be deactivated by the rehearsed signed-phone-update/binding-removal path; Play withdrawal is verified only as prevention of new installs.

Rollback: withdraw the Wear track to prevent new installs and ship a signed phone update that starts the durable binding-removal state machine. It stops capability publication, rejects commands, publishes the tombstone, immediately deletes non-tombstone Data Items, and clears all remaining phone-owned binding state on acknowledgement or the fixed deadline. Companion removal performs the same flow, and startup reconciliation completes overdue work. The watch clears local cache/binding on tombstone; an offline lost watch cannot be remotely wiped, so device lock, no-backup rules, sensitive-minimized cache, local cache expiry, and unknown-binding rejection remain required. Existing phone/runtime pairings are unaffected.

### Direct foreground client: removed from this plan

An earlier draft carried a "Phase 4: optional direct foreground client" as a conditional later phase. Decision 10 above removes it entirely rather than deferring it: the incumbent `wear/` prototype already demonstrates what an unreviewed direct client looks like in practice (full `mobile`-scope runtime authority on-watch, no server-side Wear allowlist), which is the concrete risk this plan's companion-first boundary (decision 1) exists to prevent. If phone-independent operation is ever genuinely required, it is a separate initiative — its own server-owned Wear grant, `WEAR_RPC_METHOD_ALLOWLIST`, no-phone enrollment, Hermes/mobile crypto conformance, and push strategy — proposed and reviewed on its own merits, not inherited as a phase of this document.

## Dependency and critical path

```mermaid
flowchart TD
  A[Approve companion boundary, package, signing, dependencies] --> B[Phase 0 physical feasibility]
  B --> C[Phase 1 read-only snapshots]
  C --> D[Phase 2 structured chat and commands]
  D --> E[Phase 3 release gates]
  E --> F[Minimum product]

  B --> H[Wear theme and accessibility shell]
  H --> C
  B --> I[Phone projection contract]
  I --> C
```

After Phase 0, the Wear UI shell and phone projection contract can proceed in parallel. In Phase 2, conversation rendering and command-journal work can proceed in parallel after the action schema is fixed. Release integration waits for both.

## Verification matrix

| Requirement          | Primary evidence                                                                                                                                                                | Failure behavior                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Pair/discover hosts  | User-confirmed binding, installed-cert, multi-node, rebind/removal, and host-catalog tests                                                                                      | No companion/update-required state; never request runtime token                           |
| Account usage parity | Fixture comparison against `accounts.subscribe`/mobile renderer semantics, plus `usageGroups[]` dedup acceptance (verified-merge, distinct-accounts, unverified-stays-separate, freshest-not-summed) | Show last-known timestamp or unavailable, never zero as a guess                           |
| Agent command center | Host catalog/worktree join covering every paired host, bounded live-socket budget (background cap only, never a catalog exclusion), terminal-backed and structured session inventory (decision 11), direct/relay cleanup, SSH/folder/Git/old-host tests | Preserve cached/incomplete/unverifiable state                                             |
| View messages        | Native-chat local/SSH order/replay plus 20-message/32-KiB lease, relay backpressure/cancel, dropped-close, no-callback process death, restart reconciliation, and server expiry | Stale view with timestamp; no fabricated continuity                                       |
| Send messages        | Atomic local send or SSH relay-reserve/main-write/relay-complete, target fences, receipts, POSIX/Windows crash cuts, duplicate-ID tests                                         | Accepted/rejected/unknown; unproved platform/old host/relay is read-only; no raw fallback |
| Notifications        | Physical system bridge/dismissal/lock/ongoing/duplicate tests plus session catch-up projection                                                                                  | Phone remains sole producer; inbox is non-archival and says so                            |
| Security/privacy     | Binding/signing negatives, closed-schema/byte/rate/lease/flood rejection, inbox handoff/GC, payload/log/storage/backup/uninstall checks                                         | Fail closed; reject before JS wake and expire/delete sensitive projection                 |
| Accessibility        | TalkBack focus, rotary, all font scales, 48-dp targets, text floors, startup/state restoration, 192/227 dp                                                                      | Release blocked                                                                           |
| Battery              | Watch and phone Power Profiler/Perfetto/Battery Historian against budget and zero-idle-work gate                                                                                | Release blocked                                                                           |
| Mixed versions       | Old/new watch schema, byte-exact old authentication, post-auth capability negotiation, old runtime inventory/send behavior                                                      | Read-only or explicit update-required                                                     |
| Release/rollback     | Installed-cert APK/AAB, dedicated Wear track, review, binding tombstone, acknowledgement/deadline cleanup, and signed-phone-update rehearsal                                    | Prevent new installs and terminally deactivate existing bindings                          |

Verification language is evidence-based: a gate is either proved by source/static analysis, tested automatically, tested on the physical device, or explicitly unverified. No self-assigned confidence score and no waived release gate.

## Release and rollback strategy

1. Internal physical-device APKs with matching installed app-signing certificates and an approved binding.
2. Play internal/closed Wear track with the Android companion and Wear-enabled AAB under the same package/listing identity; verify Play-generated installed certificates, not merely upload keys.
3. Read-only preview first; advertise command capability only when Phase 2 and the host's `native-chat.atomic-send.v1` evidence pass.
4. Observe crashes, ANRs, watch/phone power, listener wakeups, payload size, Data Layer delivery, command unknown/receipt reconciliation, and duplicate notifications without logging user content.
5. Roll back existing installs with the rehearsed signed phone update or explicit companion removal state machine, including immediate non-tombstone deletion and acknowledgement-or-deadline terminal cleanup; withdraw the Wear track to stop new installs. No watch-runtime credential exists to migrate or revoke in the minimum architecture.

## Definition of done

The minimum product is done only when:

- a user-confirmed phone/watch binding with matching installed app-signing certificates catalogs every currently paired Orca host without cross-node leakage;
- the closed account-usage projection matches mobile's active-provider percentages, window lengths, reset timestamps, status, and freshness without persisting account identifiers or unapproved snapshot fields;
- every currently paired host is catalogued and selectable, not a subset; terminal-backed *and* structured agent sessions on the small number of concurrently live-socketed hosts (selection always holds a slot; the rest is a bounded, Phase-0-evidence-sized background concurrency budget, see Phase 1 — never a fixed number and never a catalog exclusion) render with truthful state across local, SSH, paired-runtime, Git-worktree, and folder-workspace contexts, while other catalog hosts are explicitly cached/stale until selected; usage is deduplicated per *verified* provider account via `usageGroups[]`, not repeated per host, with unverified identities kept explicitly separate rather than guessed-merged;
- a selected recent native-chat conversation can be viewed under a bounded lease and, on every execution path advertising the proved capability, a short message can be sent through the atomic host method with accepted/rejected/unknown plus receipt reconciliation; local Windows remains send-capable, and Windows SSH send is either proved atomic (decision 9) or its exclusion from "all paired machines" is an explicit, separately recorded scope-reduction decision — an unproved, merely-read-only Windows SSH relay is a named gap blocking done, not a quiet substitute for it;
- structured agent sessions appear in inventory alongside terminal-backed ones (decision 11's Phase 1 step); structured-session messaging is done per agent-kind/host path only where the Phase 0 audit and Phase 2 acceptance prove it safe (decision 11) — any combination not proved by release time is a named gap in this definition of done, not silently covered by the terminal-backed messaging bullet above;
- notifications arrive once on the Wear OS system surface through Android bridging and a redacted, non-archival session catch-up appears in the app;
- offline, revoked, incompatible, stale, and unverifiable states are distinct;
- no runtime credential or arbitrary RPC surface exists on the watch;
- security, privacy, accessibility, watch/phone battery, mixed-version, and installed-app rollback gates pass on the physical Samsung watch for the internally sideloaded product; Play publication and its release gates remain outside this authorization;
- every changed file and dependency traces to these requirements, with no compatibility shim, speculative abstraction, or unrelated documentation.

There is no Phase 4 in this plan; a direct watch-to-runtime client is out of scope entirely (decision 10), not a deferred extension of this definition of done.

## Verification Report — post-spike, 2026-09-23

This report was first written pre-implementation, then updated after Dhiman authorized and this pass executed the isolated Phase 0A/0B feasibility spike (log above, under "Spike evidence log"). Claims are tagged by how they were actually checked; nothing here is a self-scored confidence number, and evidence levels only move to **Tested** where a real command was run with a captured exit status — not on the strength of a plausible design.

| Claim | Evidence level | Basis |
| --- | --- | --- |
| Repository/branch/worktree state, existing runtime source, and the incumbent `wear/` prototype's actual code (package identity, transport, theme) | **Grounded** | Direct file:line reads of this checkout at the branch's current HEAD |
| `agentSession.*` absent from `MOBILE_RPC_METHOD_ALLOWLIST`; `nativeChat.readSession`/`.subscribe`/`.unsubscribe` present; structured→native-chat projection is renderer-only | **Tested** | Isolated static probe against the real source, exit code 0, assertion PASS (spike log above) |
| 61 existing unit tests across session-tab-agent-status-projection, runtime-rpc-request-authorization, native-chat, and structured-agent-session | **Tested** | `vitest run` on each file, all passed, durations recorded (spike log above) |
| `wear/` and `mobile/` package/signing identity mismatch; `standalone=true`; SDK floor (`minSdk 33`/`compileSdk 36`/`targetSdk 36`) already matches Gate 0A | **Tested** | `keytool`/build.gradle/gradle.properties inspection with file:line citations (spike log above); real release-cert comparison still unavailable (no release artifact exists) |
| The incumbent, rejected `wear/` prototype compiles into a real, signed, installable APK on this machine's JDK/SDK/Expo toolchain | **Tested** (that one codebase's toolchain portability only) | Isolated-copy `assembleDebug --offline`, direct exit-status capture = 0, real APK verified via apksigner/aapt2 (spike log above) — not evidence toward the future, not-yet-built companion architecture, and not evidence the companion mechanism works |
| `wear/` standalone-builds with zero sibling directories (JS/TS layer) | **Tested** | Isolated empty-tree copy: install/typecheck/test/lint all passed (spike log above) |
| Documented write/fsync/rename algorithm, as modeled, degrades safely across 3 orderly step-boundary exits | **Reasoned, lightly Grounded** | Isolated Node probe against a *reimplementation* of the algorithm (not the production module), using `process.exit()` (orderly, not a forced kill) at step boundaries — not process-kill-safety evidence, not production-code evidence, not power-cut evidence for decision 9 (spike log above) |
| Physical product behavior: watch React Native startup/navigation/rotary/TalkBack, dashboard refresh, battery, phone-handoff latency | **Not Tested** | Physical native probe transport passed on SM-L500 and SM-S928B (API 36); this does not exercise product UI, refresh, or power budgets |
| Native companion probe: build/install and actual paired Data Layer | **Tested on emulators and one physical Samsung pair** | Emulator harness exit 0 covers background, crash-cold, Doze, replay, timeout, and reconnect. Physical paired receipts cover both directions, replay, locked/paused phone delivery, force-stop delivery and valid-path recovery; physical explicit timeout remains unproved. See the physical section of [consolidated evidence](../spikes/wear-companion/evidence/2026-09-23.json) |
| Local replay-window logic | **Tested** | Five JVM tests, zero failures; process-local bounded detection only |
| Actual Expo Headless JS bootstrap | **Tested on paired emulators; physical delivery unverified** | Emulator native receive, JS entry/reply/completion and watch PONG passed, including a new phone process. Physical ARM64 release built, matching test certificate verified, installed and foreground JS ran; watch ADB connectivity was lost before the headless request. Build/install is not headless delivery evidence |
| Structured-session messaging per agent-kind/host-path (Phase 2 acceptance) | **Not Tested** | Inventory-side RPC gap audited (Tested, above); the new `agentSession.*`-equivalent mobile surface this requires is not yet designed or built |
| Windows SSH atomic-send power-cut durability | **Not Tested — Blocked** | No hardware fault-injection available; the process-kill probe above is evidence for a narrower claim only |
| Real release/Play signing certificate match | **Not Tested — Blocked** | No release-signed artifact exists in this checkout to compare |

**Gate: FAIL / pending**, not a pass with caveats — the spike closed real evidence gaps but did not close the release gates. Named blocking gaps:

- physical Samsung product evidence (watch startup, rotary, TalkBack, memory, battery) remains untested; native Data Layer pairing and correlated transport passed, while physical Headless JS wake remains blocked on watch ADB connectivity;
- background/screen-off/Doze dashboard-refresh proof (decision 5b) — requires the same physical device, not collected;
- real release/Play installed-APK signing/certificate match evidence (decision 3, decision register) — no release artifact exists to compare;
- structured agent-session messaging implementation and its per-agent-kind/host-path acceptance (decision 11) — the RPC gap is now audited and scoped correctly upward, but the new mobile-allowlisted surface it requires does not exist yet;
- Windows SSH atomic-send crash/power-cut durability (decision 9) — a probe against a reimplemented model, not the production code, found no corruption at orderly step boundaries; this closes no real part of decision 9, hardware-level proof against the actual implementation is still entirely absent, and its interim read-only state is not a substitute for it;
- product inbox/journal, admission limits, action expiry, shared socket ownership, and force-stop policy remain untested; emulator delivery after force-stop means the planned unavailable/no-mutation behavior cannot be inferred from the OS stopped flag alone;
- evidence for all implementation and internal-device acceptance rows; user authorization is now granted, but authorization alone closes no technical gate.

**Authorization:** full product implementation and internal installation are approved; the evidence above still describes the completed spike only. Product completion requires every in-scope behavior and installed-device acceptance criterion, including every paired-machine and agent-type path. Public publication, Play release, and merge remain outside this authorization.

### Product implementation checkpoint — 2026-09-23

Full implementation is active. The first bounded unit adds the portable nine-action manifest, generated TypeScript schema, closed canonical decoder, UTF-8 limits, and 36 passing admission tests under `wear/packages/wear-companion-contract`. Type checking, generated-source freshness, lint, and formatting pass. Independent read-only review found no blocking TypeScript defect; Kotlin byte parity remains unverified. This unit performs no device or runtime mutations.

Outstanding: Kotlin validation and crypto/enrollment, native inbox and durable command journal, capability-gated runtime inventory and exact-target receipts, shared phone host ownership, product screens and freshness/notification/background behavior, extraction/signing verification, and installed-device acceptance across all required host/agent paths. Physical Headless JS delivery remains unproved; the earlier native transport probe is not product acceptance.

The second bounded unit adds advertised `client-capabilities.set.v1` negotiation through the authenticated socket and real RPC dispatcher. The first declaration is immutable, identical sets are idempotent, sibling sockets are isolated, and reconnect starts undeclared. Direct/relay and unchanged E2EE authentication tests pass (41 tests across six files); node type checking and scoped lint pass. Independent review caught and then verified the dispatcher propagation fix. This unit does not yet expose structured inventory or negotiate from the phone; those remain the next integration criteria.

The third bounded unit exposes existing structured history/subscription/cleanup methods to negotiated mobile clients and includes structured Codex rows in their inventory. Undeclared clients retain the previous projection; legacy non-Codex structured rows remain a named parity gap. Direct/relay stream disposal now targets the requesting inventory or structured stream. Restoration registers cleanup before awaiting work, so cancellation cannot leave a subscription behind. Verification: 100 runtime tests and 12 mobile transport tests pass; node/mobile type checks pass; independent review fixes are included. The real-runtime test fixture now closes its owned SQLite handles for Windows teardown. Phone negotiation and product readers are not enabled yet.

The native contract unit generates Kotlin schema data from the action manifest and validates actions before JavaScript, including strict UTF-8 byte decoding and pre-parser lexical/depth limits. Shared vectors cover canonical escapes, JavaScript whitespace, Unicode byte limits, safe integers, closed fields, fences, and expiry. TypeScript passes 76 tests; the Kotlin JVM suite passes 43 tests using the Android API at compile time and a test-only JSON implementation at execution time. Review found an Android comment-parser depth bypass; the pre-parser now rejects non-JSON lexical constructs, with regression assertions before parser entry. This does not yet prove execution against Android’s own JSON implementation, native listener integration, crypto/binding, or any installed product behavior.

The native key-primitives unit adds API-31-gated P-256 enrollment keys, role-ordered and length-delimited enrollment transcripts, a 64-bit comparison fingerprint, HKDF-SHA-256 bootstrap derivation, and AES-GCM binding-key wrapping under Android Keystore. The fixed 32-byte derivation matches [RFC 5869 A.1](https://www.rfc-editor.org/rfc/rfc5869.html#appendix-A.1); the Keystore path follows the [Android ECDH API](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec). Independent source review found no blocker in this bounded unit; enrollment authorization, lifecycle, transport, and key cleanup still require implementation.

Actual Android execution now closes the earlier parser-runtime gap for API 31: isolated `orca_spike_phone31_codex` / `emulator-5554` ran `dev.orca.wear.nativeacceptance` and passed three instrumented tests covering all 40 action vectors plus the comment attack, ECDH agreement with non-exportable Keystore private keys, and wrapping with wrong-binding/tamper rejection. The JVM cryptographic suite passed two tests. Test APK SHA-256: `e92b28ab7e659794a85dd1b242be87b8a7b4945b6ecdb8b003cbe3a604c18856`; local log: `spikes/wear-companion/build/product-implementation/android31-native-acceptance.log`. This uses the actual product source but remains component acceptance, not an enrolled or working watch app. No physical phone/watch package was changed.

The enrollment and binding-store unit now requires matching user confirmations on both peers before exchanging a binding, pins the peer node and hello, expires the ceremony, and refuses to retry an ambiguous persistence callback. Native SQLite storage retains installation identity, wrapped keys, pending/active/revoked state and a fixed revocation deadline. Nonce reservations commit before return and separate phone/watch domains. Eight API-31 instrumented tests pass, including reopen/concurrent reservations and the previous native acceptance suite; independent source review found no blocker within this unit. This is not a crash/power-loss durability proof or transport integration.

The first enrollment run completed its three session tests, then stalled in Android 12 Keystore with `BACKEND_BUSY`; another process stalled immediately. A cold boot temporarily restored execution: eight tests passed, then ten passed, before repeated ECDH exhausted the backend again. Review found a matching defect in the [Android 12 Keystore compatibility implementation](https://android.googlesource.com/platform/system/security/+/android-12.0.0_r1/keystore2/src/km_compat/km_compat.cpp): `begin` claims one of 15 operation slots before returning a software-key operation that does not release that compatibility slot. This supersedes the initial stale-emulator diagnosis; the installed emulator build still needs exact source mapping. Android 12's [operation creation implementation](https://android.googlesource.com/platform/frameworks/base/+/android-12.0.0_r1/keystore/java/android/security/KeyStoreSecurityLevel.java) can then retry indefinitely. No security or compatibility setting was changed. Integration tests continue on API 36; repeated enrollment on affected API-31 backends remains an explicit gap. Product integration must keep crypto off UI threads and bound queued work even when a provider call stalls. Evidence: `spikes/wear-companion/build/product-implementation/android31-enrollment-bindings-cold.log`. Still outstanding: enrollment owner and wire transport, authenticated envelopes, cleanup/ack reconciliation, native inbox, phone ownership, watch screens, runtime actions and installed-device acceptance.

The native envelope unit authenticates its versioned binary header (binding, kind/path, publisher epoch, revision, request ID, expiry and nonce) with AES-GCM, restricts sender roles and binding states, and bounds wire size to 32 KiB. Nonces are reserved durably; node/state checks precede Keystore work and are revalidated with immutable binding identity under a database transaction. Keystore unwrapping stays outside that transaction. Expiry is checked again after cryptography using elapsed time. Review caught and resolved revocation and expiry races. API-36 emulator acceptance passes 13 tests, including a 40-operation ECDH regression, concurrent revocation, authenticated metadata/ciphertext rejection and delayed-expiry rejection; the final admission-only adjustment passes the three affected envelope tests. Logs: `android36-envelope.log` and `android36-envelope-final.log` in the existing local evidence directory. Enrollment now also checks expiry after Keystore returns. Replay/deduplication, transport publication ordering, pending-binding reconciliation and product integration remain outstanding.

The enrollment controller now connects the closed native packet codec, both-screen confirmation, durable pending binding, and authenticated acknowledgement. Lost-ACK recovery after watch-process restart and durable cancellation followed by replay are exercised with simulated transport; actual Google Data Layer wiring remains next. A single native worker admits at most eight queued jobs. Timeout prevents later effect admission; an already-admitted effect yields `unknown`, without spawning replacement workers. Five JVM tests and six API-36 controller/store tests pass; independent review fixes for cancellation durability and timeout/effect races are included. Pending records expire after 120 seconds and cannot activate after that deadline. This remains native component integration, not phone/watch application acceptance.

The current integration slice registers the same role-bound Expo module and Google Data Layer listener in the phone and watch Android builds, adds a phone watch-settings entry and a watch enrollment screen, and keeps product pages explicitly waiting for phone data. Cancellation now fences queued enrollment commands by generation and scopes delayed session cleanup; four API-36 controller instrumentation tests pass, including a queued-begin/cancel/new-begin regression. Both generated Expo projects compile the module's debug Kotlin target, phone/watch TypeScript checks pass, and the revised watch Metro Android bundle exports. The generated watch debug APK builds with package `com.stably.orca.mobile`, watch feature, min SDK 33, and signing-certificate SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`; it has no standalone JS bundle and has not been installed. Paired Data Layer exchange remains unverified. Independent source review found no remaining blocker in the cancellation fix, but this is not yet an installed or functional product.

Read-only inspection of the installed phone APK reports signing-certificate SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`; both local phone and watch debug keystores report the same fingerprint. This resolves the earlier unknown-signature concern for an internal debug-key update only. No phone/watch package was installed or replaced. Before installation, build the exact APKs, verify their signatures and version codes, and complete functional integration. The physical watch endpoint is presently absent; emulator/source work continues independently.

The portable `wear.dashboard.v1` decoder now admits only closed host, page, usage-group, active-provider and window fields. It rejects unknown sensitive fields, oversized/noncanonical JSON, invalid percentages and counts, broken group references, duplicate provider/host account groups, and dashboards whose future timestamp would extend the 24-hour expiry. Nineteen focused fixtures, TypeScript checking, lint, and independent source review pass. A UUID-shaped `groupKey` alone does not prove opacity; the phone projection must generate binding-scoped random keys and test that raw account identifiers never cross. No dashboard is published or rendered yet.

The phone's pure usage projection now maps only active provider status, session/weekly percentages, reset timestamps, and freshness. It merges Claude by normalized email plus organization UUID and Codex by provider plus workspace account ID only when the rate-limit runtime target selects that managed account; absent or incomplete identities remain separate. The freshest reading records its exact `readingHostId`, and account IDs, email, errors, buckets, reset descriptions, and runtime targets do not enter the projected group. Nine mobile fixtures, mobile typecheck, lint, and independent source review pass. A binding-scoped random-key owner, live host catalog, encrypted Data Layer publication, watch rendering, and physical acceptance remain open.

The existing phone host-client registry now has one process owner shared by the React provider and prospective background tasks. A separate lifetime retains its client when UI unmounts; the final lifetime cancels pending opens and retries, removes revival listeners, and closes retained clients. The UI/background overlap regression and 36 existing transport tests pass, as do mobile typecheck, lint, format, and independent source review (`b34bb9977`). This establishes the socket owner only: no headless registration or same-runtime Android proof exists yet, and no full paired-host catalog, dashboard publisher, watch consumer, or physical product acceptance has been implemented.

The phone now creates binding-scoped opaque usage keys with Android-backed random bytes and maps verified account identity to those keys without transmitting account identifiers. Seven focused tests, mobile typecheck/lint/format, and independent review pass (`e0c5d24e7`). This key owner is not yet connected to a live dashboard projection.

The native dashboard unit adds revision-specific authenticated Data Items, a persistent publication/cleanup ledger and monotonically consumed revisions, current-item expiry, a bounded retrying cleanup drain, and watch restart/bind catch-up. The watch stores only the decrypted minimized snapshot in no-backup SQLite and rejects replay or expired rows; TypeScript checks the full closed dashboard again after the native read. API-36 instrumentation passes 25 tests, including eight focused store/drain tests; native phone/watch module Kotlin compilation, mobile/watch typechecks, three watch repository tests, and scoped lint/format pass. Independent source review found no remaining blocker in this bounded unit. Actual DataClient timeout/process-death ordering, paired transfer, live phone projection, watch rendering, and physical-device acceptance remain unverified. The phone publisher adapter exists but has no live caller yet.

The mobile runtime-read gate now probes the authenticated host, declares only advertised inventory/structured read capabilities, and clears readiness at every socket replacement. Wear subscriptions can opt out of automatic replay on both direct physical reauthentication and logical relay/direct cutover; the observer must dispose and reopen them after declaration. The default replay behavior for existing subscribers is unchanged. Twenty-seven focused and 39 transport regression tests, mobile typecheck/lint/format, and independent source review pass. This gate is not yet wired to the all-host observation coordinator, and it does not prove real paired-host inventory delivery.

The phone's bounded dashboard projection now retains every paired host including credential-unavailable entries, uses explicit `unverifiable` for lost contact, projects only opaque active-account usage, and publishes truthful host and usage truncation metadata. A clipped host can still contribute the freshest reading to a retained verified group; a clipped group never leaves a dangling host reference. The decoder reserves the 133-byte native envelope overhead, and an API-36 instrumentation test sealed/opened exactly 32,768 wire bytes and rejected one byte beyond it. Four native envelope tests, 14 focused phone tests, 20 contract tests, three watch repository tests, phone/watch typechecks, scoped lint, and independent source review pass. This is a pure projection and contract unit: live host observation, account subscriptions, detail paging, encrypted publication call site, and watch UI remain open; no physical product device was changed.

The phone's per-host inventory observer now opens `session.tabs.subscribeAll` only after post-auth capability negotiation, with automatic stream replay disabled. An old host can still supply incomplete legacy inventory; only a negotiated, explicitly authoritative census can make an empty agent count authoritative. Unpublished worktree placeholders preserve old rows until a real publication, explicit removals retain version fences, and working/attention counts expire on the clock even with no further stream traffic. Ended/error streams and transient declaration failures retry with bounded backoff, while socket replacement and disposal fence old callbacks. Sixteen focused tests, mobile typecheck/lint and independent source review pass. The observer is not yet acquired by a process-level all-host coordinator; structured sessions are counted as present but do not claim a working/attention state without a separate explicit state feed. Live paired-host delivery, fair background refresh, phone dashboard publication, and physical acceptance remain open.

Home now uses a process-owned `HostObservationCoordinator` for `accounts.subscribe` and the existing phone notification replay path. Overlapping Home/Wear observers share one account and one notification subscription per connected host; Wear inventory remains on-demand and singular per observed host. Disconnect closes account/notification streams, client replacement clears cached account identity and inventory and fences retired callbacks, and final release tears down all observers. Thirty-three focused/notification regression tests, mobile typecheck/lint/format, and independent source review pass. The coordinator is an ownership seam only: no all-host background acquisition, fairness schedule, live dashboard publisher, or paired-device proof exists yet.

The Wear host feed now loads the full paired catalog and rotates at most three Wear-owned live acquisitions every 30 seconds across credential-ready hosts. It uses the shared process owner and observation coordinator, observes already-open Home clients, clears account identity on client replacement or credential loss, and labels retired inventory incomplete while dropping stale live-status counts. Six focused feed tests, mobile typecheck/lint/format, and independent review pass. The rotation interval and concurrency cap are provisional until physical battery/freshness measurement. Live dashboard publication, detail pages, foreground/background lifetime, and paired-device acceptance remain open.

The phone root now starts a foreground-only dashboard publisher when the Android app is active and at least one native watch binding exists. It turns live host observations and active account readings into the closed minimized dashboard for every binding, with distinct binding-scoped opaque usage keys, native-reserved revisions, coalesced encrypted publication, and delayed retry after failure. It re-reads the feed after revision reservation, skips removed bindings, and releases Wear-owned host acquisition when the app backgrounds. Six publisher tests and 25 combined focused tests, mobile typecheck/lint/format, and independent source review pass. `companionState` remains `unavailable` until peer reachability is observed; no physical paired transfer, scheduled Headless JS/background refresh, detail paging, conversation/action path, watch product UI, or battery/freshness acceptance has been proved.

The watch now reads the native authenticated dashboard store on binding, matching dashboard events, and foreground resume; it rejects expired or mismatched envelopes, fences a prior phone's view synchronously on binding switch, and expires a visible snapshot on its deadline. Attention, Agents, and Usage render bounded snapshot summaries with full date/time, incomplete-inventory and clipped-page labels, and active-account usage without account identifiers. Four focused watch read/binding tests, watch typecheck/lint/format, independent source review, and a bundled `assembleRelease` build pass. The release APK (74,606,095 bytes, debug certificate `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`) cold-started on a disposable API-33 small-round AVD; its unbound screen and scroll to phone selection were visually observed. The first debug APK required Metro and did not establish startup. An older installed Orca package on another AVD rejected the test APK as a downgrade and was left untouched. Bound dashboard delivery/rendering, transient agent/event detail and pagination, replies, rotary/TalkBack, physical watch acceptance, and battery/freshness proof remain open.

The native phone action inbox now has a separate no-backup SQLite store for supplied ciphertext and a canonical hash only. It bounds pending rows to 64 globally and eight per binding, supports duplicate/conflict admission, expires rows, reclaims timed-out claims with replacement tokens, and deletes a row only for an exact claim/hash handoff; binding removal clears its rows. The ACTION envelope itself now enforces an 8-KiB total encrypted wire limit on seal and open. Nine API-36 instrumentation tests across inbox and envelope pass, including 8,192/8,193-byte boundaries and restart recovery. This primitive is not connected to `WearCompanionListenerService` or Headless JS; receive-side authentication before insertion, native rejection receipts/rate limits, JavaScript journal handoff, exact-target runtime execution, and physical action delivery remain open.

The phone listener now accepts only bounded `/action` messages for its role, authenticates the active binding/node and envelope, validates the canonical action against every authenticated header field, and inserts only ciphertext plus its hash into the bounded inbox. The published dashboard record now retains its epoch, and admission checks that epoch and revision inside the same binding transaction used by publication completion; a superseded snapshot cannot enter the inbox. API-36 instrumentation passes all 34 native tests, and the Wear and phone Expo modules compile from refreshed local package copies. Independent source review found no remaining blocker in this bounded receive unit. Rejection receipts, rate limiting beyond the existing queue/inbox caps, product Headless JS claim/handoff, durable JavaScript journal, runtime execution, and paired action delivery remain open. The published-dashboard schema is unshipped isolated companion state; no production phone package or data was changed.

Native inbox insertion now atomically applies persisted per-binding read/lease, send, refresh, and handoff admission budgets. Reads are capped at 30 per rolling minute and four per two-second burst; sends at ten per rolling minute and two seconds apart; refresh and handoff at ten- and five-second gaps. Duplicate/conflicting request IDs return without spending another slot, including within the short admission window after ciphertext handoff. The ledger uses elapsed real time and Android boot count, not wall time; an unknown boot fails closed, and a changed boot with prior admissions stays closed until 60 seconds into the new boot. The rate ledger is globally capped at 4,096 recent entries and pruned on insertion. API-36 instrumentation passes all 39 native tests, including restart, wall-clock jumps, reboot, and replay; phone and Wear module release Kotlin compile, and independent review found no remaining blocker in this bounded unit. The 60-second admission history is not the durable execution journal; encrypted rejection receipts, Headless JS, runtime sends, and paired-device delivery remain open.

The native action database now has a metadata-only command journal. A claimed canonical action is revalidated against the stored hash and exact claim token; one SQLite transaction records its immutable action/target fences and deletes the encrypted inbox row. Missing bridge acknowledgement recovers through the same journal key, while conflicting hashes cannot replace it. A separate persisted effect-start transition admits at most one executing command per binding; accepted/rejected/unknown terminal states are retained for deduplication, with 16 unresolved rows per binding and 2,000 rows total failing closed when full. Elapsed-time plus boot fences prevent stale unstarted commands from executing after clock changes or reboot, release their open capacity as `unknown`, and prevent a forward wall-clock jump from pruning terminal deduplication or an active effect early. All 47 API-36 native instrumentation tests and phone/watch module release Kotlin compiles pass; independent read-only review found no remaining bounded blocker. This storage seam is not exposed to JS yet and has not executed a host RPC or delivered a watch receipt. Product Headless JS, exact-target runtime sends, encrypted receipts, notifications/background refresh, device acceptance, and Windows SSH durability remain open.

The phone-only Expo module now exposes narrow claim/decrypt, atomic journal handoff, journal lookup, effect start, and effect finish methods. A claimed ciphertext is reopened under the active binding and pinned peer node; native admission rechecks its authenticated header, canonical bytes, and hash before returning transient plaintext to phone JS, then clears native buffers. Handoff and effect start recheck the active binding under the binding transaction. No binding key, arbitrary RPC method, or watch-side command API is exposed. The phone and Wear module release Kotlin compiles, both TypeScript workspaces typecheck, scoped lint/format passes, all 47 API-36 native tests pass, and independent source review found no bounded blocker. Product Headless registration, execution-time target/publisher freshness, authoritative host receipt reconciliation, encrypted watch receipts, and physical delivery remain open.

The receipt payload now has a closed shared TypeScript contract and native Kotlin codec: binding/request/hash, accepted/rejected/unknown, a fixed rejection reason, and a 120-second lifetime within 1 KiB. Two TypeScript fixtures and 49 API-36 native instrumentation tests pass, as do Wear module release Kotlin compile, TypeScript check, lint, format, and independent contract review. This is payload validation only: no receipt has been sent, correlated to a pending watch action, or derived from an authoritative host outcome. Those delivery/recovery gates, product Headless execution, exact-target runtime work, and physical acceptance remain open.

The phone journal now persists a closed terminal rejection reason, and its Expo bridge can send only a journal-backed terminal result as an encrypted receipt. The watch Expo bridge can validate and encrypt a canonical current-dashboard action, record its hash before transport, and accept a receipt only from its pinned phone for the exact pending binding/request/hash. Accepted or rejected results cannot be downgraded; unknown can resolve later. The watch store uses boot-aware elapsed time for pending expiry and 30-day terminal retention, so wall-clock changes do not strand slots or erase deduplication. Fifty-five API-36 Android instrumentation tests, phone/watch native release Kotlin compiles, both TypeScript checks, scoped lint/format, and independent review pass. Product JS does not yet invoke this path, the phone does not yet wake Headless JS or issue native admission rejection receipts, and paired-device delivery/process-death acceptance is unproved. Host execution, real conversations, background refresh, notifications, physical watch installation, and Windows SSH send durability remain open.

The phone now registers a bundled Headless JS drain and wakes it after native action insertion; foreground startup and resume also drain persisted inbox rows. Journal terminal receipts are attempted in bounded batches and retained for a persisted JobScheduler retry until MessageClient success. A scheduling gate preserves an already queued job and covers a request racing a completed job's removal. Sixty API-36 instrumentation tests, four phone drain tests, phone/watch native release Kotlin compiles, both TypeScript checks, scoped lint/format, merged release manifest inspection, Metro export, and read-only review pass. The drain currently closes actions as `unsupported`: it has not executed a host command. Actual background Headless wake and retry delivery remain installed-device gaps. Exact-target runtime execution, rejection receipts at native admission, watch action UI and conversations, notifications/refresh, SSH durability, and physical product acceptance remain open.

The host now advertises an optional `wear.action-target.v1` capability and a mobile-only `wear.target.resolve` read. It resolves a current published workspace kind, epoch, version, and tab to one structured session or terminal/PTY pair under the authenticated phone's navigation projection. Unknown fields and mismatches fail closed; old clients keep their existing RPC contract. Seven focused host tests and seven phone capability-session tests pass, as do node/mobile typechecks, scoped lint/format, and independent read-only review. This is only a snapshot check: live agent sendability, publication freshness at the write boundary, durable host reservation/outcome, SSH ownership, and every actual Wear send remain unproved and unimplemented.

A separate host SQLite ledger now reserves `(bindingId, requestId)` under `BEGIN IMMEDIATE`, retains the supplied fingerprint and a pending outcome before any future write, and replays rather than re-executes the same request after restart. Changed fingerprints conflict; 16 unresolved rows per binding and 2,000 rows globally fail closed; a persisted clock watermark refuses new work after wall-clock rollback. Unknown can later resolve from authoritative evidence, while accepted/rejected outcomes cannot be changed. Five focused real-SQLite tests, node typecheck, lint/format, and read-only review pass. This storage unit is not yet wired to a runtime command or execution host; the caller must bind action expiry to the fingerprint, and abrupt power-loss durability, SSH relay reservation, and actual send acceptance remain unproved.

The host now has a capability-gated `wear.terminal.send` RPC for authenticated
mobile clients. It reserves the full action fingerprint before local native PTY
submission, replays recorded outcomes without another write, and refuses
SSH/WSL targets. A read-only review found an async status-probe race; the writer
now checks publication, PTY identity, and action expiry synchronously before
paste bytes and Enter. Focused host/writer and phone negotiation tests plus
typechecks pass. The phone drain still returns `unsupported` and does not invoke
this RPC, so no watch action has reached an agent. Structured sends,
authoritative receipt query/reconciliation, phone integration, actual
conversations, physical delivery, and remote execution-host durability remain
open.

The phone drain now executes `sendAgentMessage` only through the exact paired
host's negotiated Wear terminal capability. The host returns the SHA-256 hash
of the canonical action with every outcome; the phone accepts a result only
when it matches the native journal hash. It queries the host ledger after an
interrupted effect and never resends that action. A persisted retry job is
scheduled before ciphertext handoff, and restart recovery retires stranded
unstarted or currently unsupported actions to an `unknown` watch receipt.
One reconciliation candidate is claimed fairly per wake. Eighteen focused
TypeScript tests, 63 API-36 native emulator tests, node/mobile typechecks,
phone native compile, and scoped lint/format pass. These are component tests:
no paired phone/watch command delivery or physical background recovery is yet
proved. Structured-agent and SSH execution-host sends, actual conversation
views, notifications, background refresh, and installed-product acceptance
remain open.

The portable host-page contract now defines a bounded, 120-second, encrypted
PAGE payload correlated to the exact watch action hash and dashboard
epoch/revision. It validates each host with the dashboard's existing host
schema, limits pages to 16 distinct entries, checks offset/total and cursor
progress, and reserves 512 bytes of envelope headroom. Contract and dashboard
tests (22 total), Wear typecheck, lint, and format pass. The next bounded unit
connects `readHostPage` to the phone's paired-host catalog, sends the exact
action-bound PAGE through the encrypted native Data Layer, retains up to eight
transient watch pages, and renders a paged All machines view. Native final-send
admission checks the current dashboard publication and action state; the watch
checks the action hash, binding, epoch, revision, cursor, and offset before
display. Ten phone, four focused Wear, and 67 API-36 native tests pass;
phone/watch typechecks, native Kotlin compile, Wear release APK build, and
disposable Wear emulator install/start pass. This does not prove paired PAGE
delivery: no physical watch endpoint is online. A content-derived cursor now
rejects a changed paired-host catalog between pages; Refresh machines restarts
the walk.
Agent detail, real conversations and structured/SSH replies, notifications,
background refresh, all-host freshness, and installed physical acceptance
remain open.

The next agent-detail foundation retains bounded terminal and structured tab
identities, titles, explicit status freshness, and publication fences in the
existing phone Wear inventory. A portable `wear.agent-page.v1` contract and
projection define 12-row pages, a content-derived inventory cursor, exact
binding/action/dashboard/host fields, and nullable workspace kind when the
host's folder catalog is unavailable. Two contract and seven phone inventory/
projection tests pass. This foundation does not answer `readHostAgents` yet:
selected-host RPC acquisition, native PAGE delivery, watch rendering, and
all-host folder/SSH/structured acceptance remain open. The earlier plan text
that said negotiated mobile clients could not see Codex structured tabs was
corrected against the current capability-gated runtime projection.

The selected-host agent path now reads terminal and structured tab inventory
through one negotiated paired-host client, projects bounded 12-row pages with
current publication fences and status deadlines, and sends only a journal-
correlated encrypted PAGE. Native final-send admission rechecks the action,
current publication, and expiry; the watch checks the exact request, action
hash, binding, dashboard, host, cursor, and offset before rendering. Changed
host catalogs and agent inventories invalidate their content-derived cursors.
The watch hides unavailable machine pages, downgrades unavailable/expired
agent status, and refreshes expiry on foreground resume. Twenty-three focused
phone and eight Wear tests, 68 API-36 native tests, both TypeScript checks,
native phone Kotlin compile, scoped lint/format, and a Wear release build and
disposable emulator install/start pass. Emulator start proves only launch of
the unbound app; actual paired PAGE delivery and visible bound-agent state are
unproved. Conversation reads, exact-target reply UI and structured/SSH sends,
usage/notification background refresh, physical installation, and end-to-end
acceptance remain open.

The host now advertises a separate `wear.conversation-read.v1` capability and
accepts only an authenticated mobile read of the exact current workspace,
kind, tab, publication epoch, and snapshot version. It derives terminal
transcript identity from that tab, refuses remote terminal fallback to local
files, and reads structured history only under its separate negotiated
capability. It rechecks the target after the read, returns at most 20 text
messages under a 28-KiB body budget, and marks any clipped message. Six
focused read tests, existing target tests, node/mobile typechecks, mobile
negotiation tests, scoped lint/format, and read-only review pass. This is a
host read primitive; non-text blocks and SSH transcript routing remain named
gaps.

The phone now executes `openConversation` through the negotiated exact-target
host read and sends a closed, 18-field, journal-correlated encrypted PAGE. The
watch verifies the action hash, dashboard, host/workspace/tab and publication
fences before showing a transient text-only preview. It marks shortened
messages and older-page limits, labels transcript authors without asserting
who operated them, discards the view at expiry, and retries bounded native
action/PAGE races without accepting a late result after rejection. The native
watch store remains volatile. The contract and watch repository pass four
focused tests, phone projection/drain pass 12 focused tests, and API-36 native
acceptance passes 69 tests. This is a one-shot preview, not a completed
conversation lease or live follow; rendered bound-device delivery, non-text
history, older pages, typed/dictated replies, SSH relay reads, background
refresh, and physical acceptance remain open.

The watch now offers a typed reply only for an exact, current terminal target
with a verified conversation PAGE. It persists the request ID, action hash,
target tuple, and recovery identity before transport; receipt state never
regresses from accepted/rejected, and uncertain delivery blocks another send
until the user checks the named machine, workspace, and tab on the phone and
explicitly releases it. The host's durable local PTY ledger remains the final
deduplication authority. Five focused Wear tests, Wear typecheck/lint/format,
independent safety review fixes, and a release APK build/install/start on a
disposable emulator pass. A bound paired-device reply and post-restart UI
recovery remain unproved; structured/SSH replies, live conversation updates,
notifications/background refresh, and physical acceptance remain open.

A current dashboard can now request an on-demand phone refresh. Foreground and
Headless JS share one publisher; the phone reloads the paired-host catalog and
acknowledges the watch action only after the exact binding, epoch, and revision
are recorded as published by the native Data Layer. The watch shows pending,
rejected, and uncertain states and retains the snapshot timestamp. Four focused
mobile test files (29 tests), both TypeScript checks, scoped lint/format, phone
Kotlin compile, and a release APK build/install/start on a disposable Wear
emulator pass. A paired watch receipt, refreshed data while the phone is
backgrounded, autonomous background/notification refresh, and refresh after
dashboard expiry remain unproved.

The watch now has a transient Inbox path for retained notification dispatches,
one paired machine per request. The desktop replay adds dispatch time and an
optional version marker; the phone durably seeds a binding-and-host-key-specific
sequence floor on first read, showing no older entries, and rejects older hosts
without the marker. Later reads return only redacted event kinds and times,
apply dismissals, and label unavailable machines. Native PAGE admission is
bound to the journal action and current dashboard; watch decode correlates
request/hash/revision/cursor and expiry. Focused runtime, mobile, Wear, and
API-36 native tests pass; paired watch delivery remains unproved. This is
not yet the planned session-scoped Attention feed: safe event-to-agent
navigation, autonomous background refresh, and physical notification parity
remain open.

On 2026-09-24, a fresh Wear API-33 emulator and disposable Android API-36
phone paired at the OS level and discovered each other in Orca. Their first
app enrollment reached the binding acknowledgment, which the phone rejected:
the watch clock was about four seconds ahead, while native envelope admission
allowed no skew beyond the declared 120-second lifetime. The receiver now
allows 30 seconds of clock skew without extending the packet's absolute
expiry; seven API-36 envelope instrumentation tests pass. With rebuilt APKs,
both screens showed the same comparison code, the phone showed “1 paired
watch,” and the watch showed Attention, Agents, Usage, Inbox, and an actual
phone snapshot timestamp and attention counts. This proves native binding
and paired DASHBOARD delivery on disposable emulators. Command PAGE delivery,
real host data and replies, autonomous background behavior, and physical
watch acceptance remain unproved.

Both release APKs were rebuilt from clean product source and updated on that
disposable pair without losing the binding; the watch received a newer phone
snapshot. The only catalog host on that emulator reports authentication
unavailable, so this does not prove host PAGE or reply delivery. Receiver PAGE
and receipt decoders now share the envelope's bounded 30-second clock-skew
allowance while sender lifetime and absolute expiry remain strict; focused
contract tests and 73 API-36 native instrumentation tests pass.

Structured Codex replies now use a separate negotiated Wear send capability.
The phone resolves the exact published tab before routing, and the host checks
the publication, session lease, and action expiry immediately before provider
issue. A durable Wear receipt links to the structured operation and journal so
ambiguous outcomes can be reconciled without resending; terminal and structured
methods reject cross-method request-ID collisions. The watch composer accepts a
matching structured conversation PAGE through the same persistent reply guard.
Focused host, phone, and Wear tests and typechecks pass. A live paired structured
send, journal recovery after process restart, and physical-watch acceptance are
still unproved. SSH-host replies, autonomous refresh/notifications, live
conversation follow, and full-product acceptance remain open.

The committed phone and Wear release APKs installed on the existing disposable
Android API-36 phone/Wear API-33 emulator pair without losing their binding.
With the phone on the launcher, a watch refresh advanced the displayed phone
snapshot. After `am kill` ended only the background Orca test process, a new
watch refresh started a new phone process while the launcher stayed top-visible;
the watch snapshot advanced from 5:31 to 5:33 PM. This proves watch-initiated
Headless refresh after ordinary process reclamation on this emulator. A further
watch refresh advanced the snapshot to 5:35 PM while the phone reported
`mWakefulness=Asleep`. Neither test proves host-initiated notification wake,
Doze timing, an authenticated host read, or physical-watch behavior. The test
phone's sole desktop pairing reports invalid authentication, so paired
conversation/reply delivery remains unproved.

SSH terminal conversation reads now execute on the owning relay host through a
bounded text-only transcript-tail RPC. The desktop rechecks the published tab,
PTY, transcript identity, and SSH provider after the read; an older relay or
disconnected route returns unavailable without reading a local file. Folder
workspace targets now match their published `folder:<id>` key during Wear
resolution, including send and current-target checks. Twenty-four focused
host/relay tests, 15 cross-version wire tests, node/CLI typechecks, relay
bundle build, and scoped lint pass. The SSH path has no live paired-host proof;
SSH replies still lack host-side durable issue/deduplication. Host-initiated
background delivery, authenticated PAGE/reply, and physical-watch acceptance
remain open.

An isolated source-built headless Orca host passed a real terminal nonce
roundtrip, then paired with the disposable API-36 phone without changing its
existing pairing. A throwaway repository appeared under connected Host 2 in
the phone UI; the paired Wear API-33 emulator showed Host 2 as connected in
its live Agents dashboard. The watch requested and displayed the complete
two-machine host PAGE, then opened Host 2's agent PAGE, which correctly showed
zero of zero agents. A rebuilt watch APK also automatically reloads the host
PAGE after dashboard revision changes and retains the selected host's display
name. This is authenticated host and empty-inventory PAGE evidence, not agent
conversation or reply evidence. The catalog PAGE currently labels connection
status unverified even when the dashboard has a live connected observation;
that presentation gap and a live roundtrip through an existing authenticated
agent remain open.

An Orca-managed Codex terminal was created only in that throwaway repository.
The source-built host published it; the watch Agents dashboard changed from
zero to one agent, and Host 2's agent PAGE displayed the terminal row with
status unavailable. The isolated Codex profile reached its sign-in screen;
no prompt was sent, no conversation was returned, and no reply can be claimed.
Owner correction: that test terminal was retired, and signing in or creating
another profile is not a prerequisite. Continue validation with existing
configured, authenticated agents and paired machines. Inspect the exact
identity and idle state before one harmless bounded reply test; leave busy
sessions untouched and preserve all existing profiles and pairings.
The host catalog view now omits its static, misleading connection and
inventory labels; live connection remains on the dashboard and detailed
inventory authority on the agent page.

Watch conversation selection now follows a newer snapshot version only for
the same workspace, tab, kind, workspace type, and host publication epoch.
An absent or unverifiable current target hides the composer and offers a path
back to agents; a new host epoch requires explicit reselection. The Wear
typecheck, lint, 140 tests, and rebuilt release APK pass on the paired emulator.
The existing authenticated host inventory can be inspected read-only, but no
currently observed agent has yet met the idle, exact-identity gate for a
harmless reply; none has received a test prompt.

The open watch conversation now requests a fresh preview every 30 seconds
while foregrounded, and again on foreground return, including after an expired
page. Refresh pauses while reply delivery is pending or uncertain. Wear
typecheck, lint, 140 tests, release build, and installation/launch on the
already-paired disposable watch emulator pass. This does not prove a live
conversation changed on screen: the disposable host has no authenticated
agent. Read-only checks of three existing configured agent terminals found
work-in-progress previews and no explicit idle/wait state, so no reply test
was sent. The physical watch remains absent from ADB. Outstanding acceptance:
an authenticated existing-agent conversation and harmless exact-target reply,
SSH host-side send durability, autonomous host-originated notification delivery,
real usage/freshness, and physical watch installation and operation.

An unsent reply draft now survives the temporary conversation-view unmount
caused by inventory revalidation. It is keyed to binding, host, workspace,
tab, and host publication epoch, so it cannot carry into a different target;
an accepted receipt clears it. Wear typecheck, lint, 140 tests, and the rebuilt
release APK install on the disposable watch emulator pass. The draft-retention
behavior still needs an interactive watch check with a live agent page.

An SSH relay file-journal prototype passed sequential restart tests but failed
independent safety review: Windows cannot prove its newly created reservation
directory entry survives power loss, and concurrent relay processes could race
capacity and outcome updates. The uncommitted prototype was removed; no SSH
reply route was enabled. A host-owned transactional, durable reservation and
receipt remains required before the SSH send capability can be advertised.

The phone publisher now compares each binding's redacted projected dashboard
content before reserving a revision. An added second watch only publishes its
own binding; a host update consumed during a reservation does not republish;
explicit refresh and a five-minute freshness heartbeat still publish. Mobile
typecheck, lint, formatting, and all 79 Wear tests pass. The multi-ABI release
APK built and installed on the disposable paired phone emulator. The watch
loaded both paired machines' Inbox pages; Host 1 was unavailable and Host 2
reported no retained events. A synthetic bell attempted through an isolated
shell received only an old-host input-accepted receipt, its terminal stream
did not prove bell execution, and no watch event appeared. Treat terminal-bell
delivery as unproved, not a passing acceptance test. The physical watch is
still absent from ADB; no existing busy agent was sent a prompt.

Read-only structured-send review exposed two host-side defects. The Wear
operation ID did not match the structured journal's timestamped admission
format, so a real native session would refuse the send despite mocked RPC
tests; folder targets also used the raw folder ID where the published key is
`folder:<id>`. Both are corrected. The operation ID is stable across retries,
bound to the canonical action hash, and checked by the real operation-admission
function in focused tests. These tests do not prove provider delivery or an
installed-device structured reply. Native local Codex remains the only
currently supported structured-send path; SSH/WSL and other provider paths
need separate owner-side implementation and acceptance.

The paired API-36 phone and API-33 watch emulators passed a process-cold,
watch-initiated dashboard refresh. With the phone on its launcher, `am kill`
removed Orca PID 26048; the watch's Refresh action started PID 26568 without
bringing the phone UI forward, and its displayed phone-snapshot time advanced
from 8:00 PM to 8:04 PM. This proves the authenticated ACTION → Headless JS →
phone dashboard publication path for this emulator pair. It does not prove a
screen-off/Doze case, host-originated wake, notification delivery, or the
physical watch. Source audit confirms the phone's live host feed is released
when React Native enters background; once the process dies there is no
host-to-phone wake source. The existing receipt JobScheduler handles only
pending receipts, and the phone's local notification bridge requires a live
host subscription. Autonomous host-originated delivery remains an open
architecture and installed-device gate.

The phone now schedules an app-scoped, persisted 15-minute JobScheduler refresh
only while at least one watch binding exists. A scheduled run starts bundled
Headless JS, refreshes every active binding, and explicitly completes its native
job; stopped runs abort the host feed, and stale run IDs cannot finish a later
job. On the paired API-36 phone/API-33 watch emulators, the release APK built
and installed; after `am kill` removed the background phone process, a forced
app-specific job started a new process while the launcher remained on top,
finished in about 3.5 seconds, and advanced the watch's phone snapshot to
8:44 PM without a watch tap. Mobile typecheck, scoped lint/format, and 86 Wear
tests pass. This is best-effort periodic freshness, not immediate host-originated
notification delivery: Android may defer periodic jobs, no screen-off/Doze or
physical-watch behavior was tested, and the real existing-agent conversation,
safe idle reply, SSH send durability, and physical acceptance remain open.

The scheduled phone job now keeps its host observation alive through
notification catch-up and rotates across every authenticated catalog host
within a bounded 35-second run. A first phone subscription records the
desktop's current sequence as an optional ready-frame baseline, so later jobs
replay only events dispatched after pairing. Delayed or failed watermark
storage reads remain unknown rather than authorizing a new baseline; a timed
out read allows live delivery without advancing the cursor and catches up when
it completes. A failed baseline write keeps the in-memory cursor for the
current process. Phone notification/Wear tests (156), desktop replay/RPC
tests (14), both TypeScript checks, and scoped lint/format pass. The optional
field preserves old-client decoding; an older desktop runtime without the
baseline cannot safely recover notifications after a first pairing with no
live event, so that host needs a runtime upgrade for this guarantee. This
does not establish timely host-originated wake or a physical notification:
Android may defer the periodic job, and installed-device delivery still needs
direct evidence. The existing authenticated agents remain the validation
targets; no disposable profile or sign-in is required. Send a harmless
acknowledgement only after an existing session's exact identity and idle state
are verified; no such reply has been sent.

The final source APK (`3A1883B5CB3F517EA22AD0547E51B38EDF378755E9B51C2DB26BC59BE9D828C2`)
installed on the already-paired disposable API-36 phone emulator. With the
launcher on top, `am kill` removed the phone process; the forced app-specific
job started a new process, advanced the API-33 watch's visible phone snapshot
from 9:20 to 9:24 PM without watch input, and called `jobFinished` after
about 33 seconds, below the native 90-second stop bound. Its emulator host
connections were unavailable or unauthorized, so no host notification was
delivered and this is not physical-device or screen-off acceptance.

SSH Wear send remains disabled. The first host-side unit now proves the relay's
primary channel before exposing its multiplexer to Wear: a one-use,
generation-bound challenge is accepted only from the live SSH primary, while
an endpoint-credential-authenticated primary is already proved. Its logical
owner principal matches the endpoint-credential socket across reconnects so
existing PTY leases can be recovered; a superseded reconnect cannot replace
the current proof. Older
relays fail closed for Wear send. Focused relay/SSH tests, the Node 18 relay
subprocess suite, node typecheck, and scoped lint/format pass. The bundled
conversation reader was also made Node 18 compatible. This is authentication
substrate, not a remote-write receipt: host-owned durable admission, exact PTY
incarnation checks, failure recovery, and end-to-end watch delivery remain
open. No existing agent received a test message.

A POSIX slot-file receipt prototype was removed after review found a pruning
race that could erase a newly reserved command and crash-orphaned slots that
could exhaust capacity. Its single-process and same-key race probes do not
establish durable cross-process safety. SSH Wear send stays disabled until a
host-owned transactional receipt store passes concurrent reservation, pruning,
crash-recovery, and exact-PTY acceptance tests; no receipt from the generic
relay PTY notification is authoritative.

The bound watch now uses a single previous/current/next page row and places
each page's primary data before snapshot and refresh controls. On the paired
API-33 round emulator, the release APK
(`F5DC6C1CB79E44164B5D73B58673E753F007F8350387F24529CD2C3AAFC10FAC`)
installed over the existing test app
without losing its binding; Attention, Agents, Usage, and Inbox rendered after
page taps, with the Attention count visible on the first screen. All 140 Wear
tests, typecheck, scoped lint/format, and release build pass. This is emulator
layout evidence, not physical rotary, TalkBack, real usage, or host-message
delivery acceptance.

Phone-native Wear admission now records authenticated, canonical stale,
rate-limited, and busy actions as durable rejected command-journal rows. The
same SQLite transaction checks pending and journaled requests first, so an
exact replay keeps its prior outcome and a changed hash is a conflict. The
existing receipt job is scheduled from the native database effect even when
its work callback times out, and retries after phone process restart. Admission
rejections are capped at 32 per binding and 128 globally to reserve journal
space for actionable commands; beyond the cap the watch has no rejection
receipt and must show the request as unresolved. Malformed or unauthenticated
packets receive no receipt. The API-36 phone
emulator passed 76 native instrumentation tests, including reboot budget,
duplicate precedence, rejection persistence, and full-inbox behavior; the
integrated Expo module compiled. These are database and compile gates, not
proof of a phone-to-watch rejection receipt on a device. Existing authenticated
agents remain the inventory and conversation targets. An exact idle-session
reply, host-backed watch conversation, SSH durable send, notification timing,
real usage, and physical-watch installation and operation remain open.

The next bounded unit wires `requestPhoneHandoff` through the phone's existing
Wear command journal and local notification channel. A terminal target is
resolved with its workspace, tab, publication epoch, and snapshot version
before scheduling the notification and again on tap. The phone selects only a
matching renderable local terminal tab; a newer user tab choice cancels the
handoff, and an older same-epoch snapshot can wait up to 15 seconds for the
exact version. The watch now offers **Open on phone** in terminal conversations
and retains the request/hash across restart to recover its native receipt.
Structured-agent phone handoff remains unavailable because mobile has no
structured-agent session tab; the watch does not advertise that control there.
No new profile or sign-in was created. Validation must use the existing paired
machines and authenticated agents, and a reply test remains restricted to a
reverified idle exact session with a harmless bounded acknowledgement.
Focused mobile tests (36), all Wear tests (143), both TypeScript checks, and
scoped lint pass; these prove source behavior only. The full mobile run passed
3,983 tests but failed eight existing tests in seven untouched areas: seven
source-text checks sensitive to this Windows checkout's CRLF text and a
mock-server key-pair child-process import test. A phone/watch emulator
handoff, notification timing, real-host exact conversation/reply, actual usage,
and physical watch installation/operation are still required for acceptance.

Both release APKs built from commit `8e95ad10c` with offline Gradle:
watch SHA-256 `733FD05AA0E4CA057684515A0474D3BD3F4415082BFCC48CCE9BFE38BE80A875`
and phone SHA-256 `2DD88D72930E99B80447B07774202BB62D5D5F16F9DB359A2B0B01B0C066D790`.
Their signing certificate matched the already-installed emulator apps
(`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`).
Sideload updates succeeded on the existing paired API-36 phone emulator
`emulator-5556` and bound Wear emulator `emulator-5562` without uninstalling
either app. The watch launched to Attention with its binding intact; the phone
launched with its existing hosts intact. Another unbound Wear emulator
(`emulator-5560`) also accepted the watch APK and remained unbound. These
observations prove startup and update continuity, not notification delivery or
an agent conversation. The physical watch is still absent from `adb devices`
and no physical APK install has occurred for this commit.

The next bounded source unit enables **Open on phone** for structured agents
without adding an agent-management system. The existing exact-target host
resolution and `conversationRead` capability gate select a dedicated read-only
mobile conversation view; notification taps reverify the target, and the view
reads the existing `wear.conversation.read` RPC with the same publication epoch
and snapshot version. The latest tap wins if notifications verify out of order,
and a mounted view cannot show messages from a previous target while a new
read is pending. Focused mobile tests (20), all Wear tests (144), both typechecks,
and changed-file lint/format pass. This is source verification only: the new
view, notification timing, and a real structured-agent conversation have not
yet been accepted on a paired device. Validation uses Dhiman's existing
authenticated agents and paired machines; there is no disposable profile or
sign-in prerequisite. A reply test may use only a reverified idle exact session
and a harmless bounded acknowledgement; busy agents remain untouched. SSH
durable send, actual usage/freshness, physical-watch installation and operation,
and end-to-end receipt/recovery acceptance remain open.

Release builds from `f1bb8d30c` passed offline Gradle for both apps. Phone APK
SHA-256 is `AB497C4250F5BCF80C40E84C1A858132130597467D3549EF4CA687A3FFC49632`;
watch APK SHA-256 is `050C98A95056A19A60E3502515F060DAB726A77182E1BF34F2CBD34E49642BF5`.
Both report certificate SHA-256
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`,
matching the previously installed emulator certificate. In-place updates on
paired phone `emulator-5556` and bound watch `emulator-5562` returned `Success`;
both `MainActivity` instances resumed. This verifies packaging and startup,
not a structured notification tap or real host conversation. Physical phone
and watch were absent from `adb devices -l` and ADB mDNS discovery.

The selected-host phone client now gives a request its own bounded 25-second
deadline after the 15-second connection deadline. Previously the connection
timer stayed live after request start and could cut off the 20-second structured
conversation RPC at 15 seconds. The timing regression test, focused conversation
tests, mobile typecheck, and scoped lint/format pass. This is source evidence;
no real conversation has yet been read through the paired devices. The physical
phone later advertised `192.168.68.106:45379` over ADB mDNS, but TCP refused
the connection and neither physical endpoint entered `adb devices`; no physical
install or agent prompt was attempted. A read-only Orca inventory confirmed
three existing paired runtimes, but the visible agent terminals were active and
the idle terminals were shells, so there was no reverified idle agent for a
safe acknowledgement test.

The phone release bundle containing the conversation timer fix built with
offline Gradle, SHA-256
`30A00CC19F4C205FA0FFE7778B3E1601E893186D853EB0E023D881A1E9488FAC`,
under the same verified emulator certificate. An in-place update on paired
phone `emulator-5556` returned `Success`; phone and bound watch `MainActivity`
were both resumed afterward. This remains startup evidence, not a measured
20-second host response or a physical-device conversation.

The SSH terminal conversation route now uses only the current relay session's
proved primary channel. The provider exposes its Wear RPC only while the
session's authenticated mux matches the current provider mux, and the call
rechecks immediately before dispatch; a proof loss or replacement route stays
unavailable. The route still rechecks its target and provider after the host
read. Three focused test files (75 tests), node typecheck, scoped lint/format,
and independent read-only review pass. This does not enable SSH Wear sends or
prove a physical SSH transcript read.

Owner scope correction: validation uses the existing configured, authenticated
agents and paired machines. No disposable Codex profile, login, or new account
is required. The previously created isolated sign-in attempt is historical
evidence, not an active blocker. Before a reply test, reverify an existing
agent session's exact identity and idle state, then send only a bounded,
harmless acknowledgement; leave busy sessions and all profile data untouched.

An ARM64-only release build exposed a conflicting watch manifest plugin:
`with-wear-manifest.js` overwrote the companion module's `standalone=false` with
`true`. The duplicate metadata writer was removed. Expo config introspection
and the rebuilt watch APK now report `com.google.android.wearable.standalone=false`;
the APK contains only `arm64-v8a` native libraries, the bundled JavaScript,
package `com.stably.orca.mobile`, and certificate SHA-256
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
The watch APK SHA-256 is
`F0B40C87F1670266A290FC38F01DDAF500C1B791935539B6BF47B257B4E290C8`.
The matching ARM64 phone APK also built; SHA-256
`B6E4136038770BC830296D5A6D12A1FCFBC5AA09644B5C3C642B0E49870B6AF6`.
Its manifest contains the non-exported Wear Headless JS service and its APK
contains bundled JavaScript. No physical install or Headless JS wake occurred;
paired-device and runtime acceptance remain open.

Read-only source review found that each cold background publisher began host
rotation at the first three paired machines, starving later hosts when jobs
ended before the 30-second rotation. The existing Wear host feed now persists
its bounded rotation cursor across publisher restarts using the phone's existing
AsyncStorage dependency. Cursor read/write errors are reported while the full
catalog and a bounded live batch remain available; persistent storage failure
can still weaken cross-restart fairness. The watch Usage page now shows each
window's duration and reset time, labels retained error-state figures as last
known, and names the host that supplied the displayed reading (falling back to
its opaque ID when that host row is clipped). Focused publisher/background/feed
tests (31), both TypeScript checks, scoped lint/format, and all mobile Wear
tests (106) and watch tests (144) pass. Review-found cursor failure and
historical-reset wording issues were fixed. These are source checks, not live
usage readings or a measured background wake on Dhiman's devices.

Both ARM64-only release APKs were rebuilt after commit `35b797538`. Watch
SHA-256 is `CDC7BF1EB2E2207A6870EEAED79C3397C114BA349AF1D6B1D454F82C45023624`;
phone SHA-256 is `12F6FEF5D056E25FBCBE1E22B77DF5DA90C9D5811ADF33CB9CECFD8DB0F94B01`.
Both verify under signing certificate SHA-256
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`,
contain only `arm64-v8a` native libraries and bundled JavaScript, and share
package `com.stably.orca.mobile`. The watch manifest has `standalone=false`;
the phone manifest has the non-exported Wear Headless JS service. The physical
phone ADB endpoint still refuses TCP and the watch is absent from ADB, so
neither current artifact was installed on Dhiman's devices.

The scheduled notification replay now continues with a bounded host batch if
its AsyncStorage cursor cannot be read or written, logging a generic warning.
A failed read does not overwrite the last persisted cursor. Focused replay and
background tests pass; no physical notification delivery was observed.

Usage-group paging is now wired through the closed action manifest and generated
Kotlin validator, journal-backed native PAGE transport, phone action drain, and
watch "More accounts" view. The phone saves the complete opaque groups with the
dashboard before publication and retains the previous revision during a new
publication; page reads require the requested epoch/revision, and native send
requires the current published epoch/revision. Watch acceptance additionally
checks the pending action hash, cursor, offset, total, expiry, and dashboard.
Writes, binding removal, and startup cleanup share one phone-JS queue across
publisher instances. Cleanup checks current bindings when it runs and removes
only this cache's absent-binding keys before another publication. Publication
rechecks binding ownership after each wait. A read-only review found the
cross-publisher races; ordering tests cover them. The 160-group
page-walk test, all
mobile Wear and watch tests, both TypeScript checks, generated-source check,
Kotlin contract conformance test, scoped lint/format, and phone/watch release
Kotlin compiles pass. An individual group with enough source hosts to exceed
the 32-KiB page bound still cannot be displayed; no physical Usage page fetch
or process-death cache cleanup has been observed.

After commit `20d4474f0`, both ARM64-only release APKs rebuilt offline. The
watch APK SHA-256 is
`FF1FCDB3EC26FE243BBE3284C8EE52A82774D5A8D5C07CB6F35984B8566F6028`;
the phone APK SHA-256 is
`38D4B9EC5B88E858442215F3D2098258C589B939A5261365035AE8043F61E11E`.
Both contain bundled JavaScript, report only `arm64-v8a`, use package
`com.stably.orca.mobile`, and verify under certificate SHA-256
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
The watch manifest has `standalone=false`; the phone's Wear Headless JS service
is non-exported. ADB still lists only emulators. The physical phone's advertised
`192.168.68.106:45379` endpoint actively refused a connection, and the watch
did not appear. Neither current APK was installed on Dhiman's devices.

An x86_64 release build of that source was installed in place on test phone
`emulator-5556` and paired test watch `emulator-5562`, with both `adb install -r`
commands reporting `Success`; each `MainActivity` started. The watch retained
its phone binding and visibly rendered Attention (zero agents needing
attention, one host inventory incomplete), Agents (Host 2 connected with zero
agents; Host 1 also listed), and Usage (Claude unverified account, usage
unavailable, a reported timestamp and Host 2 source). The other Wear emulator,
`emulator-5560`, was unbound; its connect screen is not a pairing regression
for the paired `5562`. This proves installed emulator navigation and snapshot
rendering, not authenticated conversation, action delivery, Usage PAGE,
notifications, timed background wake, or physical-device behavior. No agent
message or production data change was made. The verified ARM64 checkpoint APKs
were restored to the canonical release output paths after emulator testing.

The paired emulator's on-watch "Refresh from phone" completed with a visible
snapshot timestamp advance from 1:21 to 1:26 AM. With test phone
`emulator-5556` on its launcher (`topResumedActivity` no longer Orca), a second
watch refresh advanced the timestamp to 1:27. After `adb shell am kill
com.stably.orca.mobile` on that test emulator (not force-stop), the old phone
process exited, a new PID appeared following a watch refresh, and the visible
snapshot advanced to 1:28. These observations support foreground,
backgrounded, and process-cold **watch-initiated** request/response on the
paired emulator. They do not prove host-originated autonomous wake,
screen-off/Doze timing, notification delivery, physical watch behavior, or a
real host conversation/reply.

The observed Attention label for one incomplete inventory had incorrect plural
agreement. Commit `f2ea6c197` corrects the watch copy. Wear typecheck, scoped
lint/format, and an offline ARM64 release build pass. The updated ARM64 watch
APK SHA-256 is `593AD96D25E44910C543C9CC57D0BA66DDEBC7134335C2D25BF753875731AD56`;
it contains bundled JavaScript and only `arm64-v8a` native libraries. The
matching phone APK remains the verified prior checkpoint with SHA-256
`38D4B9EC5B88E858442215F3D2098258C589B939A5261365035AE8043F61E11E`.
Neither current ARM64 artifact has been installed on Dhiman's devices.

The SSH relay's new Wear transcript-tail handler now independently requires
the authenticated current relay owner principal and rejects a stale request
before and after the host transcript read. The desktop's proved-channel check
remains in place. Commit `01dcf5a24` passes 34 focused relay/provider tests,
node typecheck, scoped lint/format, and relay bundles for Linux, macOS, Windows,
and WSL; independent read-only review found no code defect. Follow-up commit
`1aeafd849` adds a dispatcher-level request test: an unproved primary is
rejected, current attestation admits a host read, and a replaced primary
generation is rejected. The focused test, node typecheck, lint, and format pass.
This guard does not enable SSH sends or prove a live SSH transcript on a paired
device.

On paired watch `emulator-5562`, the installed Inbox requested real phone
notification pages. Host 1 returned a checked timestamp and explicit
unavailable state; connected Host 2 returned a checked timestamp and no
retained events since its first watch check. "Next machine" fetched Host 2
through the phone rather than treating Host 1's failure as an empty global
feed. With Orca backgrounded on phone `emulator-5556`, `adb shell am kill
com.stably.orca.mobile` removed its process; a watch "Refresh events" caused
a new phone PID and advanced Host 1's checked time from 1:45 to 1:47 AM and
Host 2's from 1:46 to 1:48 AM after another page request. This supports
process-cold, watch-initiated Inbox fetch and per-host honest states on the
paired emulator. It does not prove a retained host notification, autonomous
host-originated delivery, screen-off/Doze timing, or a physical watch.

The current release also retains one persisted, app-scoped periodic
`WearDashboardRefreshJobService` (`JobScheduler` ID 1464156499, 15-minute
interval) on paired phone `emulator-5556`. After the app was backgrounded and
its process killed, forcing that specific test-app job with `cmd jobscheduler
run -f` reported `Running job [FORCED]`, started a new Orca phone PID while
the launcher remained top-resumed, and the watch displayed a 1:50 AM phone
snapshot without a watch tap. A second forced run across the next minute
advanced the watch snapshot from 1:50 to 1:51 AM without watch input; the
phone process had already restarted before that second run, so it is job-path
evidence but not a second cold-start claim. This reconfirms scheduled
phone-to-watch refresh on the current emulator build, not naturally timed
15-minute execution, host notification delivery, Doze behavior, or physical
acceptance.

The current ARM64 watch release source map lists 626 bundled modules from
`/index.ts` and `/App.tsx`; none comes from the preserved, untracked
`wear/src/orca/` direct-runtime prototype or `wear/src/command-center/`.
The committed `wear/App.tsx` imports the companion Data Layer and fixed page
hooks, with no direct runtime-RPC/WebSocket client. This checks the bundle's
source boundary; it does not alone inspect on-device private storage or prove
that a production watch never held credentials from an older app.

Read-only `uiautomator dump` on paired watch emulator `5562` exposed a
scrollable Usage view, individually focusable account card with its status,
timestamp, machine count and reading host in the accessibility description,
and focusable buttons labelled "Previous page", "Next page", and "Refresh
from phone". This verifies these rendered accessibility-tree labels on the
emulator; TalkBack speech/order, rotating input, and physical small-round
ergonomics remain untested.

`apksigner verify --print-certs` on the current canonical ARM64 release pair
confirms both APKs share certificate SHA-256
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
`aapt dump badging` reports package `com.stably.orca.mobile` for both (watch
versionCode 1, phone versionCode 15). This proves pairwise compatibility for
these internal test-signed artifacts. It does not establish compatibility with
Dhiman's installed production phone signature; that package must be inspected
before any physical phone install and never replaced across a signature
mismatch.

The Wear terminal path now includes WSL source support: the local durable
receipt and settled-prompt writer admit an exact workspace/PTY in a named WSL
distro, and conversation reads use only the hook transcript path translated
inside that same distro. The send pins the distro through both asynchronous
and synchronous write fences; a changed namespace produces an unresolved
receipt rather than a second attempt. Focused runtime/RPC tests (27), node
typecheck, and direct scoped lint pass. A read-only review found the original
distro-switch gap and the final code closes it. This is source evidence, not
a live WSL agent conversation or reply. Validation remains on Dhiman's
existing configured agents and paired machines; no disposable sign-in is a
blocker. Before any reply test, reverify one exact idle session and send only
a harmless bounded acknowledgement. Physical phone/watch acceptance, SSH
atomic-send durability, and an actual WSL roundtrip remain open.

Read-only current Orca inventory on the three existing paired runtimes shows
one OMP terminal with ongoing wedding work on Crowley, one OMP terminal
waiting on its own Codex work on Choisoonsil, and no terminal on Rasputin.
None is an exactly verified idle reply target, so no test prompt was sent.
ADB still lists only four emulators. The advertised physical phone endpoint
`192.168.68.106:45379` refused `adb connect` with 10061; the watch was not
discovered. Physical acceptance therefore remains unobserved, with no change
to either device or its installed app.

WSL terminal conversation reads now also resolve pathless provider sessions
from the terminal's named distro. The read probes that distro's login-shell
`HOME` and `OMP_CODING_AGENT_DIR`, scopes all Claude/Codex/Grok/OMP roots to
it, rejects a result from another distro, and aborts the whole lookup after
15 seconds. Twenty focused read/root tests, node typecheck, direct lint, and
read-only review pass. This is source-level validation: no live WSL agent
conversation has been read. An OMP root set only inside one terminal command
cannot be inferred from a separate login shell when its provider session has
no transcript path; that exact session remains unavailable rather than
showing a guessed file. Existing paired-agent validation, SSH send durability,
and physical-device acceptance remain open.

The watch `openConversation` host RPC previously timed out after eight seconds,
shorter than the runtime's 15-second WSL transcript lookup and SSH relay read.
Commit `89d0c12b1` uses the existing 20-second conversation budget within the
phone's 25-second host-request deadline. The focused mobile tests (19), mobile
typecheck, scoped lint/format, and diff check pass. No real paired-host
conversation or physical-watch read has been accepted. Current paired
inventories show Crowley and Choisoonsil agents working and Rasputin with no
terminals, so no acknowledgement test was sent.

The phone release APK rebuilt after `89d0c12b1` with offline Gradle, SHA-256
`96185991FC441D7729AA42E88195DF38B5C72AFC3595E01B6C440A372655F3BD`.
Its package is `com.stably.orca.mobile`, versionCode 15, and its signing
certificate matches the paired emulator's installed APK at
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
One in-place install on phone emulator `5556` returned `Success`; its app
started, then the launcher resumed. The bound watch emulator `5562` refreshed
through the backgrounded phone and advanced its snapshot from 2:37 to 2:40 AM.
Before that install, with the phone on its launcher and no watch tap, Android's
persisted 15-minute refresh job completed at 2:37:42 AM and the watch advanced
from 2:22 to 2:37 AM. This is paired-emulator periodic and on-demand delivery,
not proof of screen-off/Doze behavior, a real host conversation, or physical
watch operation. The current phone APK now contains the timeout fix, but no
authenticated host was available to exercise its 15-second transcript path.

The selected-agent screen now yields to the existing expired-dashboard notice
when its phone snapshot expires, instead of displaying a perpetual inventory
check. Wear's 147 tests, typecheck, scoped lint/format, and release APK build
pass. The rebuilt APK SHA-256 is
`99A7F6B8FE2A18C07F88436F585775B1B487A07E90FD9B118D83A60EACFD404B`;
its signing certificate matches the existing emulator test pair. One in-place
install on the paired watch emulator `5562` returned `Success`. The real paired
conversation, exactly idle acknowledgement reply, durable SSH send, and
physical-watch acceptance remain open. Use existing configured profiles and
agents for those tests; no disposable-profile sign-in is required.

Current-source ARM64-only watch and phone release APKs rebuilt offline after
`474390ab8`. Watch SHA-256 is
`3F8699D89D55BA1D501FA96D56C9265CA76F60E6A2A49C2C0F4BB3BADA5F94DA`;
phone SHA-256 is
`D42F00160D2CB47870C65F4431AF3E47A883D7C408B0854027840C70EE6E83C3`.
Both verify under the same test certificate, contain bundled JavaScript, and
report only `arm64-v8a`. The watch manifest declares `standalone=false`, and
the phone's Wear Headless JS service is non-exported. These are build and
packaging checks, not physical installation or headless-wake evidence. A fresh
ADB scan still lists only emulators; the advertised physical phone endpoint
`192.168.68.106:45379` refuses TCP, and no watch endpoint is visible.

Attention now sums only authoritative host inventories; an incomplete host
cannot inflate the displayed count. Wear's 147 tests, typecheck, scoped lint,
and format pass. A read-only structured-session audit found that the host tab
snapshot carries identity but no status. The phone correctly marks those rows
unavailable: a bounded conversation tail cannot prove that an older pending
prompt or running turn ended. Full structured status requires a host-owned
full-journal projection with freshness and recovery semantics, published as an
optional capability-gated tab field. This remains open; no status was guessed.
The watch ARM64 release rebuilt after `68f262713` has SHA-256
`02DE7068265F02CC1416FEF5B56404EB35F66A039F13B56CFBC1A422545CC423`;
its package, ARM64 ABI, and test signing certificate were reverified. It has
not been installed on the physical watch.

The structured-status publication gap is narrower than the journal itself:
`StructuredAgentSessionHost` has the full reduced journal, and its subscriber
publisher receives live changes, but that publisher does not emit a
`session.tabs` change. The Wear phone observer therefore cannot update either
the dashboard count or selected-agent row from structured turn/prompt events.
Close this at the host boundary: derive from the full reduced journal only
while its owner state is verifiable, attach a bounded freshness timestamp as
an optional field on the existing structured tab projection, publish a tab
change when that verdict changes, and keep older hosts/clients at unavailable.
Acceptance must cover a pending prompt beyond the conversation tail, completed
turn, crash/restart stale running state, and old-host/new-phone absence.

The host-owned structured-status projection is now implemented on this branch.
It reads the full reduced journal only for a reconciled live native owner,
publishes `working`/`blocked`/`done` as an optional session-tab field, and
keeps older hosts at unavailable. Publication follows journal changes and
lease renewal; a deadline timer invalidates it if renewal stops. A failed
status observer is reported without aborting a durable agent send. Host/Wear
focused tests, node/mobile typechecks, scoped lint and format pass; the new
runtime publication test passes in isolation. The full restoration suite's
assertions pass but its Windows temp-directory teardown intermittently fails
with `EPERM`, so that suite remains a harness check to revisit. No current
source phone APK or physical paired-device status roundtrip has been verified
yet. The exact idle-session reply, SSH durable send, physical watch install,
and installed-device acceptance remain open. Existing configured agents and
paired machines are the test targets; no disposable profile or sign-in is
required.

After `fdfdf4c4e`, the phone `:app:assembleRelease` ARM64-only offline build
passed with bundled JavaScript. The resulting `com.stably.orca.mobile`
versionCode 15 APK is 62,899,740 bytes, SHA-256
`A798C6C5099FB1E94F56F505B9D3B727195F3196E1820E97EEDCAB0DCD9A359F`,
and verifies under test certificate
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
ADB still lists only emulators; this build has not been installed on the
physical phone. The physical watch remains unavailable over ADB.

Installed-device check on the existing paired emulators exposed an ABI trap:
the x86_64 phone emulator advertises ARM64 too, but an ARM64-only APK crashed
at startup because SoLoader sought `libreactnative.so` under x86_64. An
x86_64 release of the same source installed and launched, with the phone
process live and Host 2 connected. The paired watch's displayed phone
snapshot advanced from 3:21 to 3:39 AM after refresh, confirming dashboard
delivery on that emulator pair. The watch still labels its host inventory
incomplete; this does not verify a live structured status or conversation.
The build output was restored to ARM64-only and its SHA-256 rechecked as
`A798C6C5099FB1E94F56F505B9D3B727195F3196E1820E97EEDCAB0DCD9A359F`.
No physical device was changed.

Commit `3a4537f14` isolates individual session-tab listener failures, so a
disconnected subscriber cannot suppress status delivery to other phones. The
targeted runtime test, node typecheck, scoped lint/format, independent
read-only review, all 120 phone Wear tests, and ten mixed-version structured
wire tests pass. The SSH send audit confirms its current PTY write only queues
a notification without an incarnation fence; it cannot be treated as an
authoritative effect receipt. Node 18 lacks the built-in SQLite used by the
local durable ledger. SSH replies stay disabled pending a host-owned durable
admission and guarded write; the unresolved Node 18 versus Node 24 storage
choice must not be inferred from the existing local implementation.

Current-source paired-emulator cold refresh repeated after the x86_64 phone
install: phone `emulator-5556` was backgrounded to the launcher, `am kill`
removed its PID, and the watch `emulator-5562` refresh started a new phone PID
for `WearCompanionListenerService` while the launcher remained top-resumed.
The watch's visible snapshot advanced from 3:54 to 3:57 AM. This is
watch-initiated process-cold delivery on the test pair, not autonomous host
notification delivery, physical-device operation, or a real agent reply.

Dhiman clarified that validation must use the existing configured,
authenticated agents and paired machines. There is no disposable-profile,
new-login, or new-account gate. Preserve all existing profiles and data. Before
one watch-path reply test, inspect an existing agent's exact session identity
and verify that it is idle; send only a harmless bounded acknowledgement and
leave busy sessions untouched. The earlier isolated sign-in attempt is
historical, not an outstanding requirement. Remaining acceptance includes a
real conversation and reply, SSH durable send, autonomous notification delivery,
and physical phone/watch installation and on-device checks.

A status race found during review is closed in source: Codex now retains a
completed lifecycle verdict in the structured journal, while a provider end
without a turn completion still tombstones the running marker. Wear reports
`done` only when a completion verdict belongs after the latest user submission;
assistant text alone is insufficient because it may precede `turn/started`.
The real translator/reducer test covers start-before-user completion, a new
submission, and assistant text before a start notification; the shared
projection also keeps another overlapping turn working. Focused runtime and
mixed-version tests (75), node typecheck, and scoped lint/format pass. The `pnpm test`
wrapper currently fails before Vitest while rebuilding the unrelated
`@vscode/windows-process-tree` addon because this machine lacks VS Spectre
libraries; direct Vitest passed. This is source evidence, not installed-device
status acceptance.

After `8e3652f10`, an emulator-only app-specific background job check advanced
the paired watch dashboard without a watch tap. Phone `emulator-5556` was sent
to the launcher and its app process killed. Its existing persisted periodic
job `1464156499` reported `waiting`; `cmd jobscheduler run -f` started a new
phone process (PID 9666) for `WearDashboardRefreshJobService`. The job returned
to `waiting`, the launcher remained top-resumed, and watch `emulator-5562`
changed its visible phone-snapshot timestamp from 4:12 to 4:13 AM. This proves
an app-specific forced background-job wake and publication on the paired
emulators, not natural periodic timing, screen-off/Doze, host-originated push,
or physical-device acceptance. No physical device or real agent was touched.

SSH relay now has a narrow exact-incarnation PTY write prerequisite. Its
optional `wearPromptWriteVersion` capability announces `pty.writeIfIncarnation`;
the method checks the proved primary relay owner, rejects stale channels,
validates bounded input, and rechecks the live PTY incarnation immediately
before using the existing ingress/echo path. Sixty-eight targeted relay tests
passed (twelve existing skips), as did node typecheck, scoped lint/format, and
independent read-only review. This method is deliberately not wired into Wear
send yet: `written: true` means only that `node-pty.write` was invoked, and a
replayed request would write again. SSH Wear replies remain disabled until a
host-owned durable reservation suppresses replay and the runtime probes this
capability before use; the Node 18 storage decision remains open. The current
paired watch emulator lists Host 2 connected with zero agents and Host 1
inventory incomplete, so it has no verified idle target for a reply test.
