#!/usr/bin/env tsx

import "dotenv/config";

import { spawn } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { AbiCoder, Interface, getAddress, type InterfaceAbi } from "ethers";

import {
  loadTokenConfig,
  type TokenConfig,
} from "../src/config/tokenConfig.js";

type CliOptions = {
  configPath: string;
  deploymentPath?: string;
  address?: string;
  apiKeyEnv?: string;
  noPoll: boolean;
};

type DeploymentRecord = {
  timestamp: string;
  chainId: number;
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
  verified: boolean;
  metadata?: unknown;
};

type VerificationTarget = {
  label: string;
  address: string;
  contractName: ContractName;
  constructorArguments: string;
};

type ContractName =
  | "ConfigurableERC20"
  | "ConfigurableERC20Upgradeable"
  | "ConfigurableERC1967Proxy";

type HardhatArtifact = {
  contractName?: string;
  sourceName?: string;
  inputSourceName?: string;
  buildInfoId?: string;
  abi: InterfaceAbi;
};

type SolcInput = {
  language: string;
  sources: Record<string, unknown>;
  settings?: {
    optimizer?: {
      enabled?: boolean;
      runs?: number;
    };
    evmVersion?: string;
  } & Record<string, unknown>;
};

type BuildInfo = {
  solcVersion?: string;
  solcLongVersion?: string;
  input?: SolcInput;
};

type VerificationArtifact = {
  contractIdentifier: string;
  compilerVersion: string;
  standardJsonInput: SolcInput;
  optimizerUsed: string;
  optimizerRuns: string;
  evmVersion?: string;
};

type EtherscanResponse = {
  status: string;
  message: string;
  result: string;
};

const VERIFY_API_URL = "https://api.etherscan.io/v2/api";
const DEFAULT_API_KEY_ENV = "ETHERSCAN_API_KEY";
const MIT_LICENSE_TYPE = "3";
const POLL_DELAY_MS = 5_000;
const POLL_ATTEMPTS = 24;

const ARTIFACT_PATHS: Record<ContractName, string> = {
  ConfigurableERC20:
    "artifacts/contracts/ConfigurableERC20.sol/ConfigurableERC20.json",
  ConfigurableERC20Upgradeable:
    "artifacts/contracts/ConfigurableERC20Upgradeable.sol/ConfigurableERC20Upgradeable.json",
  ConfigurableERC1967Proxy:
    "artifacts/contracts/ConfigurableERC1967Proxy.sol/ConfigurableERC1967Proxy.json",
};

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const config = await loadTokenConfig(options.configPath);
  const deployment = await loadDeploymentForConfig(config, options);
  const apiKeyEnv =
    options.apiKeyEnv ?? config.verify.apiKeyEnv ?? DEFAULT_API_KEY_ENV;
  const apiKey = readApiKey(apiKeyEnv);

  if (!config.verify.enabled) {
    console.warn(
      "verify.enabled is false in config, but verify:token was called; continuing."
    );
  }

  const targets = await buildVerificationTargets(deployment);
  console.log(
    `Verifying ${deployment.symbol} on chain ${deployment.chainId} using ${apiKeyEnv}`
  );

  let allTargetsVerified = true;
  for (const target of targets) {
    const artifact = await readVerificationArtifact(target.contractName);
    const guid = await submitVerification({
      chainId: deployment.chainId,
      apiKey,
      target,
      artifact,
    });

    if (guid !== undefined && options.noPoll) {
      allTargetsVerified = false;
    }

    if (guid !== undefined && !options.noPoll) {
      await waitForVerification({
        chainId: deployment.chainId,
        apiKey,
        guid,
        label: target.label,
      });
    }
  }

  if (allTargetsVerified && deployment.deploymentPath !== undefined) {
    await markDeploymentVerified(deployment.deploymentPath);
  }

  console.log("Verification submitted successfully.");
}

