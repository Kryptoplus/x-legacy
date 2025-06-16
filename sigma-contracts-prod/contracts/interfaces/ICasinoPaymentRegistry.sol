// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

// Interface for CasinoTreasury to interact with CasinoPaymentRegistry
interface ICasinoPaymentRegistry {
    // --- View Functions ---
    function isUserSuspended(uint256 casinoId, address user) external view returns (bool);
    function isTokenSupported(uint256 casinoId, address token) external view returns (bool);
    function getCasinoDetails(uint256 _casinoId) external view returns (
        address owner,
        address treasury,
        bool active,
        uint256 registrationTimestamp
    );
    function getCasinoAdmins(uint256 _casinoId) external view returns (address[] memory);
    function platformFeeBps() external view returns (uint16);
    function platformFeeRecipient() external view returns (address);
    function isWhitelisted(address _account) external view returns (bool);
    function canRegisterCasino(address _caller) external view returns (bool, string memory);
    function getWhitelistedAccounts() external view returns (address[] memory);
    function casinoCount() external view returns (uint256);
    function registeredCasinos(uint256 _casinoId) external view returns (bool);
    function supportedTokens(uint256 _casinoId, address _token) external view returns (bool);
    function suspendedUsers(uint256 _casinoId, address _user) external view returns (bool);
    function userUniversalIds(address _user) external view returns (bytes32);
    function universalIdToUser(bytes32 _universalId) external view returns (address);
    function casinoTreasuryImplementation() external view returns (address);
    function lastFeeUpdate() external view returns (uint256);

    // --- Constants ---
    function MAX_CASINO_COUNT() external view returns (uint256);
    function MAX_PLATFORM_FEE_BPS() external view returns (uint256);
    function MAX_TOTAL_FEE_BPS() external view returns (uint256);
    function FEE_UPDATE_COOLDOWN() external view returns (uint256);

    // --- State-Changing Functions ---
    function registerCasinoAndDeployTreasury(
        address _casinoOwner,
        address _treasuryInstanceOwner,
        address[] memory _initialAdminWallets,
        address[] memory _initialSupportedTokens
    ) external returns (uint256 casinoId, address treasuryProxyAddress);

    function addCasinoAdmin(uint256 _casinoId, address _adminWallet) external;
    function removeCasinoAdmin(uint256 _casinoId, address _adminWallet) external;
    function setCasinoStatus(uint256 _casinoId, bool _active) external;
    function setTokenSupport(uint256 _casinoId, address _token, bool _supported) external;
    function setSuspendedUser(uint256 _casinoId, address _user, bool _suspended) external;
    function updateCasinoTreasury(uint256 _casinoId, address _newTreasury) external;
    function updatePlatformFee(uint16 _newPlatformFeeBps, address _newRecipient) external;
    function linkUserAcrossChains(address _user, bytes32 _universalId) external;
    function updateWhitelist(address _account, bool _status) external;
    function setTreasuryImplementation(address _implementation) external;
    function pause() external;
    function unpause() external;
}