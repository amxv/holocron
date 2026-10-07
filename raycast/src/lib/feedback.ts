import { HolocronError, SharedItem } from "./holocron";

export interface ShareFeedback {
  start(): Promise<void>;
  success(message: string): Promise<void>;
  failure(message: string): Promise<void>;
}

export function receiptMessage(item: SharedItem): string {
  const size = item.byteCount < 1024 ? `${item.byteCount} B` : `${(item.byteCount / 1024).toFixed(1)} KiB`;
  return `Shared ${item.kind} with Holocron · ${size} · Expires in 24h`;
}

export async function shareWithFeedback(share: () => Promise<SharedItem>, feedback: ShareFeedback): Promise<void> {
  await feedback.start();
  let item: SharedItem;
  try {
    item = await share();
  } catch (error) {
    await feedback.failure(
      error instanceof HolocronError
        ? error.message
        : "Could not share with Holocron. Check its CLI and extension preferences.",
    );
    return;
  }
  // A HUD error after a successful share must never turn into a failed-share message.
  await feedback.success(receiptMessage(item));
}

export async function lifecycleWithFeedback(action: () => Promise<string>, feedback: ShareFeedback): Promise<void> {
  await feedback.start();
  let message: string;
  try {
    message = await action();
  } catch (error) {
    await feedback.failure(
      error instanceof HolocronError ? error.message : "Could not control Holocron. Check its CLI and Mac setup.",
    );
    return;
  }
  await feedback.success(message);
}
