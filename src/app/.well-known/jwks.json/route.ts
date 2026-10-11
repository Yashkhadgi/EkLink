import { publicJwk } from "@/lib/auth/jwt";
import { type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  request.headers.get("host");
  return Response.json({ keys: [await publicJwk()] });
}
