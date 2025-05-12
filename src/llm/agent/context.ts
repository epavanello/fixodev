import * as z from 'zod';
import { MemoryStore, MemoryEntry } from './memory';
import { ToolRegistry } from '../tools/registry';
import { ChatCompletionRole } from 'openai/resources/chat/completions/completions';

/**
 * Message roles in a conversation
 */
export enum MessageRole {
  SYSTEM = 'system',
  USER = 'user',
  ASSISTANT = 'assistant',
  FUNCTION = 'function',
  TOOL = 'tool', // For local use, will be mapped to 'function' when sending to OpenAI
}

/**
 * Definition of a message in the conversation
 */
export const MessageSchema = z.object({
  /**
   * Unique identifier for the message
   */
  id: z.string(),

  /**
   * Role of the message sender
   */
  role: z.nativeEnum(MessageRole),

  /**
   * Content of the message
   */
  content: z.string(),

  /**
   * Timestamp when the message was created
   */
  createdAt: z.number().default(() => Date.now()),

  /**
   * Name of the tool if this is a tool message
   */
  toolName: z.string().optional(),

  /**
   * Tool call ID if this is a response to a tool call
   */
  toolCallId: z.string().optional(),
});

export type Message = z.infer<typeof MessageSchema>;

/**
 * Tool call definition
 */
export const ToolCallSchema = z.object({
  /**
   * Unique identifier for the tool call
   */
  id: z.string(),

  /**
   * Name of the tool to call
   */
  name: z.string(),

  /**
   * Arguments to pass to the tool
   */
  arguments: z.record(z.string(), z.unknown()),
});

export type ToolCall = z.infer<typeof ToolCallSchema>;

/**
 * The context for an agent, including conversation history and memory
 */
export class AgentContext {
  private messages: Message[] = [];
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
  }) {
    this.toolRegistry = options.toolRegistry;
    this.memory = options.memory || new MemoryStore();
    this.maxHistoryTokens = options.maxHistoryTokens || 8000;
    this.reservedTokens = options.reservedTokens || 2000;

    // Add system message if provided
    if (options.systemMessage) {
      this.addMessage({
        role: MessageRole.SYSTEM,
        content: options.systemMessage,
      });
    }
  }

  /**
   * Add a message to the conversation
   */
  addMessage(
    message: Omit<Message, 'id' | 'createdAt'> & { id?: string; createdAt?: number },
  ): Message {
    const id = message.id || this.generateId('msg');
    const newMessage = MessageSchema.parse({
      ...message,
      id,
      createdAt: message.createdAt || Date.now(),
    });

    this.messages.push(newMessage);
    return newMessage;
  }

  /**
   * Get all messages in the conversation
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Get the last N messages
   */
  getLastMessages(count: number): Message[] {
    return this.messages.slice(-count);
  }

  /**
   * Add a user message
   */
  addUserMessage(content: string): Message {
    return this.addMessage({
      role: MessageRole.USER,
      content,
    });
  }

  /**
   * Add an assistant message
   */
  addAssistantMessage(content: string): Message {
    return this.addMessage({
      role: MessageRole.ASSISTANT,
      content,
    });
  }

  /**
   * Add a tool result message
   */
  addToolResultMessage(toolCallId: string, toolName: string, content: string): Message {
    return this.addMessage({
      role: MessageRole.FUNCTION,
      toolName,
      toolCallId,
      content: typeof content === 'string' ? content : JSON.stringify(content),
    });
  }

  /**
   * Record a tool call in memory
   */
  recordToolCall(toolCall: ToolCall, result: any): string {
    return this.memory.add({
      type: 'tool_call',
      content: {
        toolCall,
        result,
      },
      metadata: {
        toolName: toolCall.name,
        timestamp: Date.now(),
      },
      importance: 0.5, // Default importance
    });
  }

  /**
   * Add a code insight to memory
   */
  addCodeInsight(insight: {
    type: string;
    content: any;
    metadata?: Record<string, any>;
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
  getPromptMessages(): {
    role: ChatCompletionRole;
    content: string;
    name?: string;
    tool_call_id?: string;
  }[] {
    // This is a simplified version; in a real implementation,
    // you would need to count tokens and truncate history
    return this.messages.map(msg => {
      // Map internal MessageRole to OpenAI's ChatCompletionRole
      const role =
        msg.role === MessageRole.TOOL
          ? ('function' as ChatCompletionRole)
          : (msg.role as ChatCompletionRole);

      return {
        role,
        content: msg.content,
        ...(msg.toolName ? { name: msg.toolName } : {}),
        ...(msg.toolCallId ? { tool_call_id: msg.toolCallId } : {}),
      };
    });
  }

  /**
   * Generate a unique ID
   */
  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
