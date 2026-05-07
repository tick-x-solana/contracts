use std::{error::Error, path::PathBuf, str::FromStr};

use borsh::BorshSerialize;
use sha2::{Digest, Sha256};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    hash::Hash,
    instruction::{AccountMeta, Instruction},
    message::Message,
    pubkey::Pubkey,
    signature::{read_keypair_file, Keypair, Signature},
    signer::Signer,
    system_program,
    transaction::Transaction,
};
use tickx_settlement_sol::{
    instruction::{SettlementInstruction, SETTLEMENT_FEED_COUNT},
    state::{BATCH_SEED, CONFIG_SEED, PAID_SEED},
};

const QUOTE_PROGRAM_ID_STR: &str = "orac1eFjzWL5R3RbbdMV68K9H6TaCVVcL6LjvQQWAbz";

pub struct ClientArgs {
    pub rpc_url: String,
    pub payer_path: PathBuf,
    pub program_id: Pubkey,
}

pub fn parse_client_args(args: &[String]) -> Result<ClientArgs, Box<dyn Error>> {
    Ok(ClientArgs {
        rpc_url: get_flag_value(args, "--rpc-url")?,
        payer_path: PathBuf::from(get_flag_value(args, "--payer")?),
        program_id: Pubkey::from_str(&get_flag_value(args, "--program-id")?)?,
    })
}

pub fn get_flag_value(args: &[String], flag: &str) -> Result<String, Box<dyn Error>> {
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if arg == flag {
            let value = iter
                .next()
                .ok_or_else(|| format!("missing value for {}", flag))?;
            return Ok(value.clone());
        }
    }
    Err(format!("missing required flag {}", flag).into())
}

pub fn rpc_client(rpc_url: &str) -> RpcClient {
    RpcClient::new_with_commitment(rpc_url.to_string(), CommitmentConfig::confirmed())
}

pub fn load_keypair(path: &PathBuf) -> Result<Keypair, Box<dyn Error>> {
    read_keypair_file(path).map_err(|err| err.into())
}

pub fn config_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], program_id)
}

pub fn batch_pda(program_id: &Pubkey, batch_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[BATCH_SEED, batch_id], program_id)
}

pub fn paid_pda(program_id: &Pubkey, batch_id: &[u8; 32], account: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PAID_SEED, batch_id, account.as_ref()], program_id)
}

pub fn parse_hex_32(input: &str) -> Result<[u8; 32], Box<dyn Error>> {
    let raw = input.strip_prefix("0x").unwrap_or(input);
    if raw.len() != 64 {
        return Err(format!("expected 32-byte hex string, got length {}", raw.len()).into());
    }

    let mut out = [0_u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&raw[i * 2..i * 2 + 2], 16)?;
    }
    Ok(out)
}

pub fn parse_feed_ids_csv(input: &str) -> Result<[[u8; 32]; SETTLEMENT_FEED_COUNT], Box<dyn Error>> {
    let parts: Vec<&str> = input.split(',').map(str::trim).filter(|s| !s.is_empty()).collect();
    if parts.len() != SETTLEMENT_FEED_COUNT {
        return Err(format!(
            "expected {} comma-separated feed IDs, got {}",
            SETTLEMENT_FEED_COUNT,
            parts.len()
        )
        .into());
    }

    let mut feed_ids = [[0_u8; 32]; SETTLEMENT_FEED_COUNT];
    for (idx, part) in parts.iter().enumerate() {
        feed_ids[idx] = parse_hex_32(part)?;
    }
    Ok(feed_ids)
}

pub fn derive_quote_account(
    queue: &Pubkey,
    feed_ids: &[[u8; 32]; SETTLEMENT_FEED_COUNT],
) -> Pubkey {
    let mut hasher = Sha256::new();
    for feed_id in feed_ids {
        hasher.update(feed_id);
    }
    let feed_ids_hash = hasher.finalize();

    let quote_program_id =
        Pubkey::from_str(QUOTE_PROGRAM_ID_STR).expect("valid switchboard quote program id");
    Pubkey::find_program_address(&[queue.as_ref(), &feed_ids_hash], &quote_program_id).0
}

pub fn build_instruction(
    program_id: Pubkey,
    instruction: SettlementInstruction,
    accounts: Vec<AccountMeta>,
) -> Result<Instruction, Box<dyn Error>> {
    Ok(Instruction {
        program_id,
        accounts,
        data: instruction.try_to_vec()?,
    })
}

pub fn send_transaction(
    rpc_client: &RpcClient,
    payer: &Keypair,
    instructions: &[Instruction],
) -> Result<Signature, Box<dyn Error>> {
    let latest_blockhash: Hash = rpc_client.get_latest_blockhash()?;
    let message = Message::new(instructions, Some(&payer.pubkey()));
    let tx = Transaction::new(&[payer], message, latest_blockhash);
    Ok(rpc_client.send_and_confirm_transaction(&tx)?)
}

pub fn initialize_accounts(payer: &Pubkey, config: &Pubkey) -> Vec<AccountMeta> {
    vec![
        AccountMeta::new(*payer, true),
        AccountMeta::new(*config, false),
        AccountMeta::new_readonly(system_program::id(), false),
    ]
}

pub fn commit_accounts(
    payer: &Pubkey,
    config: &Pubkey,
    batch: &Pubkey,
) -> Vec<AccountMeta> {
    vec![
        AccountMeta::new(*payer, true),
        AccountMeta::new(*config, false),
        AccountMeta::new(*batch, false),
        AccountMeta::new_readonly(system_program::id(), false),
        AccountMeta::new_readonly(solana_sdk::sysvar::clock::id(), false),
    ]
}

pub fn commit_switchboard_accounts(
    payer: &Pubkey,
    config: &Pubkey,
    batch: &Pubkey,
    quote_account: &Pubkey,
    queue: &Pubkey,
) -> Vec<AccountMeta> {
    vec![
        AccountMeta::new(*payer, true),
        AccountMeta::new(*config, false),
        AccountMeta::new(*batch, false),
        AccountMeta::new(*quote_account, false),
        AccountMeta::new_readonly(*queue, false),
        AccountMeta::new_readonly(solana_sdk::sysvar::clock::id(), false),
        AccountMeta::new_readonly(solana_sdk::sysvar::slot_hashes::id(), false),
        AccountMeta::new_readonly(solana_sdk::sysvar::instructions::id(), false),
        AccountMeta::new_readonly(system_program::id(), false),
    ]
}

pub fn mark_paid_accounts(
    payer: &Pubkey,
    beneficiary: &Pubkey,
    config: &Pubkey,
    batch: &Pubkey,
    paid: &Pubkey,
) -> Vec<AccountMeta> {
    vec![
        AccountMeta::new(*payer, true),
        AccountMeta::new_readonly(*beneficiary, false),
        AccountMeta::new(*config, false),
        AccountMeta::new(*batch, false),
        AccountMeta::new(*paid, false),
        AccountMeta::new_readonly(system_program::id(), false),
    ]
}
