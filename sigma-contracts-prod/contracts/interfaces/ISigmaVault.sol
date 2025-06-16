// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISigmaVault {
    // --- Events ---
    event Deposited(
        address indexed user,
        address[] assets,
        uint256[] amounts,
        address indexed receiver,
        bool toCasino,
        uint256 shares
    );
    
    event Withdrawn(
        address indexed user,
        uint256 shares,
        address[] assets,
        uint256[] amounts,
        address[] recipients,
        uint256[] recipientAmounts
    );

    event AdminAdded(address indexed admin);
    event AdminRemoved(address indexed admin);
    event PrecisionError(string operation, uint256 expected, uint256 actual);
    event CasinoTreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event VaultInitialized(uint256 initialATokenAmount);

    // --- Core Functions ---
    function deposit(
        address from,
        address[] calldata assets,
        uint256[] calldata amounts,
        address receiver,
        bool depositToCasino
    ) external returns (uint256 shares);

    function withdraw(
        address from,
        uint256 shares,
        address[] calldata recipients,
        uint256[] calldata recipientAmounts,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata minAmounts,
        bool fromWallet
    ) external returns (uint256[] memory received);

    // --- Initialization ---
    function initializeVault(
        address asset1,
        address asset2,
        string memory _name,
        string memory _symbol
    ) external;

    // --- View Functions ---
    function convertToShares(
        address[] calldata assets, 
        uint256[] calldata amounts
    ) external view returns (uint256 shares);

    function convertToAssets(
        uint256 shares, 
        address[] calldata assets
    ) external view returns (uint256[] memory amounts);

    function previewDeposit(
        address[] calldata assets, 
        uint256[] calldata amounts
    ) external view returns (uint256 shares);

    function previewWithdraw(
        uint256 shares, 
        address[] calldata assets
    ) external view returns (uint256[] memory amounts);

    // --- State Variables ---
    function usdt() external view returns (address);
    function usdc() external view returns (address);
    function aPolUsdt() external view returns (address);
    function aPolUsdc() external view returns (address);
    function aavePool() external view returns (address);
    function chip() external view returns (address);
    function casinoTreasury() external view returns (address);
    function initialized() external view returns (bool);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function aTokenBalances(address user, address aToken) external view returns (uint256);

    // --- Admin Management ---
    function addAdmin(address admin) external;
    function removeAdmin(address admin) external;
    function isAdmin(address admin) external view returns (bool);
    function setCasinoTreasury(address newTreasury) external;
}