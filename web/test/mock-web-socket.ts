/** Minimal WebSocket stand-in the hook drives in jsdom tests. */
export class MockWebSocket {
  static instances: MockWebSocket[] = [];

  static reset(): void {
    MockWebSocket.instances = [];
  }

  onopen: (() => void) | null = null;
  onmessage: ((event: {data: string}) => void) | null = null;
  onclose: (() => void) | null = null;
  closeCalls = 0;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  close(): void {
    this.closeCalls += 1;
    this.onclose?.();
  }

  /** Simulates the connection being established. */
  open(): void {
    this.onopen?.();
  }

  /** Simulates a server-initiated disconnect. */
  dropConnection(): void {
    this.onclose?.();
  }

  emitRaw(data: string): void {
    this.onmessage?.({data});
  }

  emit(frame: unknown): void {
    this.emitRaw(JSON.stringify(frame));
  }
}
