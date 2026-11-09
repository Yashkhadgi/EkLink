# EkLink Change Sync Guide

EkLink is the single owner of people, their placement (organization → institute → department), platform roles and approver jobs. Connected apps such as TemplateOS and ApproveIt keep their own databases and receive changes from EkLink.

An app can receive changes in two ways:

- **Push:** EkLink POSTs signed batches of events to the app's `sync_url`.
- **Pull:** the app reads `/api/sync/changes` and `/api/sync/snapshot` with its client credentials.

Both use the same events and the same ascending event ids, so an app can use push for speed and pull to catch up.

## Database

| Migration | Adds | Rollback |
| --- | --- | --- |
| `supabase/migrations/0005_org_hierarchy.sql` | organizations, institutes, departments; `platform_role` and `semester` on profiles | `supabase/rollback/0005_org_hierarchy_down.sql` |
| `supabase/migrations/0006_sync.sql` | approver jobs, `change_events`, `event_deliveries`, login ID lock, sync functions | `supabase/rollback/0006_sync_down.sql` |

Apply them in order. Database triggers write a `change_events` row for every relevant change and queue one `event_deliveries` row per app that has a `sync_url`.

## Events

Every event has the same shape:

```json
{ "id": 42, "type": "person.upserted", "at": "2026-11-10T08:00:00Z", "data": { } }
```

| Type | Sent when |
| --- | --- |
| `person.upserted` | a person is created or their profile, role or placement changes |
| `person.login_id_changed` | an admin renames a login ID (`data` has `sub`, `old_login_id`, `new_login_id`) |
| `directory.upserted` | an organization, institute or department is created or changed |
| `approver.upserted` | an approver job is assigned or ended |

The exact `data` fields are built by the `sync_person_payload`, `sync_directory_payload` and `sync_approver_payload` functions in migration 0006. Map people by `sub`, never by `login_id`.

Apply events in ascending `id` order and store the last applied id. Applying the same event twice must be safe (treat every event as an upsert).

## Push

Register the URL where EkLink should POST events:

```bash
node --env-file=.env scripts/register-app.mjs --slug templateos ... --sync-url http://localhost:3001/api/eklink/events
```

Use `--sync-url none` to stop pushes.

Each push is a `POST` with `content-type: application/jwt`. The body is an ES256 JWT signed with the same key as access tokens (verify it with EkLink's JWKS):

- header `typ` is `eklink-events+jwt`
- `iss` is `EKLINK_ISSUER_URL`, `aud` is the app's `client_id`
- `exp` is 5 minutes after `iat`; `jti` is unique per push
- the `events` claim holds at most 25 events in ascending id order

Return any `2xx` once all events are applied. Any other status or a timeout (60 seconds) marks the batch failed. Failed batches are retried after 1, 5, 15 and 60 minutes, then hourly. Later events for that app wait until the failed batch succeeds, so order is never broken.

The dispatcher runs inside the EkLink server every `SYNC_DISPATCH_INTERVAL_SECONDS` (default `60`, minimum `5`, `0` turns it off). Admin changes also trigger a dispatch right away. Admins can see delivery status and retry failed deliveries in **Admin Console → Apps & sync**.

## Pull

Both endpoints use HTTP Basic auth with the app's `client_id` and `client_secret`. They are rate limited to 120 requests per minute per IP, and rejected attempts are written to the audit log.

### Changes

```bash
curl -u "$EKLINK_CLIENT_ID:$EKLINK_CLIENT_SECRET" \
  "$EKLINK_URL/api/sync/changes?after=0&limit=500"
```

```json
{ "events": [ ], "last_event_id": 42, "has_more": false }
```

- `after` is the last event id the app has applied (default `0`).
- `limit` is 1–500 (default `500`).
- When there is nothing new, `last_event_id` equals `after`.
- Keep calling with `after=last_event_id` while `has_more` is `true`.

### Snapshot

```bash
curl -u "$EKLINK_CLIENT_ID:$EKLINK_CLIENT_SECRET" "$EKLINK_URL/api/sync/snapshot"
```

Returns `last_event_id`, `directory`, `people` and `approvers`, read in one database statement. Use it for the first load or to rebuild an app's copy, then continue with `/api/sync/changes?after=<last_event_id>`.

## Test Checklist

- A push with a wrong `aud`, expired `exp` or wrong `typ` is rejected by the app.
- Applying the same batch twice changes nothing.
- A failed push shows as failed in Apps & sync and succeeds after **Retry**.
- `/api/sync/changes` with a wrong secret returns `401`.
- Snapshot followed by changes gives the same data as push alone.
