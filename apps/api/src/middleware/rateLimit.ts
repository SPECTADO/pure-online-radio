import rateLimit from "express-rate-limit";

/** Rate limit applied to all /public/* routes (unauthenticated, internet-facing). */
export const publicRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
