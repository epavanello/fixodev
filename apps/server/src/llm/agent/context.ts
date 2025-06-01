import { MemoryStore, MemoryEntry } from './memory';
import { ToolRegistry } from '../tools/registry';
import { CoreMessage, ToolResultUnion } from 'ai';

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

  addSystemMessage(content: string): CoreMessage {
    return this.addMessage({
      role: 'system',
      content,
    });
  }

  addUserMessage(content: string): CoreMessage {
    return this.addMessage({
      role: 'user',
      content,
    });
  }

  addAssistantMessage(content: string): CoreMessage {
    return this.addMessage({
      role: 'assistant',
      content,
    });
  }

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

  getMemoriesByType(type: string): MemoryEntry[] {
    return this.memory.findByType(type);
  }

  getMemoryStore(): MemoryStore {
    return this.memory;
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

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
}
