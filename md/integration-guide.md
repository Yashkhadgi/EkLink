# EkLink App Integration Guide

This guide is for apps that use EkLink for sign-in.

## Environment Variables

Each app stores these on its server only:

```env
EKLINK_URL=http://localhost:3000
EKLINK_CLIENT_ID=your_client_id
EKLINK_CLIENT_SECRET=your_client_secret
EKLINK_REDIRECT_URI=http://localhost:3001/auth/callback
```

Never expose `EKLINK_CLIENT_SECRET` in browser code.

## Redirect To EkLink

When an app has no local session, generate a random `state`, store it in an HttpOnly app session cookie and redirect the user to:

```text
{EKLINK_URL}/authorize?client_id={EKLINK_CLIENT_ID}&redirect_uri={EKLINK_REDIRECT_URI}&state={state}
```

`redirect_uri` must exactly match a callback URL registered in EkLink.

## Callback And Token Exchange

The app callback receives `code` and `state`.

1. Verify `state` matches the value saved before redirecting.
2. Exchange the code from the app server:

```bash
curl -X POST "$EKLINK_URL/token" \
  -H "content-type: application/json" \
  -d '{
    "grant_type":"authorization_code",
    "code":"CODE_FROM_CALLBACK",
    "redirect_uri":"'"$EKLINK_REDIRECT_URI"'",
    "client_id":"'"$EKLINK_CLIENT_ID"'",
    "client_secret":"'"$EKLINK_CLIENT_SECRET"'"
  }'
```

The response is:

```json
{
  "access_token": "JWT",
  "token_type": "Bearer",
  "expires_in": 900
}
```

Codes expire quickly and can be used only once.

## Verify The JWT

Fetch EkLink public keys from:

```text
{EKLINK_URL}/.well-known/jwks.json
```

On the app server, verify:

- Signature using the JWKS key.
- `iss` equals EkLink's issuer URL.
- `aud` equals the app's `EKLINK_CLIENT_ID`.
- `exp` is still valid.

Use the claims only after verification.

## User Mapping

Map users by the EkLink `sub` claim. If an older app needs a fallback, use `login_id` first and `email` second.

Typical claims:

- `sub`
- `login_id`
- `email`
- `name`
- `role`
- `department`
- `batch`
- `section`
- `ver`

Create the app-local user on first sign-in if needed.

## Sessions And Refresh

Keep app sessions short. Before the EkLink access token expires, refresh it from the server:

```bash
curl -X POST "$EKLINK_URL/token/refresh" \
  -H "content-type: application/json" \
  -d '{
    "client_id":"'"$EKLINK_CLIENT_ID"'",
    "client_secret":"'"$EKLINK_CLIENT_SECRET"'",
    "access_token":"OLD_ACCESS_TOKEN"
  }'
```

EkLink re-checks the user is active, does not need a forced password change, still has an allowed role and still has the same `token_version`.

## Roles

Use the EkLink `role` claim for broad app access only. App-specific permissions must still be enforced by the app server.

## Logout

On logout, clear the app's own session. EkLink tokens are short-lived; forced logout or deactivation blocks refresh.

## Test Checklist

Before marking an app integrated, test:

- Expired token is rejected by the app.
- Reused authorization code is rejected by `/token`.
- User with the wrong role gets a no-access response.
- Tampered `redirect_uri` is rejected.
- Inactive user cannot authorize or refresh.
