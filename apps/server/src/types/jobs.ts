export enum JobType {
  AppMention = 'app_mention',
  AppMentionOnPullRequest = 'app_mention_on_pull_request',
}

export interface BaseJob {
  id: string;
  type: JobType;
  originalRepoOwner: string;
  originalRepoName: string;
  installationId: number;
  triggeredBy: string;
  commandToProcess: string;
  repositoryUrl: string;
}

export interface AppMentionOnIssueJob extends BaseJob {
  type: JobType.AppMention;
  eventIssueNumber: number;
  eventIssueTitle: string;
}

export interface AppMentionOnPullRequestJob extends BaseJob {
  type: JobType.AppMentionOnPullRequest;
  eventPullRequestNumber: number;
  eventPullRequestTitle: string;
  pullRequestUrl: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  baseSha: string;
  commentId: number;
}

export type Job = AppMentionOnIssueJob | AppMentionOnPullRequestJob;
