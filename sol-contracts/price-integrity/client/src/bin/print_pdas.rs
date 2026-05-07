use std::{error::Error, str::FromStr};

use solana_sdk::pubkey::Pubkey;

#[path = "../common.rs"]
mod common;

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    let client_args = common::parse_client_args(&args)?;
    let queue = Pubkey::from_str(&common::get_flag_value(&args, "--queue")?)?;
    let feed_ids = common::parse_feed_ids_csv(&common::get_flag_value(&args, "--feed-ids")?)?;
    let epoch_id = common::get_optional_flag_value(&args, "--epoch-id")
        .map(|value| value.parse::<u64>())
        .transpose()?;

    let (config, _) = common::config_pda(&client_args.program_id);
    let quote_account = common::derive_quote_account(&queue, &feed_ids);

    println!("program_id={}", client_args.program_id);
    println!("config_pda={}", config);
    println!("queue={}", queue);
    println!("quote_account={}", quote_account);

    if let Some(epoch_id) = epoch_id {
        let (report, _) = common::report_pda(&client_args.program_id, epoch_id);
        println!("report_pda={}", report);
        println!("epoch_id={}", epoch_id);
    }

    Ok(())
}
