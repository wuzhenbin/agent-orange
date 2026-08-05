export class TypedEventEmitter<T extends object> {
    private listeners = new Map<keyof T, Set<(event: any) => void>>()
    private allListeners = new Set<(event: { type: keyof T; payload: any }) => void>()

    on<K extends keyof T>(event: K, listener: (payload: T[K]) => void): () => void {
        let listeners = this.listeners.get(event)
        if (!listeners) {
            listeners = new Set()
            this.listeners.set(event, listeners)
        }

        listeners.add(listener)
        return () => {
            listeners?.delete(listener)
        }
    }

    onAny(listener: (event: { type: keyof T; payload: any }) => void): () => void {
        this.allListeners.add(listener)
        return () => {
            this.allListeners.delete(listener)
        }
    }

    emit<K extends keyof T>(event: K, payload: T[K]): void {
        const listeners = this.listeners.get(event)
        if (listeners) {
            for (const listener of listeners) {
                listener(payload)
            }
        }
        for (const listener of this.allListeners) {
            listener({
                type: event,
                payload,
            })
        }
    }
}
