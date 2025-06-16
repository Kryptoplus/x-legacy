const axios = require('axios');
const ethers = require('ethers');
const { isAuthorized } = require('./auth');

require('events').EventEmitter.defaultMaxListeners = 20;

exports.handler = async (event) => {
    console.log('Received event:', JSON.stringify(event));

    // Handle preflight requests for CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*', // Allow all origins or specify your domain
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, x-integrator-id'
            }
        };
    }

    let parsedBody;
    try {
        parsedBody = JSON.parse(event.body);
    } catch (error) {
        console.error('Error parsing event body:', error.message);
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*', // Allow all origins or specify your domain
            },
            body: JSON.stringify({ error: 'Invalid request body' })
        };
    }

    const { fromAmount, toAddress, connectWallet } = parsedBody;

    // Check if toAddress and connectWallet are provided
    if (!toAddress || !connectWallet) {
        console.log('Missing toAddress or connectWallet in the request');
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*', // Allow all origins or specify your domain
            },
            body: JSON.stringify({ error: 'toAddress and connectWallet are required' })
        };
    }

    // Check authorization
    if (!isAuthorized(toAddress, connectWallet)) {
        console.log('Unauthorized access attempt');
        return {
            statusCode: 401,
            headers: {
                'Access-Control-Allow-Origin': '*', // Allow all origins or specify your domain
            },
            body: JSON.stringify({ error: 'Unauthorized' })
        };
    }

    const formattedFromAmount = ethers.parseUnits(fromAmount.toString(), 6);
    const feeAmount = ethers.parseUnits("2.50", 6);
    const finalFromAmount = formattedFromAmount - feeAmount;

    const params = {
        fromChain: "137",
        toChain: "43114",
        fromToken: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
        toToken: "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
        fromAmount: finalFromAmount.toString(),
        fromAddress: "0x98e2Fa14BbE89F55d43A199ba36e9aD938DbD421",
        toAddress: toAddress, // Use the provided toAddress
        slippageConfig: {
            autoMode: 1
        },
        bypassGuardrails: true, // This will bypass the guardrails check
        quoteOnly: false,
        enableBoost: true,
    };

    console.log("Attempting to fetch route with parameters:", params);

    try {
        const response = await axios.post("https://v2.api.squidrouter.com/v2/route", params, {
            headers: {
                "x-integrator-id": process.env.INTEGRATOR_ID,
                "Content-Type": "application/json"
            },
        });

        console.log("Route fetched successfully, Request ID:", response.headers["x-request-id"]);
        console.log("response", response.data);
        const paddedValue = BigInt(response.data.route.transactionRequest.value) + ethers.parseUnits("0.2", 18);
        // const convertToAmountMin = BigInt(response.data.route.estimate.toAmountMin)
        // const convertToAmount = BigInt(response.data.route.estimate.toAmount)
        // Assuming response.data.route.estimate.toAmountMin and toAmount are already strings with 6 decimal places
        // Function to format to 2 decimal places without rounding
        const formatToTwoDecimals = (value) => {
            const formattedValue = ethers.formatUnits(value, 6); // Convert to a string with 6 decimal places
            const parts = formattedValue.split('.');
            const integerPart = parts[0];
            const decimalPart = parts[1] ? parts[1].substring(0, 2) : '00';
            return `${integerPart}.${decimalPart}`;
        };

        // Access and format the amounts
        const toAmountMin = response.data.route.estimate.toAmountMin;
        const toAmount = response.data.route.estimate.toAmount;

        const formattedToAmountMin = formatToTwoDecimals(toAmountMin);
        const formattedToAmount = formatToTwoDecimals(toAmount);
        

        // Preparing the specific response structure
        const quoteResponse = {
            from: connectWallet,
            externalBridgeContract: response.data.route.transactionRequest.target,
            amount: formattedFromAmount.toString(),
            value: "0",
            feeAmount: feeAmount.toString(),
            callData: response.data.route.transactionRequest.data,
            requestId: response.headers["x-request-id"],
            toAmountMin: formattedToAmountMin,
            toAmount: formattedToAmount,
            exchangeRate: response.data.route.estimate.exchangeRate
        };

        // return {
        //     statusCode: 200, data: quoteResponse
        // };
        // return {
        //     statusCode: 200, data: JSON.stringify(quoteResponse)
        // };
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*', // Allow all origins or specify your domain
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(quoteResponse)
        };
    } catch (error) {
        console.error("API error during route fetching:", error.response ? error.response.data : error.message);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*', // Allow all origins or specify your domain
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ error: error.message })
        };
        // return {
        //     statusCode: 500,
        //     body: JSON.stringify({ error: error.message })
        // };
    }
};