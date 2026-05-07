use std::{error::Error, str::FromStr};

use solana_sdk::{pubkey::Pubkey, signer::Signer};
use tickx_settlement_sol::instruction::SettlementInstruction;

#[path = "../common.rs"]
mod common;

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    let client_args = common::parse_client_args(&args)?;
    let beneficiary = Pubkey::from_str(&common::get_flag_value(&args, "--beneficiary")?)?;
    let batch_id = common::parse_hex_32(&common::get_flag_value(&args, "--batch-id")?)?;
    let amount = common::get_flag_value(&args, "--amount")?.parse::<u64>()?;

    let rpc_client = common::rpc_client(&client_args.rpc_url);
    let payer = common::load_keypair(&client_args.payer_path)?;
    let (config, _) = common::config_pda(&client_args.program_id);
    let (batch_pda, _) = common::batch_pda(&client_args.program_id, &batch_id);
    let (paid_pda, _) = common::paid_pda(&client_args.program_id, &batch_id, &beneficiary);

    let instruction = common::build_instruction(
        client_args.program_id,
        SettlementInstruction::MarkPaid { batch_id, amount },
        common::mark_paid_accounts(&payer.pubkey(), &beneficiary, &config, &batch_pda, &paid_pda),
    )?;

    let signature = common::send_transaction(&rpc_client, &payer, &[instruction])?;
    println!("program_id={}", client_args.program_id);
    println!("beneficiary={}", beneficiary);
    println!("batch_pda={}", batch_pda);
    println!("paid_pda={}", paid_pda);
    println!("signature={}", signature);
    Ok(())
}
