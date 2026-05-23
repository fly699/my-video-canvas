export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  // Use a deterministic dev-only secret when JWT_SECRET is unset — prevents "zero-length key" crash
  // in local development. Production deployments must set JWT_SECRET explicitly.
  cookieSecret: process.env.JWT_SECRET || "dev-only-secret-do-not-use-in-production-32c",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  ownerEmail: process.env.OWNER_EMAIL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  poyoApiKey: process.env.POYO_API_KEY ?? "",
  higgsfieldApiKey: process.env.HIGGSFIELD_API_KEY ?? "",
  higgsfieldApiSecret: process.env.HIGGSFIELD_API_SECRET ?? "",
};
