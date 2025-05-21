import { openrouter, LanguageModelV1 } from '@openrouter/ai-sdk-provider';

// Initialize OpenAI client
export const coderModel: LanguageModelV1 = openrouter('google/gemini-2.0-flash-001'); //openrouter('openai/gpt-4o-mini');
