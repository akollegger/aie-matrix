import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ConversationStore, MessageRecord } from "@aie-matrix/shared-types";

export type { ConversationStore, MessageRecord };

export class JsonlStore implements ConversationStore {
  constructor(private readonly dataDir: string) {}

  private filePath(thread_id: string): string {
    return `${this.dataDir}/${thread_id}.jsonl`;
  }

  async append(record: MessageRecord): Promise<void> {
    const path = this.filePath(record.thread_id);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(record) + "\n", "utf8");
  }

  async get(thread_id: string, message_id: string): Promise<MessageRecord | null> {
    const records = await this.list(thread_id);
    return records.find((r) => r.message_id === message_id) ?? null;
  }

  async list(
    thread_id: string,
    options?: { after?: string; limit?: number },
  ): Promise<MessageRecord[]> {
    const path = this.filePath(thread_id);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }

    const lines = raw.split("\n").filter((l) => l.trim() !== "");
    let records: MessageRecord[] = lines.map((l) => JSON.parse(l) as MessageRecord);

    const { after, limit = 50 } = options ?? {};
    if (after !== undefined && after !== "") {
      records = records.filter((r) => r.message_id > after);
    }

    return records.slice(0, limit);
  }
}

export class MemoryStore implements ConversationStore {
  private readonly records = new Map<string, MessageRecord[]>();

  async append(record: MessageRecord): Promise<void> {
    const thread = this.records.get(record.thread_id) ?? [];
    thread.push(record);
    this.records.set(record.thread_id, thread);
  }

  async get(thread_id: string, message_id: string): Promise<MessageRecord | null> {
    const thread = this.records.get(thread_id) ?? [];
    return thread.find((r) => r.message_id === message_id) ?? null;
  }

  async list(
    thread_id: string,
    options?: { after?: string; limit?: number },
  ): Promise<MessageRecord[]> {
    let thread = this.records.get(thread_id) ?? [];
    const { after, limit = 50 } = options ?? {};
    if (after !== undefined && after !== "") {
      thread = thread.filter((r) => r.message_id > after);
    }
    return thread.slice(0, limit);
  }
}
