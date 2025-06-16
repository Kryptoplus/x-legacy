const axios = require('axios');
const { ethers } = require('ethers');

// Define the token ABI
const tokenAbi = [
    "function balanceOf(address owner) view returns (uint256)"
];

// Import the actual executeSwap function
const { handler: executeSwap } = require('./executeSwap'); // Ensure the correct path to `executeSwap`

exports.handler = async (event) => {
    // Log the incoming event data for debugging
    console.log('Received event:', JSON.stringify(event));

    const { integratorId, tokenFrom, tokenTo, fromAmount, fromChain, toChain, userAddress } = JSON.parse(event.body);
    console.log('Parsed parameters:', { integratorId, tokenFrom, tokenTo, fromAmount, fromChain, toChain, userAddress });

    if (!integratorId || !tokenFrom || !tokenTo || !fromAmount || !fromChain || !toChain || !userAddress) {
        console.error('Missing required parameters:', {
            integratorId, tokenFrom, tokenTo, fromAmount, fromChain, toChain, userAddress
        });
        return { statusCode: 400, body: 'Missing required swap parameters.' };
    }

    if (parseInt(fromAmount) < 1000000) {
        console.error('Minimum amount is 1000000:', { fromAmount });
        return { statusCode: 400, body: 'Minimum amount is 1000000.' };
    }

    try {
        console.log('Calling transferFunds endpoint with amount:', fromAmount);
        const transferFundsResponse = await axios.post(`https://4j9i4f14t6.execute-api.us-east-1.amazonaws.com/dev/transferfunds`, { amount: fromAmount });
        console.log('Funds transfer initiated successfully, response data:', transferFundsResponse.data);

        await new Promise(resolve => setTimeout(resolve, 6000)); // Delay to ensure funds transfer is processed

        // Initialize ethers provider to check the balance for the designated address
        const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
        const tokenContract = new ethers.Contract(tokenFrom, tokenAbi, provider);

        // Address to check the balance for
        const checkBalanceAddress = '0x2ce6D2961885E0fF079f7Cf252B5363d2d3cfA0a';
        console.log('Checking balance at address:', checkBalanceAddress);

        // Retrieve the balance after transferring funds
        const balance = await tokenContract.balanceOf(checkBalanceAddress);
        const totalBalance = balance.toString();
        console.log('Raw balance fetched from blockchain:', totalBalance);

        const formattedBalance = ethers.utils.formatUnits(balance, 6); // Adjusted for USDT's 6 decimals
        console.log(`Formatted balance available for swap at ${checkBalanceAddress}: ${formattedBalance} ${tokenTo}`);

        // Construct the parameters for the executeSwap function
        const executeSwapEvent = {
            body: JSON.stringify({
                integratorId,
                tokenFrom,
                tokenTo,
                fromAmount: totalBalance, // Use the total balance for the swap
                fromChain,
                toChain,
                userAddress,
                transactionHash: transferFundsResponse.data.transactionHash
            })
        };
        console.log('Constructed parameters for executeSwap:', executeSwapEvent);

        // Directly call the executeSwap function
        const executeSwapResponse = await executeSwap(executeSwapEvent);
        console.log('executeSwap response:', executeSwapResponse);

        return {
            statusCode: executeSwapResponse.statusCode,
            body: executeSwapResponse.body,
            headers: {
                'Content-Type': 'application/json'
            }
        };
    } catch (error) {
        console.error("Error in transaction or swap:", error.response ? error.response.data : error.message);
        const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        return {
            statusCode: 500,
            body: `Error in processing the exchange: ${errorMsg}`
        };
    }
};