use std::error::Error;

#[path = "../common.rs"]
mod common;

use solana_sdk::signer::Signer;
use tickx_settlement_sol::instruction::SettlementInstruction;

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    let client_args = common::parse_client_args(&args)?;
    let rpc_client = common::rpc_client(&client_args.rpc_url);
    let payer = common::load_keypair(&client_args.payer_path)?;
    let (config, _) = common::config_pda(&client_args.program_id);

    let instruction = common::build_instruction(
        client_args.program_id,
        SettlementInstruction::Initialize,
        common::initialize_accounts(&payer.pubkey(), &config),
    )?;

    let signature = common::send_transaction(&rpc_client, &payer, &[instruction])?;
    println!("program_id={}", client_args.program_id);
    println!("config_pda={}", config);
    println!("signature={}", signature);
    Ok(())
}
