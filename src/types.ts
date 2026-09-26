export interface Env {
  GITHUB_CACHE: KVNamespace;
  GITHUB_USERNAME: string;
  ALLOWED_ORIGIN: string;
  GITHUB_TOKEN: string; // set via `wrangler secret put GITHUB_TOKEN`
}
