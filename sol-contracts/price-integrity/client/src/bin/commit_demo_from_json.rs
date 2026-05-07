use std::{error::Error, fs};

use serde::Deserialize;
use solana_sdk::signer::Signer;
use tickx_price_integrity_sol::instruction::PriceIntegrityInstruction;

#[path = "../common.rs"]
mod common;

#[derive(Deserialize)]
struct DeploymentConfig {
    #[serde(rename = "syntheticSnapshot")]
    synthetic_snapshot: SyntheticSnapshot,
}

#[derive(Deserialize)]
struct SyntheticSnapshot {
    #[serde(rename = "epochId")]
    epoch_id: u64,
    #[serde(rename = "windowStart")]
    window_start: u64,
    #[serde(rename = "candleCount")]
    candle_count: u64,
    #[serde(rename = "internalCandlesHash")]
    internal_candles_hash: String,
    #[serde(rename = "chainlinkCandlesHash")]
    chainlink_candles_hash: String,
    metrics: SyntheticMetrics,
}

#[derive(Deserialize)]
struct SyntheticMetrics {
    #[serde(rename = "ohlcMaeBps")]
    ohlc_mae_bps: u64,
    #[serde(rename = "ohlcP95Bps")]
    ohlc_p95_bps: u64,
    #[serde(rename = "ohlcMaxBps")]
    ohlc_max_bps: u64,
    #[serde(rename = "directionMatchBps")]
    direction_match_bps: u64,
    #[serde(rename = "outlierCount")]
    outlier_count: u64,
    #[serde(rename = "scoreBps")]
    score_bps: u64,
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    let client_args = common::parse_client_args(&args)?;
    let config_path = common::get_flag_value(&args, "--config-json")?;
    let diff_merkle_root = common::parse_hash_32(&args, "--diff-merkle-root")?;

    let deployment: DeploymentConfig = serde_json::from_str(&fs::read_to_string(&config_path)?)?;
    let snapshot = deployment.synthetic_snapshot;

    let rpc_client = common::rpc_client(&client_args.rpc_url);
    let payer = common::load_keypair(&client_args.payer_path)?;
    let (config, _) = common::config_pda(&client_args.program_id);
    let (report, _) = common::report_pda(&client_args.program_id, snapshot.epoch_id);

    let instruction = common::build_instruction(
        client_args.program_id,
        PriceIntegrityInstruction::CommitDemoBatchReport {
            epoch_id: snapshot.epoch_id,
            window_start: snapshot.window_start,
            candle_count: snapshot.candle_count,
            internal_candles_hash: common::parse_hex_32(&snapshot.internal_candles_hash)?,
            chainlink_candles_hash: common::parse_hex_32(&snapshot.chainlink_candles_hash)?,
            diff_merkle_root,
            ohlc_mae_bps: snapshot.metrics.ohlc_mae_bps,
            ohlc_p95_bps: snapshot.metrics.ohlc_p95_bps,
            ohlc_max_bps: snapshot.metrics.ohlc_max_bps,
            direction_match_bps: snapshot.metrics.direction_match_bps,
            outlier_count: snapshot.metrics.outlier_count,
            score_bps: snapshot.metrics.score_bps,
        },
        common::commit_demo_accounts(&payer.pubkey(), &config, &report),
    )?;

    let signature = common::send_transaction(&rpc_client, &payer, &[instruction])?;

    println!("program_id={}", client_args.program_id);
    println!("config_json={}", config_path);
    println!("config_pda={}", config);
    println!("report_pda={}", report);
    println!("epoch_id={}", snapshot.epoch_id);
    println!("window_start={}", snapshot.window_start);
    println!("candle_count={}", snapshot.candle_count);
    println!("score_bps={}", snapshot.metrics.score_bps);
    println!("ohlc_p95_bps={}", snapshot.metrics.ohlc_p95_bps);
    println!("signature={}", signature);

    Ok(())
}
