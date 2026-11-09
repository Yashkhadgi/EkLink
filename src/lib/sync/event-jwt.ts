// Pure helpers for the events JWT (SYNC_CONTRACT.md section 5.1). No server-only
// import and no environment access, so `node --test` can exercise them directly.
import { SignJWT, jwtVerify, type CryptoKey, type JWTPayload, type KeyObject } from "jose";

export const EVENTS_JWT_TYP = "eklink-events+jwt";
export const EVENTS_JWT_TTL_SECONDS = 300;
// Kept small: TemplateOS' database is far away, so a large batch can take
// longer than the push timeout even though every event is applied.
export const MAX_EVENTS_PER_PUSH = 25;

export type SyncEvent = {
  id: number;
  type: string;
  at: string;
  data: Record<string, unknown>;
};

export type EventsJwtPayload = JWTPayload & { events: SyncEvent[] };

type SigningKey = CryptoKey | KeyObject | Uint8Array;

export async function signEventsJwt({
  key,
  kid,
  issuer,
  audience,
  events,
  now = Math.floor(Date.now() / 1000),
  jti = crypto.randomUUID(),
}: {
  key: SigningKey;
  kid: string;
  issuer: string;
  audience: string;
  events: SyncEvent[];
  now?: number;
  jti?: string;
}) {
  if (events.length > MAX_EVENTS_PER_PUSH) {
    throw new Error(`at most ${MAX_EVENTS_PER_PUSH} events per push`);
  }
  for (let index = 1; index < events.length; index += 1) {
    if (events[index].id <= events[index - 1].id) {
      throw new Error("events must be in ascending id order");
    }
  }
  return new SignJWT({ events })
    .setProtectedHeader({ alg: "ES256", kid, typ: EVENTS_JWT_TYP })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + EVENTS_JWT_TTL_SECONDS)
    .setJti(jti)
    .sign(key);
}

/** What a receiving app does (used by the tests; EkLink itself never verifies pushes). */
export async function verifyEventsJwt(
  token: string,
  key: SigningKey,
  { issuer, audience, currentDate }: { issuer: string; audience: string; currentDate?: Date },
) {
  const { payload, protectedHeader } = await jwtVerify<EventsJwtPayload>(token, key, {
    algorithms: ["ES256"],
    issuer,
    audience,
    typ: EVENTS_JWT_TYP,
    currentDate,
  });
  if (!Array.isArray(payload.events)) throw new Error("events claim missing");
  return { payload, header: protectedHeader };
}

/** Retry delay after the n-th failed attempt: 1, 5, 15, 60 minutes, then hourly. */
export function backoffMinutes(attempts: number) {
  if (attempts <= 1) return 1;
  if (attempts === 2) return 5;
  if (attempts === 3) return 15;
  return 60;
}
