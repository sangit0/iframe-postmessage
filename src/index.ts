/**
 * Iframe Handshake Bridge
 *
 * A robust cross-frame communication library for secure parent-child iframe messaging.
 * Includes enhanced features for concurrent multi-iframe handling and improved reliability.
 *
 * Key Features:
 * - Instance registry tracks all active iframe connections
 * - Origin-based message routing ensures messages go to correct iframe
 * - Source validation prevents cross-iframe message interference
 * - Per-instance message queueing prevents race conditions
 * - Enhanced handshake reliability with fallback mechanisms
 */

// ============================================================================
// Constants
// ============================================================================

const MESSAGE_TYPE = 'application/x-iframe-bridge-v1+json';
const MAX_HANDSHAKE_ATTEMPTS = 10;
const HANDSHAKE_INTERVAL_MS = 500;
const HANDSHAKE_TIMEOUT_MS = 10000;
const MESSAGE_QUEUE_REPLAY_DELAY_MS = 50;

/**
 * Check if we're in production environment
 */
const isProduction = (): boolean => {
    try {
        return process.env.NODE_ENV === 'production';
    } catch {
        return false;
    }
};

/**
 * IframeBridge logging function that enables/disables via config
 * Only logs in non-production environments
 */
const log = (...args: unknown[]): void => {
    if (!isProduction()) {
        // eslint-disable-next-line no-console
        console.log('[IframeBridge]', ...args);
    }
};

// ============================================================================
// Types
// ============================================================================

type BridgeMessageType = 'handshake' | 'handshake-reply' | 'call' | 'emit' | 'reply' | 'request';

interface BridgeMessage {
    bridge: BridgeMessageType;
    type: string;
    property?: string;
    data?: unknown;
    value?: {
        name?: string;
        data?: unknown;
    };
    uid?: number;
    model?: Record<string, unknown>;
}

interface QueuedMessage {
    message: BridgeMessage;
    origin: string;
    source: MessageEventSource;
    uid?: number; // For deduplication
}

export interface IframeBridgeConfig {
    container?: HTMLElement;
    url: string;
    classListArray?: string[];
    title?: string;
    ariaLabel?: string;
    name?: string;
    model?: Record<string, unknown>;
}

// ============================================================================
// Global Registry for Concurrent Multi-iframe Handling
// ============================================================================

/**
 * Registry to track active Bridge instances for concurrent multi-iframe support
 * Key: iframe window reference
 * Value: Bridge instance info
 */
interface BridgeInstanceInfo {
    childOrigin: string;
    parentOrigin?: string;
    frame: HTMLIFrameElement;
}

const activeInstances = new Map<Window, BridgeInstanceInfo>();

/**
 * Register a Bridge instance
 * Prevents duplicate registration by checking if instance already exists
 */
function registerInstance(childWindow: Window, info: BridgeInstanceInfo): void {
    // Check if instance already exists
    const existingInstance = activeInstances.get(childWindow);
    if (existingInstance) {
        // Clean up old instance's iframe if it exists
        if (existingInstance.frame && existingInstance.frame.parentNode) {
            try {
                existingInstance.frame.parentNode.removeChild(existingInstance.frame);
            } catch {
                // Ignore errors when removing frame
            }
        }
    }
    activeInstances.set(childWindow, info);
}

/**
 * Unregister a Bridge instance
 */
function unregisterInstance(childWindow: Window): void {
    const instance = activeInstances.get(childWindow);
    if (instance) {
        activeInstances.delete(childWindow);
    }
}

/**
 * Clean up orphaned instances (iframes removed from DOM but not properly destroyed)
 * This prevents memory leaks when iframes are removed without calling destroy()
 */
function cleanupOrphanedInstances(): void {
    activeInstances.forEach((info, childWindow) => {
        try {
            // Check if iframe still exists in DOM
            if (info.frame && !info.frame.isConnected) {
                unregisterInstance(childWindow);
            }
        } catch {
            // If we can't access the window (e.g., cross-origin), unregister it
            unregisterInstance(childWindow);
        }
    });
}

// Periodically clean up orphaned instances (every 30 seconds)
// Only run in browser environment
if (typeof window !== 'undefined' && typeof setInterval !== 'undefined') {
    setInterval(cleanupOrphanedInstances, 30000);
}

/**
 * Get instance info for a message source
 */
