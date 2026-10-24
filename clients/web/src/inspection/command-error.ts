/** A command the application rejected, with the host's error code if any. */
export class CommandRejectedError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "CommandRejectedError";
    this.code = code;
  }
}
