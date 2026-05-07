use std::{error::Error, str::FromStr};

use solana_sdk::signature::Signer;
use solana_sdk::pubkey::Pubkey;
use tickx_pool_reserve_sol::instruction::PoolReserveInstruction;

#[path = "../common.rs"]
mod common;

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    let client_args = common::parse_client_args(&args)?;
    let claim_signer = Pubkey::from_str(&common::get_flag_value(&args, "--claim-signer")?)?;

    let rpc_client = common::rpc_client(&client_args.rpc_url);
    let payer = common::load_keypair(&client_args.payer_path)?;
    let (config, _) = common::config_pda(&client_args.program_id);
    let (vault, _) = common::vault_pda(&client_args.program_id);

    let instruction = common::build_instruction(
        client_args.program_id,
        PoolReserveInstruction::Initialize { claim_signer },
        common::initialize_accounts(&payer.pubkey(), &config, &vault),
    )?;

    let signature = common::send_transaction(&rpc_client, &payer, &[], instruction)?;

    println!("program_id={}", client_args.program_id);
    println!("config_pda={}", config);
    println!("vault_pda={}", vault);
    println!("signature={}", signature);

    Ok(())
}
