import { envConfig } from '@/config/env';

const BOT_MENTION = `@${envConfig.BOT_NAME}`.toLowerCase();

/**
 * Checks if the bot is mentioned in the body and extracts the command.
 */
export function getBotCommandFromPayload(
  body: string | null | undefined,
  sender: string,
):
  | {
      shouldProcess: false;
      command?: undefined;
    }
  | {
      shouldProcess: true;
      command: string;
    } {
  if (!body) {
    return { shouldProcess: false };
  }
  if (
    body.toLowerCase().includes(BOT_MENTION) &&
    sender.toLowerCase() !== envConfig.BOT_NAME.toLowerCase() &&
    sender.toLowerCase() !== `${envConfig.BOT_NAME.toLowerCase()}[bot]`
  ) {
    return { shouldProcess: true, command: body };
  }
  return { shouldProcess: false };
}
