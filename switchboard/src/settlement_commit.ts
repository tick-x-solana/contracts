import "dotenv/config";

import { readFile } from "node:fs/promises";

import { CrossbarClient } from "@switchboard-xyz/common";
import { asV0Tx, getDefaultDevnetQueue } from "@switchboard-xyz/on-demand";
import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";

import { runtimeConfig } from "./config.js";

const SETTLEMENT_PROGRAM_ID_FLAG = "--program-id";
const RPC_URL_FLAG = "--rpc-url";
const PAYER_FLAG = "--payer";
const CONFIG_JSON_FLAG = "--config-json";
const COMMIT_VARIANT = 1;

interface CommitConfig {
  rpcUrl: string;
  queue: string;
  quoteAccount: string;
  feedIds: string[];
  selectedBatch: {
    batchId: string;
  };
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function parseHex32(input: string): Buffer {
  const normalized = input.startsWith("0x") ? input.slice(2) : input;
  if (normalized.length !== 64) {
    throw new Error(`expected 32-byte hex string, got length ${normalized.length}`);
  }
  return Buffer.from(normalized, "hex");
}

function loadKeypair(secret: string): Keypair {
  const parsed = JSON.parse(secret) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

function findProgramAddress(seeds: Buffer[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function buildCommitInstruction(params: {
  programId: PublicKey;
  payer: PublicKey;
  config: PublicKey;
  batch: PublicKey;
  quoteAccount: PublicKey;
  queue: PublicKey;
  batchId: Buffer;
}): TransactionInstruction {
  const data = Buffer.concat([Buffer.from([COMMIT_VARIANT]), params.batchId]);
  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.config, isSigner: false, isWritable: true },
      { pubkey: params.batch, isSigner: false, isWritable: true },
      { pubkey: params.quoteAccount, isSigner: false, isWritable: false },
      { pubkey: params.queue, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: new PublicKey("SysvarS1otHashes111111111111111111111111111"), isSigner: false, isWritable: false },
      { pubkey: new PublicKey("Sysvar1nstructions1111111111111111111111111"), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const configJsonPath =
    getFlagValue(args, CONFIG_JSON_FLAG) ?? "deployments/settlement-switchboard-commit-devnet.json";
  const rpcUrl = getFlagValue(args, RPC_URL_FLAG) ?? runtimeConfig.rpcUrl;
  const payerPath = getFlagValue(args, PAYER_FLAG) ?? runtimeConfig.payerKeypairPath;
  const programIdRaw = getFlagValue(args, SETTLEMENT_PROGRAM_ID_FLAG);

  if (!programIdRaw) throw new Error("missing required flag --program-id");
  if (!payerPath) throw new Error("missing payer keypair path");

  const configJson = JSON.parse(await readFile(configJsonPath, "utf8")) as CommitConfig;
  const programId = new PublicKey(programIdRaw);
  const queue = new PublicKey(configJson.queue);
  const quoteAccount = new PublicKey(configJson.quoteAccount);
  const batchId = parseHex32(configJson.selectedBatch.batchId);
  const payer = loadKeypair(await readFile(payerPath, "utf8"));
  const connection = new Connection(rpcUrl, "confirmed");

  const configPda = findProgramAddress([Buffer.from("settlement-config")], programId);
  const batchPda = findProgramAddress([Buffer.from("settlement-batch"), batchId], programId);

  const crossbar = new CrossbarClient(runtimeConfig.crossbarUrl, true);
  const queueAccount = await getDefaultDevnetQueue(rpcUrl);
  if (!queueAccount.pubkey.equals(queue)) {
    throw new Error(
      `queue mismatch: config expects ${queue.toBase58()} but SDK resolved ${queueAccount.pubkey.toBase58()}`
    );
  }
  const gateway = await queueAccount.fetchGatewayFromCrossbar(crossbar);
  const updateIx = await queueAccount.fetchUpdateBundleIx(
    gateway,
    crossbar,
    configJson.feedIds,
    1,
    0
  );

  const commitIx = buildCommitInstruction({
    programId,
    payer: payer.publicKey,
    config: configPda,
    batch: batchPda,
    quoteAccount,
    queue,
    batchId,
  });

  const tx = await asV0Tx({
    connection,
    ixs: [updateIx, commitIx],
    signers: [payer],
    computeUnitPrice: 10_000,
    computeUnitLimitMultiple: 1.3,
  });

  const signature = await connection.sendTransaction(tx as VersionedTransaction, {
    preflightCommitment: "processed",
  });
  await connection.confirmTransaction(signature, "confirmed");

  console.log(`programId=${programId.toBase58()}`);
  console.log(`configPda=${configPda.toBase58()}`);
  console.log(`batchPda=${batchPda.toBase58()}`);
  console.log(`quoteAccount=${quoteAccount.toBase58()}`);
  console.log(`batchId=${configJson.selectedBatch.batchId}`);
  console.log(`signature=${signature}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
