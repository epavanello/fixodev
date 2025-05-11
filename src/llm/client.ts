import OpenAI from 'openai';
import { envConfig } from '../config/env';
import { logger } from '../config/logger';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: envConfig.OPENAI_API_KEY,
});

/**
 * Generate a completion with GPT-4
 */
export const generateCompletion = async (
  prompt: string,
  options: {
    maxTokens?: number;
    temperature?: number;
  } = {},
): Promise<string> => {
  try {
    const { maxTokens = 1000, temperature = 0.7 } = options;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a helpful AI assistant that helps with code analysis and fixing. Provide concise and accurate responses.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
      temperature,
    });

    const completion = response.choices[0]?.message.content || '';
    return completion;
  } catch (error) {
    logger.error(error, 'Failed to generate completion with OpenAI');
    throw new Error(`OpenAI API error: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Export OpenAI client
export { openai };
