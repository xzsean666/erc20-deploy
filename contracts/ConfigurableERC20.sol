// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract ConfigurableERC20 is ERC20, Ownable {
    error MintDisabled();

    uint8 private immutable _configuredDecimals;
    bool public immutable isTest;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address initialRecipient,
        uint256 initialSupplyBaseUnits,
        bool isTest_,
        address owner_
    ) ERC20(name_, symbol_) Ownable(owner_) {
        _configuredDecimals = decimals_;
        isTest = isTest_;

        _mint(initialRecipient, initialSupplyBaseUnits);
    }

    function decimals() public view override returns (uint8) {
        return _configuredDecimals;
    }

    function mint(address to, uint256 amount) external {
        if (!isTest) {
            revert MintDisabled();
        }

        _mint(to, amount);
    }
}
