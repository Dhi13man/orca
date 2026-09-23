# Wear companion Data Layer spike

Bounded Phase 0 probe (not product code). Two minimal native Android modules —
`phone/` and `watch/` — sharing `applicationId com.orcaspike.companion` and a
throwaway debug signing key, testing only the mechanism this plan depends on:
a phone `MessageClient` send and a watch `WearableListenerService` receive/ack,
with a fixed, non-sensitive test payload. No Orca runtime credentials, no
Orca business logic, no reuse of the rejected `wear/` prototype's transport.

This directory is source only. Build outputs are never committed; build from
an isolated copy (see `docs/wear-os-command-center-plan.md`'s Phase 0 spike
log for the exact commands and results this source produced).

- `phone/`: sends `PING` with a fixed `requestId` to every connected node on
  a button tap, and logs the received `PONG` (or timeout) via `Log.i`.
- `watch/`: `WearableListenerService` replies `PONG` to a received `PING` on
  the same fixed path, logging receipt.

Both are deliberately RN/Expo-free: the 30-minute bound for this pass did not
allow reliably bootstrapping Expo Headless JS wiring from zero without risking
using the whole budget on tooling rather than the mechanism itself. This
validates the native Data Layer/listener half of what an Expo native module
would wrap; the Expo/Headless-JS wrapper layer remains a separately named,
still-open gap — see the plan's spike log for exactly what this does and does
not close.
