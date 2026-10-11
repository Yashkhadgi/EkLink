import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const PROTECTED_PATHS = ["/dashboard", "/profile"];
const PASSWORD_CHANGE_ALLOWED_PATHS = [
  "/change-password",
  "/api/auth",
  "/auth",
  "/login",
  "/authorize",
  "/token",
];

type RefreshedCookie = {
  name: string;
  value: string;
  options: CookieOptions;
};

function pathMatches(pathname: string, paths: string[]) {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function proxy(request: NextRequest) {
  let refreshedCookies: RefreshedCookie[] = [];
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          refreshedCookies = cookiesToSet;

          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isProtected = pathMatches(pathname, PROTECTED_PATHS);

  if (isProtected && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(loginUrl);
  }

  if (user && !pathMatches(pathname, PASSWORD_CHANGE_ALLOWED_PATHS)) {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("must_change_password")
      .eq("id", user.id)
      .maybeSingle();

    if (!error && profile?.must_change_password) {
      if (pathname.startsWith("/api/")) {
        return Response.json(
          { error: "Password change required." },
          { status: 403 },
        );
      }

      const changePasswordUrl = request.nextUrl.clone();
      changePasswordUrl.pathname = "/change-password";
      changePasswordUrl.search = "";
      const redirectResponse = NextResponse.redirect(changePasswordUrl);
      refreshedCookies.forEach(({ name, value, options }) => {
        redirectResponse.cookies.set(name, value, options);
      });
      return redirectResponse;
    }

    // Fail open here so a transient profile lookup issue does not break the whole app.
    // Sensitive routes such as /authorize and /token must re-check this flag on the
    // server with the admin client and fail closed.
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
