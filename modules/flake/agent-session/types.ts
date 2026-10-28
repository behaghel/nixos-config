export interface AgentSessionConfig {
	version: number;
	worktree_root: string;
	agent_command: string[];
	prepare_command: string[];
	local_links: string[];
	disposable_paths: string[];
}

export type PullRequestMode = "review" | "independent";

export interface PullRequestSelection {
	number: number;
	repository?: string;
	mode?: PullRequestMode;
}

export interface PullRequestMetadata {
	number: number;
	url: string;
	repository: string;
	baseBranch: string;
	headBranch: string;
	headCommit: string;
	state: "OPEN" | "CLOSED" | "MERGED";
	isDraft: boolean;
	mode: PullRequestMode;
	trustedHeadCommit: string;
	sourceRepository?: string | null;
	sourceRemote?: string;
	sourceBranchMissing?: boolean;
}

export interface ActiveOperation {
	id: string;
	pid: number;
	hostname: string;
	startedAt: string;
}

export interface SessionMetadata {
	version: 1 | 2;
	slug: string;
	branch: string;
	worktreePath: string;
	remote: string;
	defaultBranch: string;
	createdAt: string;
	lastWorkAt?: string;
	activeOperations?: ActiveOperation[];
	conversation: null;
	preexistingBranches?: string[];
	initialBranchOwned?: boolean;
	pr?: PullRequestMetadata;
}

export interface BatchFinishOptions {
	inactiveFor: string;
	inactiveMs: number;
	exclusions: string[];
	json: boolean;
	dryRun: boolean;
	yes: boolean;
	expected?: string;
}

export interface OperationLock {
	pid: number;
	command: string;
	createdAt: string;
}

export interface SessionStatus extends SessionMetadata {
	initialBranch: string;
	currentBranch: string | null;
	ownedBranches: string[];
	state:
		| "ready"
		| "dirty"
		| "stale"
		| "dirty-stale"
		| "orphaned"
		| "unrecorded"
		| "conflict"
		| "broken";
	clean: boolean;
	fresh: boolean;
	publication: "unpublished" | "unpushed" | "behind" | "diverged" | "published";
	ahead: number;
	behind: number;
	problem?: string;
}

export type ProgressStatus = "started" | "completed" | "failed" | "skipped";

export type ProgressReporter = (
	phase: string,
	status: ProgressStatus,
	detail?: string,
) => void;

export interface ManagedWorktree {
	slug: string;
	branch: string;
	worktreePath: string;
}

export interface ReflogEntry {
	timestamp: string;
	commit: string;
	summary: string;
}
