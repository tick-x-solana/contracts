use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction, system_program,
    sysvar::Sysvar,
};

use crate::{
    error::SettlementError,
    instruction::SettlementInstruction,
    state::{PaidRecord, SettlementBatch, SettlementConfig, BATCH_SEED, CONFIG_SEED, PAID_SEED},
};

pub struct Processor;

impl Processor {
    pub fn process<'a>(
        program_id: &Pubkey,
        accounts: &'a [AccountInfo<'a>],
        instruction_data: &[u8],
    ) -> Result<(), ProgramError> {
        match SettlementInstruction::unpack(instruction_data)? {
            SettlementInstruction::Initialize => Self::process_initialize(program_id, accounts),
            SettlementInstruction::CommitSettlementBatch {
                batch_id,
                merkle_root,
                total_payout,
                withdrawable_cap,
                window_start,
                window_end,
            } => Self::process_commit_settlement_batch(
                program_id,
                accounts,
                batch_id,
                merkle_root,
                total_payout,
                withdrawable_cap,
                window_start,
                window_end,
            ),
            SettlementInstruction::MarkPaid { batch_id, amount } => {
                Self::process_mark_paid(program_id, accounts, batch_id, amount)
            }
        }
    }

    fn process_initialize<'a>(
        program_id: &Pubkey,
        accounts: &'a [AccountInfo<'a>],
    ) -> Result<(), ProgramError> {
        let account_info_iter = &mut accounts.iter();
        let payer = next_account_info(account_info_iter)?;
        let config_account = next_account_info(account_info_iter)?;
        let system_program_account = next_account_info(account_info_iter)?;

        if !payer.is_signer {
            return Err(SettlementError::Unauthorized.into());
        }
        if *system_program_account.key != system_program::id() {
            return Err(ProgramError::IncorrectProgramId);
        }

        let (expected_config, bump) = Pubkey::find_program_address(&[CONFIG_SEED], program_id);
        if expected_config != *config_account.key {
            return Err(SettlementError::InvalidPda.into());
        }
        if !config_account.data_is_empty() {
            return Err(SettlementError::AlreadyInitialized.into());
        }

        Self::create_pda_account(
            payer,
            config_account,
            system_program_account,
            program_id,
            SettlementConfig::LEN,
            &[CONFIG_SEED, &[bump]],
        )?;

        let config = SettlementConfig {
            is_initialized: true,
            owner: *payer.key,
            batch_count: 0,
            bump,
        };
        config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

        msg!("settlement initialized");
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn process_commit_settlement_batch<'a>(
        program_id: &Pubkey,
        accounts: &'a [AccountInfo<'a>],
        batch_id: [u8; 32],
        merkle_root: [u8; 32],
        total_payout: u64,
        withdrawable_cap: u64,
        window_start: u64,
        window_end: u64,
    ) -> Result<(), ProgramError> {
        if batch_id == [0_u8; 32] {
            return Err(SettlementError::InvalidAmount.into());
        }
        if window_end <= window_start {
            return Err(SettlementError::InvalidWindow.into());
        }

        let account_info_iter = &mut accounts.iter();
        let owner = next_account_info(account_info_iter)?;
        let config_account = next_account_info(account_info_iter)?;
        let batch_account = next_account_info(account_info_iter)?;
        let system_program_account = next_account_info(account_info_iter)?;
        let clock_account = next_account_info(account_info_iter)?;

        if !owner.is_signer {
            return Err(SettlementError::Unauthorized.into());
        }
        if *system_program_account.key != system_program::id()
            || *clock_account.key != solana_program::sysvar::clock::id()
        {
            return Err(ProgramError::InvalidArgument);
        }

        let mut config = Self::load_config(program_id, config_account)?;
        if config.owner != *owner.key {
            return Err(SettlementError::Unauthorized.into());
        }

        let (expected_batch, bump) =
            Pubkey::find_program_address(&[BATCH_SEED, &batch_id], program_id);
        if expected_batch != *batch_account.key {
            return Err(SettlementError::InvalidPda.into());
        }
        if !batch_account.data_is_empty() {
            return Err(SettlementError::DuplicateBatchId.into());
        }

        Self::create_pda_account(
            owner,
            batch_account,
            system_program_account,
            program_id,
            SettlementBatch::LEN,
            &[BATCH_SEED, &batch_id, &[bump]],
        )?;

        let batch = SettlementBatch {
            is_initialized: true,
            batch_id,
            merkle_root,
            total_payout,
            withdrawable_cap,
            window_start,
            window_end,
            committed_at: Clock::from_account_info(clock_account)?.unix_timestamp,
            bump,
        };
        batch.serialize(&mut &mut batch_account.data.borrow_mut()[..])?;

        config.batch_count = config
            .batch_count
            .checked_add(1)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

        msg!("settlement batch committed");
        Ok(())
    }

    fn process_mark_paid<'a>(
        program_id: &Pubkey,
        accounts: &'a [AccountInfo<'a>],
        batch_id: [u8; 32],
        amount: u64,
    ) -> Result<(), ProgramError> {
        if amount == 0 {
            return Err(SettlementError::InvalidAmount.into());
        }

        let account_info_iter = &mut accounts.iter();
        let owner = next_account_info(account_info_iter)?;
        let beneficiary = next_account_info(account_info_iter)?;
        let config_account = next_account_info(account_info_iter)?;
        let batch_account = next_account_info(account_info_iter)?;
        let paid_account = next_account_info(account_info_iter)?;
        let system_program_account = next_account_info(account_info_iter)?;

        if !owner.is_signer {
            return Err(SettlementError::Unauthorized.into());
        }
        if *system_program_account.key != system_program::id() {
            return Err(ProgramError::IncorrectProgramId);
        }

        let config = Self::load_config(program_id, config_account)?;
        if config.owner != *owner.key {
            return Err(SettlementError::Unauthorized.into());
        }

        let (expected_batch, _) = Pubkey::find_program_address(&[BATCH_SEED, &batch_id], program_id);
        if expected_batch != *batch_account.key {
            return Err(SettlementError::InvalidPda.into());
        }
        let batch = SettlementBatch::try_from_slice(&batch_account.data.borrow())?;
        if !batch.is_initialized {
            return Err(SettlementError::Uninitialized.into());
        }

        let (expected_paid, bump) = Pubkey::find_program_address(
            &[PAID_SEED, &batch_id, beneficiary.key.as_ref()],
            program_id,
        );
        if expected_paid != *paid_account.key {
            return Err(SettlementError::InvalidPda.into());
        }

        if paid_account.data_is_empty() {
            Self::create_pda_account(
                owner,
                paid_account,
                system_program_account,
                program_id,
                PaidRecord::LEN,
                &[PAID_SEED, &batch_id, beneficiary.key.as_ref(), &[bump]],
            )?;

            let record = PaidRecord {
                is_initialized: true,
                batch_id,
                account: *beneficiary.key,
                amount: 0,
                bump,
            };
            record.serialize(&mut &mut paid_account.data.borrow_mut()[..])?;
        }

        let mut record = PaidRecord::try_from_slice(&paid_account.data.borrow())?;
        record.amount = record
            .amount
            .checked_add(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        record.serialize(&mut &mut paid_account.data.borrow_mut()[..])?;

        msg!("paid marked");
        Ok(())
    }

    fn load_config<'a>(
        program_id: &Pubkey,
        config_account: &'a AccountInfo<'a>,
    ) -> Result<SettlementConfig, ProgramError> {
        let (expected_config, _) = Pubkey::find_program_address(&[CONFIG_SEED], program_id);
        if expected_config != *config_account.key {
            return Err(SettlementError::InvalidPda.into());
        }
        if config_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }

        let config = SettlementConfig::try_from_slice(&config_account.data.borrow())?;
        if !config.is_initialized {
            return Err(SettlementError::Uninitialized.into());
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
            &[payer.clone(), new_account.clone(), system_program_account.clone()],
            &[signer_seeds],
        )?;

        Ok(())
    }
}
