use borsh::{BorshDeserialize, BorshSerialize};
use switchboard_on_demand::solana_program::{program_error::ProgramError, pubkey::Pubkey};

use crate::error::SettlementError;

pub const SETTLEMENT_FEED_COUNT: usize = 12;

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq)]
pub enum SettlementInstruction {
    Initialize {
        quote_account: Pubkey,
        queue: Pubkey,
        max_age_slots: u64,
        field_feed_ids: [[u8; 32]; SETTLEMENT_FEED_COUNT],
    },
    CommitSwitchboardSettlementBatch {
        batch_id: [u8; 32],
    },
    SetSwitchboardConfig {
        quote_account: Pubkey,
        queue: Pubkey,
        max_age_slots: u64,
        field_feed_ids: [[u8; 32]; SETTLEMENT_FEED_COUNT],
    },
    CommitDemoSettlementBatch {
        batch_id: [u8; 32],
        merkle_root: [u8; 32],
        total_payout: u64,
        withdrawable_cap: u64,
        window_start: u64,
        window_end: u64,
    },
    MarkPaid {
        batch_id: [u8; 32],
        amount: u64,
    },
}

impl SettlementInstruction {
    pub fn unpack(input: &[u8]) -> Result<Self, ProgramError> {
        Self::try_from_slice(input).map_err(|_| SettlementError::InvalidInstruction.into())
    }
}
