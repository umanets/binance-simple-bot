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
- Maintains ghost buy/sell logs in `ghost_buy_trades.json` and `ghost_sell_trades.json`: records rejected buy/sell signals for adaptive thresholding.
- Exposes service methods `getGhostBuyTrades()` and `getGhostSellTrades()` to retrieve current ghost entries.
- Computes a dynamic shrink coefficient `k` from incoming signal metrics (`atr`, `stdev`, `volRatio`, `reliability`) to adapt average-price thresholds per ticker.

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
- `ticker`: **String** — trading pair, e.g. `"BTCUSDT"`
- `direction`: **String** — `"aBuy"` or `"aSell"`
- `price`: **Number** — the asset price at signal time (recorded for logging)
- `buyCoef`: **Number** — multi-timeframe buy confidence coefficient
- `sellCoef`: **Number** — multi-timeframe sell confidence coefficient
- `atr`: **Number** — normalized ATR (e.g. ATR(14)/price)
- `stdev`: **Number** — standard deviation of log-returns
- `volRatio`: **Number** — volume / average volume (e.g. volume / sma(volume,20))
- `reliability`: **Number** — recent win rate of signals (0..1)

**Example (extended payload):**
```json
{
  "ticker":     "BTCUSDT",
  "direction":  "aBuy",
  "price":      60000,
  "buyCoef":    40,
  "sellCoef":   0,
  "atr":        0.0015,
  "stdev":      0.0250,
  "volRatio":   1.20,
  "reliability":0.78
}
```

- On a buy signal (direction: "aBuy"), the bot will:
    - Compute a dynamic shrink threshold `k` from incoming metrics (`atr`, `stdev`, `volRatio`, `reliability`) and per-ticker Fibonacci/ghost counts, then determine if the new average price meets the adjusted discount requirement.
    - If the condition fails (rejected due to average price threshold), record a *ghost buy* entry `{ticker, price}` in `ghost_buy_trades.json`.
    - Otherwise, place a spot market order for computed size, save the executed quantity and price to the trade log, and clear any ghost entries for that ticker.
- On a sell signal (direction: "aSell"), the bot will:
    - Compute dynamic threshold `k` similarly, and select sellable buy records that allow breakeven (accounting commissions).
    - If no eligible orders to sell, record a *ghost sell* entry `{ticker, price}` in `ghost_sell_trades.json`.
    - Otherwise, place a sell order, remove consumed buy-log entries, store any leftovers, clear any ghost entries for that ticker, and perform dust cleanup.

## What this service is NOT
- No signal generation or strategy logic—signals (`aBuy`/`aSell` + coefficients) must come from external sources (e.g. TradingView).
- You must provide the signal source (e.g. a TradingView webhook, custom script, or other automation).
- Not suitable for futures/margin trading. Only supports spot Binance.
  
---
  
## LLM-augmented Prediction Service

In addition to executing raw webhook signals, this bot now includes an OpenAI-based prediction layer for *buy* signals:

- **Signal Logging**: All incoming buy-signals are logged to `signals_log.json` with full feature context and recent candle history.
- **Prompt Generation**: A compact JSON prompt (with key metrics and zig-zag pivot points) is built and sent to GPT-4 to obtain entry, stop-loss, and take-profit levels.
- **Prediction Storage**: The predictions (`{ ticker, time, entry, stop_loss, take_profit, executed }`) are stored in `predictions.json`.  
  - Only **aBuy** signals trigger LLM calls; new predictions replace unexecuted entries for the same ticker.
- **Post-Processing**:  
  1. LLM stop_loss becomes the new entry price.  
  2. True stop_loss is set to the lowest zig-zag low pivot extracted from recent candles.  
  3. An `executed` flag is initialized to `false`.

## Live Prediction Executor

The `PredictionExecutorService` dynamically watches `predictions.json` and manages Binance WebSocket subscriptions:

- **Dynamic Subscriptions**: Automatically subscribes to new tickers and unsubscribes removed ones via `fs.watch`.
- **Automated BUY**: When price ≤ `entry` and `executed=false`, it places a market BUY of `(2 × minNotional/price)`, aligns to lot size, sets `executed=true`, and records actual fill quantity and average price.
- **Automated SELL**: Once `executed=true`, monitors for price ≥ `take_profit` or ≤ `stop_loss` to place a limit SELL at the trigger price for the exact bought quantity.
- **Execution Logs**: Completed buy/sell cycles are appended to `prediction-orders.json` as `{ ticker, signalTime, buyPrice, qty, sellTime, sellPrice, profit }`.
- **Signal Labeling**: Upon sell execution, the original signal in `signals_log.json` is labeled with its `profit` and written to `signals_log_labeled.json`, creating a ready-made dataset for analysis and ML.

## Data Files

- `signals_log.json`: Raw signal entries with full context for each webhook alert.  
- `signals_log_labeled.json`: Signals augmented with realized profit for EDA or ML training.  
- `predictions.json`: Latest LLM predictions per ticker (including `executed` status).  
- `prediction-orders.json`: Execution history of prediction-based trades and their P&L.

Refer to the `src` directory for full implementation details of prompt building, zig-zag pivot logic, and WebSocket handlers.