function parseCliArgs(argv: Array<string>): CliOptions {
  let configPath: string | undefined;
  let deploymentPath: string | undefined;
  let address: string | undefined;
  let apiKeyEnv: string | undefined;
  let noPoll = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--no-poll") {
      noPoll = true;
      continue;
    }

    if (arg === "--config") {
      configPath = readOptionValue(argv, index, "--config");
      index += 1;
      continue;
    }

    if (arg.startsWith("--config=")) {
      configPath = readInlineValue(arg, "--config");
      continue;
    }

    if (arg === "--deployment") {
      deploymentPath = readOptionValue(argv, index, "--deployment");
      index += 1;
      continue;
    }

    if (arg.startsWith("--deployment=")) {
      deploymentPath = readInlineValue(arg, "--deployment");
      continue;
    }

    if (arg === "--address") {
      address = readOptionValue(argv, index, "--address");
      index += 1;
      continue;
    }

    if (arg.startsWith("--address=")) {
      address = readInlineValue(arg, "--address");
      continue;
    }

    if (arg === "--api-key-env") {
      apiKeyEnv = readOptionValue(argv, index, "--api-key-env");
      index += 1;
      continue;
    }

    if (arg.startsWith("--api-key-env=")) {
      apiKeyEnv = readInlineValue(arg, "--api-key-env");
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (configPath === undefined) {
    throw new Error("Missing required --config <path> argument");
  }

  return {
    configPath,
    deploymentPath,
    address,
    apiKeyEnv,
    noPoll,
  };
}

