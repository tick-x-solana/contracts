use std::{error::Error, path::PathBuf, str::FromStr};

use borsh::BorshSerialize;
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    instruction::{AccountMeta, Instruction},
    message::Message,
    pubkey::Pubkey,
    signature::{read_keypair_file, Keypair, Signature, Signer},
    system_program, transaction::Transaction,
};
use tickx_pool_reserve_sol::{
    instruction::PoolReserveInstruction,
    state::{CONFIG_SEED, TRADER_POSITION_SEED, VAULT_SEED},
};

pub struct ClientArgs {
    pub rpc_url: String,
    pub payer_path: PathBuf,
    pub program_id: Pubkey,
}

pub fn parse_client_args(args: &[String]) -> Result<ClientArgs, Box<dyn Error>> {
    let rpc_url = get_flag_value(args, "--rpc-url")?;
    let payer_path = PathBuf::from(get_flag_value(args, "--payer")?);
    let program_id = Pubkey::from_str(&get_flag_value(args, "--program-id")?)?;

    Ok(ClientArgs {
        rpc_url,
        payer_path,
        program_id,
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

pub fn vault_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[VAULT_SEED], program_id)
}

pub fn trader_position_pda(program_id: &Pubkey, trader: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[TRADER_POSITION_SEED, trader.as_ref()], program_id)
}

pub fn build_instruction(
    program_id: Pubkey,
    instruction: PoolReserveInstruction,
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
    additional_signers: &[&Keypair],
    instruction: Instruction,
) -> Result<Signature, Box<dyn Error>> {
    let latest_blockhash = rpc_client.get_latest_blockhash()?;

    let mut all_signers: Vec<&Keypair> = Vec::with_capacity(1 + additional_signers.len());
    all_signers.push(payer);
    all_signers.extend_from_slice(additional_signers);

    let message = Message::new(&[instruction], Some(&payer.pubkey()));
    let tx = Transaction::new(&all_signers, message, latest_blockhash);
    let signature = rpc_client.send_and_confirm_transaction(&tx)?;
    Ok(signature)
}

pub fn initialize_accounts(
    payer: &Pubkey,
    config: &Pubkey,
    vault: &Pubkey,
) -> Vec<AccountMeta> {
    vec![
        AccountMeta::new(*payer, true),
        AccountMeta::new(*config, false),
        AccountMeta::new(*vault, false),
        AccountMeta::new_readonly(system_program::id(), false),
    ]
}

pub fn deposit_accounts(
    trader: &Pubkey,
    config: &Pubkey,
    trader_position: &Pubkey,
    vault: &Pubkey,
) -> Vec<AccountMeta> {
    vec![
        AccountMeta::new(*trader, true),
        AccountMeta::new(*config, false),
        AccountMeta::new(*trader_position, false),
        AccountMeta::new(*vault, false),
        AccountMeta::new_readonly(system_program::id(), false),
    ]
}

pub fn claim_accounts(
    claim_signer: &Pubkey,
    trader: &Pubkey,
    config: &Pubkey,
    trader_position: &Pubkey,
    vault: &Pubkey,
) -> Vec<AccountMeta> {
    vec![
        AccountMeta::new_readonly(*claim_signer, true),
        AccountMeta::new(*trader, false),
        AccountMeta::new(*config, false),
        AccountMeta::new(*trader_position, false),
        AccountMeta::new(*vault, false),
    ]
}
