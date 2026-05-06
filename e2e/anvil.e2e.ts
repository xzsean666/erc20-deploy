import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";
import assert from "node:assert/strict";

import {
  Contract,
  HDNodeWallet,
  JsonRpcProvider,
  Wallet,
  getAddress,
  parseUnits,
} from "ethers";

const MNEMONIC = "test test test test test test test test test test test junk";
const CHAIN_ID = 31337;
const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

type TokenConfig = {
  rpc: string;
  chainId: number;
  deployerPrivateKeyEnv: string;
  tokenName: string;
  symbol: string;
  decimals: number;
  initialSupply: string;
  initialRecipient?: string;
  owner?: string;
  isTest: boolean;
  isUpgradeable: boolean;
  confirmations: number;
  verify: {
    enabled: boolean;
  };
  metadata: {
    project: string;
    notes: string;
  };
};

type DeploymentRecord = {
  chainId: number;
  rpcHost: string;
  deployer: string;
  tokenName: string;
  symbol: string;
  decimals: number;
  initialSupply: string;
  initialSupplyBaseUnits: string;
  initialRecipient: string;
  owner: string;
  isTest: boolean;
  isUpgradeable: boolean;
  implementationAddress?: string;
  proxyAddress?: string;
  tokenAddress: string;
  transactionHash: string;
  blockNumber: number;
  confirmations: number;
  verified: boolean;
  metadata: {
    project: string;
    notes: string;
  };
};

const tokenAbi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function owner() view returns (address)",
  "function isTest() view returns (bool)",
  "function mint(address to, uint256 amount)",
  "error MintDisabled()",
] as const;

