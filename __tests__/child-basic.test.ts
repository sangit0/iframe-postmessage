/**
 * Tests for IframeBridge Child API - Basic tests
 */

import { createMockWindow } from './utils';

describe('IframeBridge Child API - Basic Tests', () => {
    let mockParentWindow: ReturnType<typeof createMockWindow>;

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset modules to clear the WeakSet
        jest.resetModules();
        
        mockParentWindow = createMockWindow('https://parent.example.com');
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Model Creation', () => {
        it('should create child model', async () => {
            // Import fresh module for this test
            const { IframeBridge } = await import('../src/index');
            
            // Create a fresh window for this test
            const mockChildWindow = createMockWindow('https://child1.example.com');
            global.window = mockChildWindow as unknown as Window & typeof globalThis;
            
            Object.defineProperty(global.window, 'parent', {
                value: mockParentWindow,
                writable: true,
            });

            Object.defineProperty(global.window, 'location', {
                value: { origin: 'https://child1.example.com' },
                writable: true,
            });

            const model = {
                testMethod: jest.fn(),
                testProperty: 'testValue',
            };

            const handshakePromise = new IframeBridge.Model(model);
            expect(handshakePromise).toBeInstanceOf(Promise);
        });

        it('should prevent multiple models for same window', async () => {
            // Import fresh module for this test
            const { IframeBridge } = await import('../src/index');
            
            // Create a fresh window for this test
            const mockChildWindow = createMockWindow('https://child2.example.com');
            global.window = mockChildWindow as unknown as Window & typeof globalThis;
            
            Object.defineProperty(global.window, 'parent', {
                value: mockParentWindow,
                writable: true,
            });

            Object.defineProperty(global.window, 'location', {
                value: { origin: 'https://child2.example.com' },
                writable: true,
            });

            const model = { test: 'value' };
            new IframeBridge.Model(model);

            expect(() => {
                new IframeBridge.Model(model);
            }).toThrow('BridgeModel already exists for this window');
        });
    });
});


