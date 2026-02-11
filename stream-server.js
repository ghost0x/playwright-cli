#!/usr/bin/env node
/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const { WebSocketServer, WebSocket } = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class ScreenshotStreamServer {
  constructor(options = {}) {
    this.port = options.port || 8080;
    this.interval = options.interval || 1000; // 1 second by default
    this.session = options.session || 'default';
    this.clients = new Set();
    this.isStreaming = false;
    this.screenshotInterval = null;
    this.wss = null;
    this.tempDir = path.join(require('os').tmpdir(), 'playwright-stream');
  }

  async start() {
    // Ensure temp directory exists
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    // Create WebSocket server
    this.wss = new WebSocketServer({ port: this.port });
    
    console.log(`WebSocket server started on port ${this.port}`);
    console.log(`Streaming screenshots every ${this.interval}ms`);
    console.log(`Session: ${this.session}`);
    console.log(`\nConnect to: ws://localhost:${this.port}`);
    console.log(`\nExample client HTML:\n`);
    console.log(`<!DOCTYPE html>
<html>
<head><title>Playwright Stream</title></head>
<body>
  <h1>Playwright Screenshot Stream</h1>
  <img id="stream" style="max-width: 100%; border: 1px solid #ccc;" />
  <script>
    const ws = new WebSocket('ws://localhost:${this.port}');
    const img = document.getElementById('stream');
    ws.onmessage = (event) => {
      img.src = 'data:image/png;base64,' + event.data;
    };
  </script>
</body>
</html>\n`);

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      console.log(`Client connected. Total clients: ${this.clients.size}`);

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`Client disconnected. Total clients: ${this.clients.size}`);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error.message);
        this.clients.delete(ws);
      });
    });

    // Start streaming
    this.isStreaming = true;
    this.captureAndStream();
  }

  async captureScreenshot() {
    return new Promise((resolve, reject) => {
      const timestamp = Date.now();
      const filename = path.join(this.tempDir, `screenshot-${timestamp}.png`);
      
      const cliPath = path.join(__dirname, 'playwright-cli.js');
      const args = ['screenshot', '--filename', filename];
      
      if (this.session !== 'default') {
        args.unshift(`-s=${this.session}`);
      }

      const child = spawn(process.execPath, [cliPath, ...args], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0 && fs.existsSync(filename)) {
          // Read the screenshot file
          const buffer = fs.readFileSync(filename);
          const base64 = buffer.toString('base64');
          
          // Clean up the file
          try {
            fs.unlinkSync(filename);
          } catch (e) {
            // Ignore cleanup errors
          }
          
          resolve(base64);
        } else {
          reject(new Error(`Screenshot failed: ${stderr || stdout || 'Unknown error'}`));
        }
      });

      child.on('error', reject);
    });
  }

  async captureAndStream() {
    if (!this.isStreaming) return;

    try {
      if (this.clients.size > 0) {
        const base64Screenshot = await this.captureScreenshot();
        
        // Broadcast to all connected clients
        this.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(base64Screenshot);
          }
        });
      }
    } catch (error) {
      console.error('Error capturing screenshot:', error.message);
    }

    // Schedule next capture
    this.screenshotInterval = setTimeout(() => {
      this.captureAndStream();
    }, this.interval);
  }

  stop() {
    this.isStreaming = false;
    
    if (this.screenshotInterval) {
      clearTimeout(this.screenshotInterval);
      this.screenshotInterval = null;
    }

    if (this.wss) {
      this.wss.close();
      console.log('WebSocket server stopped');
    }

    // Cleanup temp directory
    try {
      if (fs.existsSync(this.tempDir)) {
        const files = fs.readdirSync(this.tempDir);
        files.forEach(file => {
          fs.unlinkSync(path.join(this.tempDir, file));
        });
        fs.rmdirSync(this.tempDir);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

// CLI handling
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--port=')) {
      options.port = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--interval=')) {
      options.interval = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('-s=')) {
      options.session = arg.split('=')[1];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Playwright CLI Screenshot Stream Server

Usage: node stream-server.js [options]

Options:
  --port=<port>         WebSocket server port (default: 8080)
  --interval=<ms>       Screenshot capture interval in milliseconds (default: 1000)
  -s=<session>          Playwright CLI session name (default: default)
  --help, -h            Show this help message

Example:
  node stream-server.js --port=8080 --interval=500 -s=mySession

The server will capture screenshots from the specified Playwright CLI session
and broadcast them to all connected WebSocket clients.

To connect from a web browser, use:
  ws://localhost:<port>

The server will send base64-encoded PNG images that can be displayed using:
  <img src="data:image/png;base64,<received_data>" />
`);
      process.exit(0);
    }
  }

  const server = new ScreenshotStreamServer(options);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    server.stop();
    process.exit(0);
  });

  server.start().catch((error) => {
    console.error('Failed to start stream server:', error);
    process.exit(1);
  });
}

module.exports = { ScreenshotStreamServer };
