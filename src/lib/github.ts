import type { Env } from "../types";

const CACHE_TTL_SECONDS = 60 * 30; // 30 minutes — plenty fresh, keeps us well under rate limits

interface GithubProfile {
  login: string;
  name: string | null;
  avatarUrl: string;
  bio: string | null;
  followers: number;
  following: number;
  publicRepos: number;
}

interface ContributionDay {
  date: string;
  count: number;
}

interface ContributionData {
  totalContributions: number;
  days: ContributionDay[];
}

async function githubRest<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "nayeem-portfolio-worker",
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new Error(`GitHub REST error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function githubGraphQL<T>(query: string, variables: Record<string, unknown>, token: string): Promise<T> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "nayeem-portfolio-worker",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL error ${res.status}: ${await res.text()}`);
  const json = await res.json<{ data: T; errors?: unknown }>();
  if (json.errors) throw new Error(`GitHub GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data;
}

/** Cache wrapper: serve from KV if fresh, otherwise fetch + repopulate. */
async function withCache<T>(env: Env, key: string, fetcher: () => Promise<T>): Promise<T> {
  const cached = await env.GITHUB_CACHE.get(key, "json");
  if (cached) return cached as T;

  const fresh = await fetcher();
  await env.GITHUB_CACHE.put(key, JSON.stringify(fresh), { expirationTtl: CACHE_TTL_SECONDS });
  return fresh;
}

export async function getGithubProfile(env: Env): Promise<GithubProfile> {
  return withCache(env, `profile:${env.GITHUB_USERNAME}`, async () => {
    const data = await githubRest<{
      login: string; name: string | null; avatar_url: string; bio: string | null;
      followers: number; following: number; public_repos: number;
    }>(`/users/${env.GITHUB_USERNAME}`, env.GITHUB_TOKEN);

    return {
      login: data.login,
      name: data.name,
      avatarUrl: data.avatar_url,
      bio: data.bio,
      followers: data.followers,
      following: data.following,
      publicRepos: data.public_repos,
    };
  });
}

export async function getGithubContributions(env: Env): Promise<ContributionData> {
  return withCache(env, `contributions:${env.GITHUB_USERNAME}`, async () => {
    const query = `
      query($login: String!) {
        user(login: $login) {
          contributionsCollection {
            contributionCalendar {
              totalContributions
              weeks {
                contributionDays { date contributionCount }
              }
            }
          }
        }
      }
    `;

    const data = await githubGraphQL<{
      user: {
        contributionsCollection: {
          contributionCalendar: {
            totalContributions: number;
            weeks: { contributionDays: { date: string; contributionCount: number }[] }[];
          };
        };
      };
    }>(query, { login: env.GITHUB_USERNAME }, env.GITHUB_TOKEN);

    const calendar = data.user.contributionsCollection.contributionCalendar;
    const days = calendar.weeks.flatMap((w) =>
      w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount }))
    );

    return { totalContributions: calendar.totalContributions, days };
  });
}
