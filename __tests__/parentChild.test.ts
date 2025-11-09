import {
    MESSAGE_QUEUE_REPLAY_DELAY_MS,
    MESSAGE_TYPE,
} from '@/constants';
import {
    BridgeParent,
    ParentAPIImplementation,
} from '@/parent';
import {
    BridgeModel,
    ChildAPIImplementation,
    clearActiveBridgeModels,
} from '@/child';
import {
    activeInstances,
    unregisterInstance,
} from '@/registry';
import { createMockIframe, createMessageEvent, createMockWindow } from './utils';

describe('BridgeParent integration', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        activeInstances.clear();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
        activeInstances.clear();
        clearActiveBridgeModels();
    });

    it('establishes handshake and enables parent communication actions', async () => {
        const { iframe, contentWindow, triggerLoad } = createMockIframe();
        const childWindow = contentWindow as unknown as Window;

        const originalCreateElement = document.createElement.bind(document);
        jest.spyOn(document, 'createElement').mockImplementation((tagName: string): HTMLElement => {
            if (tagName.toLowerCase() === 'iframe') {
                return iframe;
            }
            return originalCreateElement(tagName);
        });

        const container = iframe.parentNode as unknown as HTMLElement;

        const handshakePromise = new BridgeParent({
            url: 'https://child.example.com/app',
            container,
            model: { greet: 'hello' },
        }) as unknown as Promise<ParentAPIImplementation>;

        triggerLoad();

        expect(contentWindow.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                bridge: 'handshake',
                type: MESSAGE_TYPE,
                model: { greet: 'hello' },
            }),
            'https://child.example.com',
        );

        const handshakeReply = createMessageEvent(
            {
                bridge: 'handshake-reply',
                type: MESSAGE_TYPE,
            },
            'https://child.example.com',
            childWindow,
        );
        window.dispatchEvent(handshakeReply);

        const parentApi = await handshakePromise;

        contentWindow.postMessage.mockClear();
        parentApi.call('doWork', 'payload');
        expect(contentWindow.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                bridge: 'call',
                type: MESSAGE_TYPE,
                property: 'doWork',
                data: 'payload',
            }),
            'https://child.example.com',
        );

        contentWindow.postMessage.mockClear();
        const getPromise = parentApi.get('value');
        const requestCall = contentWindow.postMessage.mock.calls.find(
            ([message]) => (message as { bridge?: string }).bridge === 'request',
        );
        expect(requestCall).toBeDefined();
        const [{ uid }] = requestCall as [ { uid: number }, string ];

        const replyEvent = createMessageEvent(
            {
                bridge: 'reply',
                type: MESSAGE_TYPE,
                uid,
                value: 'child-response',
            },
            'https://child.example.com',
            childWindow,
        );
        window.dispatchEvent(replyEvent);
        await expect(getPromise).resolves.toBe('child-response');

        const handler = jest.fn();
        parentApi.on('child-event', handler);
        const emitEvent = createMessageEvent(
            {
                bridge: 'emit',
                type: MESSAGE_TYPE,
                value: {
                    name: 'child-event',
                    data: { ok: true },
                },
            },
            'https://child.example.com',
            childWindow,
        );
        window.dispatchEvent(emitEvent);
        expect(handler).toHaveBeenCalledWith({ ok: true });

        parentApi.destroy();
        expect((iframe.parentNode as unknown as { removeChild: jest.Mock }).removeChild).toHaveBeenCalledWith(iframe);

        unregisterInstance(childWindow);
    });
});

describe('BridgeModel communication', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        activeInstances.clear();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
        activeInstances.clear();
        clearActiveBridgeModels();
        unregisterInstance(window);
    });

    it('replies to parent messages and replays queued messages after handshake', async () => {
        // Create a mock parent window
        const parentWindow = createMockWindow('https://parent.example.com');
        Object.defineProperty(window, 'parent', {
            value: parentWindow as unknown as Window,
            writable: true,
            configurable: true,
        });

        const model: Record<string, unknown> = {
            onPing: jest.fn(),
            value: 'child-value',
        };

        const handshakePromise = new BridgeModel(model) as unknown as Promise<ChildAPIImplementation>;

        const queuedCallEvent = createMessageEvent(
            {
                bridge: 'call',
                type: MESSAGE_TYPE,
                property: 'onPing',
                data: 'queued-data',
            },
            'https://parent.example.com',
            parentWindow as unknown as Window,
        );
        window.dispatchEvent(queuedCallEvent);

        const handshakeEvent = createMessageEvent(
            {
                bridge: 'handshake',
                type: MESSAGE_TYPE,
                model: {
                    parentValue: 'from-parent',
                },
            },
            'https://parent.example.com',
            parentWindow as unknown as Window,
        );
        window.dispatchEvent(handshakeEvent);

        const childApi = await handshakePromise;

        expect(parentWindow.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                bridge: 'handshake-reply',
                type: MESSAGE_TYPE,
            }),
            'https://parent.example.com',
        );

        expect(model.parentValue).toBe('from-parent');

        // Advance timers to trigger message replay
        jest.advanceTimersByTime(MESSAGE_QUEUE_REPLAY_DELAY_MS);
        
        // Wait for next tick to ensure replay is processed
        await Promise.resolve();
        
        expect(model.onPing).toHaveBeenCalledWith('queued-data');

        parentWindow.postMessage.mockClear();
        const uid = 99;
        const requestEvent = createMessageEvent(
            {
                bridge: 'request',
                type: MESSAGE_TYPE,
                property: 'value',
                uid,
            },
            'https://parent.example.com',
            parentWindow as unknown as Window,
        );
        window.dispatchEvent(requestEvent);

        // Wait for the Promise to resolve (resolveValue uses Promise.resolve)
        // With fake timers, we need to flush all pending promises
        await jest.runAllTimersAsync();

        expect(parentWindow.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                bridge: 'reply',
                uid,
                value: 'child-value',
            }),
            'https://parent.example.com',
        );

        parentWindow.postMessage.mockClear();
        childApi.emit('status', { ok: true });
        expect(parentWindow.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                bridge: 'emit',
                value: {
                    name: 'status',
                    data: { ok: true },
                },
            }),
            'https://parent.example.com',
        );

        unregisterInstance(window);
    });
});

