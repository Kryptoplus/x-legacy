const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');
const hre = require("hardhat");
require("dotenv").config();

const DEPLOYMENT_INFO_PATH = path.join(__dirname, '..', 'deployment-info.json');

// --- Manual Gas Settings ---
const MANUAL_GAS_LIMIT = 5000000; // Max limit for Polygon block
const MANUAL_GAS_PRICE_GWEI = "100"; // Gwei
const MANUAL_MAX_FEE_PER_GAS = ethers.parseUnits(MANUAL_GAS_PRICE_GWEI, "gwei");
const MANUAL_MAX_PRIORITY_FEE_PER_GAS = ethers.parseUnits(MANUAL_GAS_PRICE_GWEI, "gwei");

const TX_OVERRIDES = {
    gasLimit: MANUAL_GAS_LIMIT,
    maxFeePerGas: MANUAL_MAX_FEE_PER_GAS,
    maxPriorityFeePerGas: MANUAL_MAX_PRIORITY_FEE_PER_GAS,
};

async function getContractAddresses(network) {
    try {
        const deploymentInfo = JSON.parse(fs.readFileSync(DEPLOYMENT_INFO_PATH, 'utf8'));
        const networkInfo = deploymentInfo[network];
        
        if (!networkInfo) {
            throw new Error(`No deployment info found for network ${network}`);
        }

        // Get CasinoTreasury address from Casinos section
        const casinoId = process.env.CASINO_ID;
        const casinoInfo = networkInfo.Casinos[casinoId];
        if (!casinoInfo) {
            throw new Error(`No casino info found for ID ${casinoId}`);
        }

        const casinoTreasuryAddress = casinoInfo.treasuryAddress;
        if (!casinoTreasuryAddress) {
            throw new Error('CasinoTreasury address not found in deployment info');
        }

        return {
            casinoTreasuryAddress
        };
    } catch (error) {
        console.error("Error reading deployment info:", error.message);
        process.exit(1);
    }
}

async function main() {
    const network = hre.network.name;
    const [deployer] = await ethers.getSigners();

    // Get parameters
    const casinoId = process.env.CASINO_ID;
    const depositFeeBps = process.env.CASINO_DEPOSIT_FEE_BPS;
    const withdrawalFeeBps = process.env.CASINO_WITHDRAWAL_FEE_BPS;
    const feeRecipient = process.env.CASINO_FEE_RECIPIENT;

    if (!casinoId || depositFeeBps === undefined || withdrawalFeeBps === undefined || !feeRecipient) {
        console.error("Please set CASINO_ID, CASINO_DEPOSIT_FEE_BPS, CASINO_WITHDRAWAL_FEE_BPS, and CASINO_FEE_RECIPIENT in your .env file");
        process.exit(1);
    }

    console.log(`Setting casino fees on network: ${network}`);
    console.log(`Using account: ${deployer.address}`);
    console.log(`Account balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

    console.log("Parameters:");
    console.log(`Casino ID: ${casinoId}`);
    console.log(`Deposit Fee (BPS): ${depositFeeBps}`);
    console.log(`Withdrawal Fee (BPS): ${withdrawalFeeBps}`);
    console.log(`Fee Recipient: ${feeRecipient}\n`);

    // --- Log Manual Gas Settings ---
    console.log("Using Manual Gas Settings:");
    console.log(`  Gas Limit: ${MANUAL_GAS_LIMIT}`);
    console.log(`  Max Fee Per Gas: ${ethers.formatUnits(MANUAL_MAX_FEE_PER_GAS, "gwei")} Gwei`);
    console.log(`  Max Priority Fee Per Gas: ${ethers.formatUnits(MANUAL_MAX_PRIORITY_FEE_PER_GAS, "gwei")} Gwei\n`);

    // Get contract addresses from deployment info
    const { casinoTreasuryAddress } = await getContractAddresses(network);
    
    // Connect to CasinoTreasury
    const treasury = await ethers.getContractAt("CasinoTreasury", casinoTreasuryAddress, deployer);

    // Get registry address from treasury
    const registryAddress = await treasury.registry();
    const registry = await ethers.getContractAt("CasinoPaymentRegistry", registryAddress, deployer);

    // Verify casino admin status through registry
    const casinoDetails = await registry.getCasinoDetails(casinoId);
    const admins = await registry.getCasinoAdmins(casinoId);
    
    const isAdmin = casinoDetails.owner === deployer.address || 
                   admins.includes(deployer.address) || 
                   deployer.address === await registry.owner();

    if (!isAdmin) {
        throw new Error("Deployer is not a casino admin");
    }

    // Verify casino is active
    if (!casinoDetails.active) {
        throw new Error("Casino is not active");
    }

    console.log("Setting fees...");
    try {
        const tx1 = await treasury.setFees(depositFeeBps, withdrawalFeeBps, TX_OVERRIDES);
        console.log("Waiting for fee update transaction...");
        await tx1.wait(2);
        console.log("Fees updated successfully!");

        console.log("\nSetting fee recipient...");
        const tx2 = await treasury.setFeeRecipient(feeRecipient, TX_OVERRIDES);
        console.log("Waiting for fee recipient update transaction...");
        await tx2.wait(2);
        console.log("Fee recipient updated successfully!");

        // Verify the updates
        const currentFees = await treasury.depositFeeBps();
        const currentWithdrawalFees = await treasury.withdrawalFeeBps();
        const currentFeeRecipient = await treasury.casinoFeeRecipient();

        console.log("\n=== Verification ===");
        console.log(`Current Deposit Fee (BPS): ${currentFees}`);
        console.log(`Current Withdrawal Fee (BPS): ${currentWithdrawalFees}`);
        console.log(`Current Fee Recipient: ${currentFeeRecipient}`);

    } catch (error) {
        console.error("Error updating fees:", error.message);
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });