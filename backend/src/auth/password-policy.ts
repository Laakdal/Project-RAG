import { z } from "zod";

// Shared password strength policy. Mirrors the frontend's validatePassword
// (frontend/lib/utils/validators.ts) so client and server agree on what's valid.
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a number")
  .regex(/[^a-zA-Z0-9]/, "Password must contain a symbol");
