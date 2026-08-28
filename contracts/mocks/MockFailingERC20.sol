// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice ERC20 whose transferFrom can be toggled to always fail, used to
///         simulate a stale approval (owner moved the tokens elsewhere after
///         approving DMH) and verify the skip-and-continue partial-claim path.
contract MockFailingERC20 is ERC20 {
    bool public shouldFail;

    constructor() ERC20("FailToken", "FAIL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setShouldFail(bool v) external {
        shouldFail = v;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (shouldFail) {
            revert("simulated stale approval failure");
        }
        return super.transferFrom(from, to, amount);
    }
}
