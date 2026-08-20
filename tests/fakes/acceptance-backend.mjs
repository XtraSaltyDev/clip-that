export class FakeAcceptanceBackend {
  sources = new Map([
    ['display:1', { kind: 'display', available: true }],
    ['window:1', { kind: 'window', available: true }],
    ['region:1', { kind: 'region', available: true }]
  ])
  library = []
  recordingState = 'idle'
  rawRecording = []

  capture(sourceId) {
    const source = this.sources.get(sourceId)
    if (!source?.available) throw new Error('The selected source is no longer available.')
    const item = {
      id: `capture-${this.library.length + 1}`,
      kind: 'image',
      sourceId,
      edited: false
    }
    this.library.push(item)
    return item
  }

  edit(id) {
    const item = this.library.find((candidate) => candidate.id === id)
    if (!item) throw new Error('Library item not found')
    item.edited = true
    return item
  }

  startRecording(sourceId) {
    if (this.recordingState !== 'idle') throw new Error('Recording already active')
    if (!this.sources.get(sourceId)?.available)
      throw new Error('The selected source is no longer available.')
    this.recordingState = 'recording'
    this.rawRecording = [new Uint8Array([1, 2, 3])]
  }

  pause() {
    if (this.recordingState === 'recording') this.recordingState = 'paused'
  }
  resume() {
    if (this.recordingState === 'paused') this.recordingState = 'recording'
  }
  closeSource(sourceId) {
    const source = this.sources.get(sourceId)
    if (source) source.available = false
    if (this.recordingState === 'recording' || this.recordingState === 'paused')
      this.recordingState = 'encoding'
  }

  exportRecording(format, succeeds = true) {
    if (this.rawRecording.length === 0) throw new Error('No recoverable recording')
    if (!succeeds) throw new Error('Export failed; raw recording was preserved')
    const item = { id: `recording-${this.library.length + 1}`, kind: 'video', format }
    this.library.push(item)
    this.rawRecording = []
    this.recordingState = 'idle'
    return item
  }
}
