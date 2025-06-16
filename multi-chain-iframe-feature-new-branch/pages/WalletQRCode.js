import React, { useState, useMemo } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useActiveAccount } from "thirdweb/react";
import styles from "./WalletQRCode.module.css";
import { FaRegCopy } from "react-icons/fa";
import networkTokenMapping from "../config/networkTokenMapping";

const WalletQRCode = ({ selectedNetwork, selectedToken, showCopy }) => {
  const account = useActiveAccount();
  const address = account?.address;
  const [copied, setCopied] = useState(false);

  // Get the correct icon for the selected network/token
  const tokenIcon = useMemo(() => {
    if (
      selectedNetwork &&
      selectedToken &&
      networkTokenMapping[selectedNetwork] &&
      networkTokenMapping[selectedNetwork].tokens[selectedToken]
    ) {
      return networkTokenMapping[selectedNetwork].tokens[selectedToken].icon;
    }
    return null;
  }, [selectedNetwork, selectedToken]);

  if (!address) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className={styles.qrCard}>
      <div className={styles.qrWrapper}>
        <QRCodeSVG
          value={address}
          size={180}
          level="H"
          includeMargin={true}
          className={styles.qrCode}
        />
        {tokenIcon && (
          <div className={styles.qrIconOverlay}>
            <img src={tokenIcon} alt="Token Icon" className={styles.tokenIcon} />
          </div>
        )}
      </div>
      <div className={styles.qrAddressRow}>
        <span className={styles.qrAddress}>
          {address.substring(0, 6)}...{address.slice(-4)}
        </span>
        {showCopy && (
          <span className={styles.copyIcon} onClick={handleCopy} title="Copy address">
            <FaRegCopy />
            {copied && <span className={styles.copiedText}>Copied!</span>}
          </span>
        )}
      </div>
    </div>
  );
};

export default WalletQRCode;