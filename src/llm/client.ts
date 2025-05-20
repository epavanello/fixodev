import { openrouter, LanguageModelV1 } from '@openrouter/ai-sdk-provider';

// Initialize OpenAI client
export const coderModel: LanguageModelV1 = openrouter('anthropic/claude-3.7-sonnet'); //openrouter('openai/gpt-4o-mini');
