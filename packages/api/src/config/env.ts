import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const DEV_JWT_SECRET_FALLBACK = "dev-secret-change-me";
const nodeEnv = process.env.NODE_ENV ?? "development";
const jwtSecret = required("JWT_SECRET", DEV_JWT_SECRET_FALLBACK);

// Audit P2-1: the fallback above exists purely so `npm run dev` works with
// zero setup. Booting in production with a well-known secret would let
// anyone forge a valid JWT for any user/role, so refuse to start rather
// than run silently insecure.
if (nodeEnv === "production" && jwtSecret === DEV_JWT_SECRET_FALLBACK) {
  throw new Error(
    "JWT_SECRET is not set (or still the development fallback) while NODE_ENV=production. " +
      "Set a real, unique JWT_SECRET before starting in production."
  );
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "12h",
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  nodeEnv,
};
