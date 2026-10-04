import { getPreferenceValues } from "@raycast/api";
import { HolocronPreferences, shareClipboard } from "./lib/holocron";
import { shareWithFeedback } from "./lib/feedback";
import { raycastFeedback } from "./lib/raycast-feedback";

export default async function Command() {
  await shareWithFeedback(
    () => shareClipboard(getPreferenceValues<HolocronPreferences>()),
    raycastFeedback("Sharing Clipboard with Holocron"),
  );
}
