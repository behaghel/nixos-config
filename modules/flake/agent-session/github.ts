import { git } from "./git.ts";
import { CliError, run } from "./runtime.ts";
import type { PullRequestMetadata, PullRequestSelection } from "./types.ts";

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const remotePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function githubRepository(url: string): string {
	const match = url.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i);
	if (!match?.[1]) throw new CliError("PR creation requires a github.com upstream repository URL.");
	return match[1].toLowerCase();
}

export function parsePullRequestSelection(value: string): PullRequestSelection {
	const url = value.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)\/?$/i);
	const number = Number(url?.[2] ?? value);
	if ((!url && !/^[1-9][0-9]*$/.test(value)) || !Number.isSafeInteger(number)) {
		throw new CliError("--pr requires a positive PR number or a github.com PR URL.", 64);
	}
	return { number, ...(url ? { repository: url[1]!.toLowerCase() } : {}) };
}

export function assertPullRequestTarget(root: string, remote: string, selection: PullRequestSelection): string {
	// Configured identity, not get-url's insteadOf-expanded transport.
	const repository = githubRepository(git(root, ["config", "--get", `remote.${remote}.url`]));
	if (selection.repository !== undefined && selection.repository !== repository) {
		throw new CliError(`PR URL targets a different repository (${selection.repository}); this project's upstream is ${repository}.`);
	}
	return repository;
}

export function validPullRequest(value: unknown): value is PullRequestMetadata {
	if (!value || typeof value !== "object") return false;
	const pr = value as Partial<PullRequestMetadata>;
	return Number.isSafeInteger(pr.number) && (pr.number ?? 0) > 0 &&
		typeof pr.repository === "string" && repositoryPattern.test(pr.repository) &&
		pr.url === `https://github.com/${pr.repository}/pull/${pr.number}` &&
		typeof pr.baseBranch === "string" && typeof pr.headBranch === "string" &&
		typeof pr.headCommit === "string" && /^[a-f0-9]{40}$/.test(pr.headCommit) &&
		pr.trustedHeadCommit === pr.headCommit && pr.mode === "review" &&
		["OPEN", "CLOSED", "MERGED"].includes(pr.state ?? "") && typeof pr.isDraft === "boolean" &&
		(pr.sourceRepository === undefined || (typeof pr.sourceRepository === "string" && repositoryPattern.test(pr.sourceRepository))) &&
		(pr.sourceRemote === undefined || (typeof pr.sourceRemote === "string" && remotePattern.test(pr.sourceRemote) && pr.sourceRepository !== undefined));
}

export function resolvePullRequest(root: string, remote: string, selection: PullRequestSelection): PullRequestMetadata {
	const repository = assertPullRequestTarget(root, remote, selection);
	const result = run("gh", [
		"pr", "view", String(selection.number), "--repo", `https://github.com/${repository}`,
		"--json", "number,url,state,isDraft,baseRefName,headRefName,headRefOid,isCrossRepository,headRepository,headRepositoryOwner",
	], root);
	if (result.status !== 0) {
		throw new CliError(`Could not resolve PR #${selection.number} with gh. Ensure gh is installed and run gh auth login.${result.stderr ? `\n${result.stderr}` : ""}`);
	}
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(result.stdout);
		if (!raw || typeof raw !== "object") throw new Error("Expected an object");
	} catch {
		throw new CliError("gh returned invalid PR metadata.");
	}
	const source = raw.headRepository as { name?: unknown } | null;
	const owner = raw.headRepositoryOwner as { login?: unknown } | null;
	if (typeof source?.name !== "string" || typeof owner?.login !== "string" ||
		!repositoryPattern.test(`${owner.login}/${source.name}`)) {
		throw new CliError("PR source repository is unavailable or invalid; no session was created.");
	}
	const sourceRepository = `${owner.login}/${source.name}`.toLowerCase();
	const pr = {
		number: raw.number, url: typeof raw.url === "string" ? raw.url.toLowerCase() : raw.url, repository,
		baseBranch: raw.baseRefName, headBranch: raw.headRefName,
		headCommit: raw.headRefOid, state: raw.state, isDraft: raw.isDraft,
		mode: "review", trustedHeadCommit: raw.headRefOid, sourceRepository,
	};
	if (!validPullRequest(pr) || pr.number !== selection.number ||
		raw.isCrossRepository !== (sourceRepository !== repository) ||
		run("git", ["check-ref-format", "--branch", pr.headBranch], root).status !== 0 ||
		run("git", ["check-ref-format", "--branch", pr.baseBranch], root).status !== 0) {
		throw new CliError("gh returned invalid or mismatched PR metadata.");
	}
	if (pr.state !== "OPEN" || pr.isDraft) throw new CliError("Only open, non-draft PR review is supported currently.");
	if (sourceRepository === repository) assertReviewSource(root, remote, pr);
	return pr;
}

