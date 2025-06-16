import { useState, useEffect } from 'react';
import styles from './NetworkTokenSelector.module.css';

export default function NetworkTokenSelector({ setNetwork, setToken }) {
    // Define network-token combination SVGs for the dropdown
    const dropdownIcons = {
        'Polygon-USDT': '/PolygonUSDT-Dropdown.svg',
        'Solana-USDT': '/solana-usdt-dropdown.svg',
        'Avalanche-USDC': '/USDC-AVAX-DROPDOWN.svg',
        'Binance-USDT': '/BNBChain-USDT-Dropdown.svg',
        'Base-USDC': '/USDC-Base-Dropdown.svg',
    };

    // Define networks and their token icons
    const networks = [
        { name: 'Polygon', icon: '/Polygon-icon.svg', tokens: [{ name: 'USDT', icon: '/USDT-Polygon.svg' }] },
        { name: 'Solana', icon: '/Solana-icon.svg', tokens: [{ name: 'USDT', icon: '/USDT-Solana.svg' }] },
        { name: 'Avalanche', icon: '/Avalanche-Icon.svg', tokens: [{ name: 'USDC', icon: '/USDC-AVAX-Icon.svg' }] },
        { name: 'Binance', icon: '/BNBChain-icon.svg', tokens: [{ name: 'USDT', icon: '/USDT-BNBChain.svg' }] },
        { name: 'Base', icon: '/Base-icon.svg', tokens: [{ name: 'USDC', icon: '/USDC-Base-Icon.svg' }] },
    ];

    const defaultNetwork = networks[0]; // Default to Polygon
    const defaultToken = defaultNetwork.tokens[0]; // Default to USDT

    const [isOpen, setIsOpen] = useState(false);
    const [showTokens, setShowTokens] = useState(false);
    const [selectedNetwork, setSelectedNetwork] = useState(defaultNetwork);
    const [selectedToken, setSelectedToken] = useState(defaultToken);
    const [dropdownIcon, setDropdownIcon] = useState(dropdownIcons[`${defaultNetwork.name}-${defaultToken.name}`]); // Initialize with the default network-token icon

    // Initial setup for external states on the first render only
    useEffect(() => {
        setNetwork(defaultNetwork.name);
        setToken(defaultToken.name);
    }, [setNetwork, setToken]);

    const toggleDropdown = () => {
        setShowTokens(false); // Reset to network selection on each open
        setIsOpen(!isOpen);
    };

    const handleNetworkSelect = (network) => {
        setSelectedNetwork(network);
        setNetwork(network.name);
        setShowTokens(true); // Show tokens after selecting a network
    };
    
    const handleTokenSelect = (token) => {
        setSelectedToken(token);
        setToken(token.name);
        setDropdownIcon(dropdownIcons[`${selectedNetwork.name}-${token.name}`]); // Update the dropdown icon only when a token is selected
        setIsOpen(false); // Close the modal after selecting a token
        setShowTokens(false); // Reset to show networks next time it opens
    };

    const handleBackToNetworks = () => {
        setShowTokens(false);
    };

    return (
        <div className={styles.selectorContainer}>
            {/* Display the custom SVG as the dropdown button */}
            <img
                src={dropdownIcons[`${selectedNetwork.name}-${selectedToken.name}`]}
                alt={`${selectedNetwork.name} ${selectedToken.name}`}
                className={styles.dropdownIcon}
                onClick={toggleDropdown}
            />

            {isOpen && (
                <div className={styles.modalOverlay}>
                    <div className={styles.modalContent}>
                        <button onClick={() => setIsOpen(false)} className={styles.closeButton}>✕</button>
                        <div className={styles.modalHeader}>
                            {showTokens ? (
                                <button onClick={handleBackToNetworks} className={styles.backButton}>←</button>
                            ) : null}
                            <span>{showTokens ? 'Select Token' : 'Select Network'}</span>
                        </div>

                        {showTokens ? (
                            <>
                                <h3 className={styles.sectionTitle}>Tokens</h3>
                                <div className={styles.tokenList}>
                                    {selectedNetwork.tokens.map((token) => (
                                        <div
                                            key={token.name}
                                            className={`${styles.tokenItem} ${token.name === selectedToken.name ? styles.activeItem : ''}`}
                                            onClick={() => handleTokenSelect(token)}
                                        >
                                            {/* Custom Token Icon for each Token */}
                                            <img src={token.icon} alt={token.name} className={styles.icon} />
                                            <span>{token.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <>
                                <h3 className={styles.sectionTitle}>Networks</h3>
                                <div className={styles.networkList}>
                                    {networks.map((network) => (
                                        <div
                                            key={network.name}
                                            className={`${styles.networkItem} ${network.name === selectedNetwork.name ? styles.activeItem : ''}`}
                                            onClick={() => handleNetworkSelect(network)}
                                        >
                                            {/* Custom Network Icon for each Network */}
                                            <img src={network.icon} alt={network.name} className={styles.icon} />
                                            <span>{network.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}