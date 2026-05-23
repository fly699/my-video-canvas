export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  // Use a deterministic dev-only secret when JWT_SECRET is unset — prevents "zero-length key" crash
  // in local development. Production deployments must set JWT_SECRET explicitly.
  cookieSecret: process.env.JWT_SECRET || "dev-only-secret-do-not-use-in-production-32c",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  // OWNER_EMAIL must be set explicitly in production. The hardcoded fallback is intentional
  // for single-tenant deployments owned by this project's author; third-party deployers
  // MUST set OWNER_EMAIL to their own address to control who receives admin role.
  ownerEmail: process.env.OWNER_EMAIL ?? "fly699@gmail.com",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  poyoApiKey: process.env.POYO_API_KEY ?? "",
  higgsfieldApiKey: process.env.HIGGSFIELD_API_KEY ?? "",
  higgsfieldApiSecret: process.env.HIGGSFIELD_API_SECRET ?? "",
};