export function assertReviewSource(root: string, remote: string, pr: PullRequestMetadata): void {
	const repository = pr.sourceRepository ?? pr.repository;
	if (githubRepository(git(root, ["config", "--get", `remote.${remote}.url`])) !== repository) {
		throw new CliError("PR source remote no longer identifies the recorded source repository.");
	}
	const pushUrls = run("git", ["config", "--get-all", `remote.${remote}.pushurl`], root);
	if (pushUrls.status === 0 && pushUrls.stdout.split("\n").some((url) => githubRepository(url) !== repository)) {
		throw new CliError("PR source remote has a conflicting push URL; refusing to change its configuration.");
	}
	const pushRefs = run("git", ["config", "--get-all", `remote.${remote}.push`], root);
	const pushDefault = run("git", ["config", "--get", "push.default"], root);
	const mirror = run("git", ["config", "--bool", "--get", `remote.${remote}.mirror`], root);
	if (pushRefs.status === 0 || pushDefault.stdout === "matching" || mirror.stdout === "true") {
		throw new CliError("PR source remote has unsafe push settings; refusing to configure review tracking.");
	}
}

export function fetchPullRequestHead(root: string, remote: string, pr: PullRequestMetadata): void {
	const fetched = run("git", ["fetch", remote, `refs/pull/${pr.number}/head`], root);
	if (fetched.status !== 0) throw new CliError(`Could not fetch PR #${pr.number} head.${fetched.stderr ? `\n${fetched.stderr}` : ""}`);
	if (git(root, ["rev-parse", "--verify", "FETCH_HEAD^{commit}"]) !== pr.headCommit) {
		throw new CliError("PR head changed. Retry after inspecting the PR; no session was created.");
	}
}

// A named Git remote supplies an ordinary upstream and safe plain-push target.
// Existing remotes are never repointed. Successful sessions retain their source
// remote, including after finish, so preserved branches keep their tracking.
export function prepareReviewSource(root: string, baseRemote: string, slug: string, pr: PullRequestMetadata): { remote: string; created: boolean } {
	let remote = baseRemote;
	let created = false;
	if (pr.sourceRepository !== pr.repository) {
		const matching = git(root, ["remote"]).split("\n").find((candidate) => {
			if (!remotePattern.test(candidate)) return false;
			try {
				return githubRepository(git(root, ["config", "--get", `remote.${candidate}.url`])) === pr.sourceRepository;
			} catch { return false; }
		});
		remote = matching ?? `as-pr-${slug}`;
		if (!matching) {
			const pattern = remote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			if (run("git", ["config", "--get-regexp", `^remote\\.${pattern}\\.`], root).status === 0 ||
				git(root, ["for-each-ref", "--format=%(refname)", `refs/remotes/${remote}/`])) {
				throw new CliError(`Refusing to overwrite existing source remote ${remote}.`);
			}
			git(root, ["remote", "add", remote, `https://github.com/${pr.sourceRepository}.git`]);
			created = true;
		}
	}
	try {
		assertReviewSource(root, remote, pr);
		if (remote !== baseRemote) {
			const fetched = run("git", ["fetch", "--prune", remote], root);
			if (fetched.status !== 0) throw new CliError(`Could not fetch PR source remote ${remote}.${fetched.stderr ? `\n${fetched.stderr}` : ""}`);
		}
		const source = run("git", ["rev-parse", "--verify", `refs/remotes/${remote}/${pr.headBranch}^{commit}`], root);
		if (source.status !== 0 || source.stdout !== pr.headCommit) {
			throw new CliError("PR head changed or its source branch is unavailable. Retry after inspecting the PR; no session was created.");
		}
		return { remote, created };
	} catch (error) {
		if (created) git(root, ["remote", "remove", remote]);
		throw error;
	}
}
