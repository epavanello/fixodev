import { MemoryStore, MemoryEntry } from './memory';
import { ToolRegistry } from '../tools/registry';
import { CoreMessage, ToolResultUnion, ToolCallPart, ToolResultPart } from 'ai';
import { formatDataForLogging } from '@/utils/json';

/**
 * The context for an agent, including conversation history and memory
 */
export class AgentContext {
  private messages: CoreMessage[] = [];
  private memory: MemoryStore;
  private toolRegistry: ToolRegistry;
  private maxHistoryTokens: number;
  private reservedTokens: number;

  constructor(options: {
    toolRegistry: ToolRegistry;
    memory?: MemoryStore;
    maxHistoryTokens?: number;
    reservedTokens?: number;
    systemMessage?: string;
    history?: CoreMessage[];
  }) {
    this.toolRegistry = options.toolRegistry;
    this.memory = options.memory || new MemoryStore();
    this.maxHistoryTokens = options.maxHistoryTokens || 8000;
    this.reservedTokens = options.reservedTokens || 2000;

    // Add system message if provided
    if (options.systemMessage) {
      this.addMessage({
        role: 'system',
        content: options.systemMessage,
      });
    }

    // Add history if provided
    if (options.history) {
      this.messages.push(...options.history.filter(msg => msg.role !== 'system'));
    }
  }

  /**
   * Add a message to the conversation
   */
  addMessage(message: CoreMessage): CoreMessage {
    this.messages.push(message);
    return message;
  }

  /**
   * Get all messages in the conversation
   */
  getMessages(): CoreMessage[] {
    return [...this.messages];
  }

  /**
   * Get the last N messages
   */
  getLastMessages(count: number): CoreMessage[] {
    return this.messages.slice(-count);
  }

  /**
   * Add a user message
   */
  addUserMessage(content: string): CoreMessage {
    return this.addMessage({
      role: 'user',
      content,
    });
  }

  /**
   * Add an assistant message
   */
  addAssistantMessage(content: string): CoreMessage {
    return this.addMessage({
      role: 'assistant',
      content,
    });
  }

  /**
   * Add a tool request message
   */
  addToolResultMessage(toolResult: ToolResultUnion<any>) {
    this.addMessage({
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: toolResult.toolCallId,
          toolName: toolResult.toolName,
          args: toolResult.args,
        },
      ],
    });
    this.addMessage({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          result: toolResult.result,
          toolCallId: toolResult.toolCallId,
          toolName: toolResult.toolName,
        },
      ],
    });
  }

  /**
   * Add a code insight to memory
   */
  addCodeInsight(insight: {
    type: string;
    content: unknown;
    metadata?: Record<string, unknown>;
    importance?: number;
  }): string {
    return this.memory.add({
      type: `code_insight.${insight.type}`,
      content: insight.content,
      metadata: insight.metadata,
      importance: insight.importance ?? 0.5, // Use default if undefined
    });
  }

  /**
   * Get memories by type
   */
  getMemoriesByType(type: string): MemoryEntry[] {
    return this.memory.findByType(type);
  }

  /**
   * Get memory store
   */
  getMemoryStore(): MemoryStore {
    return this.memory;
  }

  /**
   * Get tool registry
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  /**
   * Generate a message-like object for prompt construction,
   * filtering to respect token limits
   */
  getPromptMessages(): CoreMessage[] {
    // filter out specific tools with custom history rules
    const toolsCallsCount = new Map<string, number>();
    this.messages = this.messages
      .reverse()
      .map(msg => {
        if (msg.role === 'tool') {
          const toolName = msg.content[0].toolName;
          const tool = this.toolRegistry.get(toolName);

          if (tool && tool.transformToolResponse) {
            const toolCallCount = toolsCallsCount.get(toolName) ?? 0;
            toolsCallsCount.set(toolName, toolCallCount + 1);
            return tool.transformToolResponse(msg, {
              toolCallsCount: toolCallCount,
            });
          }
        }
        return msg;
      })
      .reverse();

    return this.messages;
  }

  /**
   * Generates a user-friendly detailed trace of the conversation history.
   * Each item in the returned array is an object with a 'message' string.
   */
  public getFormattedHistoryTrace(): Array<{ message: string }> {
    const detailedTrace: Array<{ message: string }> = [];
    const messagesToProcess = this.getMessages(); // Use getMessages to ensure any transformations are applied

    messagesToProcess.forEach((msg: CoreMessage) => {
      switch (msg.role) {
        case 'user':
          detailedTrace.push({ message: `User: ${msg.content}` });
          break;
        case 'assistant': {
          const assistantMessage = msg;
          let assistantTextContent = '';

          if (Array.isArray(assistantMessage.content)) {
            assistantMessage.content.forEach(part => {
              if (part.type === 'text') {
                assistantTextContent += part.text;
              } else if (part.type === 'tool-call') {
                const toolCall = part as ToolCallPart;
                detailedTrace.push({
                  message: `Assistant: Calls tool \`${toolCall.toolName}\` with args: ${formatDataForLogging(toolCall.args)}`,
                });
              }
            });
            if (assistantTextContent) {
              // Add accumulated text only if it's not empty
              detailedTrace.push({ message: `Assistant: ${assistantTextContent.trim()}` });
            }
          } else if (
            typeof assistantMessage.content === 'string' &&
            assistantMessage.content.trim() !== ''
          ) {
            // Add string content only if it's not empty or just whitespace
            detailedTrace.push({ message: `Assistant: ${assistantMessage.content.trim()}` });
          }
          // If there was only a tool_call and no text, it's handled above.
          // If content was an empty string or array, nothing is added for the main assistant message, which is fine.
          break;
        }
        case 'tool': {
          if (Array.isArray(msg.content)) {
            (msg.content as ToolResultPart[]).forEach(toolResult => {
              if (toolResult.type === 'tool-result') {
                detailedTrace.push({
                  message: `Tool: \`${toolResult.toolName}\` returned: ${formatDataForLogging(toolResult.result)}`,
                });
              }
            });
          }
          break;
        }
        // System messages are generally not part of this user-facing trace
      }
    });
    return detailedTrace;
  }
}
