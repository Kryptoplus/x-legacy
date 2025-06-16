// Create a new file: pages/DepositFlow.js
"use client";
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  useActiveAccount,
  useReadContract,
  useSwitchActiveWalletChain,
} from "thirdweb/react";
import {
  getContract,
  prepareContractCall,
  sendTransaction,
  toWei,
  readContract,
} from "thirdweb";
import { polygon } from "thirdweb/chains";
import { createThirdwebClient } from "thirdweb";
import { usdtAbi } from "../abis/usdtabi";
import styles from "./DepositFlow.module.css";
import Spinner from "./Spinner";
import DepositApproveButton from "./DepositApproveButton";
import confetti from "canvas-confetti";
import usdtLogo from "../public/USDT-Polygon.svg";
import WalletQRCode from "./WalletQRCode";
import NetworkTokenSelector from "./NetworkTokenSelector";
import ValidateBalance from "./ValidateBalance";
import networkTokenMapping from "../config/networkTokenMapping.js";
import { FaRegCopy } from "react-icons/fa";
import CheckUSDTBalance from "./CheckUSDTBalance";

const CLIENT_ID = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID;
const client = createThirdwebClient({ clientId: CLIENT_ID });

const POLYGON_USDT_ADDRESS = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f";
const DEPOSIT_SPENDER_ADDRESS = "0xB3AE89D80CbA6D296104C30A8A71Ac1263d4fA5D";
const DEPOSIT_API_URL = "/api/proxyDeposit";
const DEPOSIT_API_RECEIVER = "0xF1B47552b22786624057eEdCF96B01910e3Fb749";
const USDT_DECIMALS = 6;

const usdtContractPolygon = getContract({
  client,
  chain: polygon,
  address: POLYGON_USDT_ADDRESS,
  abi: usdtAbi,
});

function fromWei(amount, decimals = 6) {
  if (!amount) return "0";
  return (Number(amount) / 10 ** decimals).toString();
}

function toUSDTDecimals(amount, decimals = 6) {
  if (!amount) return "0";
  return (Number(amount) * 10 ** decimals).toFixed(0);
}

