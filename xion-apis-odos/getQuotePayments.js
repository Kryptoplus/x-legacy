const axios = require("axios");
const ethers = require("ethers");
require("dotenv").config();
const jwt = require("jsonwebtoken");

// const tokenMapping = require("./Squid/tokenMapping.json");
// const networkQuoteMapping = require("./Squid/networkQuoteMapping.json");

const multichainConfig = require("./Squid/multichainConfig.json");

// Unified conversion function for currency conversions using Coinranking API
async function convertCurrency(
  fromCurrencyAmount,
  fromCurrencyUuid,
  toCurrencyUuid,
  toCurrencyDecimals
) {
  const response = await axios.get(
    `https://api.coinranking.com/v2/coin/${fromCurrencyUuid}/price?referenceCurrencyUuid=${toCurrencyUuid}`,
    {
      headers: {
        "x-access-token": process.env.NEXT_PUBLIC_COINRANKING_API,
      },
    }
  );

  const conversionRate = parseFloat(response.data.data.price);
  const convertedAmount = fromCurrencyAmount * conversionRate;

  // Return as a unit with appropriate decimals for toCurrency
  return BigInt(Math.ceil(convertedAmount * 10 ** toCurrencyDecimals));
}

async function fetchRoute(params) {
  const response = await axios.post(
    "https://v2.api.squidrouter.com/v2/route",
    params,
    {
      headers: {
        "x-integrator-id": process.env.INTEGRATOR_ID,
        "Content-Type": "application/json",
      },
    }
  );
  return response;
}