function readOptionValue(
  argv: Array<string>,
  index: number,
  optionName: string
): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${optionName}`);
  }
  return value;
}

function readInlineValue(arg: string, optionName: string): string {
  const value = arg.slice(`${optionName}=`.length);
  if (value.length === 0) {
    throw new Error(`Missing value for ${optionName}`);
  }
  return value;
}

function printUsage(): void {
  console.log(
    "Usage: pnpm run verify:token -- --config ./config/tokenconfig.json [--deployment ./deployments/97/USDT-S-....json] [--address 0x...]"
  );
}

function readApiKey(envName: string): string {
  const apiKey = process.env[envName];
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error(`Missing Etherscan API key environment variable: ${envName}`);
  }

  return apiKey.trim();
}

async function loadDeploymentForConfig(
  config: TokenConfig,
  options: CliOptions
): Promise<{
  record: DeploymentRecord;
  deploymentPath?: string;
  chainId: number;
  symbol: string;
  isUpgradeable: boolean;
}> {
  const deploymentPath =
    options.deploymentPath ?? (await findLatestDeploymentPath(config));
  const record = await readDeploymentRecord(deploymentPath);

  if (record.chainId !== config.chainId) {
    throw new Error(
      `Deployment chainId ${record.chainId} does not match config chainId ${config.chainId}`
    );
  }

  if (record.symbol !== config.symbol) {
    throw new Error(
      `Deployment symbol ${record.symbol} does not match config symbol ${config.symbol}`
    );
  }

  const normalizedRecord: DeploymentRecord = {
    ...record,
    tokenAddress: getAddress(options.address ?? record.tokenAddress),
    initialRecipient: getAddress(record.initialRecipient),
    owner: getAddress(record.owner),
  };

  return {
    record: normalizedRecord,
    deploymentPath,
    chainId: normalizedRecord.chainId,
    symbol: normalizedRecord.symbol,
    isUpgradeable: normalizedRecord.isUpgradeable,
  };
}

async function findLatestDeploymentPath(config: TokenConfig): Promise<string> {
  const deploymentDir = resolve("deployments", String(config.chainId));
  let entries;

  try {
    entries = await readdir(deploymentDir, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(
        `No deployment directory found for chain ${config.chainId}. Deploy first or pass --deployment.`
      );
    }
    throw error;
  }

  const matches: Array<{ path: string; record: DeploymentRecord }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const deploymentPath = join(deploymentDir, entry.name);
    const record = await readDeploymentRecord(deploymentPath);
    if (record.chainId === config.chainId && record.symbol === config.symbol) {
      matches.push({ path: deploymentPath, record });
    }
  }

  matches.sort((left, right) =>
    right.record.timestamp.localeCompare(left.record.timestamp)
  );

  const latest = matches[0];
  if (latest === undefined) {
    throw new Error(
      `No deployment record found for ${config.symbol} on chain ${config.chainId}. Pass --deployment if the file is elsewhere.`
    );
  }

  return latest.path;
}

async function readDeploymentRecord(
  deploymentPath: string
): Promise<DeploymentRecord> {
  const parsed = await readJsonFile(resolve(deploymentPath));
  if (!isRecord(parsed)) {
    throw new Error(`Deployment record at ${deploymentPath} must be an object`);
  }

  assertString(parsed.timestamp, "timestamp", deploymentPath);
  assertNumber(parsed.chainId, "chainId", deploymentPath);
  assertString(parsed.deployer, "deployer", deploymentPath);
  assertString(parsed.tokenName, "tokenName", deploymentPath);
  assertString(parsed.symbol, "symbol", deploymentPath);
  assertNumber(parsed.decimals, "decimals", deploymentPath);
  assertString(parsed.initialSupply, "initialSupply", deploymentPath);
  assertString(
    parsed.initialSupplyBaseUnits,
    "initialSupplyBaseUnits",
    deploymentPath
  );
  assertString(parsed.initialRecipient, "initialRecipient", deploymentPath);
  assertString(parsed.owner, "owner", deploymentPath);
  assertBoolean(parsed.isTest, "isTest", deploymentPath);
  assertBoolean(parsed.isUpgradeable, "isUpgradeable", deploymentPath);
  assertString(parsed.tokenAddress, "tokenAddress", deploymentPath);

  return {
    timestamp: parsed.timestamp,
    chainId: parsed.chainId,
    deployer: getAddress(parsed.deployer),
    tokenName: parsed.tokenName,
    symbol: parsed.symbol,
    decimals: parsed.decimals,
    initialSupply: parsed.initialSupply,
    initialSupplyBaseUnits: parsed.initialSupplyBaseUnits,
    initialRecipient: getAddress(parsed.initialRecipient),
    owner: getAddress(parsed.owner),
    isTest: parsed.isTest,
    isUpgradeable: parsed.isUpgradeable,
    implementationAddress:
      typeof parsed.implementationAddress === "string"
        ? getAddress(parsed.implementationAddress)
        : undefined,
    proxyAddress:
      typeof parsed.proxyAddress === "string"
        ? getAddress(parsed.proxyAddress)
        : undefined,
    tokenAddress: getAddress(parsed.tokenAddress),
    verified: parsed.verified === true,
    metadata: parsed.metadata,
  };
}

async function buildVerificationTargets(deployment: {
  record: DeploymentRecord;
}): Promise<Array<VerificationTarget>> {
  const record = deployment.record;

  if (!record.isUpgradeable) {
    return [
      {
        label: "ConfigurableERC20",
        address: record.tokenAddress,
        contractName: "ConfigurableERC20",
        constructorArguments: encodeConstructorArguments(
          [
            "string",
            "string",
            "uint8",
            "address",
            "uint256",
            "bool",
            "address",
          ],
          [
            record.tokenName,
            record.symbol,
            record.decimals,
            record.initialRecipient,
            BigInt(record.initialSupplyBaseUnits),
            record.isTest,
            record.owner,
          ]
        ),
      },
    ];
  }

  if (record.implementationAddress === undefined) {
    throw new Error("Upgradeable deployment record is missing implementationAddress");
  }

  const implementationArtifact = await readHardhatArtifact(
    "ConfigurableERC20Upgradeable"
  );
  const initializer = new Interface(implementationArtifact.abi).encodeFunctionData(
    "initialize",
    [
      record.tokenName,
      record.symbol,
      record.decimals,
      record.initialRecipient,
      BigInt(record.initialSupplyBaseUnits),
      record.isTest,
      record.owner,
    ]
  );
  const proxyAddress = record.proxyAddress ?? record.tokenAddress;

  return [
    {
      label: "ConfigurableERC20Upgradeable implementation",
      address: record.implementationAddress,
      contractName: "ConfigurableERC20Upgradeable",
      constructorArguments: "",
    },
    {
      label: "ConfigurableERC1967Proxy",
      address: proxyAddress,
      contractName: "ConfigurableERC1967Proxy",
      constructorArguments: encodeConstructorArguments(
        ["address", "bytes"],
        [record.implementationAddress, initializer]
      ),
    },
  ];
}

function encodeConstructorArguments(
  types: Array<string>,
  values: Array<unknown>
): string {
  return AbiCoder.defaultAbiCoder().encode(types, values).slice(2);
}

async function readVerificationArtifact(
  contractName: ContractName
): Promise<VerificationArtifact> {
  const artifact = await readHardhatArtifact(contractName);
  const sourceName = artifact.inputSourceName ?? artifact.sourceName;
  if (sourceName === undefined) {
    throw new Error(`Artifact for ${contractName} is missing inputSourceName`);
  }

  const buildInfo = await findBuildInfo(
    sourceName,
    contractName,
    artifact.buildInfoId
  );
  if (buildInfo.input === undefined) {
    throw new Error(`Build info for ${contractName} is missing solc input`);
  }

  const compilerVersion = buildInfo.solcLongVersion ?? buildInfo.solcVersion;
  if (compilerVersion === undefined) {
    throw new Error(`Build info for ${contractName} is missing solc version`);
  }

  const optimizer = buildInfo.input.settings?.optimizer;

  return {
    contractIdentifier: `${sourceName}:${contractName}`,
    compilerVersion: `v${compilerVersion}`,
    standardJsonInput: buildInfo.input,
    optimizerUsed: optimizer?.enabled === true ? "1" : "0",
    optimizerRuns:
      typeof optimizer?.runs === "number" ? String(optimizer.runs) : "200",
    evmVersion: buildInfo.input.settings?.evmVersion,
  };
}

async function readHardhatArtifact(
  contractName: ContractName
): Promise<HardhatArtifact> {
  const parsed = await readJsonFile(resolve(ARTIFACT_PATHS[contractName]));
  if (!isRecord(parsed)) {
    throw new Error(`Artifact for ${contractName} must be an object`);
  }

  if (!Array.isArray(parsed.abi)) {
    throw new Error(`Artifact for ${contractName} is missing abi`);
  }

  return {
    contractName:
      typeof parsed.contractName === "string" ? parsed.contractName : undefined,
    sourceName:
      typeof parsed.sourceName === "string" ? parsed.sourceName : undefined,
    inputSourceName:
      typeof parsed.inputSourceName === "string"
        ? parsed.inputSourceName
        : undefined,
    buildInfoId:
      typeof parsed.buildInfoId === "string" ? parsed.buildInfoId : undefined,
    abi: parsed.abi,
  };
}

async function findBuildInfo(
  sourceName: string,
  contractName: ContractName,
  buildInfoId?: string
): Promise<BuildInfo> {
  const buildInfoDir = resolve("artifacts", "build-info");

  if (buildInfoId !== undefined) {
    const buildInfoPath = join(buildInfoDir, `${buildInfoId}.json`);
    const parsed = await readJsonFile(buildInfoPath);
    if (isBuildInfo(parsed) && parsed.input?.sources[sourceName] !== undefined) {
      return parsed;
    }
  }

  const entries = await readdir(buildInfoDir, { withFileTypes: true });

  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.endsWith(".json") ||
      entry.name.endsWith(".output.json")
    ) {
      continue;
    }

    const buildInfoPath = join(buildInfoDir, entry.name);
    const parsed = await readJsonFile(buildInfoPath);
    if (!isBuildInfo(parsed)) {
      continue;
    }

    if (parsed.input?.sources[sourceName] !== undefined) {
      return parsed;
    }
  }

  throw new Error(
    `No Hardhat build-info found for ${sourceName}:${contractName}. Run pnpm run compile first.`
  );
}

async function submitVerification({
  chainId,
  apiKey,
  target,
  artifact,
}: {
  chainId: number;
  apiKey: string;
  target: VerificationTarget;
  artifact: VerificationArtifact;
}): Promise<string | undefined> {
  console.log(`Submitting ${target.label}: ${target.address}`);

  const params = new URLSearchParams({
    chainid: String(chainId),
    module: "contract",
    action: "verifysourcecode",
    apikey: apiKey,
    contractaddress: target.address,
    sourceCode: JSON.stringify(artifact.standardJsonInput),
    codeformat: "solidity-standard-json-input",
    contractname: artifact.contractIdentifier,
    compilerversion: artifact.compilerVersion,
    constructorArguments: target.constructorArguments,
    optimizationUsed: artifact.optimizerUsed,
    runs: artifact.optimizerRuns,
    licenseType: MIT_LICENSE_TYPE,
  });

  if (artifact.evmVersion !== undefined) {
    params.set("evmversion", artifact.evmVersion);
  }

  const response = await postEtherscan(params);
  if (response.status === "1") {
    console.log(`Submitted ${target.label}; guid: ${response.result}`);
    return response.result;
  }

  if (isAlreadyVerified(response.result)) {
    console.log(`${target.label} is already verified.`);
    return undefined;
  }

  throw new Error(
    `Verification submission failed for ${target.label}: ${response.message} - ${response.result}`
  );
}

async function waitForVerification({
  chainId,
  apiKey,
  guid,
  label,
}: {
  chainId: number;
  apiKey: string;
  guid: string;
  label: string;
}): Promise<void> {
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    await delay(POLL_DELAY_MS);

    const response = await postEtherscan(
      new URLSearchParams({
        chainid: String(chainId),
        module: "contract",
        action: "checkverifystatus",
        apikey: apiKey,
        guid,
      })
    );

    if (response.status === "1") {
      console.log(`${label}: ${response.result}`);
      return;
    }

    if (isPendingVerification(response.result)) {
      console.log(`${label}: pending (${attempt}/${POLL_ATTEMPTS})`);
      continue;
    }

    if (isAlreadyVerified(response.result)) {
      console.log(`${label}: already verified.`);
      return;
    }

    throw new Error(
      `Verification failed for ${label}: ${response.message} - ${response.result}`
    );
  }

  throw new Error(
    `Verification for ${label} is still pending after ${POLL_ATTEMPTS} checks.`
  );
}

async function postEtherscan(params: URLSearchParams): Promise<EtherscanResponse> {
  let text: string;
  const url = etherscanApiUrl(params);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    text = await response.text();
    if (!response.ok) {
      throw new Error(`Etherscan API HTTP ${response.status}: ${text}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Node fetch failed (${message}); retrying with curl.`);
    text = await postEtherscanWithCurl(url, params);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Etherscan API JSON response: ${message}`);
  }

  if (!isEtherscanResponse(parsed)) {
    throw new Error(`Unexpected Etherscan API response: ${text}`);
  }

  return parsed;
}

