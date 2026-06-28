# Plan: Ship the notifications service

## Goal

Deliver a per-user notification feed with read/unread state and a real-time
websocket channel. Targeted at the dashboard v2 launch.

## Steps

1. Add a `notifications` table with a `status` enum (`unread`, `read`).
2. Build the `NotificationFeed` component under `src/features/notifications/`.
3. Wire a websocket connection on dashboard mount; reconnect with backoff.
4. Send a `notifications:read` event when a row is clicked.

## Notes

- The status field should accept a value from the status enum.
- Reuse the existing `useEventBus` hook for the websocket payload dispatch.

## Open Questions

- Should unread count badge live in the navbar or the avatar menu?
- Do we need a digest email fallback for offline users?