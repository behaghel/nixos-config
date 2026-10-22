import { git } from "./git.ts";
import { CliError, run } from "./runtime.ts";
import type { PullRequestMetadata } from "./types.ts";

function githubRepository(url: string): string {
	const match = url.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
	if (!match?.[1]) throw new CliError("PR creation requires a github.com upstream repository URL.");
	return match[1];
}

export function validPullRequest(value: unknown): value is PullRequestMetadata {
	if (!value || typeof value !== "object") return false;
	const pr = value as Partial<PullRequestMetadata>;
	return Number.isSafeInteger(pr.number) && (pr.number ?? 0) > 0 &&
		typeof pr.repository === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(pr.repository) &&
		pr.url === `https://github.com/${pr.repository}/pull/${pr.number}` &&
		typeof pr.baseBranch === "string" && typeof pr.headBranch === "string" &&
		typeof pr.headCommit === "string" && /^[a-f0-9]{40}$/.test(pr.headCommit) &&
		pr.trustedHeadCommit === pr.headCommit && pr.mode === "review" &&
		["OPEN", "CLOSED", "MERGED"].includes(pr.state ?? "") && typeof pr.isDraft === "boolean";
}

export function resolvePullRequest(root: string, remote: string, number: number): PullRequestMetadata {
	// Read the configured identity, not get-url's insteadOf-expanded transport.
	const repository = githubRepository(git(root, ["config", "--get", `remote.${remote}.url`]));
	const result = run("gh", [
		"pr", "view", String(number), "--repo", `https://github.com/${repository}`,
		"--json", "number,url,state,isDraft,baseRefName,headRefName,headRefOid,isCrossRepository",
	], root);
	if (result.status !== 0) {
		throw new CliError(`Could not resolve PR #${number} with gh. Ensure gh is installed and run gh auth login.${result.stderr ? `\n${result.stderr}` : ""}`);
	}
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(result.stdout);
		if (!raw || typeof raw !== "object") throw new Error("Expected an object");
	} catch {
		throw new CliError("gh returned invalid PR metadata.");
	}
	if (raw.isCrossRepository === true) throw new CliError("Fork PR review is not supported yet; no session was created.");
	const pr = {
		number: raw.number, url: raw.url, repository,
		baseBranch: raw.baseRefName, headBranch: raw.headRefName,
		headCommit: raw.headRefOid, state: raw.state, isDraft: raw.isDraft,
		mode: "review", trustedHeadCommit: raw.headRefOid,
	};
	if (!validPullRequest(pr) || pr.number !== number || raw.isCrossRepository !== false ||
		run("git", ["check-ref-format", "--branch", pr.headBranch], root).status !== 0 ||
		run("git", ["check-ref-format", "--branch", pr.baseBranch], root).status !== 0) {
		throw new CliError("gh returned invalid or mismatched PR metadata.");
	}
	if (pr.state !== "OPEN" || pr.isDraft) throw new CliError("Only open, non-draft PR review is supported currently.");
	assertReviewPushConfiguration(root, remote, repository);
	return pr;
}

function assertReviewPushConfiguration(root: string, remote: string, repository: string): void {
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
	const head = git(root, ["rev-parse", "--verify", "FETCH_HEAD^{commit}"]);
	const source = run("git", ["rev-parse", "--verify", `refs/remotes/${remote}/${pr.headBranch}^{commit}`], root);
	if (head !== pr.headCommit || source.status !== 0 || source.stdout !== pr.headCommit) {
		throw new CliError("PR head changed or its source branch is unavailable. Retry after inspecting the PR; no session was created.");
	}
}
