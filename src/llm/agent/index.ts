import { AgentContext } from './context';
import { ToolRegistry } from '../tools/registry';
import { MemoryStore } from './memory';
import { logger } from '../../config/logger';
import { ToolParameters, WrappedTool } from '../tools/types';
import { coderModel } from '../client';
import { askUserTool } from '../tools/interactive';
import { CoreMessage, generateText, LanguageModelV1 } from 'ai';
import { z } from 'zod';

/**
 * Options for creating an agent
 */
export interface AgentOptions {
  /**
   * The base path for file operations
   */
  basePath: string;

  /**
   * The model to use
   */
  model?: LanguageModelV1;

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
   * Maximum number of iterations for a single task
   */
  maxIterations?: number;

  /**
   * Enable conversational logging for CLI mode
   */
  conversationalLogging?: boolean;

  /**
   * History of messages to include in the prompt
   */
  history?: CoreMessage[];
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
export class RepoAgent {
  private context: AgentContext;
  private model: LanguageModelV1;
  private basePath: string;
  private steps: AgentStep[] = [];
  private maxIterations: number;
  private conversationalLogging: boolean;

  constructor(options: AgentOptions) {
    this.basePath = options.basePath;
    this.model = options.model || coderModel;
    this.maxIterations = options.maxIterations || 5;
    this.conversationalLogging = options.conversationalLogging || false;

    const toolRegistry = new ToolRegistry();
    const memory = new MemoryStore();
    let systemMessage = options.systemMessage || 'You are a helpful AI assistant.';

    const contextPreamble = `You are an AI assistant operating within the local directory: '${this.basePath}'.`;
    systemMessage = `${contextPreamble} ${systemMessage}`;

    this.context = new AgentContext({
      toolRegistry,
      memory,
      maxHistoryTokens: options.maxHistoryTokens,
      reservedTokens: options.reservedTokens,
      systemMessage,
      history: options.history,
    });
  }

  /**
   * Register a tool with the agent
   */
  registerTool<PARAMS extends z.ZodType, OUTPUT>(tool: WrappedTool<PARAMS, OUTPUT>): this {
    this.context.getToolRegistry().register(tool);
    return this;
  }

  /**
   * Run the agent with a given input, iterating until task completion or max iterations
   */
  async run<PARAMS extends ToolParameters, OUTPUT>(
    input: string,
    {
      outputTool,
      toolChoice = 'auto',
    }: { outputTool?: WrappedTool<PARAMS, OUTPUT>; toolChoice?: 'auto' | 'none' | 'required' },
  ): Promise<OUTPUT | undefined> {
    try {
      this.context.addUserMessage(input);

      let currentIteration = 0;
      let needMoreProcessing = true;
      let output: OUTPUT | undefined;

      const registryTools = this.context.getToolRegistry();
      if (outputTool) {
        registryTools.register(outputTool);
      }
      if (this.conversationalLogging) {
        registryTools.register(askUserTool);
      }

      const tools = registryTools.getUnwrappedTools();

      logger.debug({ tools }, 'Tools');
      while (needMoreProcessing && currentIteration < this.maxIterations) {
        currentIteration++;

        logger.debug(
          { iteration: currentIteration, maxIterations: this.maxIterations },
          'Starting agent iteration',
        );

        // Get the current conversation for the prompt
        const messages = this.context.getPromptMessages();

        logger.debug({ messages, iteration: currentIteration }, 'Agent request');
        if (this.conversationalLogging) {
          process.stdout.write('🤔 Thinking...\r');
        }

        // Send the request to OpenAI
        const response = await generateText<any>({
          model: this.model,
          messages,
          tools,
          toolChoice: toolChoice,
        });

        // Extract the response content and tool calls
        const responseMessage = response.text;

        logger.debug({ responseMessage, iteration: currentIteration }, 'Agent response');
        if (this.conversationalLogging) {
          // Clear the "Thinking..." message using ANSI escape codes
          process.stdout.write('\x1b[2K\r'); // Clear entire line and move cursor to start
        }

        // Set default for this iteration's outcome
        let iterationOutput = responseMessage || '';

        // Check if the LLM wants to call tools
        for (const toolResult of response.toolResults) {
          const toolName = toolResult.toolName;

          if (outputTool && toolName === outputTool.name) {
            needMoreProcessing = false;
            output = toolResult.result;
          } else {
            // // Add tool result to context
            this.context.addToolResultMessage(toolResult);
          }
        }

        // No tool calls, just add content as a message and continue or finish
        iterationOutput = responseMessage || '';
        if (this.conversationalLogging && iterationOutput) {
          console.log(`🤖 Assistant:\n${iterationOutput}`);
        }

        if (responseMessage) {
          // Add assistant message to context
          this.context.addAssistantMessage(responseMessage);
        }
      }

      if (needMoreProcessing) {
        // If we're here, we've hit the max iterations without a completion signal
        logger.warn(
          { maxIterations: this.maxIterations },
          'Reached maximum iterations without explicit task completion',
        );
      }

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
}
