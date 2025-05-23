import { eq } from 'drizzle-orm';
import { userPlansTable, UserPlanInsert } from '../db/schema';
import { db } from '../db';
import { logger as rootLogger } from '../config/logger';

const logger = rootLogger.child({ context: 'UserPlans' });

export class UserPlanManager {
  constructor(private database = db) {}

  async getUserPlan(userId: string): Promise<'free' | 'paid'> {
    try {
      const userPlan = await this.database
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

  async upgradeUserToPaid(userId: string): Promise<void> {
    const now = new Date();

    try {
      const existingPlan = await this.database
        .select()
        .from(userPlansTable)
        .where(eq(userPlansTable.userId, userId))
        .get();

      if (existingPlan) {
        // Update existing plan
        await this.database
          .update(userPlansTable)
          .set({
            planType: 'paid',
            updatedAt: now,
          })
          .where(eq(userPlansTable.userId, userId));

        logger.info({ userId }, 'Updated user plan to paid');
      } else {
        // Create new plan
        const newPlan: UserPlanInsert = {
          userId,
          planType: 'paid',
          createdAt: now,
          updatedAt: now,
        };

        await this.database.insert(userPlansTable).values(newPlan);
        logger.info({ userId }, 'Created paid plan for user');
      }
    } catch (error) {
      logger.error({ userId, error }, 'Failed to upgrade user to paid plan');
      throw new Error(`Failed to upgrade user ${userId} to paid plan: ${error}`);
    }
  }

  async downgradeUserToFree(userId: string): Promise<void> {
    const now = new Date();

    try {
      const existingPlan = await this.database
        .select()
        .from(userPlansTable)
        .where(eq(userPlansTable.userId, userId))
        .get();

      if (existingPlan) {
        await this.database
          .update(userPlansTable)
          .set({
            planType: 'free',
            updatedAt: now,
          })
          .where(eq(userPlansTable.userId, userId));

        logger.info({ userId }, 'Downgraded user plan to free');
      } else {
        // User doesn't have a plan record, they're already free by default
        logger.info({ userId }, 'User already has default free plan');
      }
    } catch (error) {
      logger.error({ userId, error }, 'Failed to downgrade user to free plan');
      throw new Error(`Failed to downgrade user ${userId} to free plan: ${error}`);
    }
  }

  async getAllPaidUsers(): Promise<string[]> {
    try {
      const paidUsers = await this.database
        .select({ userId: userPlansTable.userId })
        .from(userPlansTable)
        .where(eq(userPlansTable.planType, 'paid'));

      return paidUsers.map(user => user.userId);
    } catch (error) {
      logger.error({ error }, 'Failed to get paid users');
      return [];
    }
  }

  async createOrUpdateUserPlan(userId: string, planType: 'free' | 'paid'): Promise<void> {
    if (planType === 'paid') {
      await this.upgradeUserToPaid(userId);
    } else {
      await this.downgradeUserToFree(userId);
    }
  }
}

// Export a default instance
export const userPlanManager = new UserPlanManager();
