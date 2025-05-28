import { envConfig } from '@/config/env';

const BOT_MENTION = `@${envConfig.BOT_NAME}`.toLowerCase();

/**
 * Checks if the bot is mentioned in the body and extracts the command.
 */
export function isBotMentioned(body: string | null | undefined, sender: string) {
  if (!body) {
    return false;
  }
  return (
    body.toLowerCase().includes(BOT_MENTION) &&
    sender.toLowerCase() !== envConfig.BOT_NAME.toLowerCase() &&
    sender.toLowerCase() !== `${envConfig.BOT_NAME.toLowerCase()}[bot]`
  );
}
