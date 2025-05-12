import OpenAI from 'openai';
import {
  ChatCompletionRole,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions/completions';
import { AgentContext, ToolCallSchema } from './context';
import { ToolRegistry } from '../tools/registry';
import { MemoryStore } from './memory';
import { logger } from '../../config/logger';
import { envConfig } from '../../config/env';

/**
 * Options for creating an agent
 */
export interface AgentOptions {
  /**
   * The base path for file operations
   */
  basePath: string;

  /**
   * The OpenAI model to use
   */
  model?: string;

  /**
   * The system message to use
   */
  systemMessage?: string;

  /**
   * The maximum number of tokens to use for history
   */
  maxHistoryTokens?: number;

  /**
   * The number of tokens to reserve for the response
   */
  reservedTokens?: number;

  /**
   * Whether to enable verbose logging
   */
  verbose?: boolean;

  /**
   * The OpenAI API key to use (defaults to environment variable)
   */
  apiKey?: string;
}

/**
 * A step in the agent execution
 */
export interface AgentStep {
  /**
   * The input to the step
   */
  input: string;

  /**
   * The output from the step
   */
  output: string;

  /**
   * The tool calls made during the step
   */
  toolCalls?: {
    name: string;
    args: any;
    result: any;
  }[];
}

/**
 * LLM Agent for interacting with code
 */
export class Agent {
  private context: AgentContext;
  private openai: OpenAI;
  private model: string;
  private verbose: boolean;
  private basePath: string;
  private steps: AgentStep[] = [];

  constructor(options: AgentOptions) {
    this.basePath = options.basePath;
    this.model = options.model || 'gpt-4o';
    this.verbose = options.verbose || false;

    // Initialize OpenAI client
    this.openai = new OpenAI({
      apiKey: options.apiKey || envConfig.OPENAI_API_KEY,
    });

    // Initialize tool registry
    const toolRegistry = new ToolRegistry();

    // Initialize memory store
    const memory = new MemoryStore();

    // Initialize context
    this.context = new AgentContext({
      toolRegistry,
      memory,
      maxHistoryTokens: options.maxHistoryTokens,
      reservedTokens: options.reservedTokens,
      systemMessage: options.systemMessage,
    });
  }

  /**
   * Register a tool with the agent
   */
  registerTool(tool: any): this {
    this.context.getToolRegistry().register(tool);
    return this;
  }

  /**
   * Run the agent with a given input
   */
  async run(input: string): Promise<string> {
    try {
      // Add user message to context
      this.context.addUserMessage(input);

      const step: AgentStep = {
        input,
        output: '',
        toolCalls: [],
      };

      // Get the current conversation for the prompt
      const messages = this.convertToOpenAIMessages(this.context.getPromptMessages());

      // Get available tools as JSON Schema
      const tools = this.context
        .getToolRegistry()
        .getAllTools()
        .map(tool => ({
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.getParameterJSONSchema(),
          },
        }));

      // Log request if verbose
      if (this.verbose) {
        logger.debug({ messages, tools }, 'Agent request');
      }

      // Send the request to OpenAI
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages,
        tools,
        tool_choice: 'auto',
      });

      // Extract the response content and tool calls
      const responseMessage = response.choices[0].message;

      if (this.verbose) {
        logger.debug({ responseMessage }, 'Agent response');
      }

      // Check if the LLM wants to call tools
      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        for (const toolCall of responseMessage.tool_calls) {
          try {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments);

            // Log tool call if verbose
            if (this.verbose) {
              logger.debug({ toolName, toolArgs }, 'Tool call');
            }

            // Execute the tool
            const result = await this.context.getToolRegistry().execute(toolName, toolArgs);

            // Log tool result if verbose
            if (this.verbose) {
              logger.debug({ toolName, result }, 'Tool result');
            }

            // Add tool result to context
            this.context.addToolResultMessage(toolCall.id, toolName, JSON.stringify(result));

            // Record the tool call in memory
            const toolCallObj = ToolCallSchema.parse({
              id: toolCall.id,
              name: toolName,
              arguments: toolArgs,
            });

            this.context.recordToolCall(toolCallObj, result);

            // Add to step record
            step.toolCalls!.push({
              name: toolName,
              args: toolArgs,
              result,
            });
          } catch (error) {
            // Handle tool execution error
            const errorMessage = `Error executing tool: ${(error as Error).message}`;

            logger.error({ error }, errorMessage);

            // Add error as tool result
            this.context.addToolResultMessage(
              toolCall.id,
              toolCall.function.name,
              JSON.stringify({ error: errorMessage }),
            );
          }
        }

        // After all tools are executed, get the final response
        return await this.getFinalResponse();
      } else {
        // No tool calls, just return the content
        const output = responseMessage.content || '';

        // Add assistant message to context
        this.context.addAssistantMessage(output);

        // Add to step record
        step.output = output;
        this.steps.push(step);

        return output;
      }
    } catch (error) {
      logger.error({ error }, 'Agent execution error');
      throw error;
    }
  }

  /**
   * Get the agent's memory store
   */
  getMemory(): MemoryStore {
    return this.context.getMemoryStore();
  }

  /**
   * Get the agent's context
   */
  getContext(): AgentContext {
    return this.context;
  }

  /**
   * Get all steps in the agent execution
   */
  getSteps(): AgentStep[] {
    return [...this.steps];
  }

  /**
   * Get the final response after tool execution
   */
  private async getFinalResponse(): Promise<string> {
    try {
      // Get the current conversation for the prompt
      const messages = this.convertToOpenAIMessages(this.context.getPromptMessages());

      // Send the request to OpenAI
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages,
      });

      // Extract the response content
      const output = response.choices[0].message.content || '';

      // Add assistant message to context
      this.context.addAssistantMessage(output);

      // Update the last step with the final output
      if (this.steps.length > 0) {
        this.steps[this.steps.length - 1].output = output;
      }

      return output;
    } catch (error) {
      logger.error({ error }, 'Failed to get final response');
      throw error;
    }
  }

  /**
   * Convert internal message format to OpenAI's message format
   */
  private convertToOpenAIMessages(
    messages: { role: ChatCompletionRole; content: string; name?: string; tool_call_id?: string }[],
  ): ChatCompletionMessageParam[] {
    return messages.map(msg => {
      if (msg.role === 'function' && msg.tool_call_id) {
        // Function/tool response
        return {
          role: msg.role,
          content: msg.content,
          name: msg.name,
          tool_call_id: msg.tool_call_id,
        } as ChatCompletionMessageParam;
      } else if (msg.role === 'assistant' && msg.name) {
        // Assistant with name
        return {
          role: msg.role,
          content: msg.content,
          name: msg.name,
        } as ChatCompletionMessageParam;
      } else if (msg.role === 'system') {
        // System message
        return {
          role: msg.role,
          content: msg.content,
        } as ChatCompletionMessageParam;
      } else if (msg.role === 'user') {
        // User message
        return {
          role: msg.role,
          content: msg.content,
          ...(msg.name ? { name: msg.name } : {}),
        } as ChatCompletionMessageParam;
      }

      // Default case
      return {
        role: msg.role,
        content: msg.content,
        ...(msg.name ? { name: msg.name } : {}),
      } as ChatCompletionMessageParam;
    });
  }
}
