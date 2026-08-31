// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/// @notice ERC721 receiver that attempts one configured callback during receipt.
contract MockReentrantReceiver is IERC721Receiver {
    address public target;
    bytes public callData;
    bool public attempted;
    bool public succeeded;

    function configure(address target_, bytes calldata callData_) external {
        target = target_;
        callData = callData_;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        attempted = true;
        (succeeded,) = target.call(callData);
        return IERC721Receiver.onERC721Received.selector;
    }
}
