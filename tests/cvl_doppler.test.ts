import { expect } from "chai";
import {
  LiteSVM,
  FailedTransactionMetadata,
  TransactionMetadata,
} from "litesvm";
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

function encodeOracleUpdate(sequence: bigint, price: bigint): Buffer {
  const buf = Buffer.alloc(16);
  buf.writeBigUInt64LE(sequence, 0); // seq
  buf.writeBigUInt64LE(price, 8); // price
  return buf;
}

function decodeOracleState(data: Uint8Array): {
  sequence: bigint;
  price: bigint;
} {
  const buf = Buffer.from(data);
  return {
    sequence: buf.readBigUInt64LE(0),
    price: buf.readBigUInt64LE(8),
  };
}

function testAdminKeypair(): Keypair {
  const seed = Buffer.alloc(32);
  seed.write("doppler-test-admin");
  return Keypair.fromSeed(seed);
}

describe("cvl_doppler", () => {
  const programPath = path.join(__dirname, "..", "build", "program.so");
  const programId = Keypair.generate().publicKey;

  let svm: LiteSVM;
  let admin: Keypair;

  before(() => {
    svm = new LiteSVM();
    svm.addProgram(programId, fs.readFileSync(programPath));

    admin = testAdminKeypair();
    svm.airdrop(admin.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
  });

  function createOracleAccount(): PublicKey {
    const oracle = Keypair.generate();
    const space = 16;
    const lamports = Number(
      svm.minimumBalanceForRentExemption(BigInt(space))
    );

    const createIx = SystemProgram.createAccount({
      fromPubkey: admin.publicKey,
      newAccountPubkey: oracle.publicKey,
      lamports,
      space,
      programId,
    });

    const tx = new Transaction().add(createIx);
    tx.recentBlockhash = svm.latestBlockhash();
    tx.sign(admin, oracle);
    svm.sendTransaction(tx);

    return oracle.publicKey;
  }

  function sendUpdate(
    oracleKey: PublicKey,
    sequence: bigint,
    price: bigint,
    signer: Keypair = admin
  ): TransactionMetadata | FailedTransactionMetadata {
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: signer.publicKey, isSigner: true, isWritable: false },
        { pubkey: oracleKey, isSigner: false, isWritable: true },
      ],
      programId,
      data: encodeOracleUpdate(sequence, price),
    });

    const tx = new Transaction().add(ix);
    tx.recentBlockhash = svm.latestBlockhash();
    tx.sign(signer);
    const result = svm.sendTransaction(tx);

    if (
      result &&
      result.constructor &&
      result.constructor.name === "FailedTransactionMetadata"
    ) {
      const meta = (result as any).meta();
      const logs: string[] = meta.logs();
      const errStr = (result as any).err().toString();
      throw new Error(`TX failed: ${errStr}\n${logs.join("\n")}`);
    }
    console.log((result as any).logs());
    return result;
  }

  it("updates oracle with valid sequence", () => {
    const oracleKey = createOracleAccount();

    const result = sendUpdate(oracleKey, 1n, 42_000_000_000n);
    expect(result).to.not.be.instanceOf(FailedTransactionMetadata);

    const state = decodeOracleState(svm.getAccount(oracleKey)!.data);
    expect(state.sequence).to.equal(1n);
    expect(state.price).to.equal(42_000_000_000n);
  });

  it("accepts strictly increasing sequence", () => {
    const oracleKey = createOracleAccount();

    sendUpdate(oracleKey, 1n, 100n);
    sendUpdate(oracleKey, 2n, 200n);
    sendUpdate(oracleKey, 5n, 500n); // gaps are fine ig

    const state = decodeOracleState(svm.getAccount(oracleKey)!.data);
    expect(state.sequence).to.equal(5n);
    expect(state.price).to.equal(500n);
  });

  it("rejects stale sequence (equal)", () => {
    const oracleKey = createOracleAccount();
    sendUpdate(oracleKey, 1n, 100n);

    expect(() => sendUpdate(oracleKey, 1n, 999n)).to.throw();

    const state = decodeOracleState(svm.getAccount(oracleKey)!.data);
    expect(state.sequence).to.equal(1n);
    expect(state.price).to.equal(100n);
  });

  it("rejects stale sequence (lower)", () => {
    const oracleKey = createOracleAccount();
    sendUpdate(oracleKey, 5n, 100n);

    expect(() => sendUpdate(oracleKey, 3n, 999n)).to.throw();

    const state = decodeOracleState(svm.getAccount(oracleKey)!.data);
    expect(state.sequence).to.equal(5n);
    expect(state.price).to.equal(100n);
  });

  it("rejects unauthorized signer", () => {
    const oracleKey = createOracleAccount();
    const imposter = Keypair.generate();
    svm.airdrop(imposter.publicKey, BigInt(1 * LAMPORTS_PER_SOL));

    expect(() => sendUpdate(oracleKey, 1n, 100n, imposter)).to.throw();

    const state = decodeOracleState(svm.getAccount(oracleKey)!.data);
    expect(state.sequence).to.equal(0n);
    expect(state.price).to.equal(0n);
  });
});
