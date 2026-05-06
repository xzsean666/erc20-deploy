import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "chai";

import { loadTokenConfig } from "../src/config/tokenConfig.js";

describe("token config loader", function () {
  async function withConfigFile(
    config: Record<string, unknown>,
    test: (path: string) => Promise<void>,
  ) {
    const directory = await mkdtemp(join(tmpdir(), "erc20-tokenconfig-"));
    const configPath = join(directory, "tokenconfig.json");

    try {
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
      await test(configPath);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  function validConfig(overrides: Record<string, unknown> = {}) {
    return {
      rpc: "http://127.0.0.1:8545",
      chainId: 31337,
      deployerPrivateKeyEnv: "DEPLOYER_PRIVATE_KEY",
      tokenName: "Config Token",
      symbol: "CFG",
      decimals: 6,
      initialSupply: "1000.123456",
      initialRecipient: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
      owner: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
      isTest: true,
      isUpgradeable: false,
      ...overrides,
    };
  }

  it("loads a valid config, normalizes addresses, and applies defaults", async function () {
    await withConfigFile(validConfig(), async (configPath) => {
      const config = await loadTokenConfig(configPath);

      expect(config.symbol).to.equal("CFG");
      expect(config.initialRecipient).to.equal(
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      );
      expect(config.owner).to.equal(
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      );
      expect(config.confirmations).to.equal(2);
      expect(config.verify.enabled).to.equal(false);
      expect(config.gas).to.deep.equal({});
    });
  });

  it("rejects an initialSupply with more fractional digits than decimals", async function () {
    await withConfigFile(
      validConfig({ decimals: 2, initialSupply: "1.001" }),
      async (configPath) => {
        await expectConfigError(configPath, "initialSupply");
      },
    );
  });

  it("rejects unknown top-level fields", async function () {
    await withConfigFile(
      validConfig({ privateKey: "0xshould-not-be-here" }),
      async (configPath) => {
        await expectConfigError(configPath, "Unrecognized key");
      },
    );
  });
});

async function expectConfigError(
  configPath: string,
  expectedMessagePart: string,
): Promise<void> {
  try {
    await loadTokenConfig(configPath);
  } catch (error) {
    expect(error).to.be.instanceOf(Error);
    expect((error as Error).message).to.include(expectedMessagePart);
    return;
  }

  throw new Error("Expected loadTokenConfig to reject");
}
