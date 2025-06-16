const axios = require('axios');
const ethers = require('ethers');

exports.handler = async (event) => {
  // Parse incoming request
  let body;
  try {
    body = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { fromAmount, fromAddress } = body;
  if (!fromAmount || !fromAddress) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing fromAmount or fromAddress' }) };
  }

  // Convert fromAmount to 18-decimal units (for tokens with 18 decimals)
  const formattedFromAmount = ethers.parseUnits(fromAmount.toString(), 18);

  // Hardcoded parameters with user-provided fromAddress
  const params = {
    fromChain: "137",
    toChain: "137",
    fromToken: "0xb755506531786C8aC63B756BaB1ac387bACB0C04", // 18-decimal token
    toToken: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", // 6-decimal USDT on Polygon
    fromAmount: formattedFromAmount.toString(),
    fromAddress: fromAddress,
    toAddress: "0xF1B47552b22786624057eEdCF96B01910e3Fb749", // Hardcoded
    slippageConfig: { autoMode: 1 },
    bypassGuardrails: true
  };

  try {
    const response = await axios.post("https://v2.api.squidrouter.com/v2/route", params, {
      headers: {
        "x-integrator-id": process.env.INTEGRATOR_ID,
        "Content-Type": "application/json"
      }
    });

    // Log the entire response data for debugging
    console.log("Squid route quote response:", response.data);

    // If available, log the callData from the transaction request
    if (response.data.route && response.data.route.transactionRequest) {
      console.log("Call data from quote response:", response.data.route.transactionRequest.data);
    } else {
      console.log("No transactionRequest data found in the quote response.");
    }

    // The Squid API's route.estimate.toAmount is presumably in the toToken's decimals (6 for USDT).
    const squidToAmount = response.data.route.estimate.toAmount;
    // Format to a float in base-10, then subtract 1%
    const squidToAmountFloat = parseFloat(ethers.formatUnits(squidToAmount, 6));
    const modifiedToAmount = (squidToAmountFloat * 0.99).toFixed(6);

    return {
      statusCode: 200,
      body: JSON.stringify({ toAmount: modifiedToAmount })
    };

  } catch (error) {
    console.error("Error during route fetching:", error.message);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
