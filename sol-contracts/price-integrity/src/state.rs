use borsh::{BorshDeserialize, BorshSerialize};
use switchboard_on_demand::solana_program::pubkey::Pubkey;

use crate::instruction::METRIC_FEED_COUNT;

pub const CONFIG_SEED: &[u8] = b"price-integrity-config";
pub const REPORT_SEED: &[u8] = b"price-integrity-report";

pub const MIN_SCORE_BPS: u64 = 9_000;
pub const MAX_OHLC_P95_BPS: u64 = 50;
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const FLAG_LOW_SCORE: u8 = 1 << 0;
pub const FLAG_HIGH_P95: u8 = 1 << 1;

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq)]
pub struct PriceIntegrityConfig {
    pub is_initialized: bool,
    pub owner: Pubkey,
    pub quote_account: Pubkey,
    pub queue: Pubkey,
    pub max_age_slots: u64,
    pub metric_feed_ids: [[u8; 32]; METRIC_FEED_COUNT],
    pub bump: u8,
}

impl PriceIntegrityConfig {
    pub const LEN: usize = 1 + 32 + 32 + 32 + 8 + (32 * METRIC_FEED_COUNT) + 1;
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq)]
pub struct BatchReport {
    pub is_initialized: bool,
    pub epoch_id: u64,
    pub window_start: u64,
    pub candle_count: u64,
    pub internal_candles_hash: [u8; 32],
    pub chainlink_candles_hash: [u8; 32],
    pub ohlc_mae_bps: u64,
    pub ohlc_p95_bps: u64,
    pub ohlc_max_bps: u64,
    pub direction_match_bps: u64,
    pub outlier_count: u64,
    pub score_bps: u64,
    pub diff_merkle_root: [u8; 32],
    pub slot: u64,
    pub is_passed: bool,
    pub failure_flags: u8,
    pub bump: u8,
}

impl BatchReport {
    pub const LEN: usize = 1 + (8 * 10) + (32 * 3) + 1 + 1 + 1;
}
