import type { BinaryBookParams, SomniaMarkets } from "@somnia-chain/markets-sdk";
import { ORDER_TYPE, type PlaceOrderResult } from "@somnia-chain/markets-sdk";
import { errText } from "@certus/shared";

export type BinarySide = "BUY_YES" | "SELL_YES" | "BUY_NO" | "SELL_NO";

export interface Grid {
  one: bigint;
  tick: bigint;
  lot: bigint;
  minQuantity: bigint;
}

export class OrderDesk {
  private readonly exchange: SomniaMarkets;
  private readonly gridCache = new Map<string, Grid>();

  constructor(exchange: SomniaMarkets) {
    this.exchange = exchange;
  }

  async grid(pool: `0x${string}`, decimals: number): Promise<Grid> {
    const key = `${pool.toLowerCase()}:${decimals}`;
    const cached = this.gridCache.get(key);
    if (cached) return cached;
    const params: BinaryBookParams = await this.exchange.client.getBinaryBookParams(pool);
    const grid: Grid = {
      one: 10n ** BigInt(decimals),
      tick: params.tickSize,
      lot: params.lotSize,
      minQuantity: params.minQuantity,
    };
    this.gridCache.set(key, grid);
    return grid;
  }

  ticks(prob: number, grid: Grid): bigint | null {
    if (prob <= 0 || prob >= 1) return null;
    const steps = BigInt(Math.round((prob * Number(grid.one)) / Number(grid.tick)));
    const price = steps * grid.tick;
    if (price <= 0n || price >= grid.one) return null;
    return price;
  }

  lots(contracts: number, grid: Grid): bigint {
    const raw = BigInt(Math.floor(contracts * Number(grid.one)));
    return (raw / grid.lot) * grid.lot;
  }

  yesPriceForSide(side: BinarySide, prob: number, grid: Grid): bigint | null {
    if (side === "BUY_YES" || side === "SELL_YES") return this.ticks(prob, grid);
    const noProb = 1 - prob;
    const noPrice = this.ticks(noProb, grid);
    if (noPrice === null) return null;
    return grid.one - noPrice;
  }

  escrowCollateral(side: BinarySide, price: bigint, quantity: bigint, grid: Grid): bigint {
    if (side === "BUY_YES") return (quantity * price) / grid.one;
    if (side === "BUY_NO") return (quantity * (grid.one - price)) / grid.one;
    return 0n;
  }

  async place(
    pool: `0x${string}`,
    side: BinarySide,
    price: bigint,
    quantity: bigint,
    orderType: number,
    expireTimestampNs: bigint,
  ): Promise<PlaceOrderResult> {
    const res = await this.exchange.trader.placeOrder({
      pool,
      side,
      price,
      quantity,
      orderType,
      expireTimestampNs,
    });
    if (res.receipt.status === "reverted") {
      throw new Error(`order reverted on-chain: tx ${res.hash}`);
    }
    return res;
  }

  async cancel(pool: `0x${string}`, orderId: bigint): Promise<boolean> {
    try {
      const res = await this.exchange.trader.cancelOrder({ pool, orderId });
      if (res.receipt.status === "reverted") {
        console.error(`cancel reverted on-chain: order ${orderId} tx ${res.hash}`);
        return false;
      }
      return true;
    } catch (err) {
      console.error(`cancel failed order ${orderId}: ${errText(err).split("\n")[0]}`);
      return false;
    }
  }
}

export function isPostOnlyCross(err: unknown): boolean {
  return /PostOnlyWouldCross/i.test(errText(err));
}

export function orderTypeLabel(orderType: number): string {
  switch (orderType) {
    case ORDER_TYPE.MARKET:
      return "IOC";
    case ORDER_TYPE.POST_ONLY:
      return "POST_ONLY";
    case ORDER_TYPE.FILL_OR_KILL:
      return "FOK";
    default:
      return "LIMIT";
  }
}
