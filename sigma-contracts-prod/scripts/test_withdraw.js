const hre = require("hardhat");
const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');
require("dotenv").config();

const DEPLOYMENT_INFO_PATH = path.join(__dirname, '..', 'deployment-info.json');

// --- Manual Gas Settings ---
const MANUAL_GAS_LIMIT = 5000000;
const MANUAL_GAS_PRICE_GWEI = "200";
const MANUAL_GAS_PRICE = ethers.parseUnits(MANUAL_GAS_PRICE_GWEI, "gwei");

const TX_OVERRIDES = {
    gasLimit: MANUAL_GAS_LIMIT,
    gasPrice: MANUAL_GAS_PRICE,
};

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = hre.network.name;

    // Get casino ID from environment first
    const casinoId = process.env.CASINO_ID;
    if (!casinoId) {
        throw new Error("CASINO_ID not set in environment");
    }

    console.log(`Testing SigmaVault Withdrawal on network: ${network}`);
    console.log(`Test account: ${deployer.address}`);
    console.log(`Account balance: ${(await ethers.provider.getBalance(deployer.address)).toString()}`);
    console.log(`Testing vault for casino ID: ${casinoId}`);

    // Load deployment info
    const deploymentInfo = JSON.parse(fs.readFileSync(DEPLOYMENT_INFO_PATH, 'utf8'));
    const networkInfo = deploymentInfo[network];
    
    if (!networkInfo) {
        throw new Error(`No deployment info found for network: ${network}`);
    }

    // Get vault info from the correct location in deployment info
    const casinoInfo = networkInfo.Casinos[casinoId];
    if (!casinoInfo || !casinoInfo.vault) {
        throw new Error(`No vault found for casino ${casinoId}`);
    }

    const vaultInfo = casinoInfo.vault;
    const vaultAddress = vaultInfo.address;
    const casinoTreasuryAddress = vaultInfo.constructorArgs.casinoTreasury;
    const chipAddress = vaultInfo.constructorArgs.chip;
    const usdtAddress = vaultInfo.constructorArgs.usdt;
    const usdcAddress = vaultInfo.constructorArgs.usdc;
    
    if (!vaultAddress || !casinoTreasuryAddress || !chipAddress) {
        throw new Error('Missing required contract addresses in deployment-info.json');
    }

    // Define the specific addresses for the test
    const casinoAddress = "0xF1B47552b22786624057eEdCF96B01910e3Fb749";  // Hardcoded casino address

    console.log("\n=== Contract Addresses ===");
    console.log(`Vault: ${vaultAddress}`);
    console.log(`Casino Treasury: ${casinoTreasuryAddress}`);
    console.log(`CHIP: ${chipAddress}`);
    console.log(`USDT: ${usdtAddress}`);
    console.log(`USDC: ${usdcAddress}`);
    console.log(`Casino Address: ${casinoAddress}`);

    // Get contract instances
    const vault = await ethers.getContractAt("ISigmaVault", vaultAddress);
    const usdt = await ethers.getContractAt("IERC20", usdtAddress);
    const casinoTreasury = await ethers.getContractAt("ICasinoTreasury", casinoTreasuryAddress);
    const chip = await ethers.getContractAt("CHIP", chipAddress);

    // Check casino treasury state
    console.log("\n=== CasinoTreasury State Check ===");
    const registryAddress = await casinoTreasury.registry();
    const registry = await ethers.getContractAt("ICasinoPaymentRegistry", registryAddress);
    const isCasinoActive = await registry.getCasinoDetails(casinoId).then(details => details.active);
    console.log(`Casino is active: ${isCasinoActive}`);
    const chipSupported = await registry.isTokenSupported(casinoId, chipAddress);
    console.log(`CHIP token supported: ${chipSupported}`);
    const casinoAdmins = await registry.getCasinoAdmins(casinoId);
    const isDeployerCasinoAdmin = casinoAdmins.includes(deployer.address);
    console.log(`Deployer is casino admin: ${isDeployerCasinoAdmin}`);

    if (!isCasinoActive || !chipSupported || !isDeployerCasinoAdmin) {
        throw new Error("CasinoTreasury state invalid: Check casino activity, CHIP token support, or admin status");
    }

    // Get user stats to determine the exact CHIP balance
    console.log("\n=== Initial Status Check ===");
    const userStats = await casinoTreasury.getUserStats(casinoAddress, chipAddress);
    const casinoTreasuryChipBalance = userStats.balance;
    console.log(`Casino Treasury CHIP balance (raw): ${casinoTreasuryChipBalance.toString()}`);
    console.log(`Casino Treasury CHIP balance (formatted): ${ethers.formatUnits(casinoTreasuryChipBalance, 6)}`);

    // Set total shares to withdraw based on available balance
    let totalShares;
    const desiredShares = ethers.parseUnits("12000", 6); // Desired 12000 shares with 6 decimals
    console.log(`Desired CHIP shares (raw): ${desiredShares.toString()}`);
    if (casinoTreasuryChipBalance < desiredShares) {
        console.log(`Insufficient CHIP balance. Adjusting to available balance (raw): ${casinoTreasuryChipBalance.toString()}`);
        totalShares = casinoTreasuryChipBalance;
    } else {
        totalShares = desiredShares;
    }

    if (totalShares === 0n) {
        throw new Error("No CHIP shares available for withdrawal");
    }

    // Define recipients
    const recipients = [
        casinoAddress,
        "0x54e88C19318323c532186864CB67143A338B08ee",
        "0x84e199D87740658c3781fC0449e23849dea46a0d"
    ];

    // Preview the withdrawal to get the exact USDT amount
    const previewWithdraw = await vault.previewWithdraw(totalShares, [usdtAddress]);
    const totalUsdtToReceiveRaw = previewWithdraw[0];
    console.log(`Preview USDT to receive (raw): ${totalUsdtToReceiveRaw.toString()}`);
    console.log(`Preview USDT to receive (formatted): ${ethers.formatUnits(totalUsdtToReceiveRaw, 6)}`);

    // Adjust the total USDT amount to match the contract's maxWithdraw calculation
    const ONE = ethers.parseUnits("1", 18); // 1e18
    const assetsLength = BigInt(1); // Since we're withdrawing one asset (USDT)
    // Mimic the _roundUp logic: ((shares * ONE) - 1) / assets.length + 1
    const sharesBN = totalShares;
    const intermediate = sharesBN * ONE - BigInt(1);
    const maxWithdraw = intermediate / assetsLength + BigInt(1);
    console.log(`Calculated maxWithdraw (raw): ${maxWithdraw.toString()}`);

    // Since previewWithdraw already accounts for internal conversions, we use it directly for recipient amounts
    const totalUsdtToReceive = totalUsdtToReceiveRaw; // Use the previewed amount for splitting

    // Split USDT among recipients
    const recipientUsdtAmounts = [
        totalUsdtToReceive / 2n,  // 50% to casino
        totalUsdtToReceive / 4n,  // 25% to recipient 1
        totalUsdtToReceive / 4n   // 25% to recipient 2
    ];

    console.log("\nWithdrawal Parameters:");
    console.log(`Total CHIP shares to withdraw (raw): ${totalShares.toString()}`);
    console.log(`Total CHIP shares to withdraw (formatted): ${ethers.formatUnits(totalShares, 6)}`);
    console.log(`Total USDT to receive (raw): ${totalUsdtToReceive.toString()}`);
    console.log(`Total USDT to receive (formatted): ${ethers.formatUnits(totalUsdtToReceive, 6)}`);
    console.log(`Recipients:`, recipients);
    console.log(`Recipient USDT amounts (raw):`, recipientUsdtAmounts.map(a => a.toString()));
    console.log(`Recipient USDT amounts (formatted):`, recipientUsdtAmounts.map(a => ethers.formatUnits(a, 6)));

    // Execute withdrawal
    console.log("\nExecuting withdrawal...");
    try {
        const withdrawTx = await vault.withdraw(
            casinoAddress,         // from address (casino address)
            totalShares,           // total shares to withdraw
            recipients,            // recipients array
            recipientUsdtAmounts,  // recipient USDT amounts array
            [usdtAddress],         // assets array
            [totalShares],         // total USDT amount array (adjusted to match maxWithdraw)
            [0],                   // minAmounts array
            false,                 // fromWallet flag
            TX_OVERRIDES
        );
        
        const withdrawReceipt = await withdrawTx.wait();
        console.log("Withdrawal successful");
        console.log(`Withdrawal Transaction Hash: ${withdrawReceipt.hash}`);
    } catch (error) {
        console.error("Withdrawal failed:", error);
        if (error.data) {
            try {
                const iface = new ethers.Interface(vault.interface.abi);
                const decodedError = iface.parseError(error.data);
                console.error("Decoded revert reason:", decodedError);
            } catch (decodeError) {
                console.error("Could not decode revert reason:", decodeError);
            }
        }
        throw error;
    }

    // Verify final balances
    console.log("\n=== Final Balances ===");
    const finalCasinoTreasuryChipBalance = await casinoTreasury.balances(casinoAddress, chipAddress);
    console.log(`Final Casino Treasury CHIP balance (raw): ${finalCasinoTreasuryChipBalance.toString()}`);
    console.log(`Final Casino Treasury CHIP balance (formatted): ${ethers.formatUnits(finalCasinoTreasuryChipBalance, 6)}`);
    
    // Check USDT balances after withdrawal
    for (let i = 0; i < recipients.length; i++) {
        const balance = await usdt.balanceOf(recipients[i]);
        console.log(`Recipient ${i} USDT balance (raw): ${balance.toString()}`);
        console.log(`Recipient ${i} USDT balance (formatted): ${ethers.formatUnits(balance, 6)}`);
    }

    // Final status check
    console.log("\n=== Final Status Check ===");
    const finalATokenBalance = await chip.vaultATokenBalance(vaultAddress);
    const finalTotalSupply = await chip.totalSupply();
    console.log(`Final aToken balance (raw): ${finalATokenBalance.toString()}`);
    console.log(`Final aToken balance (formatted): ${ethers.formatUnits(finalATokenBalance, 6)}`);
    console.log(`Final total supply (raw): ${finalTotalSupply.toString()}`);
    console.log(`Final total supply (formatted): ${ethers.formatUnits(finalTotalSupply, 6)}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });