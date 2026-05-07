use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

pub const CONFIG_SEED: &[u8] = b"pool-reserve-config";
pub const VAULT_SEED: &[u8] = b"pool-reserve-vault";
pub const TRADER_POSITION_SEED: &[u8] = b"trader-position";

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq)]
pub struct ReserveConfig {
    pub is_initialized: bool,
    pub owner: Pubkey,
    pub claim_signer: Pubkey,
    pub total_trader_deposits: u64,
    pub config_bump: u8,
    pub vault_bump: u8,
}

impl ReserveConfig {
    pub const LEN: usize = 1 + 32 + 32 + 8 + 1 + 1;
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq)]
pub struct TraderPosition {
    pub is_initialized: bool,
    pub trader: Pubkey,
    pub balance: u64,
    pub nonce: u64,
    pub bump: u8,
}

impl TraderPosition {
    pub const LEN: usize = 1 + 32 + 8 + 8 + 1;
}

