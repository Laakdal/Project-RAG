import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";

// Stateless double-submit-cookie CSRF protection.
//
// A random token is issued in a NON-httpOnly cookie so the SPA's JavaScript can
// read it and echo it back in a request header. Because an attacker on another
// origin cannot read the victim's cookies (and cross-site requests cannot set
// the header to a matching value), requiring the header to equal the cookie
// proves the request came from our own front-end rather than a forged
// cross-site navigation/form submission.

export const CSRF_COOKIE_NAME = "csrf_token";
export const CSRF_HEADER_NAME = "x-csrf-token";

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Ensure a CSRF cookie is present, (re)issuing one if missing, and return the
 * current token. The cookie is readable by client JS (httpOnly: false) by
 * design so the SPA can mirror it into the request header.
 */
export function issueCsrfToken(req: Request, res: Response): string {
  const existing = req.cookies?.[CSRF_COOKIE_NAME] as string | undefined;
  const token = existing ?? generateToken();

  if (!existing) {
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      secure: config.COOKIE_SECURE,
      sameSite: config.COOKIE_SAMESITE,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    });
  }

  return token;
}

/**
 * Middleware enforcing the double-submit check on state-changing requests.
 * Rejects with 403 when the header token is missing or does not match the
 * cookie token.
 */
export function requireCsrf(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME] as string | undefined;
  const headerValue = req.get(CSRF_HEADER_NAME);
  const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (
    !cookieToken ||
    !headerToken ||
    !safeEqual(cookieToken, headerToken)
  ) {
    res.status(403).json({ error: "Invalid CSRF token" });
    return;
  }

  next();
}
