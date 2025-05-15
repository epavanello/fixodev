import OpenAI from 'openai';
import { envConfig } from '../config/env';

// Initialize OpenAI client
export const openai = new OpenAI({
  apiKey: envConfig.OPENAI_API_KEY,
});
