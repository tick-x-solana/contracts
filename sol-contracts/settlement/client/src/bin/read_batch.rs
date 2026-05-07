use std::error::Error;

use borsh::BorshDeserialize;
use tickx_settlement_sol::state::SettlementBatch;

#[path = "../common.rs"]
mod common;

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    let client_args = common::parse_client_args(&args)?;
    let batch_id = common::parse_hex_32(&common::get_flag_value(&args, "--batch-id")?)?;

    let rpc_client = common::rpc_client(&client_args.rpc_url);
    let (batch_pda, _) = common::batch_pda(&client_args.program_id, &batch_id);
    let account = rpc_client.get_account(&batch_pda)?;
    let batch = SettlementBatch::try_from_slice(&account.data)?;

    println!("program_id={}", client_args.program_id);
    println!("batch_pda={}", batch_pda);
    println!(
        "batch_id=0x{}",
        batch.batch_id.iter().map(|b| format!("{:02x}", b)).collect::<String>()
    );
    println!(
        "merkle_root=0x{}",
        batch.merkle_root.iter().map(|b| format!("{:02x}", b)).collect::<String>()
    );
    println!("total_payout={}", batch.total_payout);
    println!("withdrawable_cap={}", batch.withdrawable_cap);
    println!("window_start={}", batch.window_start);
    println!("window_end={}", batch.window_end);
    println!("committed_at={}", batch.committed_at);
    Ok(())
}
