use std::{error::Error, str::FromStr};

use solana_sdk::{pubkey::Pubkey, signer::Signer};
use tickx_settlement_sol::instruction::SettlementInstruction;

#[path = "../common.rs"]
mod common;

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    let client_args = common::parse_client_args(&args)?;
    let queue = Pubkey::from_str(&common::get_flag_value(&args, "--queue")?)?;
    let feed_ids = common::parse_feed_ids_csv(&common::get_flag_value(&args, "--feed-ids")?)?;
    let batch_id = common::parse_hex_32(&common::get_flag_value(&args, "--batch-id")?)?;
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
    println!("config_pda={}", config);
    println!("batch_pda={}", batch_pda);
    println!("quote_account={}", quote_account);
    println!("signature={}", signature);
    Ok(())
}
