use borsh::{BorshDeserialize, BorshSerialize};
use switchboard_on_demand::{
    prelude::rust_decimal::prelude::ToPrimitive,
    solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
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
    error::PriceIntegrityError,
    instruction::{PriceIntegrityInstruction, METRIC_FEED_COUNT},
    state::{
        BatchReport, PriceIntegrityConfig, BPS_DENOMINATOR, CONFIG_SEED, FLAG_HIGH_P95,
        FLAG_LOW_SCORE, MAX_OHLC_P95_BPS, MIN_SCORE_BPS, REPORT_SEED,
    },
};

pub struct Processor;

impl Processor {
    pub fn process<'a>(
        program_id: &Pubkey,
        accounts: &'a [AccountInfo<'a>],
        instruction_data: &[u8],
    ) -> Result<(), ProgramError> {
        match PriceIntegrityInstruction::unpack(instruction_data)? {
            PriceIntegrityInstruction::Initialize {
                quote_account,
                queue,
                max_age_slots,
                metric_feed_ids,
            } => Self::process_initialize(
                program_id,
                accounts,
                quote_account,
                queue,
                max_age_slots,
                metric_feed_ids,
            ),
            PriceIntegrityInstruction::CommitSwitchboardBatchReport {
                epoch_id,
                window_start,
                candle_count,
                internal_candles_hash,
                chainlink_candles_hash,
                diff_merkle_root,
            } => Self::process_commit_switchboard_batch_report(
                program_id,
                accounts,
                epoch_id,
                window_start,
                candle_count,
                internal_candles_hash,
                chainlink_candles_hash,
                diff_merkle_root,
            ),
            PriceIntegrityInstruction::CommitDemoBatchReport {
                epoch_id,
                window_start,
                candle_count,
                internal_candles_hash,
                chainlink_candles_hash,
                diff_merkle_root,
                ohlc_mae_bps,
                ohlc_p95_bps,
                ohlc_max_bps,
                direction_match_bps,
                outlier_count,
                score_bps,
            } => Self::process_commit_demo_batch_report(
                program_id,
                accounts,
                epoch_id,
                window_start,
                candle_count,
                internal_candles_hash,
                chainlink_candles_hash,
                diff_merkle_root,
                [
                    ohlc_mae_bps,
                    ohlc_p95_bps,
                    ohlc_max_bps,
                    direction_match_bps,
                    outlier_count,
                    score_bps,
                ],
            ),
            PriceIntegrityInstruction::SetSwitchboardConfig {
                quote_account,
                queue,
                max_age_slots,
                metric_feed_ids,
            } => Self::process_set_switchboard_config(
                program_id,
                accounts,
                quote_account,
                queue,
                max_age_slots,
                metric_feed_ids,
            ),
        }
    }

    fn process_initialize<'a>(
        program_id: &Pubkey,
        accounts: &'a [AccountInfo<'a>],
        quote_account: Pubkey,
        queue: Pubkey,
        max_age_slots: u64,
        metric_feed_ids: [[u8; 32]; METRIC_FEED_COUNT],
    ) -> Result<(), ProgramError> {
        let account_info_iter = &mut accounts.iter();
        let payer = next_account_info(account_info_iter)?;
        let config_account = next_account_info(account_info_iter)?;
        let system_program_account = next_account_info(account_info_iter)?;

        if !payer.is_signer {
            return Err(PriceIntegrityError::Unauthorized.into());
        }
        if *system_program_account.key != system_program::id() {
            return Err(ProgramError::IncorrectProgramId);
        }

        let (expected_config, bump) = Pubkey::find_program_address(&[CONFIG_SEED], program_id);
        if expected_config != *config_account.key {
            return Err(PriceIntegrityError::InvalidPda.into());
        }
        if !config_account.data_is_empty() {
            return Err(PriceIntegrityError::AlreadyInitialized.into());
        }

        Self::create_pda_account(
            payer,
            config_account,
            system_program_account,
            program_id,
            PriceIntegrityConfig::LEN,
            &[CONFIG_SEED, &[bump]],
        )?;

        let config = PriceIntegrityConfig {
            is_initialized: true,
            owner: *payer.key,
            quote_account,
            queue,
            max_age_slots,
            metric_feed_ids,
            bump,
        };
        config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

        msg!("price integrity config initialized");
        Ok(())
    }

    fn process_commit_switchboard_batch_report<'a>(
        program_id: &Pubkey,
        accounts: &'a [AccountInfo<'a>],
        epoch_id: u64,
        window_start: u64,
        candle_count: u64,
        internal_candles_hash: [u8; 32],
        chainlink_candles_hash: [u8; 32],
        diff_merkle_root: [u8; 32],
    ) -> Result<(), ProgramError> {
        if candle_count == 0 {
            return Err(PriceIntegrityError::InvalidAmount.into());
        }

        let account_info_iter = &mut accounts.iter();
        let payer = next_account_info(account_info_iter)?;
        let config_account = next_account_info(account_info_iter)?;
        let report_account = next_account_info(account_info_iter)?;
        let quote_account = next_account_info(account_info_iter)?;
        let queue_account = next_account_info(account_info_iter)?;
        let clock_account = next_account_info(account_info_iter)?;
        let slothashes_account = next_account_info(account_info_iter)?;
        let instructions_account = next_account_info(account_info_iter)?;
        let system_program_account = next_account_info(account_info_iter)?;

        if !payer.is_signer {
            return Err(PriceIntegrityError::Unauthorized.into());
        }
        if *clock_account.key != solana_program::sysvar::clock::id()
            || *slothashes_account.key != slot_hashes::id()
            || *instructions_account.key != instruction_sysvar::id()
            || *system_program_account.key != system_program::id()
        {
            return Err(ProgramError::InvalidArgument);
        }

        let config = Self::load_config(program_id, config_account)?;
        if *quote_account.key != config.quote_account || *queue_account.key != config.queue {
            return Err(PriceIntegrityError::InvalidSwitchboardAccount.into());
        }

        let current_slot = Clock::from_account_info(clock_account)?.slot;
        let queue_bytes = config.queue.to_bytes();

        let verified_quote = QuoteVerifier::new()
            .queue(queue_account)
            .slothash_sysvar(slothashes_account)
            .ix_sysvar(instructions_account)
            .clock_slot(current_slot)
            .max_age(config.max_age_slots)
            .verify_account(&queue_bytes, quote_account)
            .map_err(|_| PriceIntegrityError::SwitchboardVerificationFailed)?;

        let metric_values = Self::extract_metric_values(&config.metric_feed_ids, &verified_quote)?;

        Self::store_report(
            program_id,
            payer,
            report_account,
            system_program_account,
            epoch_id,
            window_start,
            candle_count,
            internal_candles_hash,
            chainlink_candles_hash,
            diff_merkle_root,
            metric_values,
            current_slot,
        )
    }

    fn process_commit_demo_batch_report<'a>(
        program_id: &Pubkey,
        accounts: &'a [AccountInfo<'a>],
        epoch_id: u64,
        window_start: u64,
        candle_count: u64,
        internal_candles_hash: [u8; 32],
        chainlink_candles_hash: [u8; 32],
        diff_merkle_root: [u8; 32],
        metric_values: [u64; METRIC_FEED_COUNT],
    ) -> Result<(), ProgramError> {
        if candle_count == 0 {
            return Err(PriceIntegrityError::InvalidAmount.into());
        }

        let account_info_iter = &mut accounts.iter();
        let payer = next_account_info(account_info_iter)?;
        let config_account = next_account_info(account_info_iter)?;
        let report_account = next_account_info(account_info_iter)?;
        let clock_account = next_account_info(account_info_iter)?;
        let system_program_account = next_account_info(account_info_iter)?;

        if !payer.is_signer {
            return Err(PriceIntegrityError::Unauthorized.into());
        }
        if *clock_account.key != solana_program::sysvar::clock::id()
            || *system_program_account.key != system_program::id()
        {
            return Err(ProgramError::InvalidArgument);
        }

        let config = Self::load_config(program_id, config_account)?;
        if config.owner != *payer.key {
            return Err(PriceIntegrityError::Unauthorized.into());
        }

        Self::store_report(
            program_id,
            payer,
            report_account,
            system_program_account,
            epoch_id,
            window_start,
            candle_count,
            internal_candles_hash,
            chainlink_candles_hash,
            diff_merkle_root,
            metric_values,
            Clock::from_account_info(clock_account)?.slot,
        )?;

        msg!("demo price integrity batch committed");
        Ok(())
    }

    fn process_set_switchboard_config<'a>(
        program_id: &Pubkey,
        accounts: &'a [AccountInfo<'a>],
        quote_account: Pubkey,
        queue: Pubkey,
        max_age_slots: u64,
        metric_feed_ids: [[u8; 32]; METRIC_FEED_COUNT],
    ) -> Result<(), ProgramError> {
        let account_info_iter = &mut accounts.iter();
        let owner = next_account_info(account_info_iter)?;
        let config_account = next_account_info(account_info_iter)?;

        if !owner.is_signer {
            return Err(PriceIntegrityError::Unauthorized.into());
        }

        let mut config = Self::load_config(program_id, config_account)?;
        if config.owner != *owner.key {
            return Err(PriceIntegrityError::Unauthorized.into());
        }

        config.quote_account = quote_account;
        config.queue = queue;
        config.max_age_slots = max_age_slots;
        config.metric_feed_ids = metric_feed_ids;
        config.serialize(&mut &mut config_account.data.borrow_mut()[..])?;

        msg!("switchboard config updated");
        Ok(())
    }

    fn load_config<'a>(
        program_id: &Pubkey,
        config_account: &'a AccountInfo<'a>,
    ) -> Result<PriceIntegrityConfig, ProgramError> {
        let (expected_config, _) = Pubkey::find_program_address(&[CONFIG_SEED], program_id);
        if expected_config != *config_account.key {
            return Err(PriceIntegrityError::InvalidPda.into());
        }
        if config_account.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }

        let config = PriceIntegrityConfig::try_from_slice(&config_account.data.borrow())?;
        if !config.is_initialized {
            return Err(PriceIntegrityError::Uninitialized.into());
        }

        Ok(config)
    }

    fn extract_metric_values(
        expected_feed_ids: &[[u8; 32]; METRIC_FEED_COUNT],
        verified_quote: &switchboard_on_demand::OracleQuote<'_>,
    ) -> Result<[u64; METRIC_FEED_COUNT], ProgramError> {
        let mut values = [0_u64; METRIC_FEED_COUNT];

        for (idx, expected_feed_id) in expected_feed_ids.iter().enumerate() {
            let feed = verified_quote
                .feed(expected_feed_id)
                .map_err(|_| PriceIntegrityError::MissingFeed)?;

            if feed.feed_value() < 0 {
                return Err(PriceIntegrityError::InvalidMetricBounds.into());
            }

            values[idx] = feed
                .value()
                .to_u64()
                .ok_or(PriceIntegrityError::InvalidMetricBounds)?;
        }

        Ok(values)
    }

    fn compute_failure_flags(score_bps: u64, ohlc_p95_bps: u64) -> u8 {
        let mut flags = 0_u8;
        if score_bps < MIN_SCORE_BPS {
            flags |= FLAG_LOW_SCORE;
        }
        if ohlc_p95_bps > MAX_OHLC_P95_BPS {
            flags |= FLAG_HIGH_P95;
        }
        flags
    }

    #[allow(clippy::too_many_arguments)]
    fn store_report<'a>(
        program_id: &Pubkey,
        payer: &AccountInfo<'a>,
        report_account: &AccountInfo<'a>,
        system_program_account: &AccountInfo<'a>,
        epoch_id: u64,
        window_start: u64,
        candle_count: u64,
        internal_candles_hash: [u8; 32],
        chainlink_candles_hash: [u8; 32],
        diff_merkle_root: [u8; 32],
        metric_values: [u64; METRIC_FEED_COUNT],
        current_slot: u64,
    ) -> Result<(), ProgramError> {
        let direction_match_bps = metric_values[3];
        let outlier_count = metric_values[4];
        if direction_match_bps > BPS_DENOMINATOR || outlier_count > candle_count {
            return Err(PriceIntegrityError::InvalidMetricBounds.into());
        }

        let failure_flags = Self::compute_failure_flags(metric_values[5], metric_values[1]);
        let is_passed = failure_flags == 0;

        let epoch_bytes = epoch_id.to_le_bytes();
        let (expected_report, bump) =
            Pubkey::find_program_address(&[REPORT_SEED, &epoch_bytes], program_id);
        if expected_report != *report_account.key {
            return Err(PriceIntegrityError::InvalidPda.into());
        }

        if report_account.data_is_empty() {
            Self::create_pda_account(
                payer,
                report_account,
                system_program_account,
                program_id,
                BatchReport::LEN,
                &[REPORT_SEED, &epoch_bytes, &[bump]],
            )?;
        }

        let report = BatchReport {
            is_initialized: true,
            epoch_id,
            window_start,
            candle_count,
            internal_candles_hash,
            chainlink_candles_hash,
            ohlc_mae_bps: metric_values[0],
            ohlc_p95_bps: metric_values[1],
            ohlc_max_bps: metric_values[2],
            direction_match_bps,
            outlier_count,
            score_bps: metric_values[5],
            diff_merkle_root,
            slot: current_slot,
            is_passed,
            failure_flags,
            bump,
        };

        report.serialize(&mut &mut report_account.data.borrow_mut()[..])?;

        msg!("price integrity batch committed");
        msg!("epoch_id={}", epoch_id);
        msg!("score_bps={}", report.score_bps);
        msg!("ohlc_p95_bps={}", report.ohlc_p95_bps);
        msg!("is_passed={}", report.is_passed as u8);

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
