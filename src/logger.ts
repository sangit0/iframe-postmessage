// ============================================================================
// Logging
// ============================================================================

const isProduction = (): boolean => {
    try {
        return process.env.NODE_ENV === 'production';
    } catch {
        return false;
    }
};

const log = (...args: unknown[]): void => {
    if (!isProduction()) {
        // eslint-disable-next-line no-console
        console.log('[iframe-postmessage]', ...args);
    }
};

export { isProduction, log };

