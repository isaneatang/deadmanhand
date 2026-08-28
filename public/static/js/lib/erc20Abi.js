// Minimal ERC-20 ABI — only the functions this app actually calls
// (balanceOf, decimals, symbol, approve, allowance). Kept separate from the
// full DMH ABI for clarity/audit-ability.
export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

// Minimal ERC-721 ABI — only setApprovalForAll / isApprovedForAll are
// needed client-side; the contract handles transferFrom internally.
export const ERC721_ABI = [
  'function setApprovalForAll(address operator, bool approved)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
];
