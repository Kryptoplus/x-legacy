import React, { useState } from "react";
import styles from "./NetworkSwitch.module.css";

const NetworkSwitch = ({ setNetwork }) => {
  const [activeNetwork, setActiveNetwork] = useState("Solana");

  const handleSwitch = () => {
    const newNetwork = activeNetwork === "Polygon" ? "Solana" : "Polygon";
    setActiveNetwork(newNetwork);
    setNetwork(newNetwork);
  };

  return (
    <div className={styles.switchContainer} onClick={handleSwitch}>
      <div className={`${styles.switch} ${activeNetwork === "Solana" ? styles.active : ""}`}>
        <div className={styles.circle}>
          <span className={styles.networkLabel}>
            {activeNetwork}
          </span>
        </div>
        <div className={styles.networkIcons}>
          <div className={`${styles.networkIcon} ${activeNetwork === "Polygon" ? styles.active : ""}`}>
            <img src="./full-polygon-logo.svg" alt="Polygon" />
          </div>
          <div className={`${styles.networkIcon} ${activeNetwork === "Solana" ? styles.active : ""}`}>
            <img src="./solanaLogo.svg" alt="Solana" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default NetworkSwitch;