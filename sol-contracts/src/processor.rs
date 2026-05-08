use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    system_program,
    sysvar::Sysvar,
};

use crate::{
    error::PoolReserveError,
    instruction::PoolReserveInstruction,
    state::{
        ReserveConfig, TraderPosition, CONFIG_SEED, TRADER_POSITION_SEED, VAULT_SEED,
    },
};

pub struct Processor;

impl Processor {
    pub fn process<'a>(
        program_id: &Pubkey,
        accounts: &'a [AccountInfo<'a>],
        instruction_data: &[u8],
    ) -> Result<(), ProgramError> {
        match PoolReserveInstruction::unpack(instruction_data)? {
            PoolReserveInstruction::Initialize { claim_signer } => {
                Self::process_initialize(program_id, accounts, claim_signer)
            }
            PoolReserveInstruction::DepositTrader { amount } => {
                Self::process_deposit_trader(program_id, accounts, amount)
            }
            PoolReserveInstruction::WithdrawTrader { amount } => {
                Self::process_withdraw_trader(program_id, accounts, amount)
            }
            PoolReserveInstruction::ClaimTrader { amount } => {
                Self::process_claim_trader(program_id, accounts, amount)
            }
            PoolReserveInstruction::SetClaimSigner { new_claim_signer } => {
                Self::process_set_claim_signer(program_id, accounts, new_claim_signer)
            }
        }
    }

    fn process_initialize<'a>(
        program_id: &Pubkey,
        accounts: &'a [AccountInfo<'a>],
        claim_signer: Pubkey,
    ) -> Result<(), ProgramError> {
        let account_info_iter = &mut accounts.iter();
        let payer = next_account_info(account_info_iter)?;
        let config_account = next_account_info(account_info_iter)?;
        let vault_account = next_account_info(account_info_iter)?;
        let system_program_account = next_account_info(account_info_iter)?;

        if !payer.is_signer {
            return Err(PoolReserveError::Unauthorized.into());
        }
        if *system_program_account.key != system_program::id() {
            return Err(ProgramError::IncorrectProgramId);
        }

        let (expected_config, config_bump) =
            Pubkey::find_program_address(&[CONFIG_SEED], program_id);
        if expected_config != *config_account.key {
            return Err(PoolReserveError::InvalidPda.into());
        }

        let (expected_vault, vault_bump) =
            Pubkey::find_program_address(&[VAULT_SEED], program_id);
        if expected_vault != *vault_account.key {
            return Err(PoolReserveError::InvalidPda.into());
        }

        if !config_account.data_is_empty()
            || (vault_account.owner == program_id && vault_account.lamports() > 0)
        {
            return Err(PoolReserveError::AlreadyInitialized.into());
        }

        Self::create_pda_account(
            payer,
            config_account,
            system_program_account,
            program_id,
            ReserveConfig::LEN,
            &[CONFIG_SEED, &[config_bump]],
        )?;

        Self::create_pda_account(
            payer,
            vault_account,
            system_program_account,
            program_id,
            0,
            &[VAULT_SEED, &[vault_bump]],
        )?;

        let config = ReserveConfig {
            is_initialized: true,
            owner: *payer.key,
            claim_signer,
            total_trader_deposits: 0,
            config_bump,
            vault_bump,
        };
        config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

        msg!("pool reserve initialized");
        Ok(())
    }

    fn process_deposit_trader<'a>(
        program_id: &Pubkey,
        accounts: &'a [AccountInfo<'a>],
        amount: u64,
    ) -> Result<(), ProgramError> {
        if amount == 0 {
            return Err(PoolReserveError::InvalidAmount.into());
        }

        let account_info_iter = &mut accounts.iter();
        let trader = next_account_info(account_info_iter)?;
        let config_account = next_account_info(account_info_iter)?;
        let trader_position_account = next_account_info(account_info_iter)?;
        let vault_account = next_account_info(account_info_iter)?;
        let system_program_account = next_account_info(account_info_iter)?;

        if !trader.is_signer {
            return Err(PoolReserveError::Unauthorized.into());
        }
        if *system_program_account.key != system_program::id() {
            return Err(ProgramError::IncorrectProgramId);
        }

        let mut config = Self::load_config(program_id, config_account, vault_account)?;
        let (expected_trader_position, trader_bump) = Pubkey::find_program_address(
            &[TRADER_POSITION_SEED, trader.key.as_ref()],
            program_id,
        );
        if expected_trader_position != *trader_position_account.key {
            return Err(PoolReserveError::InvalidPda.into());
        }

        if trader_position_account.data_is_empty() {
            Self::create_pda_account(
                trader,
                trader_position_account,
                system_program_account,
                program_id,
                TraderPosition::LEN,
                &[TRADER_POSITION_SEED, trader.key.as_ref(), &[trader_bump]],
            )?;

            let trader_position = TraderPosition {
                is_initialized: true,
                trader: *trader.key,
                balance: 0,
                nonce: 0,
                bump: trader_bump,
            };
            trader_position.serialize(&mut &mut trader_position_account.data.borrow_mut()[..])?;
        }

        let mut trader_position =
            TraderPosition::try_from_slice(&trader_position_account.data.borrow())?;
        if trader_position.trader != *trader.key {
            return Err(PoolReserveError::Unauthorized.into());
        }

        invoke(
            &system_instruction::transfer(trader.key, vault_account.key, amount),
            &[trader.clone(), vault_account.clone(), system_program_account.clone()],
        )?;

        trader_position.balance = trader_position
            .balance
            .checked_add(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        config.total_trader_deposits = config
            .total_trader_deposits
            .checked_add(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        trader_position.serialize(&mut &mut trader_position_account.data.borrow_mut()[..])?;
        config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

        msg!("trader deposited {}", amount);
        Ok(())
    }

    fn process_claim_trader<'a>(
        program_id: &Pubkey,
        accounts: &'a [AccountInfo<'a>],
        amount: u64,
    ) -> Result<(), ProgramError> {
        if amount == 0 {
            return Err(PoolReserveError::InvalidAmount.into());
        }

        let account_info_iter = &mut accounts.iter();
        let claim_signer = next_account_info(account_info_iter)?;
        let trader = next_account_info(account_info_iter)?;
        let config_account = next_account_info(account_info_iter)?;
        let trader_position_account = next_account_info(account_info_iter)?;
        let vault_account = next_account_info(account_info_iter)?;

        if !claim_signer.is_signer {
            return Err(PoolReserveError::Unauthorized.into());
        }

        let mut config = Self::load_config(program_id, config_account, vault_account)?;
        if config.claim_signer != *claim_signer.key {
            return Err(PoolReserveError::Unauthorized.into());
        }

        let (expected_trader_position, _) = Pubkey::find_program_address(
            &[TRADER_POSITION_SEED, trader.key.as_ref()],
            program_id,
        );
        if expected_trader_position != *trader_position_account.key {
            return Err(PoolReserveError::InvalidPda.into());
        }

        let mut trader_position =
            TraderPosition::try_from_slice(&trader_position_account.data.borrow())?;
        if trader_position.trader != *trader.key {
            return Err(PoolReserveError::Unauthorized.into());
        }
        if trader_position.balance < amount {
            return Err(PoolReserveError::InsufficientBalance.into());
        }

        let rent = Rent::get()?;
        let minimum_vault_balance = rent.minimum_balance(vault_account.data_len());
        let vault_lamports = vault_account.lamports();
        if vault_lamports < minimum_vault_balance.saturating_add(amount) {
            return Err(PoolReserveError::InsufficientCollateral.into());
        }

        trader_position.balance -= amount;
        trader_position.nonce = trader_position
            .nonce
            .checked_add(1)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        config.total_trader_deposits = config
            .total_trader_deposits
            .checked_sub(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        **vault_account.try_borrow_mut_lamports()? -= amount;
        **trader.try_borrow_mut_lamports()? += amount;

        trader_position.serialize(&mut &mut trader_position_account.data.borrow_mut()[..])?;
        config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

        msg!("trader claimed {}", amount);
        Ok(())
    }

    fn process_withdraw_trader<'a>(
        program_id: &Pubkey,
        accounts: &'a [AccountInfo<'a>],
        amount: u64,
    ) -> Result<(), ProgramError> {
        if amount == 0 {
            return Err(PoolReserveError::InvalidAmount.into());
        }

        let account_info_iter = &mut accounts.iter();
        let trader = next_account_info(account_info_iter)?;
        let config_account = next_account_info(account_info_iter)?;
        let trader_position_account = next_account_info(account_info_iter)?;
        let vault_account = next_account_info(account_info_iter)?;

        if !trader.is_signer {
            return Err(PoolReserveError::Unauthorized.into());
        }

        let mut config = Self::load_config(program_id, config_account, vault_account)?;
        let (expected_trader_position, _) = Pubkey::find_program_address(
            &[TRADER_POSITION_SEED, trader.key.as_ref()],
            program_id,
        );
        if expected_trader_position != *trader_position_account.key {
            return Err(PoolReserveError::InvalidPda.into());
        }

        let mut trader_position =
            TraderPosition::try_from_slice(&trader_position_account.data.borrow())?;
        if trader_position.trader != *trader.key {
            return Err(PoolReserveError::Unauthorized.into());
        }
        if trader_position.balance < amount {
            return Err(PoolReserveError::InsufficientBalance.into());
        }

        let rent = Rent::get()?;
        let minimum_vault_balance = rent.minimum_balance(vault_account.data_len());
        let vault_lamports = vault_account.lamports();
        if vault_lamports < minimum_vault_balance.saturating_add(amount) {
            return Err(PoolReserveError::InsufficientCollateral.into());
        }

        trader_position.balance -= amount;
        trader_position.nonce = trader_position
            .nonce
            .checked_add(1)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        config.total_trader_deposits = config
            .total_trader_deposits
            .checked_sub(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        **vault_account.try_borrow_mut_lamports()? -= amount;
        **trader.try_borrow_mut_lamports()? += amount;

        trader_position.serialize(&mut &mut trader_position_account.data.borrow_mut()[..])?;
        config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

        msg!("trader withdrew {}", amount);
        Ok(())
    }

    fn process_set_claim_signer<'a>(
        program_id: &Pubkey,
        accounts: &'a [AccountInfo<'a>],
        new_claim_signer: Pubkey,
    ) -> Result<(), ProgramError> {
        let account_info_iter = &mut accounts.iter();
        let owner = next_account_info(account_info_iter)?;
        let config_account = next_account_info(account_info_iter)?;
        let vault_account = next_account_info(account_info_iter)?;

        if !owner.is_signer {
            return Err(PoolReserveError::Unauthorized.into());
        }

        let mut config = Self::load_config(program_id, config_account, vault_account)?;
        if config.owner != *owner.key {
            return Err(PoolReserveError::Unauthorized.into());
        }

        config.claim_signer = new_claim_signer;
        config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

        msg!("claim signer updated");
        Ok(())
    }

    fn load_config<'a>(
        program_id: &Pubkey,
        config_account: &'a AccountInfo<'a>,
        vault_account: &'a AccountInfo<'a>,
    ) -> Result<ReserveConfig, ProgramError> {
        let (expected_config, _) = Pubkey::find_program_address(&[CONFIG_SEED], program_id);
        if expected_config != *config_account.key {
            return Err(PoolReserveError::InvalidPda.into());
        }

        let (expected_vault, _) = Pubkey::find_program_address(&[VAULT_SEED], program_id);
        if expected_vault != *vault_account.key {
            return Err(PoolReserveError::InvalidPda.into());
        }

        if config_account.owner != program_id || vault_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }

        let config = ReserveConfig::try_from_slice(&config_account.data.borrow())?;
        if !config.is_initialized {
            return Err(PoolReserveError::Uninitialized.into());
        }
        Ok(config)
    }

    fn create_pda_account<'a>(
        payer: &AccountInfo<'a>,
        new_account: &AccountInfo<'a>,
        system_program_account: &AccountInfo<'a>,
        program_id: &Pubkey,
        space: usize,
        signer_seeds: &[&[u8]],
    ) -> Result<(), ProgramError> {
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(space);

        invoke_signed(
            &system_instruction::create_account(
                payer.key,
                new_account.key,
                lamports,
                space as u64,
                program_id,
            ),
            &[
                payer.clone(),
                new_account.clone(),
                system_program_account.clone(),
            ],
            &[signer_seeds],
        )?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use borsh::{to_vec, BorshDeserialize};
    use solana_program::pubkey::Pubkey;

    use crate::{
        instruction::PoolReserveInstruction,
        state::{ReserveConfig, TraderPosition},
    };

    #[test]
    fn instruction_roundtrip() {
        let claim_signer = Pubkey::new_unique();
        let ix = PoolReserveInstruction::Initialize { claim_signer };
        let data = to_vec(&ix).unwrap();
        let decoded = PoolReserveInstruction::try_from_slice(&data).unwrap();
        assert_eq!(decoded, ix);
    }

    #[test]
    fn state_layout_roundtrip() {
        let config = ReserveConfig {
            is_initialized: true,
            owner: Pubkey::new_unique(),
            claim_signer: Pubkey::new_unique(),
            total_trader_deposits: 42,
            config_bump: 1,
            vault_bump: 2,
        };
        let trader = TraderPosition {
            is_initialized: true,
            trader: Pubkey::new_unique(),
            balance: 10,
            nonce: 1,
            bump: 3,
        };

        let config_bytes = to_vec(&config).unwrap();
        let trader_bytes = to_vec(&trader).unwrap();

        assert_eq!(
            ReserveConfig::try_from_slice(&config_bytes).unwrap(),
            config
        );
        assert_eq!(
            TraderPosition::try_from_slice(&trader_bytes).unwrap(),
            trader
        );
    }
}
