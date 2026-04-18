export class MemoryIngestionQueue {
  private readonly chains = new Map<string, Promise<void>>();

  enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const previous = this.chains.get(key) || Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.chains.set(
      key,
      next.finally(() => {
        if (this.chains.get(key) === next) {
          this.chains.delete(key);
        }
      })
    );
    return next;
  }
}
