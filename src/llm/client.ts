import { openrouter, LanguageModelV1 } from '@openrouter/ai-sdk-provider';

// Initialize OpenAI client
export const coderModel: LanguageModelV1 = openrouter('openai/o4-mini-high'); //openrouter('openai/gpt-4o-mini');
