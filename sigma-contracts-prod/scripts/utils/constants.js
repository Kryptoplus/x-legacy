// Constants shared across all test files
const USDT_ADDRESS = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
const USDT_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)"
];

// Test amounts (very small for USDT)
const TINY_AMOUNT = "0.0001";  // 0.0001 USDT
const SMALL_AMOUNT = "0.001";  // 0.001 USDT
const ESCROW_AMOUNT = "0.01";  // 0.01 USDT

module.exports = {
    USDT_ADDRESS,
    USDT_ABI,
    TINY_AMOUNT,
    SMALL_AMOUNT,
    ESCROW_AMOUNT
}; 