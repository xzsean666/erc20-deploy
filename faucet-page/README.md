# USDT-S Faucet

Static Cloudflare Pages faucet for the tokens in:

- `../deployments/97/USDT-S-2026-05-06T08-39-26-304Z.json`
- `../deployments/80002/USDT-S-2026-05-06T10-18-27-489Z.json`

BSC Testnet network values follow the BNB Chain docs:
https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/

## Add a token

Add a new entry to `TOKENS` in `./app.js`. The faucet UI, balance lookup,
network switch button, explorer links, mint transaction target, and wallet
`Add Token` button all follow the selected entry.

Required fields:

```js
{
  id: "network-symbol",
  name: "Token Name",
  symbol: "TOKEN",
  decimals: 18,
  address: "0x...",
  chainId: 80002,
  chainName: "Polygon Amoy",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  explorer: "https://amoy.polygonscan.com",
  rpcUrls: ["https://polygon-amoy.drpc.org"],
}
```

## Local preview

```sh
wrangler pages dev .
```

## Deploy

From this folder:

```sh
wrangler pages deploy . --project-name <your-pages-project-name>
```

From the repo root:

```sh
wrangler pages deploy faucet-page --project-name <your-pages-project-name>
```
