export interface PredictionRecord {
  ticker: string;
  entry: number;
  stop_loss: number;
  take_profit: number;
  executed: boolean;
  executedQty?: number;
  entryExecutedPrice?: number;
  /**
   * Timestamp of the originating signal (SignalLogEntry.timestamp) — used to
   * label the exact signal row once the prediction trade completes.
   */
  timestamp: string;
}

export interface OrderLog {
  ticker: string;
  /** Original signal timestamp (from SignalLogEntry.timestamp) */
  signalTime: string;
  buyPrice: number;
  qty: number;
  sellTime: string;
  sellPrice: number;
  profit: number;
}
