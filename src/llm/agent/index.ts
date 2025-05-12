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
import { createTaskCompletionTool } from '../tools/registry';
import { TaskCompletionStatus } from '../tools/types';

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
  private verbose: boolean;
  private basePath: string;
  private steps: AgentStep[] = [];
  private maxIterations: number;

  constructor(options: AgentOptions) {
    this.basePath = options.basePath;
    this.model = options.model || 'gpt-4o';
    this.verbose = options.verbose || false;
    this.maxIterations = options.maxIterations || 5;

    // Initialize OpenAI client
    this.openai = new OpenAI({
      apiKey: options.apiKey || envConfig.OPENAI_API_KEY,
    });

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
  registerTool(tool: any): this {
    this.context.getToolRegistry().register(tool);
    return this;
  }

  /**
   * Run the agent with a given input, iterating until task completion or max iterations
   */
  async run(input: string): Promise<string> {
    try {
      // Add user message to context
      this.context.addUserMessage(input);

      let currentIteration = 0;
      let isTaskComplete = false;
      let finalOutput = '';

      // Store the input for the first step
      const step: AgentStep = {
        input,
        output: '',
      };

      while (!isTaskComplete && currentIteration < this.maxIterations) {
        currentIteration++;

        if (this.verbose) {
          logger.debug(
            { iteration: currentIteration, maxIterations: this.maxIterations },
            'Starting agent iteration',
          );
        }

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
          logger.debug({ messages, tools, iteration: currentIteration }, 'Agent request');
        }

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

        if (this.verbose) {
          logger.debug({ responseMessage, iteration: currentIteration }, 'Agent response');
        }

        // Set default for this iteration's outcome
        let iterationOutput = responseMessage.content || '';

        // Check if the LLM wants to call tools
        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
          for (const toolCall of responseMessage.tool_calls) {
            try {
              const toolName = toolCall.function.name;
              const toolArgs = JSON.parse(toolCall.function.arguments);

              // Log tool call if verbose
              if (this.verbose) {
                logger.debug({ toolName, toolArgs, iteration: currentIteration }, 'Tool call');
              }

              // Execute the tool
              const result = await this.context.getToolRegistry().execute(toolName, toolArgs);

              // Log tool result if verbose
              if (this.verbose) {
                logger.debug({ toolName, result, iteration: currentIteration }, 'Tool result');
              }

              // Check if this is the task completion tool
              if (toolName === 'taskCompletion') {
                const completionResult = result as { status: TaskCompletionStatus };
                if (completionResult.status === TaskCompletionStatus.COMPLETED) {
                  isTaskComplete = true;
                  logger.info(
                    { reason: toolArgs.reason, iteration: currentIteration },
                    'Task completed',
                  );
                } else {
                  logger.info(
                    { reason: toolArgs.reason, iteration: currentIteration },
                    'Task requires more processing',
                  );
                }
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

          // If this iteration should terminate the task or
          // if we've reached max iterations, get the final response
          if (isTaskComplete || currentIteration >= this.maxIterations) {
            finalOutput = await this.getFinalResponse();
            step.output = finalOutput;
            this.steps.push(step);
            return finalOutput;
          }
        } else {
          // No tool calls, just add content as a message and continue or finish
          iterationOutput = responseMessage.content || '';

          // If we didn't get a completion signal via a tool call, we'll interpret
          // a direct response without tool calls on the final iteration as completion
          if (currentIteration >= this.maxIterations) {
            isTaskComplete = true;
            finalOutput = iterationOutput;

            // Add assistant message to context
            this.context.addAssistantMessage(finalOutput);

            // Add to step record
            step.output = finalOutput;
            this.steps.push(step);

            return finalOutput;
          }

          // Otherwise, add the message and continue to the next iteration
          this.context.addAssistantMessage(iterationOutput);
        }
      }

      // If we're here, we've hit the max iterations without a completion signal
      logger.warn(
        { maxIterations: this.maxIterations },
        'Reached maximum iterations without explicit task completion',
      );

      // Return the final content from the last iteration
      return finalOutput;
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
