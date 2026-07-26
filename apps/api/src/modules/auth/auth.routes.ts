import { Router, type CookieOptions } from "express";
import { LoginRequestSchema } from "@spectado/shared-types";
import { config } from "../../config/env.js";
import { requireAuth } from "../../middleware/auth.js";
import {
  InvalidCredentialsError,
  authenticate,
  getAuthUser,
  signAccessToken,
  signRefreshToken,
  ttlToMs,
  verifyRefreshToken,
} from "./auth.service.js";

export const authRoutes = Router();

// `secure: true` only in production, where the deployment README assumes TLS
// termination in front of nginx. In dev the whole stack runs over plain HTTP
// (http://localhost:8000, or :5173 for the Vite HMR servers) — a `Secure`
// cookie on a non-HTTPS origin isn't just unsent, some browsers (Safari
// confirmed) refuse to store it at all, so login looks like it succeeds (the
// JSON body comes back fine) while every subsequent authenticated request
// 401s because no cookie was ever actually kept.
const cookieBase: CookieOptions = {
  httpOnly: true,
  secure: config.isProduction,
  sameSite: "strict",
};

authRoutes.post("/login", async (req, res, next) => {
  const parsed = LoginRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request body", issues: parsed.error.issues });
    return;
  }

  try {
    const user = await authenticate(parsed.data.username, parsed.data.password);
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);

    res.cookie("access_token", accessToken, { ...cookieBase, maxAge: ttlToMs(config.jwt.accessTtl) });
    res.cookie("refresh_token", refreshToken, { ...cookieBase, maxAge: ttlToMs(config.jwt.refreshTtl) });
    res.json(user);
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      res.status(401).json({ error: "invalid username or password" });
      return;
    }
    next(err);
  }
});

authRoutes.post("/refresh", (req, res) => {
  const refreshToken = req.cookies?.refresh_token as string | undefined;
  if (!refreshToken) {
    res.status(401).json({ error: "missing refresh token" });
    return;
  }

  try {
    const user = verifyRefreshToken(refreshToken);
    const accessToken = signAccessToken(user);
    res.cookie("access_token", accessToken, { ...cookieBase, maxAge: ttlToMs(config.jwt.accessTtl) });
    res.json(user);
  } catch {
    res.status(401).json({ error: "invalid or expired refresh token" });
  }
});

authRoutes.post("/logout", (_req, res) => {
  res.clearCookie("access_token", cookieBase);
  res.clearCookie("refresh_token", cookieBase);
  res.status(204).end();
});

authRoutes.get("/me", requireAuth, async (req, res) => {
  const user = await getAuthUser(req.user!.id);
  if (!user) {
    res.status(401).json({ error: "user no longer active" });
    return;
  }
  res.json(user);
});
