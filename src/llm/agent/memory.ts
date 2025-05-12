import * as z from 'zod';

/**
 * Definition of a memory entry
 */
export const MemoryEntrySchema = z.object({
  /**
   * Unique identifier for the memory
   */
  id: z.string(),

  /**
   * Type/category of memory
   */
  type: z.string(),

  /**
   * The actual content of the memory
   */
  content: z.unknown(),

  /**
   * Metadata for indexing and retrieval
   */
  metadata: z.record(z.string(), z.unknown()).optional(),

  /**
   * When the memory was created
   */
  createdAt: z.number().default(() => Date.now()),

  /**
   * Importance score for prioritization (0-1)
   */
  importance: z.number().min(0).max(1).default(0.5),
});

export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

/**
 * In-memory store for agent memory
 */
export class MemoryStore {
  private memories: Map<string, MemoryEntry> = new Map();
  private typeIndices: Map<string, Set<string>> = new Map();
  private metadataIndices: Map<string, Map<string | number | boolean, Set<string>>> = new Map();

  /**
   * Add a memory to the store
   */
  add(memory: Omit<MemoryEntry, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): string {
    const id = memory.id || this.generateId();
    const entry = MemoryEntrySchema.parse({
      ...memory,
      id,
      createdAt: memory.createdAt || Date.now(),
    });

    // Store the memory
    this.memories.set(id, entry);

    // Update type index
    if (!this.typeIndices.has(entry.type)) {
      this.typeIndices.set(entry.type, new Set());
    }
    this.typeIndices.get(entry.type)!.add(id);

    // Update metadata indices
    if (entry.metadata) {
      Object.entries(entry.metadata).forEach(([key, value]) => {
        if (value === undefined || value === null) return;

        // Skip non-indexable values
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
          return;
        }

        if (!this.metadataIndices.has(key)) {
          this.metadataIndices.set(key, new Map());
        }

        const valueIndex = this.metadataIndices.get(key)!;
        if (!valueIndex.has(value)) {
          valueIndex.set(value, new Set());
        }

        valueIndex.get(value)!.add(id);
      });
    }

    return id;
  }

  /**
   * Get a memory by ID
   */
  get(id: string): MemoryEntry | undefined {
    return this.memories.get(id);
  }

  /**
   * Remove a memory by ID
   */
  remove(id: string): boolean {
    const memory = this.memories.get(id);
    if (!memory) return false;

    // Remove from main storage
    this.memories.delete(id);

    // Remove from type index
    const typeSet = this.typeIndices.get(memory.type);
    if (typeSet) {
      typeSet.delete(id);
      if (typeSet.size === 0) {
        this.typeIndices.delete(memory.type);
      }
    }

    // Remove from metadata indices
    if (memory.metadata) {
      Object.entries(memory.metadata).forEach(([key, value]) => {
        if (value === undefined || value === null) return;

        // Skip non-indexable values
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
          return;
        }

        const valueIndex = this.metadataIndices.get(key);
        if (valueIndex) {
          const ids = valueIndex.get(value);
          if (ids) {
            ids.delete(id);
            if (ids.size === 0) {
              valueIndex.delete(value);
            }
          }

          if (valueIndex.size === 0) {
            this.metadataIndices.delete(key);
          }
        }
      });
    }

    return true;
  }

  /**
   * Update a memory entry
   */
  update(id: string, updates: Partial<Omit<MemoryEntry, 'id'>>): boolean {
    const memory = this.memories.get(id);
    if (!memory) return false;

    // Remove old indices
    this.remove(id);

    // Create updated memory
    const updatedMemory: MemoryEntry = {
      ...memory,
      ...updates,
      id,
    };

    // Add with updated values
    this.add(updatedMemory);

    return true;
  }

  /**
   * Find memories by type
   */
  findByType(type: string): MemoryEntry[] {
    const ids = this.typeIndices.get(type);
    if (!ids) return [];

    return Array.from(ids)
      .map(id => this.memories.get(id)!)
      .filter(Boolean);
  }

  /**
   * Find memories by metadata
   */
  findByMetadata(key: string, value: string | number | boolean): MemoryEntry[] {
    const valueIndex = this.metadataIndices.get(key);
    if (!valueIndex) return [];

    const ids = valueIndex.get(value);
    if (!ids) return [];

    return Array.from(ids)
      .map(id => this.memories.get(id)!)
      .filter(Boolean);
  }

  /**
   * Get all memories sorted by importance
   */
  getAllByImportance(): MemoryEntry[] {
    return Array.from(this.memories.values()).sort((a, b) => b.importance - a.importance);
  }

  /**
   * Get count of memories
   */
  count(): number {
    return this.memories.size;
  }

  /**
   * Clear all memories
   */
  clear(): void {
    this.memories.clear();
    this.typeIndices.clear();
    this.metadataIndices.clear();
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
