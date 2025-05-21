import { openrouter, LanguageModelV1 } from '@openrouter/ai-sdk-provider';

/**
 * anthropic/claude-3.7-sonnet
 * openai/gpt-4o-mini
 */

// Initialize chat model
export const coderModel: LanguageModelV1 = openrouter('anthropic/claude-3.7-sonnet');
