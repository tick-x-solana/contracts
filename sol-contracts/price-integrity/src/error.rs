use switchboard_on_demand::solana_program::{decode_error::DecodeError, program_error::ProgramError};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum PriceIntegrityError {
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
    #[error("invalid metric bounds")]
    InvalidMetricBounds = 5,
    #[error("invalid amount")]
    InvalidAmount = 6,
    #[error("missing switchboard feed")]
    MissingFeed = 7,
    #[error("invalid switchboard account")]
    InvalidSwitchboardAccount = 8,
    #[error("switchboard verification failed")]
    SwitchboardVerificationFailed = 9,
}

impl From<PriceIntegrityError> for ProgramError {
    fn from(error: PriceIntegrityError) -> Self {
        ProgramError::Custom(error as u32)
    }
}

impl<T> DecodeError<T> for PriceIntegrityError {
    fn type_of() -> &'static str {
        "PriceIntegrityError"
    }
}
