const { Relayer } = require('@openzeppelin/defender-relay-client');

function convertFromMicro(amount) {
    return Number(amount) / 1e6; // Adjust according to the decimal places of your stablecoin
}

exports.handler = async (event) => {
    const { integratorId, tokenFrom, tokenTo, fromAmount, fromChain, toChain, userAddress, transactionHash } = JSON.parse(event.body);

    if (!integratorId || !tokenFrom || !tokenTo || !fromAmount || !fromChain || !toChain || !userAddress || !transactionHash) {
        return { statusCode: 400, body: 'Missing required body parameters.' };
    }

    // Simulating the result of getRoute using the provided input data directly
    const transactionRequest = {
        target: "0x84e199D87740658c3781fC0449e23849dea46a0d",
        data: "0xa9059cbb0000000000000000000000002f318C334780961FB129D2a6c30D0763d9a5C9700000000000000000000000000000000000000000000000000000000127a6f00",
        value: "0x0",
        gasLimit: "0x5208",
        speed: 'fast'
    };

    const statusSimulation = { status: 'Completed', fromChain: { transactionId: transactionHash }, toChain: { transactionId: "simulated_toChainTxId" } };

    const credentials = { apiKey: process.env.RELAYER_API_KEY, apiSecret: process.env.RELAYER_API_SECRET };
    const relayer = new Relayer(credentials);

    try {
        const txReceipt = await relayer.sendTransaction(transactionRequest);
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Swap executed successfully",
                transactionHash: txReceipt.hash,
                status: statusSimulation.status,
                sourceChainTransactionHash: statusSimulation.fromChain.transactionId,
                destinationChainTransactionHash: statusSimulation.toChain.transactionId,
                fromAmount: convertFromMicro(fromAmount),
                toAmount: convertFromMicro(fromAmount * 0.99), // Assuming some conversion ratio for simplicity
                minimumAmount: convertFromMicro(fromAmount * 0.98), // Example slippage calculation
                exchangeRate: 1.01 // Placeholder for actual exchange rate from getRoute
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        };
    } catch (error) {
        console.error("API or transaction error:", error);
        return { statusCode: 500, body: "An unexpected error occurred" };
    }
};
