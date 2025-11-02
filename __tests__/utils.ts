/**
 * Test utilities for iframe bridge tests
 */

export interface MockWindow {
    postMessage: jest.Mock;
    addEventListener: jest.Mock;
    removeEventListener: jest.Mock;
    location: { origin: string };
    parent: MockWindow | null;
    contentWindow?: MockWindow;
    contentDocument?: { parentWindow?: MockWindow };
    isConnected?: boolean;
}

export function createMockWindow(origin: string = 'https://example.com'): MockWindow {
    const listeners: Map<string, Set<(event: MessageEvent) => void>> = new Map();

    return {
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
        location: { origin },
        parent: null,
        contentWindow: undefined,
        contentDocument: undefined,
        isConnected: true,
    };
}

export function createMockIframe(): {
    iframe: HTMLIFrameElement;
    contentWindow: MockWindow;
} {
    const contentWindow = createMockWindow('https://child.example.com');
    
    // Create a mock iframe with writable properties
    const iframeProps: any = {
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
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
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

    return { iframe, contentWindow };
}

export function waitFor(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

