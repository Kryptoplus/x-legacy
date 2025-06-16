const fs = require('fs');
const path = require('path');

async function loadDeploymentInfo() {
    const deploymentPath = path.join(__dirname, '../../deployment-info.json');
    
    if (!fs.existsSync(deploymentPath)) {
        throw new Error(`Deployment info file not found at ${deploymentPath}`);
    }

    try {
        const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
        
        if (!deploymentInfo.polygon) {
            throw new Error('Polygon network data not found in deployment info');
        }

        // Get required addresses from environment variables
        const casinoId = process.env.CASINO_ID;
        const treasuryAddress = process.env.TREASURY_ADDRESS;

        if (!casinoId || !treasuryAddress) {
            throw new Error('CASINO_ID and TREASURY_ADDRESS must be set in environment variables');
        }

        // Get registry address from deployment info
        const registryData = deploymentInfo.polygon.CasinoPaymentRegistry;
        if (!registryData || !registryData.proxyAddress) {
            throw new Error('Registry proxy address not found in deployment info');
        }

        // Construct and return the complete deployment info object
        return {
            registryAddress: registryData.proxyAddress,
            treasuryAddress: treasuryAddress,
            casinoId: casinoId,
            polygon: deploymentInfo.polygon
        };
    } catch (error) {
        throw new Error(`Failed to load deployment info: ${error.message}`);
    }
}

module.exports = { loadDeploymentInfo }; 