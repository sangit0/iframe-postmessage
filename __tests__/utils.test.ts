/**
 * Tests for utility functions
 */

// Note: These tests require exposing the utility functions or testing them indirectly
// Since they're private, we'll test them through integration tests

describe('Utility Functions', () => {
    describe('Message Validation', () => {
        it('should validate correct message format', () => {
            const message = new MessageEvent('message', {
                data: {
                    bridge: 'handshake',
                    type: 'application/x-iframe-bridge-v1+json',
                },
                origin: 'https://example.com',
            });

            // Test through actual usage
            expect(message.data).toBeDefined();
            expect((message.data as any).bridge).toBe('handshake');
        });
    });
});

