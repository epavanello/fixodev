import { openrouter, LanguageModelV1 } from '@openrouter/ai-sdk-provider';

export interface ModelConfig {
  id: string;
  name: string;
  contextWindow: number;
  inputCostPerToken: number; // in millionths of euro
  outputCostPerToken: number; // in millionths of euro
  model: LanguageModelV1;
}

const modelConfigArray = [
  {
    id: 'anthropic/claude-3.7-sonnet',
    name: 'Claude 3.7 Sonnet',
    contextWindow: 200_000,
    inputCostPerToken: 3,
    outputCostPerToken: 15,
  },
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini',
    contextWindow: 128_000,
    inputCostPerToken: 0.15,
    outputCostPerToken: 0.6,
  },
] as const satisfies Omit<ModelConfig, 'model'>[];

type ModelConfigId = (typeof modelConfigArray)[number]['id'];

const modelConfigs: Record<ModelConfigId, ModelConfig> = modelConfigArray.reduce(
  (acc, config) => {
    acc[config.id] = {
      ...config,
      model: openrouter(config.id),
    };
    return acc;
  },
  {} as Record<string, ModelConfig>,
);

export function calculateCostInMillionths(
  modelConfig: ModelConfig,
  inputTokens: number,
  outputTokens: number,
): number {
  return (
    inputTokens * modelConfig.inputCostPerToken + outputTokens * modelConfig.outputCostPerToken
  );
}

export function formatCost(totalCostInMillionths: number) {
  const totalCostInEuro = totalCostInMillionths / 1_000_000;

  // Format to a string with 8 decimal places to show precision for small costs.
  // For example: €0.00000300 for 1 input token with Sonnet (3/1,000,000)
  const formattedCost = `€${totalCostInEuro.toFixed(8)}`;

  return formattedCost;
}

export function getModelConfig(modelId: ModelConfigId): ModelConfig {
  const config = modelConfigs[modelId];
  if (!config) {
    throw new Error(`Unknown model: ${modelId}`);
  }
  return config;
}

// Initialize chat model
export const coderModel: ModelConfig = getModelConfig('openai/gpt-4o-mini');
