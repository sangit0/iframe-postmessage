import {
    HANDSHAKE_INTERVAL_MS,
    MAX_HANDSHAKE_ATTEMPTS,
    MESSAGE_TYPE,
} from '@/constants';
import { log } from '@/logger';
import {
    activeInstances,
    getInstanceInfo,
    registerInstance,
    unregisterInstance,
} from '@/registry';
import {
    BridgeMessage,
    IframePostmessageConfig,
} from '@/types';
import {
    generateMessageId,
    resolveOrigin,
    sanitizeMessage,
} from '@/utils';

class ParentAPIImplementation {
    private parent: Window;

    private frame: HTMLIFrameElement;

    private child: Window;

    private childOrigin: string;

    private events: Record<string, Array<(data: unknown) => void>> = {};

    private handleMessageRef: (e: MessageEvent) => void;

    constructor(info: {
        parent: Window;
        frame: HTMLIFrameElement;
        child: Window;
        childOrigin: string;
    }) {
        this.parent = info.parent;
        this.frame = info.frame;
        this.child = info.child;
        this.childOrigin = info.childOrigin;
        this.events = {};

        this.handleMessageRef = this.handleMessage.bind(this);
        this.parent.addEventListener('message', this.handleMessageRef, false);
    }

    private handleMessage(e: MessageEvent): void {
        if (!sanitizeMessage(e, this.childOrigin)) {
            return;
        }

        const isFromOurChild = e.source === this.child || e.source === this.frame.contentWindow;
        if (!isFromOurChild) {
            return;
        }

        const message = e.data as BridgeMessage;

        if (message.bridge === 'emit' && message.value?.name) {
            const eventName = message.value.name;
            if (eventName in this.events) {
                this.events[eventName].forEach((callback) => {
                    callback.call(this, message.value?.data);
                });
            }
        }
    }

    get(property: string): Promise<unknown> {
        return new Promise((resolve) => {
            const uid = generateMessageId();

            const transact = (e: MessageEvent) => {
                if (!sanitizeMessage(e, this.childOrigin)) {
                    return;
                }

                const isFromOurChild = e.source === this.child || e.source === this.frame.contentWindow;
                if (!isFromOurChild) {
                    return;
                }

                const message = e.data as BridgeMessage;
                if (message.uid === uid && message.bridge === 'reply') {
                    this.parent.removeEventListener('message', transact, false);
                    resolve(message.value);
                }
            };

            this.parent.addEventListener('message', transact, false);

            this.child.postMessage(
                {
                    bridge: 'request',
                    type: MESSAGE_TYPE,
                    property,
                    uid,
                } as BridgeMessage,
                this.childOrigin,
            );
        });
    }

    call(property: string, data?: unknown): void {
        this.child.postMessage(
            {
                bridge: 'call',
                type: MESSAGE_TYPE,
                property,
                data,
            } as BridgeMessage,
            this.childOrigin,
        );
    }

    on(eventName: string, callback: (data: unknown) => void): void {
        if (!this.events[eventName]) {
            this.events[eventName] = [];
        }
        this.events[eventName].push(callback);
    }

    destroy(): void {
        unregisterInstance(this.child);

        this.parent.removeEventListener('message', this.handleMessageRef, false);

        if (this.frame.parentNode) {
            this.frame.parentNode.removeChild(this.frame);
        }
    }
}

class BridgeParent {
    private parent: Window;

    private frame: HTMLIFrameElement;

    private child: Window;

    private model: Record<string, unknown>;

    private childOrigin: string;

    constructor(config: IframePostmessageConfig) {
        this.parent = window;
        this.model = config.model || {};

        this.frame = document.createElement('iframe');
        this.frame.name = config.name || '';
        if (config.classListArray) {
            this.frame.classList.add(...config.classListArray);
        }
        this.frame.title = config.title || '';
        this.frame.setAttribute('aria-label', config.ariaLabel || '');

        const container = config.container || document.body;
        container.appendChild(this.frame);

        this.child = (this.frame.contentWindow
            || (this.frame.contentDocument
                && (this.frame.contentDocument as unknown as { parentWindow: Window }).parentWindow)) as Window;
        this.childOrigin = resolveOrigin(config.url);

        return this.sendHandshake(config.url) as unknown as BridgeParent;
    }

