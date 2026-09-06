export const NETWORK_NAME = "testnet" as const;
export const CHAIN_ID = 50312;
export const COLLATERAL_SYMBOL = "USDso";

export const DEFAULT_RPC_URL = "https://dream-rpc.somnia.network";
export const DEFAULT_WS_RPC_URL = "wss://api.infra.testnet.somnia.network/ws";
export const DEFAULT_INDEXER_URL = "https://dev.smk.somnia.host/v1/graphql";
export const DEFAULT_EXPLORER_URL = "https://shannon-explorer.somnia.network";
export const DEFAULT_VENUE_ID =
  "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";

export const ORACLE_QUESTION_URL_PREFIX =
  "https://prd.oracle.somnia.host/questions/";

export function explorerTxUrl(hash: string, explorer = DEFAULT_EXPLORER_URL) {
  return `${explorer}/tx/${hash}`;
}

export function explorerAddressUrl(
  address: string,
  explorer = DEFAULT_EXPLORER_URL,
) {
  return `${explorer}/address/${address}`;
}

export function oracleQuestionUrl(
  oracleQuestionId: string,
  prefix = ORACLE_QUESTION_URL_PREFIX,
) {
  return `${prefix}${oracleQuestionId}`;
}

export const ORDER_EXPIRY_SEC = 300;
export const MIN_SECONDS_TO_EXPIRY = 300;
export const TESTNET_COLLATERAL_DECIMALS = 6;
export const MAINNET_COLLATERAL_DECIMALS = 18;
