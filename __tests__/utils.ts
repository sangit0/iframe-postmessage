/**
 * Test utilities for iframe bridge tests
 */

export interface MockWindow {
    postMessage: jest.Mock;
    addEventListener: jest.Mock;
    removeEventListener: jest.Mock;
    dispatchEvent: jest.Mock;
    emitMessage: (data: unknown, origin?: string, source?: MockWindow) => void;
    location: { origin: string };
    parent: MockWindow | null;
    contentWindow?: MockWindow;
    contentDocument?: { parentWindow?: MockWindow };
    isConnected?: boolean;
}

export function createMockWindow(origin: string = 'https://example.com'): MockWindow {
    const listeners: Map<string, Set<(event: MessageEvent) => void>> = new Map();

    const mockWindow: MockWindow = {
        postMessage: jest.fn(),
        addEventListener: jest.fn((event: string, handler: (event: MessageEvent) => void) => {
            if (!listeners.has(event)) {
                listeners.set(event, new Set());
            }
            listeners.get(event)!.add(handler);
        }),
        removeEventListener: jest.fn((event: string, handler: (event: MessageEvent) => void) => {
            listeners.get(event)?.delete(handler);
        }),
        dispatchEvent: jest.fn((event: MessageEvent) => {
            listeners.get(event.type)?.forEach((handler) => handler(event));
        }),
        emitMessage: (data: unknown, customOrigin?: string, source?: MockWindow) => {
            const messageEvent = new MessageEvent('message', {
                data,
                origin: customOrigin ?? origin,
                source: (source ?? mockWindow) as unknown as MessageEventSource,
            });
            const typedEvent = messageEvent as unknown as MessageEvent;
            mockWindow.dispatchEvent(typedEvent);
        },
        location: { origin },
        parent: null,
        contentWindow: undefined,
        contentDocument: undefined,
        isConnected: true,
    };

    return mockWindow;
}

export function createMockIframe(): {
    iframe: HTMLIFrameElement;
    contentWindow: MockWindow;
    triggerLoad: () => void;
} {
    const contentWindow = createMockWindow('https://child.example.com');

    const iframeListeners: Map<string, Set<(event: Event) => void>> = new Map();

    // Create a mock iframe with writable properties
    const iframeProps: Record<string, unknown> = {
        contentWindow: contentWindow as unknown as Window,
        contentDocument: { parentWindow: contentWindow as unknown as Window },
        name: '',
        id: '',
        src: '',
        title: '',
        classList: {
            add: jest.fn(),
        },
        setAttribute: jest.fn(),
        parentNode: {
            removeChild: jest.fn(),
            appendChild: jest.fn(),
        },
        isConnected: true,
        addEventListener: jest.fn((event: string, handler: (event: Event) => void) => {
            if (!iframeListeners.has(event)) {
                iframeListeners.set(event, new Set());
            }
            iframeListeners.get(event)!.add(handler);
        }),
        removeEventListener: jest.fn((event: string, handler: (event: Event) => void) => {
            iframeListeners.get(event)?.delete(handler);
        }),
        dispatchEvent: jest.fn((event: Event) => {
            iframeListeners.get(event.type)?.forEach((handler) => handler(event));
        }),
    };

    // Make properties writable
    Object.defineProperty(iframeProps, 'name', {
        value: '',
        writable: true,
        enumerable: true,
        configurable: true,
    });
    
    Object.defineProperty(iframeProps, 'title', {
        value: '',
        writable: true,
        enumerable: true,
        configurable: true,
    });
    
    Object.defineProperty(iframeProps, 'src', {
        value: '',
        writable: true,
        enumerable: true,
        configurable: true,
    });

    const iframe = iframeProps as unknown as HTMLIFrameElement;

    const triggerLoad = () => {
        const loadEvent = new Event('load');
        iframeListeners.get('load')?.forEach((handler) => handler.call(iframe, loadEvent));
    };

    return { iframe, contentWindow, triggerLoad };
}

export function waitFor(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a jsdom-compatible MessageEvent
 * jsdom requires events to properly extend Event, so we create it manually
 */
export function createMessageEvent(
    data: unknown,
    origin: string,
    source: Window | MessageEventSource | null = null,
): MessageEvent {
    // Create a proper Event first
    const event = new Event('message', { bubbles: true, cancelable: false });
    
    // Add MessageEvent properties
    Object.defineProperty(event, 'data', { value: data, enumerable: true });
    Object.defineProperty(event, 'origin', { value: origin, enumerable: true });
    Object.defineProperty(event, 'source', { value: source, enumerable: true });
    
    return event as unknown as MessageEvent;
}