function getInstanceInfo(e: MessageEvent): BridgeInstanceInfo | undefined {
    if (!e.source) {
        return undefined;
    }
    return activeInstances.get(e.source as Window);
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Resolve origin from URL
 */
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

/**
 * Validate message security
 */
function sanitizeMessage(message: MessageEvent, allowedOrigin: string | false): boolean {
    // Check origin
    if (typeof allowedOrigin === 'string' && message.origin !== allowedOrigin) {
        return false;
    }

    // Check message data exists
    if (!message.data) {
        return false;
    }

    // Check message has bridge property
    if (typeof message.data !== 'object' || !('bridge' in message.data)) {
        return false;
    }

    // Check message type
    if (message.data.type !== MESSAGE_TYPE) {
        return false;
    }

    // Check valid bridge message type
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

/**
 * Generate unique message ID
 */
let messageIdCounter = 0;
function generateMessageId(): number {
    messageIdCounter += 1;
    return messageIdCounter;
}

/**
 * Resolve value from model (supports functions and promises)
 */
function resolveValue(
    model: Record<string, unknown>,
    property: string,
): Promise<unknown> {
    const unwrappedContext = typeof model[property] === 'function'
        ? (model[property] as () => unknown)()
        : model[property];
    return Promise.resolve(unwrappedContext);
}

// ============================================================================
// Child API (used by iframe)
// ============================================================================

// eslint-disable-next-line max-classes-per-file
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

        // Set up message listener
        this.child.addEventListener('message', this.handleMessage.bind(this), false);
    }

    private handleMessage(e: MessageEvent): void {
        if (!sanitizeMessage(e, this.parentOrigin)) {
            return;
        }

        const message = e.data as BridgeMessage;

        const { property, uid, data } = message;

        // Handle 'call' messages
        if (message.bridge === 'call') {
            if (property && property in this.model && typeof this.model[property] === 'function') {
                (this.model[property] as (data: unknown) => void)(data);
            }
        }

        // Handle 'request' messages (for get())
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

    /**
     * Emit event to parent
     */
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

// ============================================================================
// Parent API (used by parent frame)
// ============================================================================

// eslint-disable-next-line max-classes-per-file
class ParentAPIImplementation {
    private parent: Window;

    private frame: HTMLIFrameElement;

    private child: Window;

    private childOrigin: string;

    private events: Record<string, Array<(data: unknown) => void>> = {};

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

        // Set up message listener
        this.parent.addEventListener('message', this.handleMessage.bind(this), false);
    }

    private handleMessage(e: MessageEvent): void {
        if (!sanitizeMessage(e, this.childOrigin)) {
            return;
        }

        // Verify message is from our child iframe (concurrency safety)
        const isFromOurChild = e.source === this.child || e.source === this.frame.contentWindow;
        if (!isFromOurChild) {
            return;
        }

        const message = e.data as BridgeMessage;

        // Handle 'emit' messages from child
        if (message.bridge === 'emit' && message.value?.name) {
            const eventName = message.value.name;
            if (eventName in this.events) {
                this.events[eventName].forEach((callback) => {
                    callback.call(this, message.value?.data);
                });
            }
        }

        // Handle 'reply' messages (for get())
        // This is handled by the transact listener in get()
    }

    /**
     * Get value from child
     */
    get(property: string): Promise<unknown> {
        return new Promise((resolve) => {
            const uid = generateMessageId();

            const transact = (e: MessageEvent) => {
                if (!sanitizeMessage(e, this.childOrigin)) {
                    return;
                }

                // Verify message is from our child iframe (concurrency safety)
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

    /**
     * Call method on child
     */
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

    /**
     * Listen to events from child
     */
    on(eventName: string, callback: (data: unknown) => void): void {
        if (!this.events[eventName]) {
            this.events[eventName] = [];
        }
        this.events[eventName].push(callback);
    }

    /**
     * Destroy the iframe connection
     */
    destroy(): void {
        // Unregister instance
        unregisterInstance(this.child);

        // Clean up event listeners
        // Use bound reference to ensure proper cleanup
        const boundHandler = this.handleMessage.bind(this);
        this.parent.removeEventListener('message', boundHandler, false);

        // Remove iframe from DOM
        if (this.frame.parentNode) {
            this.frame.parentNode.removeChild(this.frame);
        }
    }
}

// ============================================================================
// Bridge Parent (for parent frame)
// ============================================================================

// eslint-disable-next-line max-classes-per-file
class BridgeParent {
    private parent: Window;

    private frame: HTMLIFrameElement;

    private child: Window;

    private model: Record<string, unknown>;

    private childOrigin: string;

    constructor(config: IframeBridgeConfig) {
        this.parent = window;
        this.model = config.model || {};

        // Create iframe
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

            // Cleanup function for failed handshake
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

                // Unregister instance if it was registered
                unregisterInstance(this.child);

                // Remove iframe from DOM
                if (this.frame.parentNode) {
                    this.frame.parentNode.removeChild(this.frame);
                }
            };

            const reply = (e: MessageEvent) => {
                // Validate message and ensure it's from our iframe
                if (!sanitizeMessage(e, false)) {
                    return;
                }

                // Ensure message is from our child iframe
                const isFromOurChild = e.source === this.child || e.source === this.frame.contentWindow;

                // Also check if it's from a registered instance with matching origin
                const instanceInfo = getInstanceInfo(e);
                const isFromRegisteredChild = instanceInfo && instanceInfo.childOrigin === this.childOrigin;

                if (!isFromOurChild && !isFromRegisteredChild) {
                    return;
                }

                const message = e.data as BridgeMessage;
                if (message.bridge === 'handshake-reply') {
                    if (isResolved) {
                        return; // Already resolved/rejected
                    }
                    isResolved = true;

                    clearInterval(responseInterval);
                    clearTimeout(handshakeTimeout);
                    log('Parent: Received handshake reply from Child');
                    if (replyHandler) {
                        this.parent.removeEventListener('message', replyHandler, false);
                    }
                    // Update childOrigin with actual origin from handshake reply
                    this.childOrigin = e.origin;

                    // Check if instance already exists (prevent duplicate registration)
                    const existingInstance = activeInstances.get(this.child);
                    if (existingInstance) {
                        unregisterInstance(this.child);
                    }

                    // Register this instance for concurrent handling
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

                // Invalid handshake reply - cleanup and reject
                log('Parent: Invalid handshake reply');
                cleanup();
                reject(new Error('Failed handshake'));
            };

            replyHandler = reply;
            this.parent.addEventListener('message', replyHandler, false);

            const doSend = (): void => {
                // Stop if we've exceeded max attempts
                if (attempt >= MAX_HANDSHAKE_ATTEMPTS) {
                    if (responseInterval) {
                        clearInterval(responseInterval);
                        responseInterval = undefined;
                    }
                    // Timeout after all attempts failed
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

                // Get fresh reference to child window (it might not be ready when iframe is created)
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
                    // Continue trying - might be cross-origin issue that resolves when iframe loads
                }

                // Stop interval after max attempts reached
                if (attempt >= MAX_HANDSHAKE_ATTEMPTS && responseInterval) {
                    clearInterval(responseInterval);
                    responseInterval = undefined;
                }
            };

            const loaded = (): void => {
                doSend();
                responseInterval = setInterval(doSend, HANDSHAKE_INTERVAL_MS);
            };

            // IE compatibility
            if ('attachEvent' in this.frame) {
                (this.frame as unknown as { attachEvent: (event: string, handler: () => void) => void }).attachEvent('onload', loaded);
            } else {
                this.frame.addEventListener('load', loaded);
            }

            this.frame.src = url;

            // Fallback: Start handshake even if load event doesn't fire (for hidden iframes)
            setTimeout(() => {
                if (!responseInterval && !isResolved) {
                    loaded();
                }
            }, 1000);
        });
    }
}

// ============================================================================
// Bridge Model (for child frame/iframe)
// ============================================================================

// Track active BridgeModel instances to prevent duplicates
const activeBridgeModels = new WeakSet<Window>();

// eslint-disable-next-line max-classes-per-file
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

        // Prevent multiple BridgeModel instances for the same window
        if (activeBridgeModels.has(this.child)) {
            throw new Error('BridgeModel already exists for this window');
        }
        activeBridgeModels.add(this.child);

        // Start intercepting messages BEFORE handshake
        this.startMessageInterception();

        return this.sendHandshakeReply() as unknown as BridgeModel;
    }

    private startMessageInterception(): void {
        this.messageListener = (e: MessageEvent) => {
            // Only intercept bridge messages
            if (!e.data || typeof e.data !== 'object' || !('bridge' in e.data)) {
                return;
            }

            const message = e.data as BridgeMessage;

            // If handshake complete, let messages pass through
            if (this.handshakeComplete) {
                return;
            }

            // Let handshake messages pass through (they will be handled by shake listener)
            if (message.bridge === 'handshake') {
                return;
            }

            // Only queue messages from parent origin (if we know it) or from parent window
            // This ensures we don't queue messages meant for other iframes
            const isFromParent = !this.parentOrigin || e.origin === this.parentOrigin;
            const isFromParentWindow = e.source === this.parent || e.source === window.parent;

            if (isFromParent && isFromParentWindow) {
                // Queue non-handshake messages from our parent
                if (message.bridge === 'call' || message.bridge === 'request') {
                    // Deduplicate: Check if this message is already queued
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

        // Use capture phase to intercept before other listeners
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
                    // Replay message as new MessageEvent
                    const messageEvent = new MessageEvent('message', {
                        data: queued.message,
                        origin: queued.origin,
                        source: queued.source,
                    });
                    window.dispatchEvent(messageEvent);
                } catch (error) {
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
                // Unregister if we were registered
                unregisterInstance(this.child);
                // Allow retry by removing from activeBridgeModels
                activeBridgeModels.delete(this.child);
                reject(new Error('Handshake timeout'));
            }, HANDSHAKE_TIMEOUT_MS);

            const shake = (e: MessageEvent) => {
                if (isResolved) {
                    return; // Already resolved/rejected
                }

                if (!e.data || typeof e.data !== 'object' || !('bridge' in e.data)) {
                    return;
                }

                const message = e.data as BridgeMessage;

                // Only accept handshake from parent window
                const isFromParent = e.source === this.parent || e.source === window.parent;
                const isValidHandshake = message.bridge === 'handshake' && isFromParent;

                if (isValidHandshake) {
                    if (isResolved) {
                        return; // Already resolved/rejected (race condition protection)
                    }
                    isResolved = true;

                    log('Child: Received handshake from Parent');

                    clearTimeout(timeout);
                    if (shakeHandler) {
                        this.child.removeEventListener('message', shakeHandler, false);
                    }

                    // Send handshake reply
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

                    // Extend model with parent's model
                    if (message.model) {
                        const parentModel = message.model;
                        Object.keys(parentModel).forEach((key) => {
                            this.model[key] = parentModel[key];
                        });
                    }

                    // Stop intercepting and replay queued messages
                    this.handshakeComplete = true;
                    this.stopMessageInterception();

                    // Check if instance already exists (prevent duplicate registration)
                    const existingInstance = activeInstances.get(this.child);
                    if (existingInstance) {
                        unregisterInstance(this.child);
                    }

                    // Register this instance for concurrent handling
                    registerInstance(this.child, {
                        childOrigin: window.location.origin,
                        parentOrigin: this.parentOrigin,
                        frame: null as unknown as HTMLIFrameElement, // Child doesn't have frame reference
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
                // Note: Non-handshake messages and handshakes from wrong source are ignored
                // (handshakes from wrong source prevent cross-iframe interference)
            };

            shakeHandler = shake;
            this.child.addEventListener('message', shakeHandler, false);
            log('Child: Listening for handshake from parent...');
        });
    }
}

// ============================================================================
// Bridge Export
// ============================================================================

/**
 * IframeBridge implementation
 */
const BridgeImplementation = function IframeBridge(config: IframeBridgeConfig) {
    return new BridgeParent(config);
} as unknown as {
    (config: IframeBridgeConfig): Promise<ParentAPIImplementation>;
    Parent: typeof BridgeParent;
    Model: typeof BridgeModel;
    debug: boolean;
    Promise: PromiseConstructor | null;
};


/**
 * Export API types
 */
export interface ParentAPI {
    get(property: string): Promise<unknown>;
    call(property: string, data?: unknown): void;
    on(eventName: string, callback: (data: unknown) => void): void;
    destroy(): void;
}

export interface ChildAPI {
    emit(name: string, data: unknown): void;
}

/**
 * Export IframeBridge as default
 */
const IframeBridge = BridgeImplementation;

// Add static properties
IframeBridge.Parent = BridgeParent;
IframeBridge.Model = BridgeModel;
IframeBridge.debug = false;
IframeBridge.Promise = (() => {
    try {
        return window ? window.Promise : Promise;
    } catch {
        return null;
    }
})();

export default IframeBridge;
export { IframeBridge };
