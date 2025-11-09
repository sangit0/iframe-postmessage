import {
    HANDSHAKE_TIMEOUT_MS,
    MESSAGE_QUEUE_REPLAY_DELAY_MS,
    MESSAGE_TYPE,
} from '@/constants';
import { log } from '@/logger';
import {
    registerInstance,
    unregisterInstance,
    activeInstances,
} from '@/registry';
import {
    BridgeMessage,
    QueuedMessage,
} from '@/types';
import {
    resolveValue,
    sanitizeMessage,
} from '@/utils';

class ChildAPIImplementation {
    private model: Record<string, unknown>;

    private parent: Window;

    private parentOrigin: string;

    private child: Window;

    constructor(info: {
        model: Record<string, unknown>;
        parent: Window;
        parentOrigin: string;
        child: Window;
    }) {
        this.model = info.model;
        this.parent = info.parent;
        this.parentOrigin = info.parentOrigin;
        this.child = info.child;

        this.child.addEventListener('message', this.handleMessage.bind(this), false);
    }

    private handleMessage(e: MessageEvent): void {
        if (!sanitizeMessage(e, this.parentOrigin)) {
            return;
        }

        const message = e.data as BridgeMessage;

        const { property, uid, data } = message;

        if (message.bridge === 'call') {
            if (property && property in this.model && typeof this.model[property] === 'function') {
                (this.model[property] as (payload: unknown) => void)(data);
            }
        }

        if (message.bridge === 'request' && uid && property) {
            resolveValue(this.model, property).then((value) => {
                if (e.source) {
                    (e.source as Window).postMessage(
                        {
                            bridge: 'reply',
                            type: MESSAGE_TYPE,
                            uid,
                            value,
                        } as BridgeMessage,
                        e.origin,
                    );
                }
            });
        }
    }

    emit(name: string, data: unknown): void {
        this.parent.postMessage(
            {
                bridge: 'emit',
                type: MESSAGE_TYPE,
                value: {
                    name,
                    data,
                },
            } as BridgeMessage,
            this.parentOrigin,
        );
    }
}

const activeBridgeModels = new Set<Window>();

function clearActiveBridgeModels(): void {
    activeBridgeModels.clear();
}

class BridgeModel {
    private child: Window;

    private model: Record<string, unknown>;

    private parent: Window;

    private parentOrigin: string | null = null;

    private messageQueue: QueuedMessage[] = [];

    private handshakeComplete = false;

    private messageListener: ((e: MessageEvent) => void) | null = null;

    constructor(model: Record<string, unknown>) {
        this.child = window;
        this.model = model;
        this.parent = this.child.parent;

        if (activeBridgeModels.has(this.child)) {
            throw new Error('BridgeModel already exists for this window');
        }
        activeBridgeModels.add(this.child);

        this.startMessageInterception();

        return this.sendHandshakeReply() as unknown as BridgeModel;
    }

    private startMessageInterception(): void {
        this.messageListener = (e: MessageEvent) => {
            if (!e.data || typeof e.data !== 'object' || !('bridge' in e.data)) {
                return;
            }

            const message = e.data as BridgeMessage;

            if (this.handshakeComplete) {
                return;
            }

            if (message.bridge === 'handshake') {
                return;
            }

            const isFromParent = !this.parentOrigin || e.origin === this.parentOrigin;
            const isFromParentWindow = e.source === this.parent || e.source === window.parent;

            if (isFromParent && isFromParentWindow) {
                if (message.bridge === 'call' || message.bridge === 'request') {
                    const isDuplicate = this.messageQueue.some(
                        queued => queued.message.bridge === message.bridge
                            && queued.message.property === message.property
                            && queued.message.uid === message.uid,
                    );

                    if (!isDuplicate) {
                        this.messageQueue.push({
                            message,
                            origin: e.origin,
                            source: e.source as MessageEventSource,
                            uid: message.uid,
                        });
                    }
                    e.stopImmediatePropagation();
                }
            }
        };

        window.addEventListener('message', this.messageListener, true);
    }

