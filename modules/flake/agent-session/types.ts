export interface AgentSessionConfig {
	version: number;
	worktree_root: string;
	agent_command: string[];
	prepare_command: string[];
	local_links: string[];
}

export interface PullRequestSelection {
	number: number;
	repository?: string;
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
	mode: "review";
	trustedHeadCommit: string;
	sourceRepository?: string;
	sourceRemote?: string;
}

export interface SessionMetadata {
	version: 1;
	slug: string;
	branch: string;
	worktreePath: string;
	remote: string;
	defaultBranch: string;
	createdAt: string;
	conversation: null;
	preexistingBranches?: string[];
	pr?: PullRequestMetadata;
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
