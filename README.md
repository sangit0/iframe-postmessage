# Iframe Handshake Bridge

A robust cross-frame communication library for secure parent-child iframe messaging. This library provides enhanced features for concurrent multi-iframe handling and improved reliability compared to other iframe communication solutions.

## Features

- **Instance Registry**: Tracks all active iframe connections for concurrent multi-iframe support
- **Origin-based Routing**: Ensures messages are routed to the correct iframe based on origin validation
- **Source Validation**: Prevents cross-iframe message interference through strict source checking
- **Message Queueing**: Per-instance message queueing prevents race conditions during handshake
- **Enhanced Reliability**: Improved handshake mechanism with fallback mechanisms and timeout handling
- **TypeScript Support**: Full TypeScript definitions included
- **Zero Dependencies**: No external dependencies required

## Installation

```bash
npm install iframe-handshake-bridge
```

## Usage

### Parent Frame (Host Page)

```typescript
import IframeBridge from 'iframe-handshake-bridge';

// Create a new iframe connection
const handshake = new IframeBridge({
  url: 'https://example.com/child-page.html',
  container: document.getElementById('iframe-container'),
  classListArray: ['custom-iframe'],
  model: {
    // Share data/methods with child
    doSomething: (data: string) => {
      console.log('Child called doSomething with:', data);
    },
  },
});

// Wait for handshake to complete
handshake.then((child) => {
  // Get a value from child
  child.get('someProperty').then((value) => {
    console.log('Value from child:', value);
  });

  // Call a method on child
  child.call('someMethod', { data: 'example' });

  // Listen to events from child
  child.on('someEvent', (data) => {
    console.log('Event from child:', data);
  });

  // Clean up when done
  // child.destroy();
});
```

### Child Frame (Iframe Content)

```typescript
import { IframeBridge } from 'iframe-handshake-bridge';

// Create child model
const handshake = new IframeBridge.Model({
  // Expose methods/properties to parent
  someProperty: 'value',
  someMethod: (data: unknown) => {
    console.log('Parent called someMethod with:', data);
    return 'response';
  },
});

// Wait for handshake to complete
handshake.then((child) => {
  // Emit events to parent
  child.emit('someEvent', { data: 'example' });
});
```

## API Reference

### IframeBridge (Parent)

#### Constructor Options

```typescript
interface IframeBridgeConfig {
  url: string;                    // URL of the iframe content
  container?: HTMLElement;         // Container element (default: document.body)
  classListArray?: string[];       // CSS classes to add to iframe
  title?: string;                  // iframe title attribute
  ariaLabel?: string;              // iframe aria-label attribute
  name?: string;                   // iframe name attribute
  model?: Record<string, unknown>; // Data/methods to share with child
}
```

#### ParentAPI Methods

- `get(property: string): Promise<unknown>` - Get a value from the child
- `call(property: string, data?: unknown): void` - Call a method on the child
- `on(eventName: string, callback: (data: unknown) => void): void` - Listen to events from child
- `destroy(): void` - Destroy the iframe connection and remove it from DOM

### IframeBridge.Model (Child)

#### Constructor Options

```typescript
constructor(model: Record<string, unknown>)
```

#### ChildAPI Methods

- `emit(name: string, data: unknown): void` - Emit an event to the parent

## Advanced Usage

### Multiple Concurrent Iframes

The library handles multiple concurrent iframe connections automatically:

```typescript
const iframe1 = new IframeBridge({ url: 'https://example.com/iframe1.html' });
const iframe2 = new IframeBridge({ url: 'https://example.com/iframe2.html' });
const iframe3 = new IframeBridge({ url: 'https://example.com/iframe3.html' });

Promise.all([iframe1, iframe2, iframe3]).then(([child1, child2, child3]) => {
  // All three iframes are ready
  child1.call('method1');
  child2.call('method2');
  child3.call('method3');
});
```

### Error Handling

```typescript
const handshake = new IframeBridge({
  url: 'https://example.com/child.html',
});

handshake
  .then((child) => {
    // Success
    console.log('Connected to child');
  })
  .catch((error) => {
    // Handle handshake failure
    console.error('Failed to connect:', error);
  });
```

## Development

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Clean build artifacts
npm run clean
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

