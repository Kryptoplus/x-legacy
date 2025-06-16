import React, { useEffect, useState } from "react";
// import { useAddress } from "@thirdweb-dev/react"; // Removed useConnectionStatus since it's not used in the revised logic
import { useActiveAccount } from "thirdweb/react";
import styles from './WalletConnectionStatus.module.css';

const WalletConnectionStatus = ({ approvalStatus, contractAddress, selectedNetwork, selectedToken  }) => {
  const [message, setMessage] = useState('');
  // const address = useAddress(); // This gets the connected wallet address, if any
  const activeAccount = useActiveAccount();
  const currentAddress = activeAccount?.address;  
  const [isAllowed, setIsAllowed] = useState(false);


  
  // Function to split and render the message with line breaks
  const renderMessage = () => {
    return message.split('\n').map((line, index) => (
      <React.Fragment key={index}>
        {line}<br />
      </React.Fragment>
    ));
  };

  return message && <p className={styles.message}>{renderMessage()}</p>;
};

export default WalletConnectionStatus;