    private sendHandshake(url: string): Promise<ParentAPIImplementation> {
        return new Promise((resolve, reject) => {
            const childOrigin = resolveOrigin(url);
            let attempt = 0;
            let responseInterval: NodeJS.Timeout | undefined;
            let handshakeTimeout: NodeJS.Timeout | undefined;
            let isResolved = false;
            let replyHandler: ((e: MessageEvent) => void) | null = null;

            const cleanup = (): void => {
                if (isResolved) {
                    return;
                }
                isResolved = true;

                clearInterval(responseInterval);
                clearTimeout(handshakeTimeout);
                if (replyHandler) {
                    this.parent.removeEventListener('message', replyHandler, false);
                }

                unregisterInstance(this.child);

                if (this.frame.parentNode) {
                    this.frame.parentNode.removeChild(this.frame);
                }
            };

            const reply = (e: MessageEvent) => {
                if (!sanitizeMessage(e, false)) {
                    return;
                }

                const isFromOurChild = e.source === this.child || e.source === this.frame.contentWindow;

                const instanceInfo = getInstanceInfo(e);
                const isFromRegisteredChild = instanceInfo && instanceInfo.childOrigin === this.childOrigin;

                if (!isFromOurChild && !isFromRegisteredChild) {
                    return;
                }

                const message = e.data as BridgeMessage;
                if (message.bridge === 'handshake-reply') {
                    if (isResolved) {
                        return;
                    }
                    isResolved = true;

                    clearInterval(responseInterval);
                    clearTimeout(handshakeTimeout);
                    log('Parent: Received handshake reply from Child');
                    if (replyHandler) {
                        this.parent.removeEventListener('message', replyHandler, false);
                    }
                    this.childOrigin = e.origin;

                    const existingInstance = activeInstances.get(this.child);
                    if (existingInstance) {
                        unregisterInstance(this.child);
                    }

                    registerInstance(this.child, {
                        childOrigin: this.childOrigin,
                        parentOrigin: window.location.origin,
                        frame: this.frame,
                    });

                    resolve(
                        new ParentAPIImplementation({
                            parent: this.parent,
                            frame: this.frame,
                            child: this.child,
                            childOrigin: this.childOrigin,
                        }),
                    );
                    return;
                }

                log('Parent: Invalid handshake reply');
                cleanup();
                reject(new Error('Failed handshake'));
            };

            replyHandler = reply;
            this.parent.addEventListener('message', replyHandler, false);

            const doSend = (): void => {
                if (attempt >= MAX_HANDSHAKE_ATTEMPTS) {
                    if (responseInterval) {
                        clearInterval(responseInterval);
                        responseInterval = undefined;
                    }
                    if (!handshakeTimeout && !isResolved) {
                        handshakeTimeout = setTimeout(() => {
                            if (!isResolved) {
                                log('Parent: Handshake timeout after max attempts');
                                cleanup();
                                reject(new Error('Handshake timeout after max attempts'));
                            }
                        }, HANDSHAKE_INTERVAL_MS);
                    }
                    return;
                }

                attempt += 1;

                const childWindow = this.frame.contentWindow;
                if (!childWindow) {
                    log(`Parent: Skipping handshake attempt ${attempt} - child window not ready yet`);
                    return;
                }

                log(`Parent: Sending handshake attempt ${attempt}`, {
                    childOrigin,
                    iframeSrc: this.frame.src,
                    hasChildWindow: !!childWindow,
                    iframeName: this.frame.name,
                    iframeId: this.frame.id,
                });

                try {
                    const handshakeMessage = {
                        bridge: 'handshake',
                        type: MESSAGE_TYPE,
                        model: this.model,
                    } as BridgeMessage;

                    childWindow.postMessage(handshakeMessage, childOrigin);
                } catch (error) {
                    log('Parent: ERROR sending handshake:', error);
                }

                if (attempt >= MAX_HANDSHAKE_ATTEMPTS && responseInterval) {
                    clearInterval(responseInterval);
                    responseInterval = undefined;
                }
            };

            const loaded = (): void => {
                doSend();
                responseInterval = setInterval(doSend, HANDSHAKE_INTERVAL_MS);
            };

            if ('attachEvent' in this.frame) {
                (this.frame as unknown as { attachEvent: (event: string, handler: () => void) => void }).attachEvent('onload', loaded);
            } else {
                this.frame.addEventListener('load', loaded);
            }

            this.frame.src = url;

            setTimeout(() => {
                if (!responseInterval && !isResolved) {
                    loaded();
                }
            }, 1000);
        });
    }
}

export { ParentAPIImplementation, BridgeParent };

