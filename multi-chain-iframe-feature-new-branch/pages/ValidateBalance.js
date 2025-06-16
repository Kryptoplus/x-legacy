// import { useAddress } from "@thirdweb-dev/react";
import { useActiveAccount } from "thirdweb/react";
import ApproveButton from "./ApproveButton";
import React, { useState } from "react";
import styles from './validate.module.css';
import networkTokenMapping from "../config/networkTokenMapping.js";

export const ValidateBalance = (props) => {
  // const currentAddress = useAddress();
  const activeAccount = useActiveAccount();
  const currentAddress = activeAccount?.address;  
  // Commenting out modal state since we won't need it
  // const [isModalOpen, setIsModalOpen] = useState(false);

  if (!currentAddress) return null;

  // Commenting out these unused functions
  /* 
  const handleBuyUSDTClick = () => {
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
  };

  const renderInsufficientFundsMessage = () => {
    return (
      <div className={styles.messageContainer}>
        <p className={styles.message}>Insufficient USDT balance</p>
        <div className={styles.centerButton}>
          <button onClick={handleBuyUSDTClick} className={styles.buyUSDT}>BUY USDT</button>
        </div>
      </div>
    );
  };
  */

  // Remove the conditional rendering and just return the ApproveButton
  return (
    <div className={styles.depositActionArea}>
      <ApproveButton {...props} />
    </div>
  );
};

export default ValidateBalance;