    private stopMessageInterception(): void {
        if (this.messageListener) {
            window.removeEventListener('message', this.messageListener, true);
            this.messageListener = null;
        }
    }

    private replayQueuedMessages(): void {
        const queueSize = this.messageQueue.length;
        if (queueSize === 0) {
            return;
        }

        setTimeout(() => {
            for (const queued of this.messageQueue) {
                try {
                    const messageEvent = new MessageEvent('message', {
                        data: queued.message,
                        origin: queued.origin,
                        source: queued.source,
                    });
                    window.dispatchEvent(messageEvent);
                } catch {
                    // Silently fail replay
                }
            }
            this.messageQueue = [];
        }, MESSAGE_QUEUE_REPLAY_DELAY_MS);
    }

    private sendHandshakeReply(): Promise<ChildAPIImplementation> {
        return new Promise((resolve, reject) => {
            let isResolved = false;
            let shakeHandler: ((e: MessageEvent) => void) | null = null;

            const timeout = setTimeout(() => {
                if (isResolved) {
                    return;
                }
                isResolved = true;
                log('ERROR: Child: Handshake timeout after', HANDSHAKE_TIMEOUT_MS, 'ms');
                log('ERROR: Child: Handshake timeout - instance count:', activeInstances.size);
                log('ERROR: Child: Handshake timeout - handshakeComplete:', this.handshakeComplete);
                this.stopMessageInterception();
                if (shakeHandler) {
                    this.child.removeEventListener('message', shakeHandler, false);
                }
                unregisterInstance(this.child);
                activeBridgeModels.delete(this.child);
                reject(new Error('Handshake timeout'));
            }, HANDSHAKE_TIMEOUT_MS);

            const shake = (e: MessageEvent) => {
                if (isResolved) {
                    return;
                }

                if (!e.data || typeof e.data !== 'object' || !('bridge' in e.data)) {
                    return;
                }

                const message = e.data as BridgeMessage;

                const isFromParent = e.source === this.parent || e.source === window.parent;
                const isValidHandshake = message.bridge === 'handshake' && isFromParent;

                if (isValidHandshake) {
                    if (isResolved) {
                        return;
                    }
                    isResolved = true;

                    log('Child: Received handshake from Parent');

                    clearTimeout(timeout);
                    if (shakeHandler) {
                        this.child.removeEventListener('message', shakeHandler, false);
                    }

                    if (e.source) {
                        log('Child: Sending handshake reply to Parent');
                        (e.source as Window).postMessage(
                            {
                                bridge: 'handshake-reply',
                                type: MESSAGE_TYPE,
                            } as BridgeMessage,
                            e.origin,
                        );
                    }

                    this.parentOrigin = e.origin;

                    if (message.model) {
                        const parentModel = message.model;
                        Object.keys(parentModel).forEach((key) => {
                            this.model[key] = parentModel[key];
                        });
                    }

                    this.handshakeComplete = true;
                    this.stopMessageInterception();

                    const existingInstance = activeInstances.get(this.child);
                    if (existingInstance) {
                        unregisterInstance(this.child);
                    }

                    registerInstance(this.child, {
                        childOrigin: window.location.origin,
                        parentOrigin: this.parentOrigin,
                        frame: null,
                    });

                    resolve(
                        new ChildAPIImplementation({
                            model: this.model,
                            parent: this.parent,
                            parentOrigin: this.parentOrigin,
                            child: this.child,
                        }),
                    );

                    this.replayQueuedMessages();
                }
            };

            shakeHandler = shake;
            this.child.addEventListener('message', shakeHandler, false);
            log('Child: Listening for handshake from parent...');
        });
    }
}

export { ChildAPIImplementation, BridgeModel, clearActiveBridgeModels };
