use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::program_error::ProgramError;

use crate::error::SettlementError;

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq)]
pub enum SettlementInstruction {
    Initialize,
    CommitSettlementBatch {
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
