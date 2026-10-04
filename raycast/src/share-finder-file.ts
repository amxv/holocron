import { getPreferenceValues, getSelectedFinderItems } from "@raycast/api";
import { HolocronError, HolocronPreferences, selectedFilePath, shareFile } from "./lib/holocron";
import { shareWithFeedback } from "./lib/feedback";
import { raycastFeedback } from "./lib/raycast-feedback";

export default async function Command() {
  await shareWithFeedback(async () => {
    const preferences = getPreferenceValues<HolocronPreferences>();
    let items: { path: string }[];
    try {
      items = await getSelectedFinderItems();
    } catch {
      throw new HolocronError("Bring Finder to the front and select one UTF-8 file, then run this command again.");
    }
    return shareFile(preferences, selectedFilePath(items));
  }, raycastFeedback("Sharing Finder File with Holocron"));
}
