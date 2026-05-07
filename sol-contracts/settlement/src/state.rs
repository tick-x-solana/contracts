use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

pub const CONFIG_SEED: &[u8] = b"settlement-config";
pub const BATCH_SEED: &[u8] = b"settlement-batch";
pub const PAID_SEED: &[u8] = b"settlement-paid";

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq)]
pub struct SettlementConfig {
    pub is_initialized: bool,
    pub owner: Pubkey,
    pub batch_count: u64,
    pub bump: u8,
}

impl SettlementConfig {
    pub const LEN: usize = 1 + 32 + 8 + 1;
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq)]
pub struct SettlementBatch {
    pub is_initialized: bool,
    pub batch_id: [u8; 32],
    pub merkle_root: [u8; 32],
    pub total_payout: u64,
    pub withdrawable_cap: u64,
    pub window_start: u64,
    pub window_end: u64,
    pub committed_at: i64,
    pub bump: u8,
}

impl SettlementBatch {
    pub const LEN: usize = 1 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1;
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq)]
pub struct PaidRecord {
    pub is_initialized: bool,
    pub batch_id: [u8; 32],
    pub account: Pubkey,
    pub amount: u64,
    pub bump: u8,
}

impl PaidRecord {
    pub const LEN: usize = 1 + 32 + 32 + 8 + 1;
}
