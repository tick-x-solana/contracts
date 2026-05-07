use borsh::{BorshDeserialize, BorshSerialize};
use switchboard_on_demand::solana_program::{program_error::ProgramError, pubkey::Pubkey};

use crate::error::PriceIntegrityError;

pub const METRIC_FEED_COUNT: usize = 6;

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq)]
pub enum PriceIntegrityInstruction {
    Initialize {
        quote_account: Pubkey,
        queue: Pubkey,
        max_age_slots: u64,
        metric_feed_ids: [[u8; 32]; METRIC_FEED_COUNT],
    },
    CommitSwitchboardBatchReport {
        epoch_id: u64,
        window_start: u64,
        candle_count: u64,
        internal_candles_hash: [u8; 32],
        chainlink_candles_hash: [u8; 32],
        diff_merkle_root: [u8; 32],
    },
    SetSwitchboardConfig {
        quote_account: Pubkey,
        queue: Pubkey,
        max_age_slots: u64,
        metric_feed_ids: [[u8; 32]; METRIC_FEED_COUNT],
    },
    CommitDemoBatchReport {
        epoch_id: u64,
        window_start: u64,
        candle_count: u64,
        internal_candles_hash: [u8; 32],
        chainlink_candles_hash: [u8; 32],
        diff_merkle_root: [u8; 32],
        ohlc_mae_bps: u64,
        ohlc_p95_bps: u64,
        ohlc_max_bps: u64,
        direction_match_bps: u64,
        outlier_count: u64,
        score_bps: u64,
    },
}

impl PriceIntegrityInstruction {
    pub fn unpack(input: &[u8]) -> Result<Self, ProgramError> {
        Self::try_from_slice(input).map_err(|_| PriceIntegrityError::InvalidInstruction.into())
    }
}
