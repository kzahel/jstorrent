/**
 * Native Bindings Type Declarations
 *
 * Declares all __jstorrent_* global functions that must be provided by
 * the native layer (Kotlin for Android, Swift for iOS).
 *
 * These functions enable the TypeScript engine to perform I/O operations
 * via QuickJS (Android) or JavaScriptCore (iOS).
 */

declare global {
  // ============================================================
  // TCP Socket Functions
  // ============================================================

  /**
   * Initiate a TCP connection.
   * Result delivered via __jstorrent_tcp_on_connected callback.
   */
  function __jstorrent_tcp_connect(
    socketId: number,
    host: string,
    port: number,
  ): void

  /**
   * Send data on a TCP socket.
   */
  function __jstorrent_tcp_send(socketId: number, data: ArrayBuffer): void

  /**
   * Close a TCP socket.
   */
  function __jstorrent_tcp_close(socketId: number): void

  /**
   * Register callback for incoming TCP data.
   */
  function __jstorrent_tcp_on_data(
    callback: (socketId: number, data: ArrayBuffer) => void,
  ): void

  /**
   * Register callback for TCP socket close.
   */
  function __jstorrent_tcp_on_close(
    callback: (socketId: number, hadError: boolean) => void,
  ): void

  /**
   * Register callback for TCP errors.
   */
  function __jstorrent_tcp_on_error(
    callback: (socketId: number, message: string) => void,
  ): void

  /**
   * Register callback for TCP connection result.
   */
  function __jstorrent_tcp_on_connected(
    callback: (
      socketId: number,
      success: boolean,
      errorMessage: string,
    ) => void,
  ): void

  // ============================================================
  // TCP Server Functions
  // ============================================================

  /**
   * Start listening on a port.
   * Port 0 means any available port.
   * Result delivered via __jstorrent_tcp_on_listening callback.
   */
  function __jstorrent_tcp_listen(serverId: number, port: number): void

  /**
   * Close a TCP server.
   */
  function __jstorrent_tcp_server_close(serverId: number): void

  /**
   * Register callback for TCP server listening result.
   */
  function __jstorrent_tcp_on_listening(
    callback: (serverId: number, success: boolean, port: number) => void,
  ): void

  /**
   * Register callback for TCP server accepting a connection.
   */
  function __jstorrent_tcp_on_accept(
    callback: (
      serverId: number,
      socketId: number,
      remoteAddr: string,
      remotePort: number,
    ) => void,
  ): void

  // ============================================================
  // UDP Socket Functions
  // ============================================================

  /**
   * Bind a UDP socket to an address and port.
   * Result delivered via __jstorrent_udp_on_bound callback.
   */
  function __jstorrent_udp_bind(
    socketId: number,
    addr: string,
    port: number,
  ): void

  /**
   * Send a UDP datagram.
   */
  function __jstorrent_udp_send(
    socketId: number,
    addr: string,
    port: number,
    data: ArrayBuffer,
  ): void

  /**
   * Close a UDP socket.
   */
  function __jstorrent_udp_close(socketId: number): void

  /**
   * Join a multicast group.
   */
  function __jstorrent_udp_join_multicast(
    socketId: number,
    group: string,
  ): void

  /**
   * Leave a multicast group.
   */
  function __jstorrent_udp_leave_multicast(
    socketId: number,
    group: string,
  ): void

  /**
   * Register callback for UDP bind result.
   */
  function __jstorrent_udp_on_bound(
    callback: (socketId: number, success: boolean, port: number) => void,
  ): void

  /**
   * Register callback for incoming UDP messages.
   */
  function __jstorrent_udp_on_message(
    callback: (
      socketId: number,
      addr: string,
      port: number,
      data: ArrayBuffer,
    ) => void,
  ): void

  // ============================================================
  // File System Functions
  // ============================================================

  /**
   * Open a file.
   * Returns true on success, false on failure.
   */
  function __jstorrent_file_open(
    handleId: number,
    rootKey: string,
    path: string,
    mode: string,
  ): boolean

  /**
   * Read data from a file.
   * Returns ArrayBuffer with read data (may be empty).
   */
  function __jstorrent_file_read(
    handleId: number,
    offset: number,
    length: number,
    position: number,
  ): ArrayBuffer

  /**
   * Write data to a file.
   * Returns number of bytes written, or -1 on error.
   */
  function __jstorrent_file_write(
    handleId: number,
    data: ArrayBuffer,
    position: number,
  ): number

  /**
   * Truncate a file to the specified length.
   * Returns true on success.
   */
  function __jstorrent_file_truncate(handleId: number, len: number): boolean

  /**
   * Flush file changes to storage.
   */
  function __jstorrent_file_sync(handleId: number): void

  /**
   * Close a file handle.
   */
  function __jstorrent_file_close(handleId: number): void

  /**
   * Get file statistics.
   * Returns JSON string: { size, mtime, isDirectory, isFile } or null if not found.
   */
  function __jstorrent_file_stat(rootKey: string, path: string): string | null

  /**
   * Create a directory.
   * Returns true on success.
   */
  function __jstorrent_file_mkdir(rootKey: string, path: string): boolean

  /**
   * Check if a path exists.
   */
  function __jstorrent_file_exists(rootKey: string, path: string): boolean

  /**
   * Read directory contents.
   * Returns JSON array of filenames.
   */
  function __jstorrent_file_readdir(rootKey: string, path: string): string

  /**
   * Delete a file or directory.
   * Returns true on success.
   */
  function __jstorrent_file_delete(rootKey: string, path: string): boolean

  // ============================================================
  // Storage Functions (SharedPreferences / UserDefaults)
  // ============================================================

  /**
   * Get a value from storage.
   * Returns the stored string or null if not found.
   */
  function __jstorrent_storage_get(key: string): string | null

  /**
   * Set a value in storage.
   */
  function __jstorrent_storage_set(key: string, value: string): void

  /**
   * Delete a key from storage.
   */
  function __jstorrent_storage_delete(key: string): void

  /**
   * Get all keys with a given prefix.
   * Returns JSON array of key strings.
   */
  function __jstorrent_storage_keys(prefix: string): string

  // ============================================================
  // Hashing Functions
  // ============================================================

  /**
   * Compute SHA1 hash.
   * Returns 20-byte ArrayBuffer.
   */
  function __jstorrent_sha1(data: ArrayBuffer): ArrayBuffer

  // ============================================================
  // Polyfill Functions (for QuickJS/JSC missing APIs)
  // ============================================================

  /**
   * Encode string to UTF-8 bytes.
   */
  function __jstorrent_text_encode(str: string): ArrayBuffer

  /**
   * Decode UTF-8 bytes to string.
   */
  function __jstorrent_text_decode(data: ArrayBuffer): string

  /**
   * Schedule a function to run after a delay.
   * Returns timer ID.
   */
  function __jstorrent_set_timeout(callback: () => void, ms: number): number

  /**
   * Cancel a scheduled timeout.
   */
  function __jstorrent_clear_timeout(id: number): void

  /**
   * Schedule a function to run repeatedly.
   * Returns interval ID.
   */
  function __jstorrent_set_interval(callback: () => void, ms: number): number

  /**
   * Cancel a scheduled interval.
   */
  function __jstorrent_clear_interval(id: number): void

  /**
   * Generate cryptographically random bytes.
   */
  function __jstorrent_random_bytes(length: number): ArrayBuffer

  /**
   * Log a message to native console.
   */
  function __jstorrent_console_log(level: string, message: string): void

  // ============================================================
  // Controller Callbacks (JS → Native)
  // ============================================================

  /**
   * Push state update to native layer.
   * Called periodically with torrent state JSON.
   */
  function __jstorrent_on_state_update(state: string): void

  /**
   * Report error to native layer.
   */
  function __jstorrent_on_error(json: string): void
}

export {}
