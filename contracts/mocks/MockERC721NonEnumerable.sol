// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Plain ERC721 WITHOUT Enumerable support, used to test the
///         skip-and-continue path when a registered NFT collection cannot be
///         enumerated on-chain (see DeadMansHand.sol design notes).
contract MockERC721NonEnumerable is ERC721 {
    uint256 private _nextId;

    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) {}

    function mint(address to) external returns (uint256 tokenId) {
        tokenId = _nextId++;
        _mint(to, tokenId);
    }
}
