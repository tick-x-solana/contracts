import "dotenv/config";

import { readFile } from "node:fs/promises";

import { CrossbarClient } from "@switchboard-xyz/common";
import { asV0Tx, getDefaultDevnetQueue } from "@switchboard-xyz/on-demand";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";

import { runtimeConfig } from "./config.js";
import { computePriceIntegritySnapshot } from "./worker.js";

const PROGRAM_ID_FLAG = "--program-id";
const RPC_URL_FLAG = "--rpc-url";
const PAYER_FLAG = "--payer";
const CONFIG_JSON_FLAG = "--config-json";
const COMMIT_VARIANT = 1;
const CONFIG_SEED = Buffer.from("price-integrity-config");
const REPORT_SEED = Buffer.from("price-integrity-report");
const SLOT_HASHES_SYSVAR = new PublicKey("SysvarS1otHashes111111111111111111111111111");
const INSTRUCTIONS_SYSVAR = new PublicKey("Sysvar1nstructions1111111111111111111111111");
const QUOTE_PROGRAM_ID = new PublicKey("orac1eFjzWL5R3RbbdMV68K9H6TaCVVcL6LjvQQWAbz");

interface DeploymentConfig {
  queue: string;
  quoteAccount?: string;
  feedIds: string[];
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function loadKeypair(secret: string): Keypair {
  const parsed = JSON.parse(secret) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

function parseHex32(input: string): Buffer {
  const normalized = input.startsWith("0x") ? input.slice(2) : input;
  if (normalized.length !== 64) {
    throw new Error(`expected 32-byte hex string, got length ${normalized.length}`);
  }
  return Buffer.from(normalized, "hex");
}

function writeU64LE(value: number | bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
}

function deriveQuoteAccount(queue: PublicKey, feedIds: string[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      queue.toBuffer(),
      ...feedIds.map((feedId) => parseHex32(feedId))
    ],
    QUOTE_PROGRAM_ID
  )[0];
}

function findProgramAddress(seeds: Buffer[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function buildCommitInstruction(params: {
  programId: PublicKey;
  payer: PublicKey;
  config: PublicKey;
  report: PublicKey;
  quoteAccount: PublicKey;
  queue: PublicKey;
  epochId: number;
  windowStart: number;
  candleCount: number;
  internalCandlesHash: Buffer;
  chainlinkCandlesHash: Buffer;
  diffMerkleRoot: Buffer;
}): TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from([COMMIT_VARIANT]),
    writeU64LE(params.epochId),
    writeU64LE(params.windowStart),
    writeU64LE(params.candleCount),
    params.internalCandlesHash,
    params.chainlinkCandlesHash,
    params.diffMerkleRoot,
  ]);

  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.config, isSigner: false, isWritable: true },
      { pubkey: params.report, isSigner: false, isWritable: true },
      { pubkey: params.quoteAccount, isSigner: false, isWritable: false },
      { pubkey: params.queue, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SLOT_HASHES_SYSVAR, isSigner: false, isWritable: false },
      { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const configJsonPath =
    getFlagValue(args, CONFIG_JSON_FLAG) ?? "deployments/price-integrity-prod-devnet.json";
  const rpcUrl = getFlagValue(args, RPC_URL_FLAG) ?? runtimeConfig.rpcUrl;
  const payerPath = getFlagValue(args, PAYER_FLAG) ?? runtimeConfig.payerKeypairPath;
  const programIdRaw = getFlagValue(args, PROGRAM_ID_FLAG);

  if (!programIdRaw) throw new Error("missing required flag --program-id");
  if (!payerPath) throw new Error("missing payer keypair path");

  const configJson = JSON.parse(await readFile(configJsonPath, "utf8")) as DeploymentConfig;
  const programId = new PublicKey(programIdRaw);
  const queue = new PublicKey(configJson.queue);
  const quoteAccount = configJson.quoteAccount
    ? new PublicKey(configJson.quoteAccount)
    : deriveQuoteAccount(queue, configJson.feedIds);
  const payer = loadKeypair(await readFile(payerPath, "utf8"));
  const connection = new Connection(rpcUrl, "confirmed");
  const snapshot = await computePriceIntegritySnapshot();

  const configPda = findProgramAddress([CONFIG_SEED], programId);
  const reportPda = findProgramAddress(
    [REPORT_SEED, writeU64LE(snapshot.epochId)],
    programId
  );

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
    report: reportPda,
    quoteAccount,
    queue,
    epochId: snapshot.epochId,
    windowStart: snapshot.windowStart,
    candleCount: snapshot.candleCount,
    internalCandlesHash: parseHex32(snapshot.internalCandlesHash),
    chainlinkCandlesHash: parseHex32(snapshot.chainlinkCandlesHash),
    diffMerkleRoot: parseHex32(snapshot.diffMerkleRoot),
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
  console.log(`reportPda=${reportPda.toBase58()}`);
  console.log(`queue=${queue.toBase58()}`);
  console.log(`quoteAccount=${quoteAccount.toBase58()}`);
  console.log(`epochId=${snapshot.epochId}`);
  console.log(`windowStart=${snapshot.windowStart}`);
  console.log(`candleCount=${snapshot.candleCount}`);
  console.log(`scoreBps=${snapshot.metrics.scoreBps}`);
  console.log(`ohlcP95Bps=${snapshot.metrics.ohlcP95Bps}`);
  console.log(`signature=${signature}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
