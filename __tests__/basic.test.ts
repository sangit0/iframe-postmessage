/**
 * Tests for IframeBridge - Basic functionality tests
 */

import IframeBridge, { IframeBridgeConfig } from '../src/index';
import { createMockWindow, createMockIframe } from './utils';

describe('IframeBridge Basic Tests', () => {
    let mockParentWindow: ReturnType<typeof createMockWindow>;
    let mockIframe: HTMLIFrameElement;
    let mockCreateElement: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        
        mockParentWindow = createMockWindow('https://parent.example.com');
        
        const { iframe } = createMockIframe();
        mockIframe = iframe;
        
        // Create a proper mock for createElement
        mockCreateElement = jest.fn((tag: string) => {
            if (tag === 'iframe') {
                return mockIframe;
            }
            return {} as HTMLElement;
        });
        
        global.window = mockParentWindow as unknown as Window & typeof globalThis;
        global.document = {
            createElement: mockCreateElement,
            body: {
                appendChild: jest.fn(),
            },
        } as unknown as Document;

        Object.defineProperty(global.window, 'location', {
            value: { origin: 'https://parent.example.com' },
            writable: true,
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Constructor', () => {
        it('should create iframe and initiate handshake', () => {
            const config: IframeBridgeConfig = {
                url: 'https://child.example.com',
                model: { testProp: 'testValue' },
            };

            const bridge = IframeBridge(config);
            
            expect(mockCreateElement).toHaveBeenCalledWith('iframe');
            expect(mockIframe).toBeDefined();
            expect(bridge).toBeInstanceOf(Promise);
        });

        it('should handle iframe with custom attributes', () => {
            const config: IframeBridgeConfig = {
                url: 'https://child.example.com',
                name: 'test-iframe',
                title: 'Test Iframe',
                ariaLabel: 'Test Label',
                classListArray: ['custom-class'],
            };

            IframeBridge(config);

            // Verify that iframe properties were set
            expect(mockIframe.name).toBe('test-iframe');
            expect(mockIframe.title).toBe('Test Iframe');
            expect(mockIframe.setAttribute).toHaveBeenCalledWith('aria-label', 'Test Label');
            expect(mockIframe.classList.add).toHaveBeenCalledWith('custom-class');
        });
    });
});


