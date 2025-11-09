import { MESSAGE_TYPE } from '@/constants';
import {
    generateMessageId,
    resolveOrigin,
    resolveValue,
    sanitizeMessage,
} from '@/utils';

describe('utility helpers', () => {
    it('resolves origin from URL with default ports', () => {
        const origin = resolveOrigin('https://example.com:443/path');
        expect(origin).toBe('https://example.com');
    });

    it('validates a correct bridge message', () => {
        const validEvent = {
            origin: 'https://child.example.com',
            data: {
                bridge: 'handshake',
                type: MESSAGE_TYPE,
            },
        } as MessageEvent;

        expect(sanitizeMessage(validEvent, 'https://child.example.com')).toBe(true);
    });

    it('rejects messages from unexpected origins', () => {
        const event = {
            origin: 'https://malicious.example.com',
            data: {
                bridge: 'handshake',
                type: MESSAGE_TYPE,
            },
        } as MessageEvent;

        expect(sanitizeMessage(event, 'https://child.example.com')).toBe(false);
    });

    it('generates incrementing message ids', () => {
        const first = generateMessageId();
        const second = generateMessageId();
        expect(second).toBe(first + 1);
    });

    it('resolves function values from a model', async () => {
        const model = {
            value: () => Promise.resolve('resolved'),
        };

        await expect(resolveValue(model, 'value')).resolves.toBe('resolved');
    });
});

