import { MESSAGE_TYPE } from '@/constants';
import { BridgeMessageType } from '@/types';

function resolveOrigin(url: string): string {
    const a = document.createElement('a');
    a.href = url;
    const protocol = a.protocol.length > 4 ? a.protocol : window.location.protocol;
    let host: string;
    if (a.host.length) {
        if (a.port === '80' || a.port === '443') {
            host = a.hostname;
        } else {
            host = a.host;
        }
    } else {
        host = window.location.host;
    }
    return a.origin || `${protocol}//${host}`;
}

function sanitizeMessage(message: MessageEvent, allowedOrigin: string | false): boolean {
    if (typeof allowedOrigin === 'string' && message.origin !== allowedOrigin) {
        return false;
    }

    if (!message.data) {
        return false;
    }

    if (typeof message.data !== 'object' || !('bridge' in message.data)) {
        return false;
    }

    if (message.data.type !== MESSAGE_TYPE) {
        return false;
    }

    const validTypes: BridgeMessageType[] = [
        'handshake',
        'handshake-reply',
        'call',
        'emit',
        'reply',
        'request',
    ];
    if (!validTypes.includes(message.data.bridge)) {
        return false;
    }

    return true;
}

let messageIdCounter = 0;
function generateMessageId(): number {
    messageIdCounter += 1;
    return messageIdCounter;
}

function resolveValue(
    model: Record<string, unknown>,
    property: string,
): Promise<unknown> {
    const unwrappedContext = typeof model[property] === 'function'
        ? (model[property] as () => unknown)()
        : model[property];
    return Promise.resolve(unwrappedContext);
}

export {
    resolveOrigin,
    sanitizeMessage,
    generateMessageId,
    resolveValue,
};

