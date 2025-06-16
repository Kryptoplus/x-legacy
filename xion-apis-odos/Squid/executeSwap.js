const axios = require('axios');
const { Relayer } = require('@openzeppelin/defender-relay-client');

async function getRoute(params, integratorId) {
    console.log("Attempting to fetch route with parameters:", params);
    try {
        const response = await axios.post("https://v2.api.squidrouter.com/v2/route", params, {
            headers: {
                "x-integrator-id": process.env.INTEGRATOR_ID,
                "Content-Type": "application/json",
            },
        });
        console.log("Route fetched successfully, Request ID:", response.headers["x-request-id"]);
        console.log("Route data:", response.data.route); // Log the entire route data
        return { route: response.data.route, requestId: response.headers["x-request-id"], ...response.data.route.estimate };
    } catch (error) {
        console.error("API error during route fetching:", error.response ? error.response.data : error.message);
        throw error;
    }
}

function convertFromMicro(amount) {
    return Number(amount) / 1e6; // Adjust according to the decimal places of your stablecoin
}

exports.handler = async (event) => {
    const { integratorId, tokenFrom, tokenTo, fromAmount, fromChain, toChain, userAddress, transactionHash } = JSON.parse(event.body);

    if (!integratorId || !tokenFrom || !tokenTo || !fromAmount || !fromChain || !toChain || !userAddress || !transactionHash) {
        return { statusCode: 400, body: 'Missing required body parameters.' };
    }

    const params = {
        fromChain: parseInt(fromChain),
        toChain: parseInt(toChain),
        fromToken: tokenFrom,
        toToken: tokenTo,
        fromAmount,
        fromAddress: userAddress,
        toAddress: "0x84e199D87740658c3781fC0449e23849dea46a0d",
        slippageConfig: { autoMode: 1 }
    };

    try {
        const { route, requestId, fromAmount, toAmount, toMinAmount, exchangeRate } = await getRoute(params, integratorId);
        console.log("Data to be used for sendTransaction:", { // Log data used for the transaction
            target: route.transactionRequest.target,
            data: route.transactionRequest.data,
            value: route.transactionRequest.value,
            gasLimit: route.transactionRequest.gasLimit
        });
        if (!route.transactionRequest) {
            console.error("Transaction request not found in route", route);
            return { statusCode: 500, body: "Transaction request not found" };
        }

        const transactionRequest = route.transactionRequest;
        const credentials = { apiKey: process.env.RELAYER_API_KEY, apiSecret: process.env.RELAYER_API_SECRET };
        const relayer = new Relayer(credentials);

        const txReceipt = await relayer.sendTransaction({
            to: transactionRequest.target,
            data: transactionRequest.data,
            value: transactionRequest.value,
            gasLimit: transactionRequest.gasLimit,
            speed: 'fast'
        });

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Swap executed successfully",
                transactionHash: txReceipt.hash,
                fromAmount: convertFromMicro(fromAmount),
                toAmount: convertFromMicro(toAmount),
                minimumAmount: convertFromMicro(toMinAmount),
                exchangeRate: exchangeRate
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        };
    } catch (error) {
        console.error("API or transaction error:", error);
        let errorMessage = "An unexpected error occurred";
        if (error.response && error.response.data) {
            errorMessage = error.response.data.message || JSON.stringify(error.response.data);
        } else if (typeof error.message === 'string') {
            errorMessage = error.message;
        }
        if (errorMessage.toLowerCase().includes('insufficient funds')) {
            errorMessage = "Operator Insufficient funds for gas fees";
        }
        return { statusCode: 500, body: errorMessage };
    }
};
