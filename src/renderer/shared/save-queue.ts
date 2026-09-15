/** Serialize autosaves, coalescing typing while a previous write is in flight. */
export class SaveQueue<T> {
  private pending: { value: T; revision: number } | null = null
  private running: Promise<void> | null = null
  private revision = 0

  constructor(
    private readonly save: (value: T) => Promise<T>,
    private readonly saved: (value: T) => void
  ) {}

  get dirty(): boolean {
    return this.pending !== null || this.running !== null
  }

  get version(): number {
    return this.revision
  }

  enqueue(value: T): void {
    this.pending = { value, revision: ++this.revision }
  }

  async flush(): Promise<void> {
    if (this.running) return this.running
    const run = async () => {
      while (this.pending) {
        const pending = this.pending
        this.pending = null
        try {
          const result = await this.save(pending.value)
          // An older response must never replace what the user has just typed.
          if (pending.revision === this.revision) this.saved(result)
        } catch (error) {
          // Keep the latest draft available for a deliberate retry.
          this.pending ??= pending
          throw error
        }
      }
    }
    this.running = run()
    try {
      await this.running
    } finally {
      this.running = null
    }
  }
}
