use std::error::Error;

use borsh::BorshDeserialize;
use tickx_price_integrity_sol::state::BatchReport;

#[path = "../common.rs"]
mod common;

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    let client_args = common::parse_client_args(&args)?;
    let epoch_id = common::get_flag_value(&args, "--epoch-id")?.parse::<u64>()?;

    let rpc_client = common::rpc_client(&client_args.rpc_url);
    let (report_pda, _) = common::report_pda(&client_args.program_id, epoch_id);
    let account = rpc_client.get_account(&report_pda)?;
    let report = BatchReport::try_from_slice(&account.data)?;

    println!("program_id={}", client_args.program_id);
    println!("report_pda={}", report_pda);
    println!("epoch_id={}", report.epoch_id);
    println!("window_start={}", report.window_start);
    println!("candle_count={}", report.candle_count);
    println!("ohlc_mae_bps={}", report.ohlc_mae_bps);
    println!("ohlc_p95_bps={}", report.ohlc_p95_bps);
    println!("ohlc_max_bps={}", report.ohlc_max_bps);
    println!("direction_match_bps={}", report.direction_match_bps);
    println!("outlier_count={}", report.outlier_count);
    println!("score_bps={}", report.score_bps);
    println!("is_passed={}", report.is_passed);
    println!("failure_flags={}", report.failure_flags);
    println!("slot={}", report.slot);
    println!(
        "internal_candles_hash=0x{}",
        report
            .internal_candles_hash
            .iter()
            .map(|byte| format!("{:02x}", byte))
            .collect::<String>()
    );
    println!(
        "chainlink_candles_hash=0x{}",
        report
            .chainlink_candles_hash
            .iter()
            .map(|byte| format!("{:02x}", byte))
            .collect::<String>()
    );
    println!(
        "diff_merkle_root=0x{}",
        report
            .diff_merkle_root
            .iter()
            .map(|byte| format!("{:02x}", byte))
            .collect::<String>()
    );

    Ok(())
}