async function main(): Promise<void> {
  const port = await getFreePort();
  const rpc = `http://127.0.0.1:${port}`;
  const workDir = await mkdtemp(join(tmpdir(), "erc20-anvil-e2e-"));
  const envPath = join(workDir, ".env");
  const deployer = walletAt(0);
  const initialRecipient = walletAt(1);
  const owner = walletAt(2);
  const minterWallet = walletAt(3);
  const mintRecipient = walletAt(4);

  let anvil: ChildProcessWithoutNullStreams | undefined;
  let provider: JsonRpcProvider | undefined;
  const recordsToDelete: Array<string> = [];

  try {
    await writeFile(envPath, `DEPLOYER_PRIVATE_KEY=${deployer.privateKey}\n`);
    anvil = await startAnvil(port);
    await waitForRpcUrl(rpc);
    provider = new JsonRpcProvider(rpc);
    await waitForRpc(provider);
    const minter = minterWallet.connect(provider);

    const network = await provider.getNetwork();
    assert.equal(network.chainId, BigInt(CHAIN_ID));

    await assertChainIdMismatchFails({
      rpc,
      envPath,
      workDir,
      owner: owner.address,
      initialRecipient: initialRecipient.address,
    });

    const directTest = await deployAndLoadRecord({
      config: buildConfig({
        rpc,
        tokenName: "Anvil Direct Test Token",
        symbol: "ADTT",
        decimals: 6,
        initialSupply: "1234.56789",
        initialRecipient: initialRecipient.address,
        owner: owner.address,
        isTest: true,
        isUpgradeable: false,
      }),
      envPath,
      workDir,
    });
    recordsToDelete.push(directTest.recordPath);
    await assertTokenDeployment({
      provider,
      record: directTest.record,
      expectedConfig: directTest.config,
      deployerAddress: deployer.address,
    });
    await assertPublicMintWorks({
      provider,
      tokenAddress: directTest.record.tokenAddress,
      minter,
      recipient: mintRecipient.address,
      amount: 1_000n,
    });

    const directProduction = await deployAndLoadRecord({
      config: buildConfig({
        rpc,
        tokenName: "Anvil Direct Production Token",
        symbol: "ADPT",
        decimals: 18,
        initialSupply: "99",
        initialRecipient: initialRecipient.address,
        owner: owner.address,
        isTest: false,
        isUpgradeable: false,
      }),
      envPath,
      workDir,
    });
    recordsToDelete.push(directProduction.recordPath);
    await assertTokenDeployment({
      provider,
      record: directProduction.record,
      expectedConfig: directProduction.config,
      deployerAddress: deployer.address,
    });
    await assertMintReverts({
      tokenAddress: directProduction.record.tokenAddress,
      minter,
      recipient: mintRecipient.address,
    });

    const directDefaultAddresses = await deployAndLoadRecord({
      config: buildConfig({
        rpc,
        tokenName: "Anvil Default Addresses Token",
        symbol: "ADAT",
        decimals: 18,
        initialSupply: "42",
        isTest: true,
        isUpgradeable: false,
      }),
      envPath,
      workDir,
    });
    recordsToDelete.push(directDefaultAddresses.recordPath);
    await assertTokenDeployment({
      provider,
      record: directDefaultAddresses.record,
      expectedConfig: directDefaultAddresses.config,
      deployerAddress: deployer.address,
    });

    const reusedDefaultAddresses = await deployAndLoadRecord({
      config: directDefaultAddresses.config,
      envPath,
      workDir,
    });
    assert.equal(reusedDefaultAddresses.recordPath, directDefaultAddresses.recordPath);
    assert.equal(
      reusedDefaultAddresses.record.tokenAddress,
      directDefaultAddresses.record.tokenAddress,
    );
    assert.match(
      reusedDefaultAddresses.stdout,
      /Found existing matching deployment/,
    );

    const forcedDefaultAddresses = await deployAndLoadRecord({
      config: directDefaultAddresses.config,
      envPath,
      workDir,
      extraArgs: ["--force"],
    });
    recordsToDelete.push(forcedDefaultAddresses.recordPath);
    assert.notEqual(
      forcedDefaultAddresses.record.tokenAddress,
      directDefaultAddresses.record.tokenAddress,
    );
    await assertTokenDeployment({
      provider,
      record: forcedDefaultAddresses.record,
      expectedConfig: forcedDefaultAddresses.config,
      deployerAddress: deployer.address,
    });

    const upgradeableTest = await deployAndLoadRecord({
      config: buildConfig({
        rpc,
        tokenName: "Anvil Upgradeable Test Token",
        symbol: "AUTT",
        decimals: 8,
        initialSupply: "4567.12345678",
        initialRecipient: initialRecipient.address,
        owner: owner.address,
        isTest: true,
        isUpgradeable: true,
      }),
      envPath,
      workDir,
    });
    recordsToDelete.push(upgradeableTest.recordPath);
    await assertTokenDeployment({
      provider,
      record: upgradeableTest.record,
      expectedConfig: upgradeableTest.config,
      deployerAddress: deployer.address,
    });
    await assertUpgradeableRecord({
      provider,
      record: upgradeableTest.record,
    });
    await assertPublicMintWorks({
      provider,
      tokenAddress: upgradeableTest.record.tokenAddress,
      minter,
      recipient: mintRecipient.address,
      amount: 2_500n,
    });

    console.log("Anvil e2e passed");
  } finally {
    await Promise.allSettled(recordsToDelete.map((path) => rm(path, { force: true })));
    if (anvil !== undefined) {
      await stopAnvil(anvil);
    }
    if (provider !== undefined) {
      await provider.destroy();
    }
    await rm(workDir, { recursive: true, force: true });
  }
}

function buildConfig(
  overrides: Pick<
    TokenConfig,
    | "rpc"
    | "tokenName"
    | "symbol"
    | "decimals"
    | "initialSupply"
    | "isTest"
    | "isUpgradeable"
  > &
    Partial<Pick<TokenConfig, "initialRecipient" | "owner">> & {
      chainId?: number;
    },
): TokenConfig {
  return {
    rpc: overrides.rpc,
    chainId: overrides.chainId ?? CHAIN_ID,
    deployerPrivateKeyEnv: "DEPLOYER_PRIVATE_KEY",
    tokenName: overrides.tokenName,
    symbol: overrides.symbol,
    decimals: overrides.decimals,
    initialSupply: overrides.initialSupply,
    initialRecipient:
      overrides.initialRecipient === undefined
        ? undefined
        : getAddress(overrides.initialRecipient),
    owner:
      overrides.owner === undefined ? undefined : getAddress(overrides.owner),
    isTest: overrides.isTest,
    isUpgradeable: overrides.isUpgradeable,
    confirmations: 1,
    verify: {
      enabled: false,
    },
    metadata: {
      project: "anvil-e2e",
      notes: `${overrides.symbol} e2e deployment`,
    },
  };
}

