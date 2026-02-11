# Screenshot Streaming Examples

This directory contains examples of how to use the screenshot streaming feature.

## Basic Usage

### 1. Start a Playwright CLI session

```bash
# Open a browser and navigate to a page
playwright-cli open https://example.com

# Or use a data URL for testing
playwright-cli open 'data:text/html,<h1>Hello World</h1>'
```

### 2. Start the stream server

```bash
# Default settings (port 8080, 1 second interval)
node stream-server.js

# Custom port
node stream-server.js --port=3000

# Faster streaming (2 frames per second)
node stream-server.js --interval=500

# Stream from a specific session
node stream-server.js -s=mySession
```

### 3. View the stream

Open `stream-client.html` in your web browser and click "Connect".

## Advanced Examples

### Example 1: Monitor a long-running test

```bash
# Terminal 1: Run your test automation
playwright-cli open https://demo.playwright.dev/todomvc --headed
playwright-cli type "Buy groceries"
playwright-cli press Enter
# ... more automation steps

# Terminal 2: Stream the session
node stream-server.js --interval=1000

# Terminal 3: View in browser
# Open stream-client.html
```

### Example 2: Custom Node.js client

Create a file `custom-client.js`:

```javascript
const WebSocket = require('ws');
const fs = require('fs');

const ws = new WebSocket('ws://localhost:8080');
let frameCount = 0;

ws.on('message', (data) => {
  frameCount++;
  console.log(`Received frame ${frameCount}`);
  
  // Save every 10th frame
  if (frameCount % 10 === 0) {
    const buffer = Buffer.from(data.toString(), 'base64');
    fs.writeFileSync(`frame-${frameCount}.png`, buffer);
    console.log(`  Saved frame-${frameCount}.png`);
  }
});

ws.on('open', () => {
  console.log('Connected to stream');
});
```

Run it:
```bash
node custom-client.js
```

### Example 3: Multi-session streaming

Monitor multiple Playwright sessions simultaneously:

```bash
# Terminal 1: Session 1
playwright-cli -s=session1 open https://example.com

# Terminal 2: Session 2  
playwright-cli -s=session2 open https://github.com

# Terminal 3: Stream session 1 on port 8080
node stream-server.js --port=8080 -s=session1

# Terminal 4: Stream session 2 on port 8081
node stream-server.js --port=8081 -s=session2
```

Then open `stream-client.html` twice in different browser tabs, connecting to different ports.

### Example 4: Automated screenshot capture

Use the stream to automatically save screenshots during testing:

```javascript
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// Create output directory
const outputDir = './screenshots';
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

const ws = new WebSocket('ws://localhost:8080');

ws.on('message', (data) => {
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const filename = path.join(outputDir, `screenshot-${timestamp}.png`);
  
  const buffer = Buffer.from(data.toString(), 'base64');
  fs.writeFileSync(filename, buffer);
  
  console.log(`Saved ${filename}`);
});

console.log('Saving all screenshots to:', path.resolve(outputDir));
```

## Tips and Tricks

### Adjusting Performance

- **High quality, low latency**: Use `--interval=100` for ~10 fps (high CPU usage)
- **Balanced**: Use `--interval=500` for ~2 fps (recommended for remote monitoring)
- **Low bandwidth**: Use `--interval=2000` for 0.5 fps (good for slow connections)

### Remote Access

To access the stream from another machine:

```bash
# Start server on all interfaces
node stream-server.js --port=8080

# In the client HTML, change:
# ws://localhost:8080 to ws://YOUR_SERVER_IP:8080
```

**Security Note**: Be careful when exposing WebSocket servers on public networks. Consider using:
- VPN or SSH tunneling
- Authentication/authorization
- HTTPS/WSS for encrypted connections

## Troubleshooting

### "Screenshot failed" errors
- Make sure a Playwright CLI session is running
- Check that the session name matches (use `-s=` parameter)
- Verify the browser page is loaded

### No frames received
- Check that the stream server is running
- Verify WebSocket connection is established
- Check browser console for errors
- Ensure firewall isn't blocking the port

### High CPU usage
- Increase the interval (e.g., `--interval=2000`)
- Reduce viewport size in Playwright
- Limit number of connected clients

### Lag or delayed frames
- Increase interval between captures
- Check network bandwidth
- Reduce number of clients
- Use a faster machine or lower viewport resolution