function base64UrlEncode(data) {
  return Buffer.from(JSON.stringify(data))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    // Handle preflight CORS requests
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, x-integrator-id, Authorization",
      },
    };
  }

  // Get the JWT secret key from environment variables
  const jwtSecret = process.env.JWT_SECRET;

  // Extract the JWT from the 'Authorization' header
  const authHeader = event.headers.Authorization || event.headers.authorization; // Check both cases
  const token = authHeader?.split(" ")[1]; // Get the token part

  if (!token) {
    return {
      statusCode: 401,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, x-integrator-id, Authorization",
      },
      body: JSON.stringify({ error: "Authorization token is missing" }),
    };
  }

  let decoded;
  try {
    // Verify the JWT
    decoded = jwt.verify(token, jwtSecret);
    console.log("Decoded JWT:", decoded); // Log the decoded token for debugging
  } catch (error) {
    console.error("Invalid token:", error.message); // Log the specific JWT error
    return {
      statusCode: 401,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, x-integrator-id, Authorization",
      },
      body: JSON.stringify({ error: "Invalid token" }),
    };
  }

  // Assign `evmWalletAddress` from the decoded JWT to `toAddress`
  const toAddress = decoded.evmWalletAddress;

  if (!toAddress) {
    return {
      statusCode: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, x-integrator-id, Authorization",
      },
      body: JSON.stringify({ error: "evmWalletAddress is missing in JWT" }),
    };
  }

  let parsedBody;
  try {
    parsedBody = JSON.parse(event.body);
    console.log("Parsed body:", parsedBody);
  } catch (error) {
    console.error("Error parsing event body:", error.message);
    return {
      statusCode: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, x-integrator-id, Authorization",
      },
      body: JSON.stringify({ error: "Invalid request body" }),
    };
  }

  const {
    toAmount,
    // toAddress,
    fromAddress,
    fromCurrency,
    fromNetwork,
    toCurrency,
    toNetwork,
  } = parsedBody;

  console.log(
    "Available from currencies:",
    Object.keys(multichainConfig[fromNetwork].fromCurrency)
  );
  console.log(
    "Available to currencies:",
    Object.keys(multichainConfig[toNetwork].toCurrency)
  );
  console.log("Available networks:", Object.keys(multichainConfig)); // Log available networks in networkQuoteMapping

  if (
    // !toAddress ||
    !fromAddress ||
    !fromCurrency ||
    !fromNetwork ||
    !toCurrency ||
    !toNetwork
  ) {
    return {
      statusCode: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, x-integrator-id, Authorization",
      },
      body: JSON.stringify({
        error:
          "fromAddress, fromNetwork, fromCurrency, toCurrency, and toNetwork are required",
      }),
    };
  }

  let formattedToAmount = parseFloat(toAmount);

  const fromCurrencyUuid =
    multichainConfig[fromNetwork].fromCurrency[fromCurrency].uuid;
  const toCurrencyUuid =
    multichainConfig[toNetwork].toCurrency[toCurrency].uuid;
  const toCurrencyDecimals =
    multichainConfig[toNetwork].toCurrency[toCurrency].decimals;
  const fromCurrencyDecimals =
    multichainConfig[fromNetwork].fromCurrency[fromCurrency].decimals;

  let convertedAmount = await convertCurrency(
    formattedToAmount,
    toCurrencyUuid,
    fromCurrencyUuid,
    fromCurrencyDecimals
  );

  console.log(
    `Initial Convert Amount: ${formattedToAmount} ${toCurrency}, Converted to ${ethers.formatUnits(
      convertedAmount,
      fromCurrencyDecimals
    )} ${fromCurrency}`
  );

  let params = {
    fromChain: multichainConfig[fromNetwork].chainId,
    toChain: multichainConfig[toNetwork].chainId,
    fromToken: multichainConfig[fromNetwork].fromCurrency[fromCurrency].address,
    toToken: multichainConfig[toNetwork].toCurrency[toCurrency].address,
    fromAmount: convertedAmount.toString(),
    fromAddress: multichainConfig[fromNetwork].spenderAddress,
    toAddress: toAddress,
    // slippageConfig: {
    //   autoMode: 1,
    // },
    // bypassGuardrails: true,
    onChainQuoting: false,
    quoteOnly: false,
    enableBoost: true,
  };

  // let params = {
  //   fromChain: 137,
  //   toChain: 137,
  //   fromToken: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  //   toToken: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
  //   fromAmount: 100000,
  //   fromAddress: fromAddress,
  //   toAddress: toAddress,
  //   slippageConfig: {
  //     autoMode: 1,
  //   },
  //   bypassGuardrails: true,
  // };

  let attempt = 1;
  let maxAttempts = 5;
  let response;
  let finalCosts = BigInt(0); // Initialize finalCosts in the broader scope
  let finalCostsfromCurrency = BigInt(0); // Initialize finalCostsWAVAX in the broader scope
  let xionFeeConverted = BigInt(0); // Initialize Xion Fee in WAVAX
  let estimate; // Declare estimate in the broader scope

  while (attempt <= maxAttempts) {
    response = await fetchRoute(params);

    if (!response.data || !response.data.route) {
      return {
        statusCode: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, x-integrator-id, Authorization",
        },
        body: JSON.stringify({ error: "Route is not defined in the response" }),
      };
    }

    let route = response.data.route;
    estimate = route.estimate; // Assign estimate in the loop
    console.log("GAS COSTS: ", estimate.gasCosts);
    console.log("Fee COSTS: ", estimate.feeCosts);

    let toAmountMin = BigInt(estimate.toAmountMin); // Use BigInt for accurate calculations

    console.log(
      `Attempt ${attempt}: toAmountMin: ${ethers.formatUnits(
        toAmountMin,
        multichainConfig[toNetwork].toCurrency[toCurrency].decimals
      )} ${toCurrency}`
    );

    // Modify the condition to exit the loop if toAmountMin is equal to or greater than the original amount
    if (
      toAmountMin >=
      BigInt(
        ethers.parseUnits(
          toAmount,
          multichainConfig[toNetwork].toCurrency[toCurrency].decimals
        )
      )
    ) {
      console.log(
        `Success: toAmountMin (${ethers.formatUnits(
          toAmountMin,
          multichainConfig[toNetwork].toCurrency[toCurrency].decimals
        )}) is equal to or greater than the requested ${toCurrency} amount (${toAmount}).`
      );

      // Calculate finalCosts
      finalCosts =
        BigInt(estimate.gasCosts[0].amount) +
        estimate.feeCosts.reduce(
          (total, cost) => total + BigInt(cost.amount),
          BigInt(0)
        );

      // Convert GAS TOKEN in SRC TOKEN
      finalCostsFromCurrency = await convertCurrency(
        Number(
          ethers.formatUnits(
            finalCosts,
            multichainConfig[fromNetwork].gasTokenDecimals
          )
        ),
        multichainConfig[fromNetwork].gasTokenUuid,
        fromCurrencyUuid,
        fromCurrencyDecimals
      );

      console.log(
        `GAS Amount: ${Number(
          ethers.formatUnits(
            finalCosts,
            multichainConfig[fromNetwork].gasTokenDecimals
          )
        )} ${
          multichainConfig[fromNetwork].gasToken
        }, Converted to ${ethers.formatUnits(
          finalCostsFromCurrency,
          fromCurrencyDecimals
        )} ${fromCurrency}`
      );

      // Calculate 1% of toAmountMin as Xion Fee and convert it to the desired currency
      // let xionFeeAmount = Number(
      //   ethers.formatUnits(
      //     toAmountMin / BigInt(100),
      //     multichainConfig[toNetwork].toCurrency[toCurrency].decimals
      //   )
      // );

      let xionFeeAmount = parseFloat(formattedToAmount / 100);

      xionFeeConverted = await convertCurrency(
        xionFeeAmount,
        toCurrencyUuid,
        fromCurrencyUuid,
        fromCurrencyDecimals
      );

      console.log(
        `XION FEE Amount: ${xionFeeAmount} ${toCurrency}, Converted to ${ethers.formatUnits(
          xionFeeConverted,
          fromCurrencyDecimals
        )} ${fromCurrency}`
      );

      // Add finalCostsFromCurrency and xionFeeConverted to the amount
      let adjustedAmount =
        convertedAmount + xionFeeConverted + finalCostsFromCurrency;
      console.log(
        `Adjusted Amount: ${ethers.formatUnits(
          adjustedAmount,
          fromCurrencyDecimals
        )} ${fromCurrency}, xionFeeConverted ${xionFeeConverted}, finalCostsFromCurrency ${finalCostsFromCurrency}`
      );

      params.fromAmount = adjustedAmount.toString(); // Update the amount

      break; // Exit loop if the condition is met
    } else {
      let difference =
        Number(toAmount) -
        Number(
          ethers.formatUnits(
            toAmountMin,
            multichainConfig[toNetwork].toCurrency[toCurrency].decimals
          )
        );
      let bufferPercentage = 1.1; // 7% buffer to make larger adjustments
      let adjustedDifference = difference * bufferPercentage;

      let additionalFromCurrencyAmount = await convertCurrency(
        adjustedDifference,
        toCurrencyUuid,
        fromCurrencyUuid,
        fromCurrencyDecimals
      );

      console.log(
        `Additional Amount: ${adjustedDifference} ${toCurrency}, Converted to ${ethers.formatUnits(
          additionalFromCurrencyAmount,
          fromCurrencyDecimals
        )} ${fromCurrency}`
      );

      // Adjust fromCurrency amount
      convertedAmount += additionalFromCurrencyAmount;
      params.fromAmount = convertedAmount.toString(); // Update fromCurrency amount
      console.log(
        `Attempt ${attempt}: Adjusted fromCurrency amount: ${convertedAmount}`
      );
    }

    attempt++;
  }

  if (!response || !response.data || !response.data.route) {
    console.error("Error: Route is not defined after retries");
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, x-integrator-id, Authorization",
      },
      body: JSON.stringify({ error: "Route is not defined after retries" }),
    };
  }

  // Calculate feeAmount as the sum of xionFeeConverted and finalCostsFrom  Currency
  const feeAmount = xionFeeConverted + finalCostsFromCurrency;

  // Get current UNIX time and set an expiry time (e.g., 15 seconds from now)
  const currentUnixTime = Math.floor(Date.now() / 1000);
  const expiryTime = currentUnixTime + 21; // Expiry time set to 15 seconds from now
  console.log("Final Route", response.data.route);

  // To calculate the readable format of the numbers
  const fromAmountFormatted = ethers.formatUnits(
    params.fromAmount,
    fromCurrencyDecimals
  );
  const toAmountFormatted = ethers.formatUnits(
    estimate.toAmount,
    toCurrencyDecimals
  );
  const toAmountMinFormatted = ethers.formatUnits(
    estimate.toAmountMin,
    toCurrencyDecimals
  );
  const feeAmountFormatted = ethers.formatUnits(
    feeAmount,
    fromCurrencyDecimals
  );

  const quoteResponse = {
    fromAddress: fromAddress,
    externalBridgeContract: response.data.route.transactionRequest.target,
    fromAmount: params.fromAmount, // This now includes the Xion Fee and finalCosts in WAVAX
    value: response.data.route.transactionRequest.value,
    feeAmount: feeAmount.toString(), // Total of Xion Fee and Final Costs in WAVAX
    callData: response.data.route.transactionRequest.data,
    gasLimit: response.data.route.transactionRequest.gasLimit,
    gasPrice: response.data.route.transactionRequest.gasPrice,
    requestId: response.headers["x-request-id"],
    toAmountMin: estimate.toAmountMin,
    toAmount: estimate.toAmount, // Updated toAmount without Xion Fee
    exchangeRate: estimate.exchangeRate,
    expiry: expiryTime, // Add the expiry time
    tokenAddress: params.fromToken,
    fromCurrency: fromCurrency,
    fromNetwork: fromNetwork,
    toCurrency: toCurrency,
    toNetwork: toNetwork,
    toAddress: toAddress,
    fromAmountFormatted: fromAmountFormatted,
    feeAmountFormatted: feeAmountFormatted,
    toAmountMinFormatted: toAmountMinFormatted,
    toAmountFormatted: toAmountFormatted,
  };

  // Base64 URL encode the quote response
  const encodedResponse = base64UrlEncode(quoteResponse);

  //console.log("Final encoded response", encodedResponse);

  return {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, x-integrator-id, Authorization",
    },
    body: JSON.stringify({
      encodedResponse, // Wrap the encoded response in a JSON object
      // normalResponse: quoteResponse,  // Commented for Testing locally
      fromAddress: fromAddress,
      fromAmount: fromAmountFormatted,
      feeAmount: feeAmountFormatted,
      requestId: response.headers["x-request-id"],
      toAmountMin: toAmountMinFormatted,
      toAmount: toAmountFormatted, // Updated toAmount without Xion Fee
      expiry: expiryTime, // Add the expiry time
      tokenAddress: params.fromToken,
      fromCurrency: fromCurrency,
      fromNetwork: fromNetwork,
      toNetwork: toNetwork,
      toCurrency: toCurrency,
      toAddress: toAddress,
    }),
  };
};
