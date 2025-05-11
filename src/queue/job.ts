export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Job {
  id: string;
  repositoryUrl: string;
  installationId: number;
  eventType: string;
  payload: any;
  status: JobStatus;
  createdAt: Date;
  updatedAt: Date;
  attempts: number;
  logs: string[];
}

export interface JobCreateParams {
  repositoryUrl: string;
  installationId: number;
  eventType: string;
  payload: any;
}

export const createJob = (params: JobCreateParams): Job => {
  const now = new Date();

  return {
    id: `job_${now.getTime()}`,
    repositoryUrl: params.repositoryUrl,
    installationId: params.installationId,
    eventType: params.eventType,
    payload: params.payload,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    logs: [],
  };
};
