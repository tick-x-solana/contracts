use std::{error::Error, str::FromStr};

use borsh::BorshDeserialize;
use solana_sdk::pubkey::Pubkey;
use tickx_settlement_sol::state::PaidRecord;

#[path = "../common.rs"]
mod common;

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    let client_args = common::parse_client_args(&args)?;
    let beneficiary = Pubkey::from_str(&common::get_flag_value(&args, "--beneficiary")?)?;
    let batch_id = common::parse_hex_32(&common::get_flag_value(&args, "--batch-id")?)?;

    let rpc_client = common::rpc_client(&client_args.rpc_url);
    let (paid_pda, _) = common::paid_pda(&client_args.program_id, &batch_id, &beneficiary);
    let account = rpc_client.get_account(&paid_pda)?;
    let paid = PaidRecord::try_from_slice(&account.data)?;

    println!("program_id={}", client_args.program_id);
    println!("paid_pda={}", paid_pda);
    println!("beneficiary={}", paid.account);
    println!("amount={}", paid.amount);
    Ok(())
}
