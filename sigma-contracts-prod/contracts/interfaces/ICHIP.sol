// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ICHIP is IERC20 {
    // --- Events ---
    event VaultWhitelisted(address indexed vault);
    event VaultRemoved(address indexed vault);
    event Blacklisted(address indexed account);
    event RemovedFromBlacklist(address indexed account);
    event EmergencyPaused(address indexed pauser);
    event EmergencyUnpaused(address indexed unpauser);
    event ATokenBalanceUpdated(address indexed vault, uint256 newBalance, uint256 timestamp);
    event SharesMinted(address indexed vault, address indexed to, uint256 amount, uint256 aTokenAmount);
    event SharesBurned(address indexed vault, address indexed from, uint256 amount, uint256 aTokenAmount);
    event SharePriceUpdated(address indexed vault, uint256 oldPrice, uint256 newPrice);
    event VaultInitialized(address indexed vault, address[] assets, string name, string symbol);
    event VaultUpdate(address indexed asset, address vault);

    // --- Core Functions ---
    function mint(address to, uint256 aTokenAmount) external;
    function burn(address from, uint256 shares) external returns (uint256);

    // --- Vault Management ---
    function whitelistVault(address _vault) external;
    function removeVault(address _vault) external;
    function initializeVault(
        address asset1,
        address asset2,
        string memory _name,
        string memory _symbol
    ) external;
    function updateATokenBalance(uint256 newBalance) external;

    // --- View Functions ---
    function whitelistedVaults(address vault) external view returns (bool);
    function vaultInitialized(address vault) external view returns (bool);
    function vaultATokenBalance(address vault) external view returns (uint256);
    function vaultLastUpdateTimestamp(address vault) external view returns (uint256);
    function vaultSharePrice(address vault) external view returns (uint256);
    function vaultAssets(address vault) external view returns (address[] memory);
    function vaultName(address vault) external view returns (string memory);
    function vaultSymbol(address vault) external view returns (string memory);
    function blacklisted(address account) external view returns (bool);
    function getSharePrice(address vault) external view returns (uint256);
    function convertToShares(uint256 aTokenAmount, address vault) external view returns (uint256);
    function convertToATokens(uint256 shares, address vault) external view returns (uint256);
    function getVaultTotalSupply(address vault) external view returns (uint256);
    function share() external view returns (address);
    function vault(address asset) external view returns (address);
    function getVaultShareBalance(address vault, address user) external view returns (uint256);
    function supportsInterface(bytes4 interfaceId) external view returns (bool);

    // --- Override Functions ---
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}