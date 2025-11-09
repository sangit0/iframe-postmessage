# Examples

This directory contains example HTML files demonstrating how to use `iframe-postmessage`.

## 🚀 Quick Start

1. **Build the library** (if not already built):
   ```bash
   npm run build
   ```

2. **Start a local server** (required for ES modules):
   ```bash
   node examples/server.js
   ```

3. **Open the parent example**:
   ```
   http://localhost:8000/examples/parent.html
   ```

## 📁 Files

### `parent.html`
Demonstrates the **parent frame** usage:
- Creating an iframe connection
- Getting values from child
- Calling child methods
- Listening to child events
- Sharing methods with child

### `child.html`
Demonstrates the **child frame** usage:
- Creating a child model
- Exposing properties and methods
- Emitting events to parent
- Handling method calls from parent

## 🎯 Features Demonstrated

### Parent Side
- ✅ Creating iframe connection
- ✅ Getting child properties (`get()`)
- ✅ Calling child methods (`call()`)
- ✅ Listening to child events (`on()`)
- ✅ Sharing methods with child (`model` option)

### Child Side
- ✅ Creating child model
- ✅ Exposing properties (getters)
- ✅ Exposing methods
- ✅ Emitting events (`emit()`)
- ✅ Handling parent method calls

## 🔧 How It Works

1. **Parent** (`parent.html`):
   - Loads the library from `dist/index.js`
   - Creates an iframe pointing to `child.html`
   - Waits for handshake to complete
   - Then can interact with child

2. **Child** (`child.html`):
   - Loads the library from `dist/index.js`
   - Creates a model with exposed properties/methods
   - Waits for handshake from parent
   - Then can emit events and respond to parent calls

## 📝 Notes

- **ES Modules**: These examples use ES modules (`type="module"`), so you need a local server
- **Same Origin**: For testing, both files should be served from the same origin
- **CORS**: In production, ensure proper CORS headers if using cross-origin iframes

## 🐛 Troubleshooting

- **"Failed to connect"**: Make sure both files are served from the same origin
- **"Module not found"**: Ensure you've run `npm run build` first
- **Events not working**: Check browser console for errors

