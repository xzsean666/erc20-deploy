#!/usr/bin/env tsx

import "dotenv/config";

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  ContractFactory,
  Interface,
  JsonRpcProvider,
  NonceManager,
  Wallet,
  getAddress,
  parseUnits,
  type InterfaceAbi,
  type Signer,
} from "ethers";

import {
  loadTokenConfig,
  type TokenConfig,
} from "../src/config/tokenConfig.js";

type CliOptions = {
  configPath: string;
};

type DeploymentOverrides = {
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
};

type HardhatArtifact = {
  contractName?: string;
  sourceName?: string;
  abi: InterfaceAbi;
  bytecode: string;
  artifactPath: string;
};

type DeployedContract = {
  address: string;
  transactionHash: string;
  blockNumber: number;
};

type TokenDeployment = DeployedContract & {
  implementationAddress?: string;
  implementationTransactionHash?: string;
  implementationBlockNumber?: number;
  proxyAddress?: string;
};

type DeploymentRecord = {
  timestamp: string;
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
  implementationTransactionHash?: string;
  implementationBlockNumber?: number;
  proxyAddress?: string;
  tokenAddress: string;
  transactionHash: string;
  blockNumber: number;
  confirmations: number;
  verified: boolean;
  metadata: TokenConfig["metadata"];
};

const ARTIFACT_CANDIDATES: Record<string, Array<string>> = {
  ConfigurableERC20: [
    "artifacts/contracts/ConfigurableERC20.sol/ConfigurableERC20.json",
  ],
  ConfigurableERC20Upgradeable: [
    "artifacts/contracts/ConfigurableERC20Upgradeable.sol/ConfigurableERC20Upgradeable.json",
  ],
  ConfigurableERC1967Proxy: [
    "artifacts/contracts/ConfigurableERC1967Proxy.sol/ConfigurableERC1967Proxy.json",
  ],
};

const BUILD_INFO_SOURCE_HINTS: Record<string, Array<string>> = {
  ConfigurableERC20: ["contracts/ConfigurableERC20.sol"],
  ConfigurableERC20Upgradeable: ["contracts/ConfigurableERC20Upgradeable.sol"],
  ConfigurableERC1967Proxy: ["contracts/ConfigurableERC1967Proxy.sol"],
};

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const config = await loadTokenConfig(options.configPath);
  const rpcHost = getRpcHost(config.rpc);
  const provider = new JsonRpcProvider(config.rpc);

  await assertChainId(provider, config.chainId);

  const privateKey = readPrivateKey(config.deployerPrivateKeyEnv);
  const wallet = new NonceManager(new Wallet(privateKey, provider));
  const deployer = getAddress(await wallet.getAddress());
  const initialSupplyBaseUnits = parseUnits(
    config.initialSupply,
    config.decimals
  );
  const overrides = buildDeploymentOverrides(config.gas);

  console.log(
    `Deploying ${config.symbol} to chain ${config.chainId} via ${rpcHost}`
  );
  console.log(`Deployer: ${deployer}`);

  const deployment = config.isUpgradeable
    ? await deployUpgradeableToken(
        config,
        wallet,
        initialSupplyBaseUnits,
        overrides
      )
    : await deployDirectToken(
        config,
        wallet,
        initialSupplyBaseUnits,
        overrides
      );

  const verified = await maybeVerify(config);
  const timestamp = new Date().toISOString();
  const record: DeploymentRecord = {
    timestamp,
    chainId: config.chainId,
    rpcHost,
    deployer,
    tokenName: config.tokenName,
    symbol: config.symbol,
    decimals: config.decimals,
    initialSupply: config.initialSupply,
    initialSupplyBaseUnits: initialSupplyBaseUnits.toString(),
    initialRecipient: config.initialRecipient,
    owner: config.owner,
    isTest: config.isTest,
    isUpgradeable: config.isUpgradeable,
    implementationAddress: deployment.implementationAddress,
    implementationTransactionHash: deployment.implementationTransactionHash,
    implementationBlockNumber: deployment.implementationBlockNumber,
    proxyAddress: deployment.proxyAddress,
    tokenAddress: deployment.address,
    transactionHash: deployment.transactionHash,
    blockNumber: deployment.blockNumber,
    confirmations: config.confirmations,
    verified,
    metadata: config.metadata,
  };

  const outputPath = await writeDeploymentRecord(record);

  console.log(`Token address: ${record.tokenAddress}`);
  if (record.implementationAddress !== undefined) {
    console.log(`Implementation address: ${record.implementationAddress}`);
  }
  console.log(`Deployment record: ${outputPath}`);
}

