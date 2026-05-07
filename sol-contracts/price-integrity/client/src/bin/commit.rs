use std::{error::Error, str::FromStr};

use solana_sdk::{pubkey::Pubkey, signer::Signer};
use tickx_price_integrity_sol::instruction::PriceIntegrityInstruction;

#[path = "../common.rs"]
mod common;

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    let client_args = common::parse_client_args(&args)?;
    let queue = Pubkey::from_str(&common::get_flag_value(&args, "--queue")?)?;
    let epoch_id = common::get_flag_value(&args, "--epoch-id")?.parse::<u64>()?;
    let window_start = common::get_flag_value(&args, "--window-start")?.parse::<u64>()?;
    let candle_count = common::get_flag_value(&args, "--candle-count")?.parse::<u64>()?;
    let internal_candles_hash = common::parse_hash_32(&args, "--internal-candles-hash")?;
    let chainlink_candles_hash = common::parse_hash_32(&args, "--chainlink-candles-hash")?;
    let diff_merkle_root = common::parse_hash_32(&args, "--diff-merkle-root")?;

    if candle_count == 0 {
        return Err("candle-count must be greater than zero".into());
    }

    let feed_ids = common::get_optional_flag_value(&args, "--feed-ids")
        .map(|value| common::parse_feed_ids_csv(&value))
        .transpose()?;
    let quote_account = common::resolve_quote_account(&args, &queue, feed_ids.as_ref())?;

    let rpc_client = common::rpc_client(&client_args.rpc_url);
    let payer = common::load_keypair(&client_args.payer_path)?;
    let (config, _) = common::config_pda(&client_args.program_id);
    let (report, _) = common::report_pda(&client_args.program_id, epoch_id);

    let instruction = common::build_instruction(
        client_args.program_id,
        PriceIntegrityInstruction::CommitSwitchboardBatchReport {
            epoch_id,
            window_start,
            candle_count,
            internal_candles_hash,
            chainlink_candles_hash,
            diff_merkle_root,
        },
        common::commit_accounts(&payer.pubkey(), &config, &report, &quote_account, &queue),
    )?;

    let signature = common::send_transaction(&rpc_client, &payer, &[instruction])?;

    println!("program_id={}", client_args.program_id);
    println!("config_pda={}", config);
    println!("report_pda={}", report);
    println!("queue={}", queue);
    println!("quote_account={}", quote_account);
    println!("epoch_id={}", epoch_id);
    println!("window_start={}", window_start);
    println!("candle_count={}", candle_count);
    println!("signature={}", signature);

    Ok(())
}
