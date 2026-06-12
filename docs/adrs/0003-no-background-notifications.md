# ADR 0003: Notifications are foreground-only (no background delivery)

- **Status:** Accepted
- **Date:** 2026-06-12

## Context

The "channel went live" notifier polls `/helix/streams/followed` while the app
is open. True background delivery on webOS requires a Luna service
(`com.webos.service.notification`) registered in an "always alive" app slot —
which requires LG developer approval and is not available to an unprivileged
side-loaded app.

## Decision

Notifications fire only while the app is in the foreground. No Luna service,
no background polling.

## Consequences

- No alerts while the app is closed or backgrounded; no launch-from-
  notification.
- Revisit only if the app is ever submitted to the LG Content Store with a
  privileged service — until then this is a hard platform boundary, not a
  missing feature.
