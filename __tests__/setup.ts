/**
 * Test setup file for Jest
 * Configures jsdom environment and mocks for iframe testing
 */

// Mock window.postMessage for testing
global.postMessage = jest.fn();

// Mock MessageEvent that extends Event for jsdom compatibility
global.MessageEvent = class MessageEvent extends Event {
    data: unknown;
    origin: string;
    source: unknown;

    constructor(type: string, options: { data?: unknown; origin?: string; source?: unknown }) {
        super(type, { bubbles: true, cancelable: false });
        this.data = options.data;
        this.origin = options.origin || '';
        this.source = options.source || null;
    }
} as unknown as typeof MessageEvent;


