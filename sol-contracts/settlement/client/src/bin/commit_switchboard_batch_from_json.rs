use std::{error::Error, fs, str::FromStr};

use serde::Deserialize;
use solana_sdk::{pubkey::Pubkey, signer::Signer};
use tickx_settlement_sol::instruction::{SettlementInstruction, SETTLEMENT_FEED_COUNT};

#[path = "../common.rs"]
mod common;

#[derive(Deserialize)]
struct CommitConfig {
    queue: String,
    #[serde(rename = "feedIds")]
    feed_ids: Vec<String>,
    #[serde(rename = "selectedBatch")]
    selected_batch: SelectedBatch,
}

#[derive(Deserialize)]
struct SelectedBatch {
    #[serde(rename = "batchId")]
    batch_id: String,
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    let client_args = common::parse_client_args(&args)?;
    let config_path = common::get_flag_value(&args, "--config-json")?;
    let config_json: CommitConfig = serde_json::from_str(&fs::read_to_string(&config_path)?)?;
    if config_json.feed_ids.len() != SETTLEMENT_FEED_COUNT {
        return Err(format!(
            "expected {} feed IDs in config, got {}",
            SETTLEMENT_FEED_COUNT,
            config_json.feed_ids.len()
        )
        .into());
    }

    let queue = Pubkey::from_str(&config_json.queue)?;
    let mut feed_ids = [[0_u8; 32]; SETTLEMENT_FEED_COUNT];
    for (idx, feed_id) in config_json.feed_ids.iter().enumerate() {
        feed_ids[idx] = common::parse_hex_32(feed_id)?;
    }
    let batch_id = common::parse_hex_32(&config_json.selected_batch.batch_id)?;
    let quote_account = common::derive_quote_account(&queue, &feed_ids);

    let rpc_client = common::rpc_client(&client_args.rpc_url);
    let payer = common::load_keypair(&client_args.payer_path)?;
    let (config, _) = common::config_pda(&client_args.program_id);
    let (batch_pda, _) = common::batch_pda(&client_args.program_id, &batch_id);

    let instruction = common::build_instruction(
        client_args.program_id,
        SettlementInstruction::CommitSwitchboardSettlementBatch { batch_id },
        common::commit_switchboard_accounts(
            &payer.pubkey(),
            &config,
            &batch_pda,
            &quote_account,
            &queue,
        ),
    )?;

    let signature = common::send_transaction(&rpc_client, &payer, &[instruction])?;
    println!("program_id={}", client_args.program_id);
    println!("config_json={}", config_path);
    println!("config_pda={}", config);
    println!("batch_pda={}", batch_pda);
    println!("quote_account={}", quote_account);
    println!("batch_id={}", config_json.selected_batch.batch_id);
    println!("signature={}", signature);
    Ok(())
}
