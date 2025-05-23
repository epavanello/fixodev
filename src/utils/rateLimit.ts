import { and, count, gte, eq } from 'drizzle-orm';
import { userPlansTable, jobExecutionsTable, JobExecutionInsert } from '../db/schema';
import { envConfig } from '../config/env';
import { logger as rootLogger } from '../config/logger';
import { DB } from '@/db';

const logger = rootLogger.child({ context: 'RateLimit' });

export interface RateLimitConfig {
  free: {
    daily: number;
    monthly: number;
  };
  paid: {
    monthly: number;
  };
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  free: {
    daily: 5,
    monthly: 20,
  },
  paid: {
    monthly: 200,
  },
};

export type RateLimitReason = 'daily_limit_exceeded' | 'monthly_limit_exceeded';

export interface RateLimitCheck {
  allowed: boolean;
  planType: 'free' | 'paid';
  usage: {
    daily: number;
    monthly: number;
  };
  limits: {
    daily?: number;
    monthly: number;
  };
  reason?: RateLimitReason;
}

export class RateLimitManager {
  constructor(
    private db: DB,
    private config: RateLimitConfig = DEFAULT_RATE_LIMITS,
  ) {}

  async getUserPlan(userId: string): Promise<'free' | 'paid'> {
    try {
      const userPlan = await this.db
        .select()
        .from(userPlansTable)
        .where(eq(userPlansTable.userId, userId))
        .get();

      return userPlan?.planType || 'free';
    } catch (error) {
      logger.warn({ userId, error }, 'Failed to get user plan, defaulting to free');
      return 'free';
    }
  }

  async checkRateLimit(
    userId: string,
    userType: 'triggeredBy' | 'repoOwner' = 'triggeredBy',
  ): Promise<RateLimitCheck> {
    const planType = await this.getUserPlan(userId);
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get daily usage
    const dailyUsage = await this.db
      .select({ count: count() })
      .from(jobExecutionsTable)
      .where(
        and(
          userType === 'triggeredBy'
            ? eq(jobExecutionsTable.triggeredBy, userId)
            : eq(jobExecutionsTable.repoOwner, userId),
          gte(jobExecutionsTable.createdAt, startOfDay),
        ),
      )
      .get();

    // Get monthly usage
    const monthlyUsage = await this.db
      .select({ count: count() })
      .from(jobExecutionsTable)
      .where(
        and(
          userType === 'triggeredBy'
            ? eq(jobExecutionsTable.triggeredBy, userId)
            : eq(jobExecutionsTable.repoOwner, userId),
          gte(jobExecutionsTable.createdAt, startOfMonth),
        ),
      )
      .get();

    const daily = dailyUsage?.count || 0;
    const monthly = monthlyUsage?.count || 0;

    const limits =
      planType === 'free'
        ? { daily: this.config.free.daily, monthly: this.config.free.monthly }
        : { monthly: this.config.paid.monthly };

    let allowed = true;
    let reason: RateLimitReason | undefined;

    if (planType === 'free') {
      if (daily >= this.config.free.daily) {
        allowed = false;
        reason = 'daily_limit_exceeded';
      } else if (monthly >= this.config.free.monthly) {
        allowed = false;
        reason = 'monthly_limit_exceeded';
      }
    } else {
      if (monthly >= this.config.paid.monthly) {
        allowed = false;
        reason = 'monthly_limit_exceeded';
      }
    }

    return {
      allowed,
      planType,
      usage: { daily, monthly },
      limits,
      reason,
    };
  }

  async recordExecution(execution: Omit<JobExecutionInsert, 'id' | 'createdAt'>): Promise<void> {
    try {
      const executionRecord: JobExecutionInsert = {
        ...execution,
        id: `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        createdAt: new Date(),
      };

      await this.db.insert(jobExecutionsTable).values(executionRecord);

      logger.info(
        {
          jobId: execution.jobId,
          triggeredBy: execution.triggeredBy,
          repoOwner: execution.repoOwner,
        },
        'Recorded job execution for rate limiting',
      );
    } catch (error) {
      logger.error({ execution, error }, 'Failed to record job execution');
      // Don't throw error here to avoid breaking the main flow
    }
  }

  generateRateLimitMessage(
    username: string,
    check: RateLimitCheck,
    userType: 'triggeredBy' | 'repoOwner',
  ): string {
    const contactEmail = envConfig.CONTACT_EMAIL;
    const userTypeText = userType === 'triggeredBy' ? 'you' : 'this repository owner';

    if (check.planType === 'free') {
      if (check.reason === 'daily_limit_exceeded') {
        return `🚧 Hi @${username}! I'd love to help, but ${userTypeText} have reached the daily limit of ${check.limits.daily} requests for free users. You can try again tomorrow, or contact us at ${contactEmail} to upgrade to a paid plan for more executions (${DEFAULT_RATE_LIMITS.paid.monthly}/month). Sorry for the inconvenience! 🙏`;
      } else if (check.reason === 'monthly_limit_exceeded') {
        return `🚧 Hi @${username}! I'd love to help, but ${userTypeText} have reached the monthly limit of ${check.limits.monthly} requests for free users. Please contact us at ${contactEmail} to upgrade to a paid plan for more executions (${DEFAULT_RATE_LIMITS.paid.monthly}/month). Sorry for the inconvenience! 🙏`;
      }
    } else {
      if (check.reason === 'monthly_limit_exceeded') {
        return `🚧 Hi @${username}! I'd love to help, but ${userTypeText} have reached the monthly limit of ${check.limits.monthly} requests for paid users. Please contact us at ${contactEmail} to discuss increasing your quota. Sorry for the inconvenience! 🙏`;
      }
    }

    return `🚧 Hi @${username}! I encountered an issue checking rate limits. Please contact us at ${contactEmail} for assistance. Sorry for the inconvenience! 🙏`;
  }
}
