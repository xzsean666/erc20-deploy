import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const TOKEN_NAME = "Upgradeable Configurable Token";
const TOKEN_SYMBOL = "UCFG";
const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

describe("ConfigurableERC20Upgradeable", function () {
  async function deployProxyFixture({
    decimals = 9,
    initialSupplyBaseUnits = ethers.parseUnits("987654.321", decimals),
    isTest = false,
  }: {
    decimals?: number;
    initialSupplyBaseUnits?: bigint;
    isTest?: boolean;
  } = {}) {
    const [deployer, initialRecipient, owner, nonOwner, minter, thirdParty] =
      await ethers.getSigners();
    const initialRecipientAddress = await initialRecipient.getAddress();
    const ownerAddress = await owner.getAddress();

    const implementation = await ethers.deployContract(
      "ConfigurableERC20Upgradeable",
    );
    const implementationAddress = await implementation.getAddress();
    const initializeCalldata = implementation.interface.encodeFunctionData(
      "initialize",
      [
        TOKEN_NAME,
        TOKEN_SYMBOL,
        decimals,
        initialRecipientAddress,
        initialSupplyBaseUnits,
        isTest,
        ownerAddress,
      ],
    );

    const proxy = await ethers.deployContract("ConfigurableERC1967Proxy", [
      implementationAddress,
      initializeCalldata,
    ]);
    const proxyAddress = await proxy.getAddress();
    const token = await ethers.getContractAt(
      "ConfigurableERC20Upgradeable",
      proxyAddress,
    );

    return {
      deployer,
      initialRecipient,
      initialRecipientAddress,
      owner,
      ownerAddress,
      nonOwner,
      minter,
      thirdParty,
      implementation,
      implementationAddress,
      proxy,
      proxyAddress,
      token,
      decimals,
      initialSupplyBaseUnits,
    };
  }

  function implementationAddressFromStorage(storageValue: string) {
    return ethers.getAddress(`0x${storageValue.slice(-40)}`);
  }

  it("initializes through an ERC1967 proxy with the expected ERC20 state", async function () {
    const decimals = 4;
    const initialSupplyBaseUnits = ethers.parseUnits("12345.6789", decimals);

    const {
      token,
      initialRecipientAddress,
      ownerAddress,
      implementationAddress,
      proxyAddress,
    } = await deployProxyFixture({ decimals, initialSupplyBaseUnits });

    expect(await token.name()).to.equal(TOKEN_NAME);
    expect(await token.symbol()).to.equal(TOKEN_SYMBOL);
    expect(await token.decimals()).to.equal(BigInt(decimals));
    expect(await token.totalSupply()).to.equal(initialSupplyBaseUnits);
    expect(await token.balanceOf(initialRecipientAddress)).to.equal(
      initialSupplyBaseUnits,
    );
    expect(await token.owner()).to.equal(ownerAddress);
    expect(
      implementationAddressFromStorage(
        await ethers.provider.getStorage(proxyAddress, IMPLEMENTATION_SLOT),
      ),
    ).to.equal(implementationAddress);
  });

  it("keeps the configured test mint behavior behind the proxy", async function () {
    const mintAmount = 5_555n;
    const { token, minter, thirdParty } = await deployProxyFixture({
      isTest: true,
    });
    const tokenAsMinter = token.connect(minter) as typeof token;
    const thirdPartyAddress = await thirdParty.getAddress();

    await (await tokenAsMinter.mint(thirdPartyAddress, mintAmount)).wait();

    expect(await token.balanceOf(thirdPartyAddress)).to.equal(mintAmount);
  });

  it("reverts proxy mint calls when isTest is false", async function () {
    const { token, minter, thirdParty } = await deployProxyFixture();
    const tokenAsMinter = token.connect(minter) as typeof token;

    await expectTransactionRevert(
      tokenAsMinter.mint(await thirdParty.getAddress(), 1n),
      "MintDisabled",
    );
  });

  it("allows initialize to run only once", async function () {
    const {
      token,
      owner,
      initialRecipientAddress,
      initialSupplyBaseUnits,
      decimals,
      ownerAddress,
    } = await deployProxyFixture();
    const tokenAsOwner = token.connect(owner) as typeof token;

    await expectTransactionRevert(
      tokenAsOwner.initialize(
        TOKEN_NAME,
        TOKEN_SYMBOL,
        decimals,
        initialRecipientAddress,
        initialSupplyBaseUnits,
        false,
        ownerAddress,
      ),
      "InvalidInitialization",
    );
  });

  it("allows only the owner to upgrade the proxy implementation", async function () {
    const { token, owner, nonOwner, proxyAddress } = await deployProxyFixture();
    const replacementImplementation = await ethers.deployContract(
      "ConfigurableERC20Upgradeable",
    );
    const replacementAddress = await replacementImplementation.getAddress();
    const tokenAsNonOwner = token.connect(nonOwner) as typeof token;
    const tokenAsOwner = token.connect(owner) as typeof token;

    await expectTransactionRevert(
      tokenAsNonOwner.upgradeToAndCall(replacementAddress, "0x"),
      "OwnableUnauthorizedAccount",
    );

    await (await tokenAsOwner.upgradeToAndCall(replacementAddress, "0x")).wait();

    expect(
      implementationAddressFromStorage(
        await ethers.provider.getStorage(proxyAddress, IMPLEMENTATION_SLOT),
      ),
    ).to.equal(replacementAddress);
    expect(await token.name()).to.equal(TOKEN_NAME);
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
