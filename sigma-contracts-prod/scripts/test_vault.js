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

    console.log(`Testing SigmaVault on network: ${network}`);
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
    
    if (!vaultAddress || !casinoTreasuryAddress || !chipAddress) {
        throw new Error('Missing required contract addresses in deployment-info.json');
    }

    // Get token addresses from deployment info
    const usdtAddress = vaultInfo.constructorArgs.usdt;
    const usdcAddress = vaultInfo.constructorArgs.usdc;

    // Define the specific addresses for the test
    const fromAddress = "0x84e199D87740658c3781fC0449e23849dea46a0d";  // Hardcoded from address
    const casinoAddress = "0xF1B47552b22786624057eEdCF96B01910e3Fb749";  // Hardcoded casino address

    console.log("\n=== Contract Addresses ===");
    console.log(`Vault: ${vaultAddress}`);
    console.log(`Casino Treasury: ${casinoTreasuryAddress}`);
    console.log(`CHIP: ${chipAddress}`);
    console.log(`USDT: ${usdtAddress}`);
    console.log(`USDC: ${usdcAddress}`);
    console.log(`From Address: ${fromAddress}`);
    console.log(`Casino Address: ${casinoAddress}`);

    // Get contract instances
    const vault = await ethers.getContractAt("ISigmaVault", vaultAddress);
    const usdt = await ethers.getContractAt("IERC20", usdtAddress);
    const usdc = await ethers.getContractAt("IERC20", usdcAddress);
    const casinoTreasury = await ethers.getContractAt("ICasinoTreasury", casinoTreasuryAddress);
    const chip = await ethers.getContractAt("CHIP", chipAddress);

    // Test amounts
    const usdtAmount = ethers.parseUnits("0.012", 6);
    const usdcAmount = ethers.parseUnits("0.012", 6);

    // Initial status check
    console.log("\n=== Initial Status Check ===");
    const isVaultWhitelisted = await chip.whitelistedVaults(vaultAddress);
    const isVaultInitialized = await chip.vaultInitialized(vaultAddress);
    const vaultATokenBalance = await chip.vaultATokenBalance(vaultAddress);
    const totalSupply = await chip.totalSupply();
    const isVaultAdmin = await vault.isAdmin(vaultAddress);

    console.log(`Vault whitelisted: ${isVaultWhitelisted}`);
    console.log(`Vault initialized: ${isVaultInitialized}`);
    console.log(`Vault aToken balance: ${ethers.formatUnits(vaultATokenBalance, 6)}`);
    console.log(`Total supply: ${ethers.formatUnits(totalSupply, 6)}`);
    console.log(`Vault is admin: ${isVaultAdmin}`);

    if (!isVaultWhitelisted || !isVaultInitialized) {
        throw new Error("Vault not properly initialized in CHIP");
    }

    // Check admin status
    console.log("\nChecking admin status...");
    const isDeployerAdmin = await vault.isAdmin(deployer.address);
    console.log(`Deployer is admin: ${isDeployerAdmin}`);

    if (!isDeployerAdmin) {
        console.log("Adding deployer as admin...");
        const addAdminTx = await vault.addAdmin(deployer.address, TX_OVERRIDES);
        await addAdminTx.wait();
        console.log("Deployer added as admin");
    }

    // Check allowances
    console.log("\nChecking allowances...");
    const usdtAllowance = await usdt.allowance(fromAddress, vaultAddress);
    console.log(`USDT allowance: ${ethers.formatUnits(usdtAllowance, 6)}`);
    
    if (usdtAllowance < usdtAmount) {
        throw new Error("Insufficient USDT allowance");
    }

    // Test deposit
    console.log("\n=== Testing Deposit ===");
    if (totalSupply === 0n) {
        console.log("First deposit will use 1:1 ratio (no existing shares)");
    } else {
        console.log("Using existing share price for deposit");
    }

    console.log("Depositing USDT...");
    const singleDepositTx = await vault.deposit(
        fromAddress,           // from address (user's wallet)
        [usdtAddress],         // assets array
        [usdtAmount],          // amounts array
        casinoAddress,         // receiver (casino address)
        true,                  // depositToCasino
        TX_OVERRIDES
    );
    
    console.log("Waiting for deposit transaction...");
    const singleDepositReceipt = await singleDepositTx.wait();
    
    // Get shares from event
    const depositEvent = singleDepositReceipt.logs.find(
        log => log.fragment && log.fragment.name === 'Deposited'
    );
    const shares = depositEvent.args.shares;
    console.log(`Shares received: ${ethers.formatUnits(shares, 6)}`);

    // Verify casino treasury balance
    const casinoBalance = await casinoTreasury.balances(casinoAddress, usdtAddress);
    console.log(`Casino treasury balance: ${ethers.formatUnits(casinoBalance, 6)}`);

    // Test preview functions
    console.log("\n=== Testing Preview Functions ===");
    const previewSingleDeposit = await vault.previewDeposit([usdtAddress], [usdtAmount]);
    console.log(`Preview shares to receive: ${ethers.formatUnits(previewSingleDeposit, 6)}`);
    // Test withdrawal
    console.log("\n=== Testing Withdrawal ===");
    // Check casino treasury CHIP balance instead of wallet balance
    const casinoTreasuryChipBalance = await casinoTreasury.balances(casinoAddress, chipAddress);
    console.log(`Casino Treasury CHIP balance: ${ethers.formatUnits(casinoTreasuryChipBalance, 6)}`);

    if (casinoTreasuryChipBalance < shares) {
        throw new Error("Insufficient CHIP balance in casino treasury for withdrawal");
    }

    // Calculate share amounts for each recipient
    const recipients = [
        casinoAddress,
        "0x54e88C19318323c532186864CB67143A338B08ee",
        "0x84e199D87740658c3781fC0449e23849dea46a0d"
    ];
    
    // All amounts should be in shares
    const recipientShareAmounts = [
        shares / 2n,  // 50% of shares to casino
        shares / 4n,  // 25% of shares to recipient 1
        shares / 4n   // 25% of shares to recipient 2
    ];

    console.log("\nWithdrawal Parameters:");
    console.log("Total shares to withdraw:", ethers.formatUnits(shares, 6));
    console.log("Recipients:", recipients);
    console.log("Recipient share amounts:", recipientShareAmounts.map(a => ethers.formatUnits(a, 6)));

    const withdrawTx = await vault.withdraw(
        casinoAddress,         // from address (casino address)
        shares,                // total shares to withdraw
        recipients,            // recipients array
        recipientShareAmounts, // recipient share amounts array
        [usdtAddress],         // assets array
        [shares],              // share amounts array (using shares, not USDT)
        [0],                   // minAmounts array
        false,                 // fromWallet flag - set to false since we're using casino treasury
        TX_OVERRIDES
    );
    
    const withdrawReceipt = await withdrawTx.wait();
    console.log("Withdrawal successful");

    // Verify final balances
    console.log("\n=== Final Balances ===");
    // Check casino treasury balances after withdrawal
    const finalCasinoTreasuryChipBalance = await casinoTreasury.balances(casinoAddress, chipAddress);
    console.log(`Final Casino Treasury CHIP balance: ${ethers.formatUnits(finalCasinoTreasuryChipBalance, 6)}`);
    
    // Check USDT balances after withdrawal
    for (let i = 0; i < recipients.length; i++) {
        const balance = await usdt.balanceOf(recipients[i]);
        console.log(`Recipient ${i} USDT balance: ${ethers.formatUnits(balance, 6)}`);
    }
 
     // Final status check
     console.log("\n=== Final Status Check ===");
     const finalATokenBalance = await chip.vaultATokenBalance(vaultAddress);
     const finalTotalSupply = await chip.totalSupply();
     console.log(`Final aToken balance: ${ethers.formatUnits(finalATokenBalance, 6)}`);
     console.log(`Final total supply: ${ethers.formatUnits(finalTotalSupply, 6)}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });