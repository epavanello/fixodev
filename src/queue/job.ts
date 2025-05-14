import { GitHubEventType } from '../types/github';
import { Schema } from '@octokit/webhooks-types';

export interface WebhookEvent<T extends Schema = Schema> {
  id: string;
  name: GitHubEventType;
  payload: T;
}

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Job<T extends Schema = Schema> {
  id: string;
  repositoryUrl: string;
  installationId: number;
  eventType: GitHubEventType;
  event: WebhookEvent<T>;
  status: JobStatus;
  createdAt: Date;
  updatedAt: Date;
  attempts: number;
  logs: string[];
}

export interface JobCreateParams<T extends Schema = Schema> {
  repositoryUrl: string;
  installationId: number;
  eventType: GitHubEventType;
  event: WebhookEvent<T>;
}

export const createJob = <T extends Schema = Schema>(params: JobCreateParams<T>): Job<T> => {
  const now = new Date();

  return {
    id: `job_${now.getTime()}`,
    repositoryUrl: params.repositoryUrl,
    installationId: params.installationId,
    eventType: params.eventType,
    event: params.event,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    logs: [],
  };
};
