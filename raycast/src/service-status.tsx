import { Action, ActionPanel, Color, Detail, getPreferenceValues, Icon, showToast, Toast } from "@raycast/api";
import { useCallback, useEffect, useState } from "react";
import { HolocronError, HolocronPreferences } from "./lib/holocron";
import {
  HealthLabel,
  serviceDetails,
  serviceOverview,
  serviceStatus,
  startService,
  stopService,
  ServiceStatus,
} from "./lib/service";

function safeError(error: unknown): string {
  return error instanceof HolocronError
    ? error.message
    : "Unable to inspect or control Holocron. Check its CLI and Mac setup.";
}

function HealthRow({ title, value }: { title: string; value: HealthLabel }) {
  const color =
    value.tone === "healthy" ? Color.Green : value.tone === "attention" ? Color.Orange : Color.SecondaryText;
  const icon =
    value.tone === "healthy" ? Icon.CheckCircle : value.tone === "attention" ? Icon.ExclamationMark : Icon.Circle;
  return (
    <Detail.Metadata.Label
      title={title}
      text={{ value: value.text, color }}
      icon={{ source: icon, tintColor: color }}
    />
  );
}

export default function Command() {
  const [status, setStatus] = useState<ServiceStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(true);
  const overview = status ? serviceOverview(status) : undefined;

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setStatus(await serviceStatus(getPreferenceValues<HolocronPreferences>()));
      setError(undefined);
    } catch (cause) {
      setStatus(undefined);
      setError(safeError(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const operate = useCallback(
    async (action: "start" | "stop") => {
      setBusy(true);
      try {
        const preferences = getPreferenceValues<HolocronPreferences>();
        if (action === "start") await startService(preferences);
        else await stopService(preferences);
        await showToast({
          style: Toast.Style.Success,
          title: action === "start" ? "Holocron started" : "Holocron stopped",
        });
        await refresh();
      } catch (cause) {
        await showToast({ style: Toast.Style.Failure, title: "Holocron service error", message: safeError(cause) });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return (
    <Detail
      navigationTitle="Holocron Service Status"
      isLoading={busy}
      markdown={
        error
          ? `# Holocron service\n\n${error}`
          : status
            ? serviceDetails(status)
            : "# Holocron service\n\nChecking status…"
      }
      metadata={
        overview ? (
          <Detail.Metadata>
            <HealthRow title="Service" value={overview.service} />
            <Detail.Metadata.Separator />
            <HealthRow title="Tunnel" value={overview.tunnel} />
            <HealthRow title="Secret requests" value={overview.secrets} />
            <Detail.Metadata.Separator />
            <HealthRow title="Pairing" value={overview.pairing} />
            <HealthRow title="Remote discovery" value={overview.discovery} />
          </Detail.Metadata>
        ) : undefined
      }
      actions={
        <ActionPanel>
          {status?.runtime === "running" ? (
            <Action title="Stop Holocron" icon={Icon.Stop} onAction={() => void operate("stop")} />
          ) : status?.runtime === "stopped" && !status.recoveryRequired ? (
            <Action title="Start Holocron" icon={Icon.Play} onAction={() => void operate("start")} />
          ) : null}
          <Action title="Refresh Status" icon={Icon.ArrowClockwise} onAction={() => void refresh()} />
        </ActionPanel>
      }
    />
  );
}
