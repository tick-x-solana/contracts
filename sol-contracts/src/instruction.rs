use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{program_error::ProgramError, pubkey::Pubkey};

use crate::error::PoolReserveError;

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq)]
pub enum PoolReserveInstruction {
    Initialize { claim_signer: Pubkey },
    DepositTrader { amount: u64 },
    ClaimTrader { amount: u64 },
    SetClaimSigner { new_claim_signer: Pubkey },
}

impl PoolReserveInstruction {
    pub fn unpack(input: &[u8]) -> Result<Self, ProgramError> {
        Self::try_from_slice(input).map_err(|_| PoolReserveError::InvalidInstruction.into())
    }
}