async function deployAndLoadRecord({
  config,
  envPath,
  workDir,
  extraArgs = [],
}: {
  config: TokenConfig;
  envPath: string;
  workDir: string;
  extraArgs?: Array<string>;
}): Promise<{
  config: TokenConfig;
  record: DeploymentRecord;
  recordPath: string;
  stdout: string;
}> {
  const configPath = join(workDir, `${config.symbol}.json`);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = await runCommand("pnpm", [
    "run",
    "deploy:token",
    "--",
    "--config",
    configPath,
    ...extraArgs,
  ], {
    DOTENV_CONFIG_PATH: envPath,
  });

  const recordPath = parseDeploymentRecordPath(result.stdout);
  const record = JSON.parse(await readFile(recordPath, "utf8")) as DeploymentRecord;

  return {
    config,
    record,
    recordPath,
    stdout: result.stdout,
  };
}

async function assertChainIdMismatchFails({
  rpc,
  envPath,
  workDir,
  initialRecipient,
  owner,
}: {
  rpc: string;
  envPath: string;
  workDir: string;
  initialRecipient: string;
  owner: string;
}): Promise<void> {
  const config = buildConfig({
    rpc,
    chainId: CHAIN_ID + 1,
    tokenName: "Wrong Chain Token",
    symbol: "WCT",
    decimals: 18,
    initialSupply: "1",
    initialRecipient,
    owner,
    isTest: false,
    isUpgradeable: false,
  });
  const configPath = join(workDir, "wrong-chain.json");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = await runCommand("pnpm", [
    "run",
    "deploy:token",
    "--",
    "--config",
    configPath,
  ], {
    DOTENV_CONFIG_PATH: envPath,
  }, false);

  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /Chain ID mismatch/);
}

async function assertTokenDeployment({
  provider,
  record,
  expectedConfig,
  deployerAddress,
}: {
  provider: JsonRpcProvider;
  record: DeploymentRecord;
  expectedConfig: TokenConfig;
  deployerAddress: string;
}): Promise<void> {
  const token = new Contract(record.tokenAddress, tokenAbi, provider);
  const expectedSupply = parseUnits(
    expectedConfig.initialSupply,
    expectedConfig.decimals,
  );
  const expectedInitialRecipient = getAddress(
    expectedConfig.initialRecipient ?? deployerAddress,
  );
  const expectedOwner = getAddress(expectedConfig.owner ?? deployerAddress);

  assert.equal(record.chainId, expectedConfig.chainId);
  assert.equal(record.rpcHost, new URL(expectedConfig.rpc).host);
  assert.equal(record.deployer, getAddress(deployerAddress));
  assert.equal(record.tokenName, expectedConfig.tokenName);
  assert.equal(record.symbol, expectedConfig.symbol);
  assert.equal(record.decimals, expectedConfig.decimals);
  assert.equal(record.initialSupply, expectedConfig.initialSupply);
  assert.equal(record.initialSupplyBaseUnits, expectedSupply.toString());
  assert.equal(record.initialRecipient, expectedInitialRecipient);
  assert.equal(record.owner, expectedOwner);
  assert.equal(record.isTest, expectedConfig.isTest);
  assert.equal(record.isUpgradeable, expectedConfig.isUpgradeable);
  assert.equal(record.confirmations, expectedConfig.confirmations);
  assert.equal(record.verified, false);
  assert.equal(record.metadata.project, "anvil-e2e");
  assert.ok(record.transactionHash.startsWith("0x"));
  assert.ok(record.blockNumber > 0);

  assert.equal(await token.name(), expectedConfig.tokenName);
  assert.equal(await token.symbol(), expectedConfig.symbol);
  assert.equal(await token.decimals(), BigInt(expectedConfig.decimals));
  assert.equal(await token.totalSupply(), expectedSupply);
  assert.equal(await token.balanceOf(expectedInitialRecipient), expectedSupply);
  assert.equal(await token.owner(), expectedOwner);
  assert.equal(await token.isTest(), expectedConfig.isTest);

  const code = await provider.getCode(record.tokenAddress);
  assert.notEqual(code, "0x");
}

