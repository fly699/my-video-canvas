if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  console.error("[FATAL] JWT_SECRET must be set in production. Refusing to start with the insecure dev fallback.");
  process.exit(1);
}

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
  // Self-hosted S3-compatible storage (MinIO / Cloudflare R2 / AWS S3).
  // When S3_ENDPOINT + S3_BUCKET + keys are set, this takes precedence over Forge.
  // For MinIO set S3_ENDPOINT=http://127.0.0.1:9000 and S3_FORCE_PATH_STYLE=true.
  // NOTE: this address is used by the SERVER only. Browser downloads are proxied
  // through the app server, so a 127.0.0.1 endpoint works for remote users too.
  s3Endpoint: process.env.S3_ENDPOINT ?? "",
  // PUBLIC endpoint reachable by end-user browsers (e.g. https://files.example.com).
  // S3_ENDPOINT is often a server-local address (127.0.0.1:9000) that remote
  // browsers cannot reach — when this is empty, downloads/uploads are streamed
  // THROUGH the app server instead of redirecting to the storage host. Set this
  // only when MinIO/S3 is exposed publicly (e.g. behind a reverse proxy) to let
  // browsers transfer directly and save app-server bandwidth.
  s3PublicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? "",
  s3Region: process.env.S3_REGION ?? "us-east-1",
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3AccessKey: process.env.S3_ACCESS_KEY ?? "",
  s3SecretKey: process.env.S3_SECRET_KEY ?? "",
  s3ForcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") !== "false",
  poyoApiKey: process.env.POYO_API_KEY ?? "",
  higgsfieldApiKey: process.env.HIGGSFIELD_API_KEY ?? "",
  higgsfieldApiSecret: process.env.HIGGSFIELD_API_SECRET ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  comfyuiBaseUrl: process.env.COMFYUI_BASE_URL ?? "",
  // Official ComfyUI cloud (cloud.comfy.org). Opt-in per node via the node's
  // 本地/云端 toggle, and only usable by admins / whitelisted users. The base URL
  // and API key are server-side secrets (never exposed to the canvas doc). When
  // either is unset the cloud toggle reports "未配置" and falls back to nothing.
  comfyuiCloudBaseUrl: process.env.COMFYUI_CLOUD_BASE_URL ?? "https://api.comfy.org",
  comfyuiCloudApiKey: process.env.COMFYUI_CLOUD_API_KEY ?? "",
  // Google OAuth (standalone OpenID Connect). Both must be set to enable the
  // "使用 Google 登录" button. GOOGLE_REDIRECT_URI is optional — when unset the
  // callback URL is derived from the incoming request origin.
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? "",
  // HTTPS (self-signed for LAN / to enable end-to-end encryption which needs a
  // secure context). When both files exist the server serves HTTPS.
  httpsCertFile: process.env.HTTPS_CERT_FILE ?? "certs/cert.pem",
  httpsKeyFile: process.env.HTTPS_KEY_FILE ?? "certs/key.pem",
};
