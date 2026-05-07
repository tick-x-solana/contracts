use std::{error::Error, str::FromStr};

use solana_sdk::{pubkey::Pubkey, signer::Signer};
use tickx_price_integrity_sol::instruction::PriceIntegrityInstruction;

#[path = "../common.rs"]
mod common;

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    let client_args = common::parse_client_args(&args)?;
    let queue = Pubkey::from_str(&common::get_flag_value(&args, "--queue")?)?;
    let max_age_slots = common::get_flag_value(&args, "--max-age-slots")?.parse::<u64>()?;
    let feed_ids = common::parse_feed_ids_csv(&common::get_flag_value(&args, "--feed-ids")?)?;
    let quote_account = common::resolve_quote_account(&args, &queue, Some(&feed_ids))?;

    let rpc_client = common::rpc_client(&client_args.rpc_url);
    let payer = common::load_keypair(&client_args.payer_path)?;
    let (config, _) = common::config_pda(&client_args.program_id);

    let instruction = common::build_instruction(
        client_args.program_id,
        PriceIntegrityInstruction::SetSwitchboardConfig {
            quote_account,
            queue,
            max_age_slots,
            metric_feed_ids: feed_ids,
        },
        common::set_switchboard_config_accounts(&payer.pubkey(), &config),
    )?;

    let signature = common::send_transaction(&rpc_client, &payer, &[instruction])?;

    println!("program_id={}", client_args.program_id);
    println!("config_pda={}", config);
    println!("queue={}", queue);
    println!("quote_account={}", quote_account);
    println!("max_age_slots={}", max_age_slots);
    println!("signature={}", signature);

    Ok(())
}