function parseCliArgs(argv: Array<string>): CliOptions {
  let configPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--config") {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error("Missing value for --config");
      }
      configPath = next;
      index += 1;
      continue;
    }

    if (arg.startsWith("--config=")) {
      const value = arg.slice("--config=".length);
      if (value.length === 0) {
        throw new Error("Missing value for --config");
      }
      configPath = value;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (configPath === undefined) {
    throw new Error("Missing required --config <path> argument");
  }

  return { configPath };
}

function printUsage(): void {
  console.log("Usage: pnpm run deploy:token -- --config ./config/tokenconfig.json");
}

async function assertChainId(
  provider: JsonRpcProvider,
  expectedChainId: number
): Promise<void> {
  const network = await provider.getNetwork();
  const actualChainId = network.chainId;

  if (actualChainId !== BigInt(expectedChainId)) {
    throw new Error(
      `Chain ID mismatch: token config expects ${expectedChainId}, but RPC returned ${actualChainId.toString()}`
    );
  }
}

function readPrivateKey(envName: string): string {
  const privateKey = process.env[envName];
  if (privateKey === undefined || privateKey.trim().length === 0) {
    throw new Error(
      `Missing deployer private key environment variable: ${envName}`
    );
  }

  return privateKey.trim();
}

function buildDeploymentOverrides(
  gas: TokenConfig["gas"]
): DeploymentOverrides {
  const overrides: DeploymentOverrides = {};

  if (gas.maxFeePerGasGwei !== undefined) {
    overrides.maxFeePerGas = parseUnits(gas.maxFeePerGasGwei, "gwei");
  }

  if (gas.maxPriorityFeePerGasGwei !== undefined) {
    overrides.maxPriorityFeePerGas = parseUnits(
      gas.maxPriorityFeePerGasGwei,
      "gwei"
    );
  }

  return overrides;
}

async function deployDirectToken(
  config: TokenConfig,
  signer: Signer,
  initialSupplyBaseUnits: bigint,
  overrides: DeploymentOverrides
): Promise<TokenDeployment> {
  const artifact = await readArtifact("ConfigurableERC20");
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);

  return deployContract(
    "ConfigurableERC20",
    factory,
    [
      config.tokenName,
      config.symbol,
      config.decimals,
      config.initialRecipient,
      initialSupplyBaseUnits,
      config.isTest,
      config.owner,
    ],
    config.confirmations,
    overrides
  );
}

async function deployUpgradeableToken(
  config: TokenConfig,
  signer: Signer,
  initialSupplyBaseUnits: bigint,
  overrides: DeploymentOverrides
): Promise<TokenDeployment> {
  const implementationArtifact = await readArtifact(
    "ConfigurableERC20Upgradeable"
  );
  const implementationFactory = new ContractFactory(
    implementationArtifact.abi,
    implementationArtifact.bytecode,
    signer
  );

  const implementation = await deployContract(
    "ConfigurableERC20Upgradeable implementation",
    implementationFactory,
    [],
    config.confirmations,
    overrides
  );

  const initializer = new Interface(
    implementationArtifact.abi
  ).encodeFunctionData("initialize", [
    config.tokenName,
    config.symbol,
    config.decimals,
    config.initialRecipient,
    initialSupplyBaseUnits,
    config.isTest,
    config.owner,
  ]);

  const proxyArtifact = await readArtifact("ConfigurableERC1967Proxy");
  const proxyFactory = new ContractFactory(
    proxyArtifact.abi,
    proxyArtifact.bytecode,
    signer
  );
  const proxy = await deployContract(
    "ConfigurableERC1967Proxy",
    proxyFactory,
    [implementation.address, initializer],
    config.confirmations,
    overrides
  );

  return {
    ...proxy,
    proxyAddress: proxy.address,
    implementationAddress: implementation.address,
    implementationTransactionHash: implementation.transactionHash,
    implementationBlockNumber: implementation.blockNumber,
  };
}

