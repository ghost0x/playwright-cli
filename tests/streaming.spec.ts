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

import { test, expect } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import WebSocket from 'ws';

async function startStreamServer(port: number = 8081): Promise<ChildProcess> {
  const serverPath = path.join(__dirname, '../stream-server.js');
  const server = spawn(process.execPath, [serverPath, `--port=${port}`, '--interval=500'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Wait for server to start
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Server start timeout'));
    }, 5000);

    server.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      if (output.includes('WebSocket server started')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    server.on('error', (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  return server;
}

function stopStreamServer(server: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    server.on('close', () => resolve());
    server.kill('SIGTERM');
  });
}

async function runCli(...args: string[]): Promise<void> {
  const cliPath = path.join(__dirname, '../playwright-cli.js');
  
  return new Promise<void>((resolve, reject) => {
    const childProcess = spawn(process.execPath, [cliPath, ...args], {
      env: {
        ...process.env,
        PLAYWRIGHT_CLI_INSTALLATION_FOR_TEST: test.info().outputPath(),
      },
      cwd: test.info().outputPath(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    childProcess.on('close', (code: number | null) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`CLI exited with code ${code}`));
      }
    });

    childProcess.on('error', reject);
  });
}

test.describe('Screenshot Streaming', () => {
  test('stream server starts and accepts connections', async () => {
    const port = 8081;
    const server = await startStreamServer(port);

    try {
      // Connect with WebSocket client
      const ws = new WebSocket(`ws://localhost:${port}`);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 3000);

        ws.on('open', () => {
          clearTimeout(timeout);
          resolve();
        });

        ws.on('error', (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      expect(ws.readyState).toBe(WebSocket.OPEN);

      // Clean up
      ws.close();
      await new Promise<void>((resolve) => {
        ws.on('close', () => resolve());
      });
    } finally {
      await stopStreamServer(server);
    }
  });

  test('stream server sends screenshot data', async () => {
    const port = 8082;
    
    // Start a browser session first
    await runCli('open', 'data:text/html,<h1>Test Page</h1>', '--persistent');

    try {
      const server = await startStreamServer(port);

      try {
        const ws = new WebSocket(`ws://localhost:${port}`);

        const screenshot = await new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('No screenshot received'));
          }, 10000);

          ws.on('message', (data: WebSocket.Data) => {
            clearTimeout(timeout);
            resolve(data.toString());
          });

          ws.on('error', (err: Error) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        // Verify we received base64 data
        expect(screenshot).toBeTruthy();
        expect(screenshot.length).toBeGreaterThan(100);
        
        // Verify it's valid base64
        const buffer = Buffer.from(screenshot, 'base64');
        expect(buffer.length).toBeGreaterThan(0);
        
        // PNG files start with specific magic bytes
        expect(buffer[0]).toBe(0x89);
        expect(buffer[1]).toBe(0x50);
        expect(buffer[2]).toBe(0x4E);
        expect(buffer[3]).toBe(0x47);

        ws.close();
      } finally {
        await stopStreamServer(server);
      }
    } finally {
      // Clean up session
      await runCli('delete-data');
    }
  });

  test('multiple clients can connect simultaneously', async () => {
    const port = 8083;
    
    await runCli('open', 'data:text/html,<h1>Multi Client Test</h1>', '--persistent');

    try {
      const server = await startStreamServer(port);

      try {
        // Connect multiple clients
        const ws1 = new WebSocket(`ws://localhost:${port}`);
        const ws2 = new WebSocket(`ws://localhost:${port}`);

        // Wait for both to connect
        await Promise.all([
          new Promise<void>((resolve) => ws1.on('open', () => resolve())),
          new Promise<void>((resolve) => ws2.on('open', () => resolve())),
        ]);

        expect(ws1.readyState).toBe(WebSocket.OPEN);
        expect(ws2.readyState).toBe(WebSocket.OPEN);

        // Both should receive messages
        const received = await Promise.all([
          new Promise<boolean>((resolve) => {
            ws1.once('message', () => resolve(true));
            setTimeout(() => resolve(false), 5000);
          }),
          new Promise<boolean>((resolve) => {
            ws2.once('message', () => resolve(true));
            setTimeout(() => resolve(false), 5000);
          }),
        ]);

        expect(received[0]).toBe(true);
        expect(received[1]).toBe(true);

        ws1.close();
        ws2.close();
      } finally {
        await stopStreamServer(server);
      }
    } finally {
      await runCli('delete-data');
    }
  });
});
