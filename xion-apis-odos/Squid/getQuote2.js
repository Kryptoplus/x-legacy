// getQuote.js

const { ethers } = require('ethers');
const { Squid } = require("@0xsquid/sdk");

exports.handler = async (event) => {
    console.log('Received event:', JSON.stringify(event));

    const { fromAmount } = JSON.parse(event.body);
    const formattedFromAmount = ethers.parseUnits(fromAmount.toString(), 6);
    const feeAmount = ethers.parseUnits("0.01", 6);
    const finalFromAmount = formattedFromAmount - feeAmount

    const fromAddress = "0x84e199D87740658c3781fC0449e23849dea46a0d";
    const contractAddress = "0x7b6677cd62491529A7Ef96f6B5bf1E869A8A2d70";

    const abi = [
        {
            "inputs": [
                {
                    "internalType": "address",
                    "name": "from",
                    "type": "address"
                },
                {
                    "internalType": "uint256",
                    "name": "amount",
                    "type": "uint256"
                }
            ],
            "name": "transferFunds",
            "outputs": [],
            "stateMutability": "nonpayable",
            "type": "function"
        },
    ];

    const iface = new ethers.Interface(abi);
    const callData = iface.encodeFunctionData("transferFunds", [fromAddress, finalFromAmount.toString()]);

    const preHooks = [
        {
            callType: 0, // SquidCallType.DEFAULT
            target: contractAddress,
            value: "0",
            callData: callData,
            estimatedGas: "300000",
            payload: {
                tokenAddress: "1",
                inputPos: 1, // Position of the amount in the encoded data
            },
        }
    ];

    const params = {
        fromChain: 137,
        toChain: 137,
        fromToken: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
        toToken: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
        fromAmount: finalFromAmount.toString(),
        fromAddress: "0x2ce6D2961885E0fF079f7Cf252B5363d2d3cfA0a",
        toAddress: '0x84e199D87740658c3781fC0449e23849dea46a0d',
        slippageConfig: {
            autoMode: 1
        },
        quoteOnly: false,
        bypassGuardrails: true,
        preHooks: preHooks
    };

    console.log("Attempting to fetch route with parameters:", params);

    try {
        const squid = new Squid({
            baseUrl: "https://v2.api.squidrouter.com",
            integratorId: process.env.INTEGRATOR_ID
        });

        await squid.init();
        console.log("Squid initialized");

        const { route, requestId } = await squid.getRoute(params);
        console.log("Route fetched successfully, Request ID:", requestId);
        console.log("route", route);
        console.log("route actions", route.estimate.actions);


        const quoteResponse = {
            fromAmount: finalFromAmount.toString(),
            toAmount: ethers.formatUnits(route.estimate.toAmount, 18),
            requestId: requestId,
            target: route.transactionRequest.target,
            value: route.transactionRequest.value,
            data: route.transactionRequest.data,
            gasLimit: route.transactionRequest.gasLimit,
            route: route,
        };

        return {
            statusCode: 200,
            body: JSON.stringify(quoteResponse)
        };
    } catch (error) {
        console.error("SDK error during route fetching:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
