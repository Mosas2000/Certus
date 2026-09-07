"use client";

import { useMemo, type ReactNode } from "react";
import { SomniaMarketsProvider } from "@somnia-chain/markets-sdk/react";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

export function Providers({ children }: { children: ReactNode }) {
  const client = useMemo(
    () =>
      new SomniaMarkets({
        indexerUrl: process.env.NEXT_PUBLIC_INDEXER_URL ?? "",
        chain: somniaShannon,
        wsRpcUrl: process.env.NEXT_PUBLIC_WS_RPC_URL ?? "",
        addresses: SOMNIA_TESTNET_ADDRESSES,
      }).client,
    [],
  );
  return <SomniaMarketsProvider client={client}>{children}</SomniaMarketsProvider>;
}
