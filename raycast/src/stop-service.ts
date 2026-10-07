import { getPreferenceValues } from "@raycast/api";
import { HolocronPreferences } from "./lib/holocron";
import { lifecycleWithFeedback } from "./lib/feedback";
import { raycastFeedback } from "./lib/raycast-feedback";
import { stopService } from "./lib/service";

export default async function Command() {
  await lifecycleWithFeedback(
    async () => {
      await stopService(getPreferenceValues<HolocronPreferences>());
      return "Holocron service stopped";
    },
    raycastFeedback("Stopping Holocron Service", "Could Not Stop Holocron"),
  );
}
