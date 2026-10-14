import { message as localizedMessage } from "../localization/runtime";

/**
 * Writes text that may still be loading. Call it inside the click: WebKit
 * keeps the user activation for a `ClipboardItem` whose content is a pending
 * promise, but not for a `writeText` after an awaited command.
 */
export async function copyText(text: string | Promise<string>): Promise<void> {
  const clipboard = navigator.clipboard;
  if (clipboard === undefined) {
    throw new Error(localizedMessage("feedback.clipboard.unavailable"));
  }
  if (
    typeof text !== "string" &&
    typeof clipboard.write === "function" &&
    typeof ClipboardItem !== "undefined"
  ) {
    await clipboard.write([
      new ClipboardItem({
        "text/plain": text.then(
          (value) => new Blob([value], { type: "text/plain" }),
        ),
      }),
    ]);
    await text;
    return;
  }
  await clipboard.writeText(await text);
}