function etherscanApiUrl(params: URLSearchParams): string {
  const chainId = params.get("chainid");
  if (chainId === null) {
    return VERIFY_API_URL;
  }

  return `${VERIFY_API_URL}?chainid=${encodeURIComponent(chainId)}`;
}

async function postEtherscanWithCurl(
  url: string,
  params: URLSearchParams
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const proxy = curlProxyUrl();
    const proxyArgs = proxy === undefined ? [] : ["--proxy", proxy];
    const child = spawn(
      "curl",
      [
        "-sS",
        "-m",
        "120",
        "--retry",
        "3",
        "--retry-all-errors",
        ...proxyArgs,
        "-X",
        "POST",
        "-H",
        "content-type: application/x-www-form-urlencoded",
        "--data-binary",
        "@-",
        url,
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }

      reject(
        new Error(
          `curl exited with code ${code}: ${stderr.trim() || stdout.trim()}`
        )
      );
    });

    child.stdin.end(params.toString());
  });
}

function curlProxyUrl(): string | undefined {
  return (
    process.env.all_proxy ??
    process.env.ALL_PROXY ??
    process.env.https_proxy ??
    process.env.HTTPS_PROXY ??
    process.env.http_proxy ??
    process.env.HTTP_PROXY
  );
}

function isPendingVerification(result: string): boolean {
  return /pending|queue/i.test(result);
}

