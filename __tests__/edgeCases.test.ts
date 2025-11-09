// Mock constants with faster values for testing
jest.mock('@/constants', () => {
    const original = jest.requireActual('@/constants');
    return {
        ...original,
        MAX_HANDSHAKE_ATTEMPTS: 2,
        HANDSHAKE_INTERVAL_MS: 1,
        HANDSHAKE_TIMEOUT_MS: 2,
    };
});

import { MESSAGE_TYPE, HANDSHAKE_TIMEOUT_MS } from '@/constants';
import { BridgeParent, ParentAPIImplementation } from '@/parent';
import { BridgeModel, ChildAPIImplementation, clearActiveBridgeModels } from '@/child';
import { activeInstances } from '@/registry';
import { sanitizeMessage } from '@/utils';
import { createMockIframe, createMessageEvent, createMockWindow } from './utils';

describe('Error cases and edge cases', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        activeInstances.clear();
        clearActiveBridgeModels();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
        activeInstances.clear();
        clearActiveBridgeModels();
    });

    describe('BridgeParent handshake failures', () => {
        it('rejects on handshake timeout', async () => {
            const { iframe, triggerLoad } = createMockIframe();

            const originalCreateElement = document.createElement.bind(document);
            jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
                if (tagName.toLowerCase() === 'iframe') {
                    return iframe;
                }
                return originalCreateElement(tagName);
            });

            const container = iframe.parentNode as unknown as HTMLElement;
            const handshakePromise = new BridgeParent({
                url: 'https://child.example.com/app',
                container,
            }) as unknown as Promise<ParentAPIImplementation>;

            triggerLoad();

            // Advance all timers to trigger timeout
            jest.runAllTimers();

            await expect(handshakePromise).rejects.toThrow('Handshake timeout after max attempts');
        });

        it('rejects on invalid handshake reply', async () => {
            const { iframe, contentWindow, triggerLoad } = createMockIframe();
            const childWindow = contentWindow as unknown as Window;

            const originalCreateElement = document.createElement.bind(document);
            jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
                if (tagName.toLowerCase() === 'iframe') {
                    return iframe;
                }
                return originalCreateElement(tagName);
            });

            const container = iframe.parentNode as unknown as HTMLElement;
            const handshakePromise = new BridgeParent({
                url: 'https://child.example.com/app',
                container,
            }) as unknown as Promise<ParentAPIImplementation>;

            triggerLoad();

            // Send invalid reply (wrong bridge type)
            const invalidReply = createMessageEvent(
                {
                    bridge: 'call', // Wrong type, should be 'handshake-reply'
                    type: MESSAGE_TYPE,
                },
                'https://child.example.com',
                childWindow,
            );
            window.dispatchEvent(invalidReply);

            await expect(handshakePromise).rejects.toThrow('Failed handshake');
        });

        it('rejects messages from wrong source', async () => {
            const { iframe, triggerLoad } = createMockIframe();
            const wrongWindow = createMockWindow('https://wrong.example.com');

            const originalCreateElement = document.createElement.bind(document);
            jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
                if (tagName.toLowerCase() === 'iframe') {
                    return iframe;
                }
                return originalCreateElement(tagName);
            });

            const container = iframe.parentNode as unknown as HTMLElement;
            const handshakePromise = new BridgeParent({
                url: 'https://child.example.com/app',
                container,
            }) as unknown as Promise<ParentAPIImplementation>;

            triggerLoad();

            // Send reply from wrong source
            const wrongSourceReply = createMessageEvent(
                {
                    bridge: 'handshake-reply',
                    type: MESSAGE_TYPE,
                },
                'https://child.example.com',
                wrongWindow as unknown as Window,
            );
            window.dispatchEvent(wrongSourceReply);

            // Should not resolve - advance timers to trigger timeout
            jest.runAllTimers();

            await expect(handshakePromise).rejects.toThrow('Handshake timeout after max attempts');
        });
    });

    describe('BridgeModel error cases', () => {
        it('throws error when creating multiple BridgeModel instances', () => {
            const model = { value: 'test' };
            new BridgeModel(model);

            expect(() => {
                new BridgeModel(model);
            }).toThrow('BridgeModel already exists for this window');
        });

        it('handles handshake timeout', async () => {
            const model = { value: 'test' };
            const handshakePromise = new BridgeModel(model) as unknown as Promise<ChildAPIImplementation>;

            // Advance past timeout
            jest.advanceTimersByTime(HANDSHAKE_TIMEOUT_MS);

            await expect(handshakePromise).rejects.toThrow('Handshake timeout');
        });

        it('rejects handshake from wrong source', async () => {
            const model = { value: 'test' };
            const handshakePromise = new BridgeModel(model) as unknown as Promise<ChildAPIImplementation>;

            const wrongWindow = createMockWindow('https://wrong.example.com');
            const wrongHandshake = createMessageEvent(
                {
                    bridge: 'handshake',
                    type: MESSAGE_TYPE,
                },
                'https://wrong.example.com',
                wrongWindow as unknown as Window,
            );
            window.dispatchEvent(wrongHandshake);

            // Should not resolve - advance timers to trigger timeout
            jest.advanceTimersByTime(HANDSHAKE_TIMEOUT_MS);

            await expect(handshakePromise).rejects.toThrow('Handshake timeout');
        });
    });

    describe('Message validation', () => {
        it('rejects messages with invalid bridge type', () => {
            const event = {
                origin: 'https://child.example.com',
                data: {
                    bridge: 'invalid-type',
                    type: MESSAGE_TYPE,
                },
            } as MessageEvent;

            expect(sanitizeMessage(event, 'https://child.example.com')).toBe(false);
        });

        it('rejects messages with missing bridge property', () => {
            const event = {
                origin: 'https://child.example.com',
                data: {
                    type: MESSAGE_TYPE,
                },
            } as MessageEvent;

            expect(sanitizeMessage(event, 'https://child.example.com')).toBe(false);
        });

        it('rejects messages with wrong message type', () => {
            const event = {
                origin: 'https://child.example.com',
                data: {
                    bridge: 'handshake',
                    type: 'wrong-type',
                },
            } as MessageEvent;

            expect(sanitizeMessage(event, 'https://child.example.com')).toBe(false);
        });

        it('rejects messages with no data', () => {
            const event = {
                origin: 'https://child.example.com',
                data: null,
            } as unknown as MessageEvent;

            expect(sanitizeMessage(event, 'https://child.example.com')).toBe(false);
        });
    });

    describe('ParentAPI edge cases', () => {
        it('handles multiple event listeners', async () => {
            const { iframe, contentWindow, triggerLoad } = createMockIframe();
            const childWindow = contentWindow as unknown as Window;

            const originalCreateElement = document.createElement.bind(document);
            jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
                if (tagName.toLowerCase() === 'iframe') {
                    return iframe;
                }
                return originalCreateElement(tagName);
            });

            const container = iframe.parentNode as unknown as HTMLElement;
            const handshakePromise = new BridgeParent({
                url: 'https://child.example.com/app',
                container,
            }) as unknown as Promise<ParentAPIImplementation>;

            triggerLoad();

            const handshakeReply = createMessageEvent(
                { bridge: 'handshake-reply', type: MESSAGE_TYPE },
                'https://child.example.com',
                childWindow,
            );
            window.dispatchEvent(handshakeReply);

            const parentApi = await handshakePromise;

            const handler1 = jest.fn();
            const handler2 = jest.fn();
            parentApi.on('test-event', handler1);
            parentApi.on('test-event', handler2);

            const emitEvent = createMessageEvent(
                {
                    bridge: 'emit',
                    type: MESSAGE_TYPE,
                    value: { name: 'test-event', data: 'test-data' },
                },
                'https://child.example.com',
                childWindow,
            );
            window.dispatchEvent(emitEvent);

            expect(handler1).toHaveBeenCalledWith('test-data');
            expect(handler2).toHaveBeenCalledWith('test-data');
        });

        it('handles get() with no reply', async () => {
            const { iframe, contentWindow, triggerLoad } = createMockIframe();
            const childWindow = contentWindow as unknown as Window;

            const originalCreateElement = document.createElement.bind(document);
            jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
                if (tagName.toLowerCase() === 'iframe') {
                    return iframe;
                }
                return originalCreateElement(tagName);
            });

            const container = iframe.parentNode as unknown as HTMLElement;
            const handshakePromise = new BridgeParent({
                url: 'https://child.example.com/app',
                container,
            }) as unknown as Promise<ParentAPIImplementation>;

            triggerLoad();

            const handshakeReply = createMessageEvent(
                { bridge: 'handshake-reply', type: MESSAGE_TYPE },
                'https://child.example.com',
                childWindow,
            );
            window.dispatchEvent(handshakeReply);

            const parentApi = await handshakePromise;

            // Test that get() properly sets up the listener and sends request
            parentApi.get('value');
            
            expect(contentWindow.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ bridge: 'request', property: 'value' }),
                'https://child.example.com',
            );
            
            // Clean up
            parentApi.destroy();
        });
    });

    describe('ChildAPI edge cases', () => {
        it('handles call to non-existent method', async () => {
            const parentWindow = createMockWindow('https://parent.example.com');
            Object.defineProperty(window, 'parent', {
                value: parentWindow as unknown as Window,
                writable: true,
                configurable: true,
            });

            const model: Record<string, unknown> = {
                existingMethod: jest.fn(),
            };

            const handshakePromise = new BridgeModel(model) as unknown as Promise<ChildAPIImplementation>;

            const handshakeEvent = createMessageEvent(
                { bridge: 'handshake', type: MESSAGE_TYPE },
                'https://parent.example.com',
                parentWindow as unknown as Window,
            );
            window.dispatchEvent(handshakeEvent);

            await handshakePromise;

            // Call non-existent method
            const callEvent = createMessageEvent(
                {
                    bridge: 'call',
                    type: MESSAGE_TYPE,
                    property: 'nonExistentMethod',
                    data: 'test',
                },
                'https://parent.example.com',
                parentWindow as unknown as Window,
            );
            window.dispatchEvent(callEvent);

            // Should not throw, just silently ignore
            expect(model.existingMethod).not.toHaveBeenCalled();
        });

        it('handles request for non-existent property', async () => {
            const parentWindow = createMockWindow('https://parent.example.com');
            Object.defineProperty(window, 'parent', {
                value: parentWindow as unknown as Window,
                writable: true,
                configurable: true,
            });

            const model: Record<string, unknown> = {
                existingProp: 'value',
            };

            const handshakePromise = new BridgeModel(model) as unknown as Promise<ChildAPIImplementation>;

            const handshakeEvent = createMessageEvent(
                { bridge: 'handshake', type: MESSAGE_TYPE },
                'https://parent.example.com',
                parentWindow as unknown as Window,
            );
            window.dispatchEvent(handshakeEvent);

            await handshakePromise;

            const requestEvent = createMessageEvent(
                {
                    bridge: 'request',
                    type: MESSAGE_TYPE,
                    property: 'nonExistentProp',
                    uid: 123,
                },
                'https://parent.example.com',
                parentWindow as unknown as Window,
            );
            window.dispatchEvent(requestEvent);

            await jest.runAllTimersAsync();

            // Should send reply with undefined value
            expect(parentWindow.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    bridge: 'reply',
                    uid: 123,
                    value: undefined,
                }),
                'https://parent.example.com',
            );
        });
    });

    describe('Message queue deduplication', () => {
        it('deduplicates queued messages', async () => {
            const parentWindow = createMockWindow('https://parent.example.com');
            Object.defineProperty(window, 'parent', {
                value: parentWindow as unknown as Window,
                writable: true,
                configurable: true,
            });

            const model: Record<string, unknown> = {
                method: jest.fn(),
            };

            new BridgeModel(model) as unknown as Promise<ChildAPIImplementation>;

            // Send duplicate messages before handshake
            const callEvent1 = createMessageEvent(
                {
                    bridge: 'call',
                    type: MESSAGE_TYPE,
                    property: 'method',
                    data: 'data1',
                },
                'https://parent.example.com',
                parentWindow as unknown as Window,
            );

            const callEvent2 = createMessageEvent(
                {
                    bridge: 'call',
                    type: MESSAGE_TYPE,
                    property: 'method',
                    data: 'data1',
                },
                'https://parent.example.com',
                parentWindow as unknown as Window,
            );

            window.dispatchEvent(callEvent1);
            window.dispatchEvent(callEvent2);

            // Complete handshake
            const handshakeEvent = createMessageEvent(
                { bridge: 'handshake', type: MESSAGE_TYPE },
                'https://parent.example.com',
                parentWindow as unknown as Window,
            );
            window.dispatchEvent(handshakeEvent);

            // Advance timers to replay
            jest.advanceTimersByTime(50);
            await Promise.resolve();

            // Should only be called once (deduplicated)
            expect(model.method).toHaveBeenCalledTimes(1);
        });
    });

    describe('Registry cleanup', () => {
        it('cleans up instances on destroy', async () => {
            const { iframe, contentWindow, triggerLoad } = createMockIframe();
            const childWindow = contentWindow as unknown as Window;

            const originalCreateElement = document.createElement.bind(document);
            jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
                if (tagName.toLowerCase() === 'iframe') {
                    return iframe;
                }
                return originalCreateElement(tagName);
            });

            const container = iframe.parentNode as unknown as HTMLElement;
            const handshakePromise = new BridgeParent({
                url: 'https://child.example.com/app',
                container,
            }) as unknown as Promise<ParentAPIImplementation>;

            triggerLoad();

            const handshakeReply = createMessageEvent(
                { bridge: 'handshake-reply', type: MESSAGE_TYPE },
                'https://child.example.com',
                childWindow,
            );
            window.dispatchEvent(handshakeReply);

            const parentApi = await handshakePromise;

            expect(activeInstances.has(childWindow)).toBe(true);

            parentApi.destroy();

            expect(activeInstances.has(childWindow)).toBe(false);
        });
    });
});

