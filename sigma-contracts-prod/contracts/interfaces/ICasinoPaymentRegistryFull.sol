// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

// Fuller Interface for CrossChainLink to interact with CasinoPaymentRegistry
interface ICasinoPaymentRegistryFull {
    // Implicitly includes Ownable functions if Registry inherits it
    function owner() external view returns (address);

    // Registry specific functions needed
    function userUniversalIds(address user) external view returns (bytes32);
    function universalIdToUser(bytes32 universalId) external view returns (address);
    function isWhitelisted(address account) external view returns (bool);
    function registeredCasinos(uint256 casinoId) external view returns (bool);
    // Add other functions as needed
} 