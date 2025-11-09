import { BridgeInstanceInfo } from './types';

const activeInstances = new Map<Window, BridgeInstanceInfo>();

function registerInstance(childWindow: Window, info: BridgeInstanceInfo): void {
    const existingInstance = activeInstances.get(childWindow);
    if (existingInstance) {
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

function unregisterInstance(childWindow: Window): void {
    if (activeInstances.has(childWindow)) {
        activeInstances.delete(childWindow);
    }
}

function cleanupOrphanedInstances(): void {
    activeInstances.forEach((info, childWindow) => {
        try {
            if (info.frame && !info.frame.isConnected) {
                unregisterInstance(childWindow);
            }
        } catch {
            unregisterInstance(childWindow);
        }
    });
}

if (typeof window !== 'undefined' && typeof setInterval !== 'undefined') {
    setInterval(cleanupOrphanedInstances, 30000);
}

function getInstanceInfo(e: MessageEvent): BridgeInstanceInfo | undefined {
    if (!e.source) {
        return undefined;
    }
    return activeInstances.get(e.source as Window);
}

export {
    activeInstances,
    registerInstance,
    unregisterInstance,
    cleanupOrphanedInstances,
    getInstanceInfo,
};