async function deployContract(
  label: string,
  factory: ContractFactory,
  args: Array<unknown>,
  confirmations: number,
  overrides: DeploymentOverrides
): Promise<DeployedContract> {
  const contract = await factory.deploy(...args, overrides);
  const deploymentTransaction = contract.deploymentTransaction();

  if (deploymentTransaction === null) {
    throw new Error(`No deployment transaction was returned for ${label}`);
  }

  const address = getAddress(await contract.getAddress());
  console.log(`Submitted ${label}: ${address}`);

  const receipt = await deploymentTransaction.wait(Math.max(confirmations, 1));
  if (receipt === null) {
    throw new Error(`Deployment transaction for ${label} was not mined`);
  }

  if (receipt.status !== 1) {
    throw new Error(
      `Deployment transaction for ${label} failed: ${deploymentTransaction.hash}`
    );
  }

  console.log(`Confirmed ${label} in block ${receipt.blockNumber}`);

  return {
    address,
    transactionHash: deploymentTransaction.hash,
    blockNumber: receipt.blockNumber,
  };
}

async function readArtifact(contractName: string): Promise<HardhatArtifact> {
  const candidates = ARTIFACT_CANDIDATES[contractName] ?? [];

  for (const relativePath of candidates) {
    const artifactPath = resolve(relativePath);
    const artifact = await tryReadArtifactAtPath(artifactPath, contractName);
    if (artifact !== undefined) {
      return artifact;
    }
  }

  const matches = await findArtifactFiles(
    resolve("artifacts"),
    `${contractName}.json`
  );
  for (const artifactPath of matches) {
    const artifact = await tryReadArtifactAtPath(artifactPath, contractName);
    if (artifact !== undefined) {
      return artifact;
    }
  }

  const buildInfoArtifact = await readArtifactFromBuildInfo(contractName);
  if (buildInfoArtifact !== undefined) {
    return buildInfoArtifact;
  }

  const checked =
    candidates.length > 0 ? ` Checked ${candidates.join(", ")}.` : "";
  throw new Error(
    `Missing Hardhat artifact for ${contractName}. Run pnpm run compile before deploying.${checked}`
  );
}

