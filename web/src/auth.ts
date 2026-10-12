// Sign in with GitHub (OAuth web flow), and a signed session cookie.
//
// - No passwords: GitHub proves who the user is; Tulpar keeps their id, login, name and email.
// - The session cookie holds only the account id and an expiry, signed with TULPAR_SESSION_SECRET
//   (HMAC-SHA256), HttpOnly, SameSite=Lax, Secure in production.
// - The OAuth "state" is a random value in a short-lived cookie, checked on the way back.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface GitHubUser {
  githubId: number;
  login: string;
  name: string | null;
  email: string | null;
}

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  /** The site's public origin, e.g. https://tulparsi.com (for the OAuth callback URL). */
  origin: string;
  secureCookies: boolean;
}

export function authFromEnv(): AuthConfig | undefined {
  const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, TULPAR_SESSION_SECRET, TULPAR_ORIGIN } = process.env;
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !TULPAR_SESSION_SECRET) return undefined;
  return {
    clientId: GITHUB_CLIENT_ID,
    clientSecret: GITHUB_CLIENT_SECRET,
    sessionSecret: TULPAR_SESSION_SECRET,
    origin: TULPAR_ORIGIN || "http://localhost:4173",
    secureCookies: process.env.NODE_ENV === "production",
  };
}

const SESSION = "tulpar_session";
const STATE = "tulpar_oauth_state";
const NEXT = "tulpar_next";
const SESSION_DAYS = 30;

/** Sends the visitor to GitHub to sign in. */
export function startSignIn(res: ServerResponse, config: AuthConfig, next?: string | null): void {
  const state = randomBytes(16).toString("hex");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", `${config.origin}/auth/github/callback`);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "true");
  // Where to return after signing in (the page that asked, e.g. connecting VS Code): a path on this site only.
  const back = next && isLocalPath(next) ? cookie(NEXT, encodeURIComponent(next), 600, config) : cookie(NEXT, "", 0, config);
  res.writeHead(302, { location: url.href, "set-cookie": [cookie(STATE, state, 600, config), back], "cache-control": "no-store" });
  res.end();
}

/**
 * Completes the sign-in: checks the state, exchanges the code for a token, and reads the user.
 * `fetchImpl` is replaceable for tests.
 */
export async function finishSignIn(req: IncomingMessage, config: AuthConfig, fetchImpl: typeof fetch = fetch): Promise<GitHubUser> {
  const url = new URL(req.url ?? "/", config.origin);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = readCookie(req, STATE);
  if (!code || !state || !expected || !safeEqual(state, expected)) throw new Error("The sign-in link expired or was not started here. Try signing in again.");
  const tokenRes = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: `${config.origin}/auth/github/callback` }),
  });
  const token = (await tokenRes.json()) as { access_token?: string; error_description?: string };
  if (!token.access_token) throw new Error(`GitHub did not sign you in${token.error_description ? `: ${token.error_description}` : "."}`);
  const headers = { authorization: `Bearer ${token.access_token}`, accept: "application/vnd.github+json", "user-agent": "tulpar" };
  const user = (await (await fetchImpl("https://api.github.com/user", { headers })).json()) as { id?: number; login?: string; name?: string | null; email?: string | null };
  if (!user.id || !user.login) throw new Error("GitHub did not return your account.");
  let email = user.email ?? null;
  if (!email) {
    const emails = (await (await fetchImpl("https://api.github.com/user/emails", { headers })).json()) as { email: string; primary: boolean; verified: boolean }[];
    email = Array.isArray(emails) ? (emails.find((e) => e.primary && e.verified)?.email ?? null) : null;
  }
  return { githubId: user.id, login: user.login, name: user.name ?? null, email };
}

/** Sets the session for an account and sends the visitor home. */
/** The page to return to after signing in, if the sign-in was started with one. */
export function signInNext(req: IncomingMessage): string {
  const raw = readCookie(req, NEXT);
  const next = raw ? decodeURIComponent(raw) : "/";
  return isLocalPath(next) ? next : "/";
}

/** A path on this site: one leading slash, never "//host" or a backslash trick. */
function isLocalPath(p: string): boolean {
  return /^\/(?![/\\])[^\s\\]*$/.test(p) && p.length <= 500;
}

export function setSession(res: ServerResponse, accountId: number, config: AuthConfig, to = "/"): void {
  const payload = Buffer.from(JSON.stringify({ a: accountId, e: Date.now() + SESSION_DAYS * 86_400_000 })).toString("base64url");
  const value = `${payload}.${sign(payload, config.sessionSecret)}`;
  res.writeHead(302, { location: to, "set-cookie": [cookie(SESSION, value, SESSION_DAYS * 86_400, config), cookie(STATE, "", 0, config), cookie(NEXT, "", 0, config)], "cache-control": "no-store" });
  res.end();
}

export function clearSession(res: ServerResponse, config: AuthConfig): void {
  res.writeHead(302, { location: "/", "set-cookie": cookie(SESSION, "", 0, config), "cache-control": "no-store" });
  res.end();
}

/** The signed-in account id, or undefined (no cookie, bad signature, or expired). */
export function sessionAccount(req: IncomingMessage, config: AuthConfig): number | undefined {
  const value = readCookie(req, SESSION);
  if (!value) return undefined;
  const [payload, signature] = value.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload, config.sessionSecret))) return undefined;
  try {
    const { a, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { a: number; e: number };
    return typeof a === "number" && typeof e === "number" && e > Date.now() ? a : undefined;
  } catch {
    return undefined;
  }
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookie(name: string, value: string, maxAge: number, config: AuthConfig): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secureCookies ? "; Secure" : ""}`;
}

export function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}
