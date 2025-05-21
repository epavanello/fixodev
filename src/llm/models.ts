import { openrouter, LanguageModelV1 } from '@openrouter/ai-sdk-provider';

// Initialize chat model
export const coderModel: LanguageModelV1 = openrouter('openai/gpt-4o-mini');