async function tryReadArtifactAtPath(
  artifactPath: string,
  expectedContractName: string
): Promise<HardhatArtifact | undefined> {
  let raw: string;

  try {
    raw = await readFile(artifactPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid artifact JSON at ${artifactPath}: ${message}`);
  }

  if (!isArtifactLike(parsed)) {
    return undefined;
  }

  if (
    parsed.contractName !== undefined &&
    parsed.contractName !== expectedContractName
  ) {
    return undefined;
  }

  if (!parsed.bytecode.startsWith("0x") || parsed.bytecode === "0x") {
    throw new Error(
      `Artifact for ${expectedContractName} at ${artifactPath} has empty bytecode`
    );
  }

  if (parsed.bytecode.includes("__")) {
    throw new Error(
      `Artifact for ${expectedContractName} at ${artifactPath} contains unresolved library links`
    );
  }

  return {
    contractName: parsed.contractName,
    sourceName: parsed.sourceName,
    abi: parsed.abi,
    bytecode: parsed.bytecode,
    artifactPath,
  };
}

function isArtifactLike(value: unknown): value is {
  contractName?: string;
  sourceName?: string;
  abi: InterfaceAbi;
  bytecode: string;
} {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate.abi) && typeof candidate.bytecode === "string";
}

async function findArtifactFiles(
  directory: string,
  fileName: string
): Promise<Array<string>> {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const matches: Array<string> = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "build-info") {
        continue;
      }
      matches.push(...(await findArtifactFiles(fullPath, fileName)));
      continue;
    }

    if (
      entry.isFile() &&
      entry.name === fileName &&
      !entry.name.endsWith(".dbg.json")
    ) {
      matches.push(fullPath);
    }
  }

  return matches.sort();
}

async function readArtifactFromBuildInfo(
  contractName: string
): Promise<HardhatArtifact | undefined> {
  const buildInfoFiles = await findFilesWithSuffix(
    resolve("artifacts", "build-info"),
    ".output.json"
  );
  const matches: Array<HardhatArtifact> = [];

  for (const buildInfoPath of buildInfoFiles) {
    const parsed = await readJsonFile(buildInfoPath);
    const contracts = getSolcOutputContracts(parsed);

    if (contracts === undefined) {
      continue;
    }

    for (const [sourceName, sourceContracts] of Object.entries(contracts)) {
      if (!isRecord(sourceContracts)) {
        continue;
      }

      const contractOutput = sourceContracts[contractName];
      if (!isRecord(contractOutput)) {
        continue;
      }

      const artifact = solcOutputToArtifact(
        contractName,
        sourceName,
        buildInfoPath,
        contractOutput
      );
      if (artifact !== undefined) {
        matches.push(artifact);
      }
    }
  }

  matches.sort((left, right) => {
    const sourceScore =
      scoreSourceHint(contractName, left.sourceName ?? "") -
      scoreSourceHint(contractName, right.sourceName ?? "");
    return sourceScore === 0
      ? left.artifactPath.localeCompare(right.artifactPath)
      : sourceScore;
  });

  return matches[0];
}

async function findFilesWithSuffix(
  directory: string,
  suffix: string
): Promise<Array<string>> {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const matches: Array<string> = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      matches.push(...(await findFilesWithSuffix(fullPath, suffix)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(suffix)) {
      matches.push(fullPath);
    }
  }

  return matches.sort();
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf8");

  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON at ${filePath}: ${message}`);
  }
}

function getSolcOutputContracts(
  value: unknown
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const output = isRecord(value.output) ? value.output : value;
  return isRecord(output.contracts) ? output.contracts : undefined;
}

function solcOutputToArtifact(
  contractName: string,
  sourceName: string,
  buildInfoPath: string,
  contractOutput: Record<string, unknown>
): HardhatArtifact | undefined {
  const abi = contractOutput.abi;
  const evm = contractOutput.evm;

  if (!Array.isArray(abi) || !isRecord(evm) || !isRecord(evm.bytecode)) {
    return undefined;
  }

  const bytecodeObject = evm.bytecode.object;
  if (typeof bytecodeObject !== "string") {
    return undefined;
  }

  const bytecode = bytecodeObject.startsWith("0x")
    ? bytecodeObject
    : `0x${bytecodeObject}`;
  if (bytecode === "0x") {
    throw new Error(`${contractName} in ${buildInfoPath} has empty bytecode`);
  }

  if (bytecode.includes("__")) {
    throw new Error(
      `${contractName} in ${buildInfoPath} contains unresolved library links`
    );
  }

  return {
    contractName,
    sourceName,
    abi,
    bytecode,
    artifactPath: `${buildInfoPath}#${sourceName}:${contractName}`,
  };
}

function scoreSourceHint(contractName: string, sourceName: string): number {
  const hints = BUILD_INFO_SOURCE_HINTS[contractName] ?? [];
  const hintIndex = hints.findIndex(
    (hint) => sourceName.endsWith(hint) || sourceName.includes(hint)
  );
  return hintIndex === -1 ? Number.MAX_SAFE_INTEGER : hintIndex;
}

async function maybeVerify(config: TokenConfig): Promise<boolean> {
  if (!config.verify.enabled) {
    return false;
  }

  console.warn(
    "verify.enabled is true, but explorer verification is not implemented in this script; recording verified=false."
  );
  return false;
}

async function writeDeploymentRecord(
  record: DeploymentRecord
): Promise<string> {
  const timestampForFile = record.timestamp.replace(/[:.]/g, "-");
  const deploymentDir = resolve("deployments", String(record.chainId));
  const outputPath = join(
    deploymentDir,
    `${record.symbol}-${timestampForFile}.json`
  );

  await mkdir(deploymentDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });

  return outputPath;
}

function getRpcHost(rpc: string): string {
  return new URL(rpc).host;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
