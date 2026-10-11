import "server-only";

import crypto from "node:crypto";

export function randomCode() {
  return crypto.randomBytes(32).toString("base64url");
}

export function sha256Hex(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function constantTimeEqualHex(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length !== rightBuffer.length) {
    const dummy = Buffer.alloc(Math.max(leftBuffer.length, rightBuffer.length, 32));
    crypto.timingSafeEqual(dummy, dummy);
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
