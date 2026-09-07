"use client";

import { useIsTailing, useLiveStatus } from "@somnia-chain/markets-sdk/react";

export function LiveStatusPill() {
  const status = useLiveStatus();
  const tailing = useIsTailing();

  let label: string;
  let cls: string;
  if (!status.wsConnected) {
    label = "reconnecting";
    cls = "pill-warn";
  } else if (status.watchCount === 0) {
    label = "idle";
    cls = "pill-dim";
  } else if (!tailing) {
    label = "hydrating";
    cls = "pill-dim";
  } else {
    label = "live";
    cls = "pill-live";
  }

  return (
    <span className={`pill ${cls}`} title={`ws=${status.wsConnected ? "connected" : "down"} watches=${status.watchCount} block=${status.lastBlock}`}>
      {label}
    </span>
  );
}
