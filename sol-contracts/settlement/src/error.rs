use solana_program::program_error::ProgramError;
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum SettlementError {
    #[error("invalid instruction")]
    InvalidInstruction = 0,
    #[error("unauthorized")]
    Unauthorized = 1,
    #[error("already initialized")]
    AlreadyInitialized = 2,
    #[error("uninitialized")]
    Uninitialized = 3,
    #[error("invalid pda")]
    InvalidPda = 4,
    #[error("invalid amount")]
    InvalidAmount = 5,
    #[error("duplicate batch id")]
    DuplicateBatchId = 6,
    #[error("invalid window")]
    InvalidWindow = 7,
}

impl From<SettlementError> for ProgramError {
    fn from(error: SettlementError) -> Self {
        ProgramError::Custom(error as u32)
    }
}
