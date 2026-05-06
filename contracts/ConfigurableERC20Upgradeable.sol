// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract ConfigurableERC20Upgradeable is
    Initializable,
    ERC20Upgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    error MintDisabled();

    /// @custom:storage-location erc7201:erc20deploy.storage.ConfigurableERC20Upgradeable
    struct ConfigurableERC20Storage {
        uint8 configuredDecimals;
        bool isTest;
    }

    // keccak256(abi.encode(uint256(keccak256("erc20deploy.storage.ConfigurableERC20Upgradeable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant CONFIGURABLE_ERC20_STORAGE_LOCATION =
        0x87ca1a876d965ad68d58d3d1bfb3255064d58a10ffde13521119f2907d20f600;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address initialRecipient,
        uint256 initialSupplyBaseUnits,
        bool isTest_,
        address owner_
    ) public initializer {
        __ERC20_init(name_, symbol_);
        __Ownable_init(owner_);

        ConfigurableERC20Storage storage $ = _getConfigurableERC20Storage();
        $.configuredDecimals = decimals_;
        $.isTest = isTest_;

        _mint(initialRecipient, initialSupplyBaseUnits);
    }

    function decimals() public view override returns (uint8) {
        return _getConfigurableERC20Storage().configuredDecimals;
    }

    function isTest() public view returns (bool) {
        return _getConfigurableERC20Storage().isTest;
    }

    function mint(address to, uint256 amount) external {
        if (!isTest()) {
            revert MintDisabled();
        }

        _mint(to, amount);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function _getConfigurableERC20Storage()
        private
        pure
        returns (ConfigurableERC20Storage storage $)
    {
        assembly {
            $.slot := CONFIGURABLE_ERC20_STORAGE_LOCATION
        }
    }
}
