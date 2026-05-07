use borsh::{BorshDeserialize, BorshSerialize};
use switchboard_on_demand::{
    prelude::rust_decimal::prelude::ToPrimitive,
    solana_program::{
        account_info::{next_account_info, AccountInfo},
        clock::Clock,
        hash::hashv,
        msg,
        program::invoke_signed,
        program_error::ProgramError,
        pubkey::Pubkey,
        rent::Rent,
        system_instruction, system_program,
        sysvar::{instructions as instruction_sysvar, slot_hashes, Sysvar},
    },
    QuoteVerifier,
};

use crate::{
    error::SettlementError,
    instruction::{SettlementInstruction, SETTLEMENT_FEED_COUNT},
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
            SettlementInstruction::Initialize {
                quote_account,
                queue,
                max_age_slots,
                field_feed_ids,
            } => Self::process_initialize(
                program_id,
                accounts,
                quote_account,
                queue,
                max_age_slots,
                field_feed_ids,
            ),
            SettlementInstruction::CommitSwitchboardSettlementBatch { batch_id } => {
                Self::process_commit_switchboard_settlement_batch(program_id, accounts, batch_id)
            }
            SettlementInstruction::SetSwitchboardConfig {
                quote_account,
                queue,
                max_age_slots,
                field_feed_ids,
            } => Self::process_set_switchboard_config(
                program_id,
                accounts,
                quote_account,
                queue,
                max_age_slots,
                field_feed_ids,
            ),
            SettlementInstruction::CommitDemoSettlementBatch {
                batch_id,
                merkle_root,
                total_payout,
                withdrawable_cap,
                window_start,
                window_end,
            } => Self::process_commit_demo_settlement_batch(
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
        quote_account: Pubkey,
        queue: Pubkey,
        max_age_slots: u64,
        field_feed_ids: [[u8; 32]; SETTLEMENT_FEED_COUNT],
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
            quote_account,
            queue,
            max_age_slots,
            field_feed_ids,
            batch_count: 0,
            bump,
        };
        config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

        msg!("settlement config initialized");
        Ok(())
    }

    fn process_commit_switchboard_settlement_batch<'a>(
        program_id: &Pubkey,
        accounts: &'a [AccountInfo<'a>],
        expected_batch_id: [u8; 32],
    ) -> Result<(), ProgramError> {
        let account_info_iter = &mut accounts.iter();
        let payer = next_account_info(account_info_iter)?;
        let config_account = next_account_info(account_info_iter)?;
        let batch_account = next_account_info(account_info_iter)?;
        let _quote_account = next_account_info(account_info_iter)?;
        let queue_account = next_account_info(account_info_iter)?;
        let clock_account = next_account_info(account_info_iter)?;
        let slothashes_account = next_account_info(account_info_iter)?;
        let instructions_account = next_account_info(account_info_iter)?;
        let system_program_account = next_account_info(account_info_iter)?;

        if !payer.is_signer {
            return Err(SettlementError::Unauthorized.into());
        }
        if *clock_account.key != solana_program::sysvar::clock::id()
            || *slothashes_account.key != slot_hashes::id()
            || *instructions_account.key != instruction_sysvar::id()
            || *system_program_account.key != system_program::id()
        {
            return Err(ProgramError::InvalidArgument);
        }

        let mut config = Self::load_config(program_id, config_account)?;
        if config.owner != *payer.key {
            return Err(SettlementError::Unauthorized.into());
        }
        if *queue_account.key != config.queue {
            return Err(SettlementError::InvalidSwitchboardAccount.into());
        }

        let current_slot = Clock::from_account_info(clock_account)?.slot;
        let verified_quote = QuoteVerifier::new()
            .queue(queue_account)
            .slothash_sysvar(slothashes_account)
            .ix_sysvar(instructions_account)
            .clock_slot(current_slot)
            .max_age(config.max_age_slots)
            .verify_instruction_at(0)
            .map_err(|_| SettlementError::SwitchboardVerificationFailed)?;

        let values = Self::extract_field_values(&config.field_feed_ids, &verified_quote)?;
        let merkle_root = Self::decode_bytes32_from_chunks(&values[0..8])?;
        let total_payout = values[8];
        let withdrawable_cap = values[9];
        let window_start = values[10];
        let window_end = values[11];
        let batch_id = Self::derive_batch_id(
            &merkle_root,
            total_payout,
            withdrawable_cap,
            window_start,
            window_end,
        );
        if batch_id != expected_batch_id {
            return Err(SettlementError::InvalidFeedEncoding.into());
        }

        Self::store_batch(
            program_id,
            payer,
            system_program_account,
            batch_account,
            &mut config,
            batch_id,
            merkle_root,
            total_payout,
            withdrawable_cap,
            window_start,
            window_end,
            Clock::from_account_info(clock_account)?.unix_timestamp,
        )?;
        config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn process_commit_demo_settlement_batch<'a>(
        program_id: &Pubkey,
        accounts: &'a [AccountInfo<'a>],
        batch_id: [u8; 32],
        merkle_root: [u8; 32],
        total_payout: u64,
        withdrawable_cap: u64,
        window_start: u64,
        window_end: u64,
    ) -> Result<(), ProgramError> {
        let account_info_iter = &mut accounts.iter();
        let payer = next_account_info(account_info_iter)?;
        let config_account = next_account_info(account_info_iter)?;
        let batch_account = next_account_info(account_info_iter)?;
        let system_program_account = next_account_info(account_info_iter)?;
        let clock_account = next_account_info(account_info_iter)?;

        if !payer.is_signer {
            return Err(SettlementError::Unauthorized.into());
        }
        if *clock_account.key != solana_program::sysvar::clock::id()
            || *system_program_account.key != system_program::id()
        {
            return Err(ProgramError::InvalidArgument);
        }

        let mut config = Self::load_config(program_id, config_account)?;
        if config.owner != *payer.key {
            return Err(SettlementError::Unauthorized.into());
        }

        Self::store_batch(
            program_id,
            payer,
            system_program_account,
            batch_account,
            &mut config,
            batch_id,
            merkle_root,
            total_payout,
            withdrawable_cap,
            window_start,
            window_end,
            Clock::from_account_info(clock_account)?.unix_timestamp,
        )?;
        config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;
        Ok(())
    }

    fn process_set_switchboard_config<'a>(
        program_id: &Pubkey,
        accounts: &'a [AccountInfo<'a>],
        quote_account: Pubkey,
        queue: Pubkey,
        max_age_slots: u64,
        field_feed_ids: [[u8; 32]; SETTLEMENT_FEED_COUNT],
    ) -> Result<(), ProgramError> {
        let account_info_iter = &mut accounts.iter();
        let owner = next_account_info(account_info_iter)?;
        let config_account = next_account_info(account_info_iter)?;

        if !owner.is_signer {
            return Err(SettlementError::Unauthorized.into());
        }

        let mut config = Self::load_config(program_id, config_account)?;
        if config.owner != *owner.key {
            return Err(SettlementError::Unauthorized.into());
        }

        config.quote_account = quote_account;
        config.queue = queue;
        config.max_age_slots = max_age_slots;
        config.field_feed_ids = field_feed_ids;
        config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

        msg!("settlement switchboard config updated");
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

        let (expected_paid, bump) =
            Pubkey::find_program_address(&[PAID_SEED, &batch_id, beneficiary.key.as_ref()], program_id);
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

    fn extract_field_values(
        expected_feed_ids: &[[u8; 32]; SETTLEMENT_FEED_COUNT],
        verified_quote: &switchboard_on_demand::OracleQuote<'_>,
    ) -> Result<[u64; SETTLEMENT_FEED_COUNT], ProgramError> {
        let mut values = [0_u64; SETTLEMENT_FEED_COUNT];
        for (idx, expected_feed_id) in expected_feed_ids.iter().enumerate() {
            let feed = verified_quote
                .feed(expected_feed_id)
                .map_err(|_| SettlementError::MissingFeed)?;
            if feed.feed_value() < 0 {
                return Err(SettlementError::InvalidFeedEncoding.into());
            }
            values[idx] = feed
                .value()
                .to_u64()
                .ok_or(SettlementError::InvalidFeedEncoding)?;
        }
        Ok(values)
    }

    fn decode_bytes32_from_chunks(chunks: &[u64]) -> Result<[u8; 32], ProgramError> {
        const CHUNK_WIDTHS: [usize; 8] = [4, 4, 4, 4, 4, 4, 4, 4];

        if chunks.len() != CHUNK_WIDTHS.len() {
            return Err(SettlementError::InvalidFeedEncoding.into());
        }

        let mut out = [0_u8; 32];
        let mut cursor = 0_usize;
        for (index, chunk) in chunks.iter().enumerate() {
            let width = CHUNK_WIDTHS[index];
            let bytes = chunk.to_be_bytes();
            out[cursor..cursor + width].copy_from_slice(&bytes[8 - width..]);
            cursor += width;
        }
        Ok(out)
    }

    fn derive_batch_id(
        merkle_root: &[u8; 32],
        total_payout: u64,
        withdrawable_cap: u64,
        window_start: u64,
        window_end: u64,
    ) -> [u8; 32] {
        hashv(&[
            merkle_root.as_ref(),
            &total_payout.to_be_bytes(),
            &withdrawable_cap.to_be_bytes(),
            &window_start.to_be_bytes(),
            &window_end.to_be_bytes(),
        ])
        .to_bytes()
    }

    #[allow(clippy::too_many_arguments)]
    fn store_batch<'a>(
        program_id: &Pubkey,
        payer: &AccountInfo<'a>,
        system_program_account: &AccountInfo<'a>,
        batch_account: &AccountInfo<'a>,
        config: &mut SettlementConfig,
        batch_id: [u8; 32],
        merkle_root: [u8; 32],
        total_payout: u64,
        withdrawable_cap: u64,
        window_start: u64,
        window_end: u64,
        committed_at: i64,
    ) -> Result<(), ProgramError> {
        if batch_id == [0_u8; 32] {
            return Err(SettlementError::InvalidAmount.into());
        }
        if window_end <= window_start {
            return Err(SettlementError::InvalidWindow.into());
        }

        let (expected_batch, bump) = Pubkey::find_program_address(&[BATCH_SEED, &batch_id], program_id);
        if expected_batch != *batch_account.key {
            return Err(SettlementError::InvalidPda.into());
        }
        if !batch_account.data_is_empty() {
            return Err(SettlementError::DuplicateBatchId.into());
        }

        Self::create_pda_account(
            payer,
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
            committed_at,
            bump,
        };
        batch.serialize(&mut &mut batch_account.data.borrow_mut()[..])?;

        config.batch_count = config
            .batch_count
            .checked_add(1)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        msg!("settlement batch committed");
        Ok(())
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