async function assertUpgradeableRecord({
  provider,
  record,
}: {
  provider: JsonRpcProvider;
  record: DeploymentRecord;
}): Promise<void> {
  assert.equal(record.proxyAddress, record.tokenAddress);
  assert.ok(record.implementationAddress);
  assert.notEqual(record.implementationAddress, record.proxyAddress);

  const implementationCode = await provider.getCode(record.implementationAddress);
  assert.notEqual(implementationCode, "0x");

  const rawSlot = await provider.getStorage(record.proxyAddress, IMPLEMENTATION_SLOT);
  assert.equal(addressFromStorage(rawSlot), getAddress(record.implementationAddress));
}

async function assertPublicMintWorks({
  provider,
  tokenAddress,
  minter,
  recipient,
  amount,
}: {
  provider: JsonRpcProvider;
  tokenAddress: string;
  minter: Wallet;
  recipient: string;
  amount: bigint;
}): Promise<void> {
  const token = new Contract(tokenAddress, tokenAbi, minter);
  const before = await token.balanceOf(recipient);
  await (await token.mint(recipient, amount)).wait();
  assert.equal(await token.balanceOf(recipient), before + amount);
}

async function assertMintReverts({
  tokenAddress,
  minter,
  recipient,
}: {
  tokenAddress: string;
  minter: Wallet;
  recipient: string;
}): Promise<void> {
  const token = new Contract(tokenAddress, tokenAbi, minter);

  try {
    await token.mint(recipient, 1n);
  } catch (error) {
    assert.match(String(error), /MintDisabled|0x17efbd6b/);
    return;
  }

  throw new Error("Expected production mint to revert");
}

async function startAnvil(port: number): Promise<ChildProcessWithoutNullStreams> {
  const anvil = spawn("anvil", [
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--chain-id",
    String(CHAIN_ID),
    "--mnemonic",
    MNEMONIC,
    "--quiet",
  ]);

  anvil.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`anvil exited with code ${code}`);
    }
    if (signal !== null) {
      console.error(`anvil exited with signal ${signal}`);
    }
  });

  return anvil;
}

async function waitForRpc(provider: JsonRpcProvider): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    try {
      await provider.getBlockNumber();
      return;
    } catch {
      await delay(100);
    }
  }

  throw new Error("Timed out waiting for Anvil RPC");
}

async function waitForRpcUrl(rpc: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    try {
      const response = await fetch(rpc, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
      });
      const payload = (await response.json()) as { result?: string };
      if (payload.result !== undefined) {
        return;
      }
    } catch {
      await delay(100);
    }
  }

  throw new Error("Timed out waiting for Anvil HTTP RPC");
}

async function stopAnvil(anvil: ChildProcessWithoutNullStreams): Promise<void> {
  if (anvil.exitCode !== null) {
    return;
  }

  anvil.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => anvil.once("exit", () => resolve())),
    delay(2_000).then(() => {
      if (anvil.exitCode === null) {
        anvil.kill("SIGKILL");
      }
    }),
  ]);
}

async function runCommand(
  command: string,
  args: Array<string>,
  env: Record<string, string> = {},
  expectSuccess = true,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
    },
  });
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });

  if (expectSuccess && exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with code ${exitCode}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
    );
  }

  return { exitCode, stdout, stderr };
}

function parseDeploymentRecordPath(stdout: string): string {
  const match = stdout.match(/Deployment record: (.+)$/m);
  if (match === null) {
    throw new Error(`Could not find deployment record path in stdout:\n${stdout}`);
  }

  return match[1].trim();
}

function addressFromStorage(storageValue: string): string {
  return getAddress(`0x${storageValue.slice(-40)}`);
}

function walletAt(index: number): Wallet {
  const wallet = HDNodeWallet.fromPhrase(
    MNEMONIC,
    undefined,
    `m/44'/60'/0'/0/${index}`,
  );
  return new Wallet(wallet.privateKey);
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a TCP port")));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