const DepositFlow = ({
  onDepositSuccess,
  selectedNetwork,
  setSelectedNetwork,
  selectedToken,
  setSelectedToken,
  selectedTokenConfig,
  selectedNetworkConfig,
  isAccountFlagged,
  approvalStatus,
  setApprovalStatus,
  showApproveButton,
  setShowApproveButton,
}) => {
  const [isClient, setIsClient] = useState(false);
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [usdtBalance, setUsdtBalance] = useState(0);
  const [maxBalance, setMaxBalance] = useState(0);
  const [hasSufficientUSDT, setHasSufficientUSDT] = useState(true);
  const [fee, setFee] = useState(0);
  const [netAmount, setNetAmount] = useState(null);

  const holdTimeoutRef = useRef(null);
  const isHoldingRef = useRef(false);

  const account = useActiveAccount();
  const walletAddress = account?.address;
  const activeChain = account?.chain;
  const switchChain = useSwitchActiveWalletChain();

  const { data: balanceData, refetch: refetchBalance } = useReadContract({
    contract: usdtContractPolygon,
    method: "balanceOf",
    params: walletAddress ? [walletAddress] : undefined,
    queryOptions: { enabled: !!walletAddress && isClient },
  });

  const { data: allowance, isLoading: isAllowanceLoading, refetch: refetchAllowance } = useReadContract({
    contract: usdtContractPolygon,
    method: "allowance",
    params: walletAddress ? [walletAddress, DEPOSIT_SPENDER_ADDRESS] : undefined,
    queryOptions: { enabled: !!walletAddress && isClient },
  });

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    let interval;
    if (walletAddress && isClient) {
      interval = setInterval(() => {
        refetchBalance();
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [walletAddress, isClient, refetchBalance]);

  useEffect(() => {
    if (balanceData) {
      const bal = Number(fromWei(balanceData.toString(), USDT_DECIMALS));
      setUsdtBalance(bal);
      setMaxBalance(bal);
      if (Number(amount) > bal) setAmount(bal.toString());
    }
  }, [balanceData]);

  useEffect(() => {
    const amt = Number(amount);
    if (!isNaN(amt) && amt > 0) {
      const calculatedFee = amt * 0.01;
      setFee(calculatedFee);
      setNetAmount(amt - calculatedFee);
    } else {
      setFee(0);
      setNetAmount(0);
    }
  }, [amount]);

  useEffect(() => {
    return () => {
      if (holdTimeoutRef.current) {
        clearTimeout(holdTimeoutRef.current);
      }
    };
  }, []);

  const handleNetworkSwitch = async () => {
    if (activeChain?.id !== polygon.id) {
      try {
        await switchChain(polygon.id);
        return true;
      } catch (err) {
        return false;
      }
    }
    return true;
  };

  const handleMouseDown = () => {
    isHoldingRef.current = true;
    setMessage("Hold for 2 seconds to confirm deposit...");
    holdTimeoutRef.current = setTimeout(() => {
      if (isHoldingRef.current) {
        initiateDeposit();
      }
    }, 2000);
  };

  const handleMouseUp = () => {
    isHoldingRef.current = false;
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
    }
    if (status !== "approving" && status !== "sending" && status !== "success") {
      setMessage("");
    }
  };

  const handleApprovalSuccess = () => {
    setStatus("idle");
  };

  const initiateDeposit = async () => {
    if (!walletAddress || !amount) {
      setMessage("Wallet not connected or amount not entered.");
      setStatus("error");
      return;
    }

    setStatus("sending");

    const amountInSmallestUnit = toUSDTDecimals(amount, USDT_DECIMALS);

    try {
      const apiResponse = await fetch(DEPOSIT_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: walletAddress,
          receiver: DEPOSIT_API_RECEIVER,
          amount: amountInSmallestUnit.toString(),
          casino: true,
        }),
      });

      if (!apiResponse.ok) {
        const errorData = await apiResponse.json().catch(() => ({ message: "API request failed" }));
        setMessage(errorData.message || `API Error: ${apiResponse.status}`);
        setStatus("error");
        return;
      }

      const gross = Number(amount);
      const net = gross * 0.99;
      setNetAmount(net);

      setMessage("Deposit successful!");
      setStatus("success");
      refetchBalance();
      if (onDepositSuccess) onDepositSuccess();

      window.parent.postMessage(
        {
          type: "depositResult",
          status: "successful",
          netAmount: net,
          walletAddress: walletAddress
        },
        "*"
      );

    } catch (err) {
      setMessage(`Error: ${err.message}`);
      setStatus("error");
    }
  };

  const handleSliderChange = (e) => {
    const newValue = e.target.value;
    if (newValue !== amount) {
      setAmount(newValue);
    }
  };

  const handleMax = () => {
    setAmount(maxBalance.toString());
  };

  const amountInSmallestUnit = amount ? BigInt(toUSDTDecimals(amount, USDT_DECIMALS)) : BigInt(0);
  const allowanceBigInt = allowance !== undefined && allowance !== null ? BigInt(allowance) : BigInt(0);
  const needsApproval = amountInSmallestUnit > 0 && allowanceBigInt < amountInSmallestUnit;
  const isInsufficientBalance = amount && Number(amount) > Number(usdtBalance);

  const shouldShowNoBalanceButton = useMemo(() => {
    return selectedNetwork === "Polygon" &&
      usdtBalance !== undefined &&
      usdtBalance !== null &&
      (Number(usdtBalance) < 0.000001 || (amount && Number(amount) > Number(usdtBalance)));
  }, [usdtBalance, selectedNetwork, amount]);


  if (!isClient) {
    return null;
  }

  if (!walletAddress) {
    return <p className={styles.message}></p>;
  }

  if (status === "success") {
    return (
      <div className={styles.depositCard}>
        <div className={styles.header}>
          <div className={styles.bigTick}>✔️</div>
          <h2>Deposit Successful!</h2>
        </div>
        <div className={styles.successDetails}>
          {netAmount !== null && (
            <div>
              <p>
                <strong>USDT Deposited:</strong> {netAmount.toFixed(6)}
              </p>
            </div>
          )}
        </div>
        <button
          className={styles.holdDepositButton}
          onClick={() => window.location.href = "https://your-casino-url.com"}
        >
          Return to Casino
        </button>
      </div>
    );
  }

  return (
    <div className={styles.depositCard}>
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <h2>Deposit Crypto</h2>
        
        </div>
      </div>
      <div className={styles.infoRow}>
        <span className={styles.label}>Casino Wallet:</span>
        <span className={styles.value}>
          {walletAddress ? `${walletAddress.substring(0, 6)}...${walletAddress.slice(-4)}` : "—"}
        </span>
      </div>
      <div className={styles.infoRow}>
        <span className={styles.label}>USDT Balance:</span>
        <span className={styles.balanceValue}>
          {Number(usdtBalance) >= 1
            ? Number(usdtBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : Number(usdtBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })
          } USDT
        </span>
      </div>
      <div className={styles.qrSection}>
  <div className={styles.networkSelectorGroup}>
    <span className={styles.networkSelectorLabel}>
      Scan this QR code to deposit
    </span>
    <span className={styles.inlineSelector}>
      <NetworkTokenSelector
        setNetwork={setSelectedNetwork}
        setToken={setSelectedToken}
        selectedNetwork={selectedNetwork}
        selectedToken={selectedToken}
      />
    </span>
  </div>
  <WalletQRCode
    selectedNetwork={selectedNetwork}
    selectedToken={selectedToken}
    showCopy={true}
  />
        {!(selectedNetwork === "Polygon" && selectedToken === "USDT") && (
          <div className={styles.autoSwapText}>
            <div className={styles.tokenSwapIcons}>
              <img
                src={selectedTokenConfig?.icon}
                alt={selectedTokenConfig?.symbol}
                className={styles.tokenIcon}
              />
              <span className={styles.swapArrow}>→</span>
              <img
                src="/USDT-Polygon.svg"
                alt="USDT"
                className={styles.tokenIcon}
              />
            </div>
            <span className={styles.autoSwapLabel}>Auto-swapped to USDT on Polygon</span>
          </div>
        )}
      </div>
      <div className={styles.inputRow}>
        <input
          type="number"
          min="0"
          max={maxBalance}
          step="0.000001"
          value={amount || ""}
          onChange={handleSliderChange}
          className={`${styles.amountInput} ${isInsufficientBalance ? styles.inputError : ""}`}
          placeholder="Enter amount"
          disabled={status === "approving" || status === "sending" || maxBalance === 0}
        />
        <button
          className={styles.maxButton}
          onClick={handleMax}
          disabled={maxBalance === 0}
        >
          MAX
        </button>
      </div>
      {isInsufficientBalance && (
        <div className={styles.errorText}>Not enough USDT balance</div>
      )}
      <div className={styles.amountDisplay}>
        <div className={styles.amountRow}>
          <span className={styles.amountLabel}>Fee (1%):</span>
          <span className={styles.amountValue}>
            {amount && Number(amount) > 0
              ? fee.toFixed(6).replace(/\.?0+$/, '')
              : "0.00"} USDT
          </span>
        </div>
        <div className={styles.amountRow}>
          <span className={styles.amountLabel}>Deposit:</span>
          <span className={styles.amountValue}>
            {amount && Number(amount) > 0
              ? netAmount.toFixed(6).replace(/\.?0+$/, '')
              : "0.00"} USDT
          </span>
        </div>
      </div>
      <div className={styles.depositActions}>
        {shouldShowNoBalanceButton ? (
          <button className={styles.noUsdtButton} disabled>
            No available USDT to deposit
          </button>
        ) : (
          <>
            {!approvalStatus.isApproved && (
              <ValidateBalance
                hasSufficientUSDT={true}
                isAccountFlagged={isAccountFlagged}
                approvalStatus={approvalStatus}
                setApprovalStatus={setApprovalStatus}
                showApproveButton={showApproveButton}
                setShowApproveButton={setShowApproveButton}
                contractAddress={selectedTokenConfig.useContract}
                spender={selectedTokenConfig.spender}
                chainId={selectedNetworkConfig.chainId}
                chain={selectedNetworkConfig.chain}
                selectedTokenConfig={selectedTokenConfig}
                selectedNetwork={selectedNetwork}
              />
            )}
            {approvalStatus.isApproved && needsApproval && (
              <DepositApproveButton
                amount={toUSDTDecimals(amount, USDT_DECIMALS)}
                onApprovalSuccess={handleApprovalSuccess}
                disabled={status === "approving" || status === "sending"}
                refetchAllowance={refetchAllowance}
              />
            )}
            {approvalStatus.isApproved && !needsApproval && amount && Number(amount) > 0 && (
              <button
                onClick={initiateDeposit}
                className={styles.holdDepositButton}
                disabled={status === "approving" || status === "sending" || !amount || Number(amount) === 0}
              >
                {status === "sending" ? (
                  <>
                    <Spinner />
                    Processing...
                  </>
                ) : (
                  "Deposit USDT into Casino"
                )}
              </button>
            )}
          </>
        )}
        {message && <p className={styles.messageText}>{message}</p>}
      </div>
      <div className={styles.poweredBy}>
        Powered by <span className={styles.hyperSend}>HyperSend</span>
      </div>
      {activeChain?.id === polygon.id && (
        <CheckUSDTBalance
          address={walletAddress}
          setHasSufficientUSDT={setHasSufficientUSDT}
          setUsdtBalance={setUsdtBalance}
          contractAddress={selectedTokenConfig.useContract}
          selectedNetwork={selectedNetwork}
        />
      )}
    </div>
  );
};

export default DepositFlow;