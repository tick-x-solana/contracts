use std::{error::Error, path::PathBuf, str::FromStr};

use solana_sdk::{native_token::sol_to_lamports, pubkey::Pubkey, signature::Signer};
use tickx_pool_reserve_sol::instruction::PoolReserveInstruction;

#[path = "../common.rs"]
mod common;

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    let client_args = common::parse_client_args(&args)?;
    let claim_signer_path = PathBuf::from(common::get_flag_value(&args, "--claim-signer")?);
    let trader = Pubkey::from_str(&common::get_flag_value(&args, "--trader")?)?;
    let amount_sol = common::get_flag_value(&args, "--amount-sol")?.parse::<f64>()?;

    if amount_sol <= 0.0 {
        return Err("amount-sol must be greater than zero".into());
    }

    let rpc_client = common::rpc_client(&client_args.rpc_url);
    let payer = common::load_keypair(&client_args.payer_path)?;
    let claim_signer = common::load_keypair(&claim_signer_path)?;
    let (config, _) = common::config_pda(&client_args.program_id);
    let (vault, _) = common::vault_pda(&client_args.program_id);
    let (trader_position, _) = common::trader_position_pda(&client_args.program_id, &trader);

    let instruction = common::build_instruction(
        client_args.program_id,
        PoolReserveInstruction::ClaimTrader {
            amount: sol_to_lamports(amount_sol),
        },
        common::claim_accounts(
            &claim_signer.pubkey(),
            &trader,
            &config,
            &trader_position,
            &vault,
        ),
    )?;

    let signature = if payer.pubkey() == claim_signer.pubkey() {
        common::send_transaction(&rpc_client, &payer, &[], instruction)?
    } else {
        common::send_transaction(&rpc_client, &payer, &[&claim_signer], instruction)?
    };

    println!("program_id={}", client_args.program_id);
    println!("payer={}", payer.pubkey());
    println!("claim_signer={}", claim_signer.pubkey());
    println!("trader={}", trader);
    println!("config_pda={}", config);
    println!("vault_pda={}", vault);
    println!("trader_position_pda={}", trader_position);
    println!("amount_sol={}", amount_sol);
    println!("signature={}", signature);

    Ok(())
}
