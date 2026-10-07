import { getPreferenceValues } from "@raycast/api";
import { HolocronPreferences } from "./lib/holocron";
import { lifecycleWithFeedback } from "./lib/feedback";
import { raycastFeedback } from "./lib/raycast-feedback";
import { serviceSummary, startService } from "./lib/service";

export default async function Command() {
  await lifecycleWithFeedback(
    async () => {
      const result = await startService(getPreferenceValues<HolocronPreferences>());
      return `${result.alreadyRunning ? "Already running" : "Started"} · ${serviceSummary(result.status)}`;
    },
    raycastFeedback("Starting Holocron Service", "Could Not Start Holocron"),
  );
}
