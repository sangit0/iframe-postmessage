/**
 * Test setup file for Jest
 * Configures jsdom environment and mocks for iframe testing
 */

// Mock window.postMessage for testing
global.postMessage = jest.fn();

// Mock MessageEvent
global.MessageEvent = class MessageEvent {
    constructor(type: string, options: { data?: unknown; origin?: string; source?: unknown }) {
        this.type = type;
        this.data = options.data;
        this.origin = options.origin || '';
        this.source = options.source || null;
    }
    type: string;
    data: unknown;
    origin: string;
    source: unknown;
} as unknown as typeof MessageEvent;


