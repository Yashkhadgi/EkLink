// Run: node --test tests/
// Events JWT (SYNC_CONTRACT.md 5.1): sign with an ES256 key, verify like an app does.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalJWKSet, decodeProtectedHeader, exportJWK, generateKeyPair } from "jose";
import {
  EVENTS_JWT_TYP,
  MAX_EVENTS_PER_PUSH,
  backoffMinutes,
  signEventsJwt,
  verifyEventsJwt,
} from "../src/lib/sync/event-jwt.ts";

const ISSUER = "http://localhost:3000";
const AUDIENCE = "templateos_test";

const events = [
  { id: 7, type: "directory.upserted", at: "2026-11-09T10:00:00Z", data: { level: "organization", code: "DEMO" } },
  { id: 9, type: "person.upserted", at: "2026-11-09T10:00:01Z", data: { sub: "00000000-0000-0000-0000-000000000001" } },
];

async function keys() {
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-kid", alg: "ES256", use: "sig" };
  return { privateKey, publicKey, jwks: createLocalJWKSet({ keys: [jwk] }) };
}

test("round trip: header, claims and events survive", async () => {
  const { privateKey, jwks } = await keys();
  const now = Math.floor(Date.now() / 1000);
  const token = await signEventsJwt({ key: privateKey, kid: "test-kid", issuer: ISSUER, audience: AUDIENCE, events, now });

  const header = decodeProtectedHeader(token);
  assert.deepEqual(header, { alg: "ES256", kid: "test-kid", typ: EVENTS_JWT_TYP });

  const { payload } = await verifyEventsJwt(token, jwks, { issuer: ISSUER, audience: AUDIENCE });
  assert.equal(payload.iss, ISSUER);
  assert.equal(payload.aud, AUDIENCE);
  assert.equal(payload.exp, now + 300);
  assert.equal(typeof payload.jti, "string");
  assert.deepEqual(payload.events, events);
});

test("wrong audience, issuer or key is rejected", async () => {
  const { privateKey, jwks } = await keys();
  const other = await keys();
  const token = await signEventsJwt({ key: privateKey, kid: "test-kid", issuer: ISSUER, audience: AUDIENCE, events });

  await assert.rejects(verifyEventsJwt(token, jwks, { issuer: ISSUER, audience: "approveit_test" }));
  await assert.rejects(verifyEventsJwt(token, jwks, { issuer: "http://evil", audience: AUDIENCE }));
  await assert.rejects(verifyEventsJwt(token, other.jwks, { issuer: ISSUER, audience: AUDIENCE }));
});

test("expired token is rejected", async () => {
  const { privateKey, jwks } = await keys();
  const now = Math.floor(Date.now() / 1000) - 3600;
  const token = await signEventsJwt({ key: privateKey, kid: "test-kid", issuer: ISSUER, audience: AUDIENCE, events, now });
  await assert.rejects(verifyEventsJwt(token, jwks, { issuer: ISSUER, audience: AUDIENCE }), /exp/);
});

test("events must be ascending and at most MAX_EVENTS_PER_PUSH", async () => {
  const { privateKey } = await keys();
  const base = { key: privateKey, kid: "k", issuer: ISSUER, audience: AUDIENCE };
  await assert.rejects(signEventsJwt({ ...base, events: [events[1], events[0]] }), /ascending/);
  const many = Array.from({ length: MAX_EVENTS_PER_PUSH + 1 }, (_, index) => ({ id: index + 1, type: "x", at: "", data: {} }));
  await assert.rejects(signEventsJwt({ ...base, events: many }), new RegExp(`at most ${MAX_EVENTS_PER_PUSH}`));
});

test("backoff: 1, 5, 15, 60 minutes, then hourly", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(backoffMinutes), [1, 5, 15, 60, 60, 60]);
});
