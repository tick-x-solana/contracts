use std::{error::Error, fs};

use serde::Deserialize;
use solana_sdk::signer::Signer;
use tickx_settlement_sol::instruction::SettlementInstruction;

#[path = "../common.rs"]
mod common;

#[derive(Deserialize)]
struct StoredBatch {
    #[serde(rename = "batchId")]
    batch_id: String,
    #[serde(rename = "merkleRoot")]
    merkle_root: String,
    #[serde(rename = "totalPayout")]
    total_payout: u64,
    #[serde(rename = "withdrawableCap")]
    withdrawable_cap: u64,
    #[serde(rename = "windowStart")]
    window_start: u64,
    #[serde(rename = "windowEnd")]
    window_end: u64,
}

#[derive(Deserialize)]
struct SettlementConfigFile {
    batches: Vec<StoredBatch>,
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    let client_args = common::parse_client_args(&args)?;
    let config_path = common::get_flag_value(&args, "--config-json")?;
    let batch_index = common::get_flag_value(&args, "--batch-index")?.parse::<usize>()?;
    let settlement_file: SettlementConfigFile = serde_json::from_str(&fs::read_to_string(&config_path)?)?;
    let batch = settlement_file
        .batches
        .get(batch_index)
        .ok_or_else(|| format!("batch index {} out of range", batch_index))?;

    let batch_id = common::parse_hex_32(&batch.batch_id)?;
    let merkle_root = common::parse_hex_32(&batch.merkle_root)?;

    let rpc_client = common::rpc_client(&client_args.rpc_url);
    let payer = common::load_keypair(&client_args.payer_path)?;
    let (config, _) = common::config_pda(&client_args.program_id);
    let (batch_pda, _) = common::batch_pda(&client_args.program_id, &batch_id);

    let instruction = common::build_instruction(
        client_args.program_id,
        SettlementInstruction::CommitDemoSettlementBatch {
            batch_id,
            merkle_root,
            total_payout: batch.total_payout,
            withdrawable_cap: batch.withdrawable_cap,
            window_start: batch.window_start,
            window_end: batch.window_end,
        },
        common::commit_accounts(&payer.pubkey(), &config, &batch_pda),
    )?;

    let signature = common::send_transaction(&rpc_client, &payer, &[instruction])?;
    println!("program_id={}", client_args.program_id);
    println!("config_json={}", config_path);
    println!("batch_index={}", batch_index);
    println!("batch_pda={}", batch_pda);
    println!("signature={}", signature);
    Ok(())
}
