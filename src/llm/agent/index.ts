import OpenAI from 'openai';
import {
  ChatCompletionRole,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions/completions';
import { AgentContext, ToolCallSchema } from './context';
import { ToolRegistry } from '../tools/registry';
import { MemoryStore } from './memory';
import { logger } from '../../config/logger';
import { createTaskCompletionTool } from '../tools/registry';
import { Tool } from '../tools/types';
import * as z from 'zod';
import { openai } from '../client';

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
   * The OpenAI API key to use (defaults to environment variable)
   */
  apiKey?: string;

  /**
   * Maximum number of iterations for a single task
   */
  maxIterations?: number;
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
}

/**
 * LLM Agent for interacting with code
 */
export class Agent {
  private context: AgentContext;
  private openai: OpenAI;
  private model: string;
  private basePath: string;
  private steps: AgentStep[] = [];
  private maxIterations: number;

  constructor(options: AgentOptions) {
    this.basePath = options.basePath;
    this.model = options.model || 'gpt-4o';
    this.maxIterations = options.maxIterations || 5;

    // Initialize OpenAI client
    this.openai = openai;

    // Initialize tool registry
    const toolRegistry = new ToolRegistry();

    // Register the task completion tool
    toolRegistry.register(createTaskCompletionTool());

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
  registerTool<T extends z.ZodType, R>(tool: Tool<T, R>): this {
    this.context.getToolRegistry().register(tool);
    return this;
  }

  /**
   * Run the agent with a given input, iterating until task completion or max iterations
   */
  async run<PARAMS extends z.ZodType, OUTPUT>(
    input: string,
    { outputTool }: { outputTool: Tool<PARAMS, OUTPUT> },
  ): Promise<OUTPUT | undefined> {
    try {
      // Add user message to context
      this.context.addUserMessage(input);

      let currentIteration = 0;
      let needMoreProcessing = true;
      let output: OUTPUT | undefined;

      // Get available tools as JSON Schema
      const tools = [...this.context.getToolRegistry().getAllTools(), ...[outputTool]].map(
        tool => ({
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.getParameterJSONSchema(),
          },
        }),
      );

      while (needMoreProcessing && currentIteration < this.maxIterations) {
        currentIteration++;

        logger.debug(
          { iteration: currentIteration, maxIterations: this.maxIterations },
          'Starting agent iteration',
        );

        // Get the current conversation for the prompt
        const messages = this.convertToOpenAIMessages(this.context.getPromptMessages());

        logger.debug({ messages, iteration: currentIteration }, 'Agent request');

        // Send the request to OpenAI
        const response = await this.openai.chat.completions.create({
          model: this.model,
          messages,
          tools,
          tool_choice: 'auto',
          parallel_tool_calls: true,
        });

        // Extract the response content and tool calls
        const responseMessage = response.choices[0].message;

        logger.debug({ responseMessage, iteration: currentIteration }, 'Agent response');

        // Set default for this iteration's outcome
        let iterationOutput = responseMessage.content || '';

        // Check if the LLM wants to call tools
        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
          // Add the assistant response with tool calls to the context
          const toolCalls = responseMessage.tool_calls.map(toolCall => {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments);
            return ToolCallSchema.parse({
              id: toolCall.id,
              name: toolName,
              arguments: toolArgs,
            });
          });

          this.context.addAssistantToolCallMessage(responseMessage.content || '', toolCalls);

          for (const toolCall of responseMessage.tool_calls) {
            try {
              const toolName = toolCall.function.name;
              const toolArgs = JSON.parse(toolCall.function.arguments);

              logger.debug({ toolName, toolArgs, iteration: currentIteration }, 'Tool call');

              if (toolName === outputTool.name) {
                needMoreProcessing = false;
                output = await outputTool.execute(toolArgs);
              } else {
                // Execute the tool
                const result = await this.context.getToolRegistry().execute(toolName, toolArgs);

                logger.debug({ toolName, result, iteration: currentIteration }, 'Tool result');

                // Add tool result to context
                this.context.addToolResultMessage(toolCall.id, toolName, JSON.stringify(result));

                // Record the tool call in memory
                const toolCallObj = ToolCallSchema.parse({
                  id: toolCall.id,
                  name: toolName,
                  arguments: toolArgs,
                });

                this.context.recordToolCall(toolCallObj, result);
              }
            } catch (error) {
              // Handle tool execution error
              const errorMessage = `Error executing tool: ${(error as Error).message}`;

              logger.error({ error, iteration: currentIteration }, errorMessage);

              // Add error as tool result
              this.context.addToolResultMessage(
                toolCall.id,
                toolCall.function.name,
                JSON.stringify({ error: errorMessage }),
              );
            }
          }
        } else {
          // No tool calls, just add content as a message and continue or finish
          iterationOutput = responseMessage.content || '';

          // Add assistant message to context
          this.context.addAssistantMessage(iterationOutput);
        }
      }

      // If we're here, we've hit the max iterations without a completion signal
      logger.warn(
        { maxIterations: this.maxIterations },
        'Reached maximum iterations without explicit task completion',
      );

      return output;
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
