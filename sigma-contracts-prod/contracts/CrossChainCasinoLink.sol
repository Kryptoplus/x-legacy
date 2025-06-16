// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/ICasinoPaymentRegistryFull.sol";

contract CrossChainCasinoLink is Initializable, OwnableUpgradeable, UUPSUpgradeable {
     using Address for address;

    // --- State Variables ---
    ICasinoPaymentRegistryFull public registry;

    // Mapping of chain ID to trusted bridge contract address for that chain
    mapping(uint256 => address) public trustedBridges;

    // Mapping of virtual balances reported from other chains
    // universalId => sourceChainId => casinoIdOnSourceChain => token => amount
    mapping(bytes32 => mapping(uint256 => mapping(uint256 => mapping(address => uint256)))) public crossChainBalances;

    // Mapping to link casino IDs across chains for unified view
    // casinoIdOnThisChain => targetChainId => casinoIdOnTargetChain
    mapping(uint256 => mapping(uint256 => uint256)) public linkedCasinos;

    // --- Events ---
    event BalanceUpdated(bytes32 indexed universalId, uint256 indexed sourceChainId, uint256 indexed casinoId, address token, uint256 amount);
    event BridgeSet(uint256 indexed chainId, address bridge);
    event CasinoLinked(uint256 indexed originalCasinoId, uint256 indexed targetChainId, uint256 remoteCasinoId);

    // --- Modifiers ---

    modifier onlyTrustedBridge(uint256 _sourceChainId) {
        require(_msgSender() == trustedBridges[_sourceChainId], "CrossChainLink: Not trusted bridge for source chain");
        _;
    }

    // Modifier to check if caller is whitelisted in the registry
    modifier onlyRegistryWhitelisted() {
        require(registry.isWhitelisted(_msgSender()), "CrossChainLink: Not registry whitelisted");
        _;
    }


    // --- Initializer ---
    function initialize(address _registryAddress, address _initialOwner) public initializer {
        require(_registryAddress != address(0) && _registryAddress.code.length > 0, "CrossChainLink: Invalid registry");
        require(_initialOwner != address(0), "CrossChainLink: Invalid owner");

        __Ownable_init(_initialOwner);
        __UUPSUpgradeable_init();

        registry = ICasinoPaymentRegistryFull(_registryAddress);
    }

     // --- UUPS Upgrade ---
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // --- Configuration ---

    /**
     * @notice Set the trusted bridge contract address for a specific source chain ID.
     * Only the owner of this CrossChainLink contract can set bridges.
     */
    function setTrustedBridge(uint256 _chainId, address _bridge) external onlyOwner {
        // Bridge address can be zero to unset/disable a bridge
        trustedBridges[_chainId] = _bridge;
        emit BridgeSet(_chainId, _bridge);
    }

    /**
     * @notice Link a casino ID on this chain to its corresponding ID on another chain.
     * Can be called by addresses whitelisted in the main Registry.
     */
    function linkCasino(uint256 _casinoIdOnThisChain, uint256 _targetChainId, uint256 _casinoIdOnTargetChain)
        external
        onlyRegistryWhitelisted // Use registry whitelist for this operation
    {
        // Ensure the casino exists on this chain according to the registry
        require(registry.registeredCasinos(_casinoIdOnThisChain), "CrossChainLink: Casino not registered locally");
        linkedCasinos[_casinoIdOnThisChain][_targetChainId] = _casinoIdOnTargetChain;
        emit CasinoLinked(_casinoIdOnThisChain, _targetChainId, _casinoIdOnTargetChain);
    }

    // --- Core Logic (Called by Trusted Bridge) ---

    /**
     * @notice Updates the recorded balance for a user from a specific chain/casino.
     * Must be called by the trusted bridge set for the sourceChainId.
     * @param _universalId User's global identifier.
     * @param _sourceChainId The chain ID where this balance originates.
     * @param _casinoIdOnSourceChain The casino ID on the source chain.
     * @param _token The token address (assumed to be consistent or mapped).
     * @param _amount The latest balance amount reported from the source chain.
     */
    function updateCrossChainBalance(
        bytes32 _universalId,
        uint256 _sourceChainId,
        uint256 _casinoIdOnSourceChain,
        address _token,
        uint256 _amount
    ) external onlyTrustedBridge(_sourceChainId) {
        require(_universalId != bytes32(0), "CrossChainLink: Zero universal ID");
        // Basic validation: token address should not be zero
        require(_token != address(0), "CrossChainLink: Zero token address");

        crossChainBalances[_universalId][_sourceChainId][_casinoIdOnSourceChain][_token] = _amount;
        emit BalanceUpdated(_universalId, _sourceChainId, _casinoIdOnSourceChain, _token, _amount);
    }

    // --- View Functions ---

    /**
     * @notice Get the last reported balance for a user on a specific remote chain/casino.
     * @param _user User address on THIS chain.
     * @param _sourceChainId The chain ID to query the balance from.
     * @param _casinoIdOnThisChain The casino ID on THIS chain to find its linked counterpart.
     * @param _token The token address.
     * @return The last reported balance amount.
     */
    function getRemoteBalance(
        address _user,
        uint256 _sourceChainId,
        uint256 _casinoIdOnThisChain,
        address _token
    ) external view returns (uint256) {
        bytes32 universalId = registry.userUniversalIds(_user);
        if (universalId == bytes32(0)) return 0; // User not linked

        uint256 remoteCasinoId = linkedCasinos[_casinoIdOnThisChain][_sourceChainId];
        if (remoteCasinoId == 0 && _casinoIdOnThisChain != 0) return 0; // Casino not linked (handle casinoId 0 case if needed)
         // If casinoIdOnThisChain is 0 maybe it represents a global balance? Adjust logic if needed.

        return crossChainBalances[universalId][_sourceChainId][remoteCasinoId][_token];
    }

     /**
     * @notice Get the sum of last reported balances across multiple specified remote chains for a specific casino link.
     * @param _user User address on THIS chain.
     * @param _token The token address.
     * @param _casinoIdOnThisChain The casino ID on THIS chain.
     * @param _chainIds Array of source chain IDs to sum balances from.
     * @return Total balance across the specified remote chains for the linked casinos.
     */
    function getTotalCrossChainBalanceForCasino(
        address _user,
        address _token,
        uint256 _casinoIdOnThisChain,
        uint256[] calldata _chainIds
    ) external view returns (uint256) {
        bytes32 universalId = registry.userUniversalIds(_user);
        if (universalId == bytes32(0)) return 0; // User not linked

        uint256 totalBalance = 0;
        for (uint256 i = 0; i < _chainIds.length; i++) {
            uint256 chainId = _chainIds[i];
            uint256 remoteCasinoId = linkedCasinos[_casinoIdOnThisChain][chainId];
             // Only add balance if the casino link exists for that chain
            if (remoteCasinoId != 0 || (_casinoIdOnThisChain == 0 && linkedCasinos[0][chainId] != 0) ) { // Adjust if casino 0 is special
                 totalBalance += crossChainBalances[universalId][chainId][remoteCasinoId][_token];
            }
        }
        return totalBalance;
    }

     /**
     * @notice Get a detailed breakdown of balances across specific chain/casino pairs.
     * @param _user User address on THIS chain.
     * @param _token The token address.
     * @param _chainCasinoMap Array of [sourceChainId, casinoIdOnSourceChain] pairs to query.
     * @return balances Array of balances corresponding to the queried pairs.
     * @return total Sum of all balances returned in the array.
     */
    function getUnifiedBalanceDetails(
        address _user,
        address _token,
        uint256[2][] calldata _chainCasinoMap
    ) external view returns (uint256[] memory balances, uint256 total) {
        bytes32 universalId = registry.userUniversalIds(_user);
        require(universalId != bytes32(0), "CrossChainLink: User not linked");

        balances = new uint256[](_chainCasinoMap.length);
        uint256 sum = 0;
        for (uint256 i = 0; i < _chainCasinoMap.length; i++) {
            uint256 chainId = _chainCasinoMap[i][0];
            uint256 casinoId = _chainCasinoMap[i][1];
            uint256 balance = crossChainBalances[universalId][chainId][casinoId][_token];
            balances[i] = balance;
            sum += balance;
        }
        return (balances, sum);
    }

    // Required storage gap for upgradeable contracts
    uint256[48] private __gap; // Adjust size as needed
} 