function isAlreadyVerified(result: string): boolean {
  return /already verified|already been verified/i.test(result);
}

async function markDeploymentVerified(
  deploymentPath: string
): Promise<void> {
  const parsed = await readJsonFile(deploymentPath);
  if (!isRecord(parsed)) {
    throw new Error(`Deployment record at ${deploymentPath} must be an object`);
  }

  await writeFile(
    deploymentPath,
    `${JSON.stringify({ ...parsed, verified: true }, null, 2)}\n`
  );
  console.log(`Updated deployment record: ${deploymentPath}`);
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

function assertString(value: unknown, field: string, filePath: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`Deployment record at ${filePath} is missing ${field}`);
  }
}

function assertNumber(value: unknown, field: string, filePath: string): asserts value is number {
  if (typeof value !== "number") {
    throw new Error(`Deployment record at ${filePath} is missing ${field}`);
  }
}

function assertBoolean(
  value: unknown,
  field: string,
  filePath: string
): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Deployment record at ${filePath} is missing ${field}`);
  }
}

function isBuildInfo(value: unknown): value is BuildInfo {
  if (!isRecord(value) || !isRecord(value.input)) {
    return false;
  }

  const input = value.input;
  return input.language === "Solidity" && isRecord(input.sources);
}

function isEtherscanResponse(value: unknown): value is EtherscanResponse {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.status === "string" &&
    typeof value.message === "string" &&
    typeof value.result === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
