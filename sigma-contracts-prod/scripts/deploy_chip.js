const { ethers, upgrades } = require("hardhat");
const fs = require('fs');
require("dotenv").config();

// --- Manual Gas Settings ---
const MANUAL_GAS_LIMIT = 30000000;
const MANUAL_GAS_PRICE_GWEI = "200";
const MANUAL_GAS_PRICE = ethers.parseUnits(MANUAL_GAS_PRICE_GWEI, "gwei");
const TX_OVERRIDES = {
    gasLimit: MANUAL_GAS_LIMIT,
    gasPrice: MANUAL_GAS_PRICE,
};
// --- End Manual Gas Settings ---

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = hre.network.name;
    
    console.log(`\nDeploying CHIP on network: ${network}`);
    console.log(`Using account: ${deployer.address}`);
    console.log(`Account balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

    try {
        // Deploy implementation
        console.log("\nDeploying CHIP implementation...");
        const CHIP = await ethers.getContractFactory("CHIP");
        
        // Deploy the proxy and initialize it
        console.log("Deploying proxy and initializing...");
        const chip = await upgrades.deployProxy(CHIP, [
            "CHIP",  // name
            "CHIP",        // symbol
            deployer.address  // initialOwner
        ], {
            initializer: 'initialize',
            ...TX_OVERRIDES
        });

        await chip.waitForDeployment();
        const address = await chip.getAddress();
        
        // Verify deployment
        console.log("\nVerifying deployment...");
        const name = await chip.name();
        const symbol = await chip.symbol();
        const owner = await chip.owner();
        const isPaused = await chip.paused();

        // Save deployment info
        const deploymentInfo = {
            name: "CHIP",
            address: address,
            constructorArgs: {
                name: "CHIP",
                symbol: "CHIP",
                initialOwner: deployer.address
            },
            implementation: await upgrades.erc1967.getImplementationAddress(address),
            proxy: address
        };

        // Update deployment-info.json
        let allDeployments = {};
        try {
            allDeployments = JSON.parse(fs.readFileSync('./deployment-info.json', 'utf8'));
        } catch (error) {
            console.log("Creating new deployment-info.json file");
        }

        allDeployments[network] = {
            ...allDeployments[network],
            CHIP: deploymentInfo
        };

        fs.writeFileSync(
            './deployment-info.json',
            JSON.stringify(allDeployments, null, 2)
        );

        // Print deployment results
        console.log("\n=== Deployment Results ===");
        console.log("Contract Address:", address);
        console.log("Name:", name);
        console.log("Symbol:", symbol);
        console.log("Owner:", owner);
        console.log("Paused:", isPaused);
        console.log("\nDeployment info saved to deployment-info.json");

        // Verify owner is set correctly
        if (owner !== deployer.address) {
            throw new Error("Owner not set correctly");
        }

        // Verify contract is not paused
        if (isPaused) {
            throw new Error("Contract is paused after deployment");
        }

        console.log("\n✓ CHIP deployed and verified successfully");
        console.log("\nNext steps:");
        console.log("1. Run set_vaults.js to whitelist vault and initialize assets");
        console.log("2. Verify contract on block explorer");
        console.log("3. Test first deposit");

    } catch (error) {
        console.error("\nDeployment failed!");
        console.error("Error details:", error);
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });