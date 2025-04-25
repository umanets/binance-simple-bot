# Binance Simple Signal Executor Bot

## Description

This is a minimal REST backend service built with NestJS designed to act as a signal endpoint and trade executor for spot Binance accounts.

- **No strategies or indicators are included or executed in this code.**
- Receives buy/sell requests as standardized webhook payloads (for example, from TradingView or external script).
- Executes spot buy or sell operations on Binance.
- Logs each buy trade to a local JSON file.
- Aggregates, retrieves, and deletes buy records to handle sells accurately.
- Implements basic protection to avoid selling at a loss (commission-aware).

---

## Features

- **POST /api/alert** — accepts trade alerts (buy/sell) from webhooks.
- Places market orders on your Binance spot account.
- Keeps a local JSON log of all buy trades, for proper sell matching.
- Handles partial fills, aggregation, proper lot size normalization, and dust-logic.
- The logic is stateless: every buy trade is stored, not calculated from position.
- **No trading strategy/decision-making is implemented.**  
  This service acts only as a trade execution and logging backend.

---

## Setup

1. **Clone and install:**
    ```bash
    git clone https://github.com/your-username/your-bot-repo.git
    cd your-bot-repo
    npm install
    ```
2. **Create a `.env` file with your Binance credentials:**
    ```
    BINANCE_API_KEY=yourKey
    BINANCE_API_SECRET=yourSecret
    ```
3. **Start the server:**
    ```
    npm run start
    ```
4. (Optional) Adjust webhook route or log file path in code if necessary.

---

## Usage

**POST** a JSON payload to `/api/alert`

**Payload parameters:**
- `ticker`: trading pair, e.g. `"BTCUSDT"`
- `direction`: `"aBuy"` or `"aSell"`
- `price`: **Number** — the asset price at signal time (recorded for logging)
- `buyCoef`: **Number** — multi-timeframe buy confidence coefficient
- `sellCoef`: **Number** — multi-timeframe sell confidence coefficient

**Example:**
```json
{
  "ticker": "BTCUSDT",
  "direction": "aBuy",
  "price": 45000,
  "buyCoef": 12,
  "sellCoef": 5
}
```

- On a buy signal (direction: "aBuy"), the bot will:
    - Compute position size from total USDT balance, confidence coefficients (buyCoef/sellCoef), and step-size, then place a spot market order accordingly.
    - Save the actual executed quantity and price to the local trade log (JSON file).
- On a sell signal (direction: "aSell"), the bot will:
    - Retrieve previous buy trades for the ticker.
    - Aggregate buy records and execute a sell only if breakeven (with commission) is possible.
    - Remove matching buy trades from the log upon selling.

## What this service is NOT
- No signal generation or strategy logic—signals (`aBuy`/`aSell` + coefficients) must come from external sources (e.g. TradingView).
- You must provide the signal source (e.g. a TradingView webhook, custom script, or other automation).
- Not suitable for futures/margin trading. Only supports spot Binance.