import { openExtensionPreferences, showHUD, showToast, Toast } from "@raycast/api";
import { ShareFeedback } from "./feedback";

export function raycastFeedback(title: string, failureTitle = "Could Not Share with Holocron"): ShareFeedback {
  let toast: Toast | undefined;
  return {
    async start() {
      toast = await showToast({ style: Toast.Style.Animated, title });
    },
    async success(message) {
      await toast?.hide();
      await showHUD(message);
    },
    async failure(message) {
      const options: Toast.Options = {
        style: Toast.Style.Failure,
        title: failureTitle,
        message,
        primaryAction: { title: "Open Holocron Preferences", onAction: () => openExtensionPreferences() },
      };
      if (toast) {
        Object.assign(toast, options);
      } else {
        await showToast(options);
      }
    },
  };
}
