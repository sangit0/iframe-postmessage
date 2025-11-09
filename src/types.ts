// ============================================================================
// Types
// ============================================================================

export type BridgeMessageType =
    | 'handshake'
    | 'handshake-reply'
    | 'call'
    | 'emit'
    | 'reply'
    | 'request';

export interface BridgeMessage {
    bridge: BridgeMessageType;
    type: string;
    property?: string;
    data?: unknown;
    value?: {
        name?: string;
        data?: unknown;
    };
    uid?: number;
    model?: Record<string, unknown>;
}

export interface QueuedMessage {
    message: BridgeMessage;
    origin: string;
    source: MessageEventSource;
    uid?: number;
}

export interface IframePostmessageConfig {
    container?: HTMLElement;
    url: string;
    classListArray?: string[];
    title?: string;
    ariaLabel?: string;
    name?: string;
    model?: Record<string, unknown>;
}

export interface BridgeInstanceInfo {
    childOrigin: string;
    parentOrigin?: string;
    frame: HTMLIFrameElement | null;
}

export interface ParentAPI {
    get(property: string): Promise<unknown>;
    call(property: string, data?: unknown): void;
    on(eventName: string, callback: (data: unknown) => void): void;
    destroy(): void;
}

export interface ChildAPI {
    emit(name: string, data: unknown): void;
}

