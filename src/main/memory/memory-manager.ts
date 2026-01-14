import type Database from 'better-sqlite3';
import type { Message, MemoryEntry, ContentBlock } from '../../renderer/types';
import { v4 as uuidv4 } from 'uuid';

interface ContextStrategy {
  type: 'full' | 'compressed' | 'rolling';
  messages: Message[];
  summary?: string;
}

/**
 * MemoryManager - Handles message history and context management
 * 
 * Two main functions:
 * 1. Message storage and retrieval
 * 2. Intelligent context management for Claude API calls
 */
export class MemoryManager {
  private db: Database.Database;
  private maxContextTokens: number;

  constructor(db: Database.Database, maxContextTokens = 180000) {
    this.db = db;
    this.maxContextTokens = maxContextTokens;
  }

  /**
   * Save a message to the database
   */
  async saveMessage(sessionId: string, message: Message): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO messages (id, session_id, role, content, timestamp, token_usage)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      message.id,
      sessionId,
      message.role,
      JSON.stringify(message.content),
      message.timestamp,
      message.tokenUsage ? JSON.stringify(message.tokenUsage) : null
    );
  }

  /**
   * Get message history for a session
   */
  async getMessageHistory(sessionId: string, limit?: number): Promise<Message[]> {
    let query = 'SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC';
    if (limit) {
      query += ` LIMIT ${limit}`;
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(sessionId) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      sessionId: row.session_id as string,
      role: row.role as Message['role'],
      content: JSON.parse(row.content as string) as ContentBlock[],
      timestamp: row.timestamp as number,
      tokenUsage: row.token_usage ? JSON.parse(row.token_usage as string) : undefined,
    }));
  }

  /**
   * Search messages using full-text search
   */
  async searchMessages(sessionId: string, query: string): Promise<Message[]> {
    // First get all messages for the session
    const messages = await this.getMessageHistory(sessionId);

    // Simple text search (FTS5 would be more efficient for large datasets)
    const queryLower = query.toLowerCase();
    
    return messages.filter((message) => {
      return message.content.some((block) => {
        if (block.type === 'text') {
          return block.text.toLowerCase().includes(queryLower);
        }
        return false;
      });
    });
  }

  /**
   * Manage context for a session - determine best strategy based on token usage
   */
  async manageContext(sessionId: string): Promise<ContextStrategy> {
    const messages = await this.getMessageHistory(sessionId);
    const tokenCount = this.estimateTokens(messages);

    // If within limits, return full context
    if (tokenCount < this.maxContextTokens * 0.9) {
      return {
        type: 'full',
        messages,
      };
    }

    // If approaching limit, compress
    return this.compressContext(messages);
  }

  /**
   * Compress context by summarizing older messages
   */
  async compressContext(messages: Message[]): Promise<ContextStrategy> {
    const recentCount = 20; // Keep last 20 messages
    
    if (messages.length <= recentCount) {
      return {
        type: 'full',
        messages,
      };
    }

    const recent = messages.slice(-recentCount);
    const older = messages.slice(0, -recentCount);

    // Generate summary of older messages
    const summary = this.generateSummary(older);

    return {
      type: 'compressed',
      messages: recent,
      summary,
    };
  }

  /**
   * Get relevant context based on current prompt (for retrieval)
   */
  async getRelevantContext(
    sessionId: string,
    currentPrompt: string
  ): Promise<Message[]> {
    const messages = await this.getMessageHistory(sessionId);
    
    // Simple relevance scoring based on keyword overlap
    const promptWords = new Set(
      currentPrompt.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    );

    const scoredMessages = messages.map((message) => {
      let score = 0;
      
      for (const block of message.content) {
        if (block.type === 'text') {
          const messageWords = block.text.toLowerCase().split(/\s+/);
          for (const word of messageWords) {
            if (promptWords.has(word)) {
              score++;
            }
          }
        }
      }

      return { message, score };
    });

    // Return messages sorted by relevance, limited to top 10
    return scoredMessages
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(({ message }) => message);
  }

  /**
   * Estimate token count for messages (rough approximation)
   */
  private estimateTokens(messages: Message[]): number {
    let charCount = 0;

    for (const message of messages) {
      for (const block of message.content) {
        if (block.type === 'text') {
          charCount += block.text.length;
        } else if (block.type === 'tool_use') {
          charCount += JSON.stringify(block.input).length;
        } else if (block.type === 'tool_result') {
          charCount += block.content.length;
        }
      }
    }

    // Rough estimate: 1 token ≈ 4 characters for English
    return Math.ceil(charCount / 4);
  }

  /**
   * Generate a summary of messages (placeholder - would call Claude API)
   */
  private generateSummary(messages: Message[]): string {
    // In production, this would call Claude API to generate a proper summary
    const userMessages = messages.filter(m => m.role === 'user');
    const topicSet = new Set<string>();

    for (const message of userMessages) {
      for (const block of message.content) {
        if (block.type === 'text') {
          // Extract key topics (simple keyword extraction)
          const words = block.text.split(/\s+/).filter(w => w.length > 5);
          words.slice(0, 3).forEach(w => topicSet.add(w.toLowerCase()));
        }
      }
    }

    const topics = Array.from(topicSet).slice(0, 5).join(', ');
    
    return `Previous conversation covered topics including: ${topics}. ` +
      `The conversation had ${messages.length} messages.`;
  }

  /**
   * Save a memory entry (for explicit memory storage)
   */
  async saveMemoryEntry(
    sessionId: string,
    content: string,
    metadata: { source: string; tags: string[] }
  ): Promise<MemoryEntry> {
    const entry: MemoryEntry = {
      id: uuidv4(),
      sessionId,
      content,
      metadata: {
        ...metadata,
        timestamp: Date.now(),
      },
      createdAt: Date.now(),
    };

    const stmt = this.db.prepare(`
      INSERT INTO memory_entries (id, session_id, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.id,
      entry.sessionId,
      entry.content,
      JSON.stringify(entry.metadata),
      entry.createdAt
    );

    // Update FTS index
    const ftsStmt = this.db.prepare(`
      INSERT INTO memory_fts (rowid, content)
      SELECT rowid, content FROM memory_entries WHERE id = ?
    `);
    ftsStmt.run(entry.id);

    return entry;
  }

  /**
   * Search memory entries using FTS
   */
  async searchMemory(sessionId: string, query: string): Promise<MemoryEntry[]> {
    const stmt = this.db.prepare(`
      SELECT me.* FROM memory_entries me
      JOIN memory_fts fts ON me.rowid = fts.rowid
      WHERE me.session_id = ? AND memory_fts MATCH ?
      ORDER BY rank
      LIMIT 20
    `);

    const rows = stmt.all(sessionId, query) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      sessionId: row.session_id as string,
      content: row.content as string,
      metadata: JSON.parse(row.metadata as string),
      createdAt: row.created_at as number,
    }));
  }

  /**
   * Delete messages for a session
   */
  async deleteSessionMessages(sessionId: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM messages WHERE session_id = ?');
    stmt.run(sessionId);
  }

  /**
   * Delete memory entries for a session
   */
  async deleteSessionMemory(sessionId: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM memory_entries WHERE session_id = ?');
    stmt.run(sessionId);
  }
}

