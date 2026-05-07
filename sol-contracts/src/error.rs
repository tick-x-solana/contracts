use solana_program::{decode_error::DecodeError, program_error::ProgramError};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum PoolReserveError {
    #[error("invalid instruction")]
    InvalidInstruction = 0,
    #[error("invalid amount")]
    InvalidAmount = 1,
    #[error("unauthorized")]
    Unauthorized = 2,
    #[error("already initialized")]
    AlreadyInitialized = 3,
    #[error("uninitialized")]
    Uninitialized = 4,
    #[error("invalid pda")]
    InvalidPda = 5,
    #[error("insufficient balance")]
    InsufficientBalance = 6,
    #[error("insufficient collateral")]
    InsufficientCollateral = 7,
}

impl From<PoolReserveError> for ProgramError {
    fn from(error: PoolReserveError) -> Self {
        ProgramError::Custom(error as u32)
    }
}

impl<T> DecodeError<T> for PoolReserveError {
    fn type_of() -> &'static str {
        "PoolReserveError"
    }
}
