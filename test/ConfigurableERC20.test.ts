import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const TOKEN_NAME = "Configurable Token";
const TOKEN_SYMBOL = "CFG";

describe("ConfigurableERC20", function () {
  async function deployTokenFixture({
    decimals = 6,
    initialSupplyBaseUnits = ethers.parseUnits("1234567.890123", decimals),
    isTest = false,
  }: {
    decimals?: number;
    initialSupplyBaseUnits?: bigint;
    isTest?: boolean;
  } = {}) {
    const [deployer, initialRecipient, owner, minter, thirdParty] =
      await ethers.getSigners();

    const token = await ethers.deployContract("ConfigurableERC20", [
      TOKEN_NAME,
      TOKEN_SYMBOL,
      decimals,
      await initialRecipient.getAddress(),
      initialSupplyBaseUnits,
      isTest,
      await owner.getAddress(),
    ]);

    return {
      deployer,
      initialRecipient,
      owner,
      minter,
      thirdParty,
      token,
      decimals,
      initialSupplyBaseUnits,
    };
  }

  it("returns the configured decimals value", async function () {
    const decimals = 8;
    const { token } = await deployTokenFixture({ decimals });

    expect(await token.decimals()).to.equal(BigInt(decimals));
  });

  it("mints the initial supply in base units to the initial recipient", async function () {
    const decimals = 6;
    const initialSupplyBaseUnits = ethers.parseUnits("2500000.123456", decimals);

    const { token, initialRecipient } = await deployTokenFixture({
      decimals,
      initialSupplyBaseUnits,
    });

    expect(await token.totalSupply()).to.equal(initialSupplyBaseUnits);
    expect(await token.balanceOf(await initialRecipient.getAddress())).to.equal(
      initialSupplyBaseUnits,
    );
  });

  it("allows any signer to mint to a third party when isTest is true", async function () {
    const mintAmount = 42_000n;
    const { token, minter, thirdParty } = await deployTokenFixture({
      isTest: true,
    });
    const tokenAsMinter = token.connect(minter) as typeof token;
    const thirdPartyAddress = await thirdParty.getAddress();

    await (await tokenAsMinter.mint(thirdPartyAddress, mintAmount)).wait();

    expect(await token.balanceOf(thirdPartyAddress)).to.equal(mintAmount);
  });

  it("reverts mint calls when isTest is false", async function () {
    const { token, minter, thirdParty } = await deployTokenFixture();
    const tokenAsMinter = token.connect(minter) as typeof token;

    await expectTransactionRevert(
      tokenAsMinter.mint(await thirdParty.getAddress(), 1n),
      "MintDisabled",
    );
  });
});

async function expectTransactionRevert(
  promise: Promise<unknown>,
  expectedMessagePart: string,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).to.be.instanceOf(Error);
    expect((error as Error).message).to.include(expectedMessagePart);
    return;
  }

  throw new Error("Expected transaction to revert");
}
