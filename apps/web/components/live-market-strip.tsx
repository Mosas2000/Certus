"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveBinaryOrderBookByMarket, useLiveMarkets } from "@somnia-chain/markets-sdk/react";
import { isBinaryMarket, type Market } from "@somnia-chain/markets-sdk";

const ASSETS = ["BTC", "ETH"] as const;

function useNow(tickMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [tickMs]);
  return now;
}

function fmtCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return "rolling";
  const m = Math.floor(secondsLeft / 60);
  const s = Math.round(secondsLeft % 60);
  if (m >= 60) return `${Math.floor(m / 60)}h${m % 60}m`;
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

function MarketTile({ marketId, asset, intervalSec, expiry }: {
  marketId: string;
  asset: string;
  intervalSec: number;
  expiry: number;
}) {
  const now = useNow(1000);
  const book = useLiveBinaryOrderBookByMarket(marketId, 1);
  const secondsLeft = Math.floor(expiry - now / 1000);

  const decimals = 6;
  const bid = book?.yesBids?.[0]?.price;
  const ask = book?.yesAsks?.[0]?.price;
  const bidProb = bid !== undefined ? Number(bid) / 10 ** decimals : null;
  const askProb = ask !== undefined ? Number(ask) / 10 ** decimals : null;

  return (
    <div className="market-tile" data-market={marketId}>
      <div className="market-tile-head">
        <span className="market-asset">{asset}</span>
        <span className="market-window">{intervalSec / 60}m</span>
        <span className={secondsLeft < 300 ? "market-ttc hot" : "market-ttc"}>
          {fmtCountdown(secondsLeft)}
        </span>
      </div>
      <div className="market-tile-book">
        {bidProb === null && askProb === null ? (
          <span className="dim">book empty</span>
        ) : (
          <>
            <span>bid {bidProb !== null ? bidProb.toFixed(3) : "—"}</span>
            <span>up-prob</span>
            <span>ask {askProb !== null ? askProb.toFixed(3) : "—"}</span>
          </>
        )}
      </div>
    </div>
  );
}

function pickCurrent(
  markets: Market[],
  asset: string,
  nowSec: number,
): { marketId: string; intervalSec: number; expiry: number } | null {
  const live = markets
    .filter(isBinaryMarket)
    .filter(
      (m) =>
        m.asset === asset &&
        m.venueId === process.env.NEXT_PUBLIC_VENUE_ID &&
        m.status === "Trading" &&
        m.intervalSec !== null &&
        Number(m.expiry) > nowSec,
    )
    .sort((a, b) => Number(a.expiry) - Number(b.expiry));
  const pick = live[0];
  if (!pick || pick.intervalSec === null) return null;
  return { marketId: pick.marketId, intervalSec: Number(pick.intervalSec), expiry: Number(pick.expiry) };
}

export function LiveMarketStrip() {
  const live = useLiveMarkets();
  const nowSec = useNow(5000) / 1000;

  const tiles = useMemo(() => {
    const binary = live.filter(isBinaryMarket);
    return ASSETS.map((asset) => ({ asset, market: pickCurrent(binary, asset, nowSec) }));
  }, [live, nowSec]);

  return (
    <section className="market-strip" aria-label="live markets">
      {tiles.map(({ asset, market }) =>
        market ? (
          <MarketTile
            key={market.marketId}
            marketId={market.marketId}
            asset={asset}
            intervalSec={market.intervalSec}
            expiry={market.expiry}
          />
        ) : (
          <div key={asset} className="market-tile market-tile-empty">
            <div className="market-tile-head">
              <span className="market-asset">{asset}</span>
            </div>
            <div className="market-tile-book">
              <span className="dim">no live window — waiting for the next roll</span>
            </div>
          </div>
        ),
      )}
    </section>
  );
}
