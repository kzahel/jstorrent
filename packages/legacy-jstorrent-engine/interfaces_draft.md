# Core Interfaces Draft

## 1. Abstract Socket Interface (`ISocket`)

This interface abstracts the underlying transport (TCP, UDP, WebSocket, WebRTC).

```typescript
export interface ISocket {
  // Unique identifier for debugging/logging
  readonly id: string;

  // Connection state
  readonly connected: boolean;
  readonly remoteAddress: string;
  readonly remotePort: number;

  // Connect to a remote peer
  connect(port: number, host: string): Promise<void>;

  // Write data to the socket
  write(data: Uint8Array): Promise<void>;

  // Close the connection
  close(): Promise<void>;

  // Events
  on(event: 'data', listener: (data: Uint8Array) => void): this;
  on(event: 'connect', listener: () => void): this;
  on(event: 'close', listener: (hadError: boolean) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  
  // Remove listeners
  off(event: string, listener: (...args: any[]) => void): this;
}

export interface IServer {
  listen(port: number, host?: string): Promise<void>;
  close(): Promise<void>;
  
  on(event: 'connection', listener: (socket: ISocket) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
}
```

## 2. Abstract File System Interface (`IFileSystem`)

This interface abstracts file storage (Node `fs`, Chrome `fileSystem`, OPFS).

```typescript
export interface IFileSystem {
  // Open a file handle
  open(path: string, mode: 'r' | 'w' | 'r+'): Promise<IFileHandle>;

  // Get file stats (size, modified time)
  stat(path: string): Promise<IFileStat>;

  // Create a directory
  mkdir(path: string): Promise<void>;
  
  // Check if file/directory exists
  exists(path: string): Promise<boolean>;
}

export interface IFileHandle {
  // Read data from a specific offset
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;

  // Write data to a specific offset
  write(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesWritten: number }>;

  // Truncate file to specific size
  truncate(len: number): Promise<void>;

  // Flush changes to disk
  sync(): Promise<void>;

  // Close the file handle
  close(): Promise<void>;
}

export interface IFileStat {
  size: number;
  mtime: Date;
  isDirectory: boolean;
  isFile: boolean;
}
```

## 3. Proxy Bridge Protocol (Draft)

For the "Proxy I/O" implementation, we can use a simple JSON-RPC over WebSocket protocol.

**Request (Client -> Proxy):**
```json
{
  "id": 1,
  "method": "fs.read",
  "params": {
    "path": "/downloads/ubuntu.iso",
    "position": 0,
    "length": 16384
  }
}
```

**Response (Proxy -> Client):**
```json
{
  "id": 1,
  "result": {
    "bytesRead": 16384,
    "data": "base64_encoded_data..." 
  }
}
```
