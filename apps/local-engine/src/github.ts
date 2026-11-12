/**
 * GitHub access through the REST API. Repositories are downloaded as source
 * archives, so no git commands or repository hooks ever run. Access tokens
 * travel only in the Authorization header.
 */
import fs from 'node:fs';
import { Octokit } from 'octokit';

export interface GitHubRef {
  owner: string;
  repo: string;
  branch: string | null;
  subdirectory: string | null;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;

/** Accepts https URLs, `git@github.com:owner/repo.git` and `owner/repo`. */
export function parseGitHubUrl(input: string): GitHubRef {
  const raw = input.trim();
  if (!raw) throw new GitHubError('Enter a GitHub repository URL', 400);
  if (/^[a-z]+:\/\/[^/\s]*@/i.test(raw)) throw new GitHubError('Do not put credentials in the URL. Use the access token field instead.', 400);
  let rest: string;
  const ssh = /^git@github\.com:(.+)$/i.exec(raw);
  if (ssh) rest = ssh[1]!;
  else if (/^https?:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new GitHubError('That is not a valid URL', 400);
    }
    if (!/^(www\.)?github\.com$/i.test(url.hostname)) throw new GitHubError('Only github.com repositories are supported', 400);
    rest = url.pathname.replace(/^\/+/, '');
  } else rest = raw.replace(/^github\.com\//i, '');
  const parts = rest.replace(/\/+$/, '').split('/').filter(Boolean);
  const owner = parts[0];
  const repo = parts[1]?.replace(/\.git$/i, '');
  if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo)) throw new GitHubError('Expected a repository in the form owner/name', 400);
  let branch: string | null = null;
  let subdirectory: string | null = null;
  if ((parts[2] === 'tree' || parts[2] === 'blob') && parts[3]) {
    // Branch names may contain slashes; the first segment is taken and can be corrected in the form.
    branch = decodeURIComponent(parts[3]);
    if (parts.length > 4) subdirectory = parts.slice(4).map(decodeURIComponent).join('/');
  }
  return { owner, repo, branch, subdirectory };
}

export interface GitHubRepoInfo {
  owner: string;
  repo: string;
  fullName: string;
  description: string | null;
  defaultBranch: string;
  branches: string[];
  private: boolean;
  sizeKb: number;
  htmlUrl: string;
}

const MAX_REPO_KB = 1024 * 1024; // 1 GB as reported by GitHub

export class GitHubClient {
  private octokit: Octokit;

  constructor(opts: { token?: string | null; fetch?: typeof fetch } = {}) {
    this.octokit = new Octokit({
      auth: opts.token || undefined,
      userAgent: 'vectora-local-engine',
      request: opts.fetch ? { fetch: opts.fetch } : undefined,
      retry: { enabled: false },
      throttle: { enabled: false },
      log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    });
  }

  private wrap(err: unknown, hasToken: boolean): GitHubError {
    const status = (err as { status?: number }).status ?? 502;
    if (status === 404) return new GitHubError(hasToken ? 'Repository not found, or the credential has no access to it' : 'Repository not found. If it is private, add an access token.', 404);
    if (status === 401) return new GitHubError('GitHub rejected the access token', 401);
    if (status === 403 || status === 429) return new GitHubError('GitHub refused the request (rate limit or insufficient permission). An access token raises the limit.', 403);
    return new GitHubError(`GitHub could not be reached (${status})`, 502);
  }

  async describe(ref: Pick<GitHubRef, 'owner' | 'repo'>, hasToken = false): Promise<GitHubRepoInfo> {
    try {
      const { data } = await this.octokit.rest.repos.get({ owner: ref.owner, repo: ref.repo });
      let branches: string[] = [];
      try {
        const res = await this.octokit.rest.repos.listBranches({ owner: ref.owner, repo: ref.repo, per_page: 100 });
        branches = res.data.map((b) => b.name);
      } catch {
        branches = [];
      }
      if (!branches.includes(data.default_branch)) branches.unshift(data.default_branch);
      return {
        owner: data.owner.login,
        repo: data.name,
        fullName: data.full_name,
        description: data.description,
        defaultBranch: data.default_branch,
        branches,
        private: data.private,
        sizeKb: data.size,
        htmlUrl: data.html_url,
      };
    } catch (err) {
      throw this.wrap(err, hasToken);
    }
  }

  /** Downloads the source archive of a branch to `destFile`. */
  async downloadArchive(ref: Pick<GitHubRef, 'owner' | 'repo'>, branch: string, destFile: string, hasToken = false): Promise<number> {
    const info = await this.describe(ref, hasToken);
    if (info.sizeKb > MAX_REPO_KB) throw new GitHubError('Repository is larger than the 1 GB import limit', 413);
    try {
      const res = await this.octokit.request('GET /repos/{owner}/{repo}/zipball/{ref}', { owner: ref.owner, repo: ref.repo, ref: branch });
      const buf = Buffer.from(res.data as ArrayBuffer);
      fs.writeFileSync(destFile, buf);
      return buf.length;
    } catch (err) {
      throw this.wrap(err, hasToken);
    }
  }
}
