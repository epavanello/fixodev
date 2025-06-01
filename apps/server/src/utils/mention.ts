import { envConfig } from '@/config/env';
import { logger } from '@/config/logger';

const BOT_MENTION = `@${envConfig.BOT_NAME}`.toLowerCase();

/**
 * Checks if the bot is mentioned in the body and extracts the command.
 */
export function isBotMentioned(body: string | null | undefined, sender: string) {
  if (!body) {
    return false;
  }
  const result =
    body.toLowerCase().includes(BOT_MENTION) &&
    sender.toLowerCase() !== envConfig.BOT_NAME.toLowerCase() &&
    sender.toLowerCase() !== `${envConfig.APP_NAME.toLowerCase()}[bot]`;

  if (result) {
    logger.info({ sender }, 'Bot mentioned');
  }
  return result;
}
