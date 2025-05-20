import { MemoryStore, MemoryEntry } from './memory';
import { ToolRegistry } from '../tools/registry';
import { CoreMessage, ToolResultUnion } from 'ai';

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
    // This is a simplified version; in a real implementation,
    // you would need to count tokens and truncate history
    return this.messages;
  }
}
