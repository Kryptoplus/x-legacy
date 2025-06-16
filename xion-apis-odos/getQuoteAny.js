const axios = require("axios");
const ethers = require("ethers");
require("dotenv").config();
const jwt = require("jsonwebtoken");

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

async function fetchDepositAddress(depositRequest) {
  try {
    const response = await axios.post(
      "https://apiplus.squidrouter.com/v2/deposit-address",
      depositRequest,
      {
        headers: {
          "x-integrator-id": process.env.INTEGRATOR_ID,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error("Error calling deposit-address endpoint:", error.response?.data || error.message);
    throw new Error("Failed to get deposit address");
  }
}

// New function for LiFi quotes
async function fetchLiFiQuote(params) {
  const {
    fromNetwork,
    toNetwork,
    fromCurrency,
    toCurrency,
    fromAddress,
    toAddress,
    fromAmount
  } = params;

  // Use numeric chain IDs directly from the multichainConfig
  const fromChainId = multichainConfig[fromNetwork].chainId;
  const toChainId = multichainConfig[toNetwork].chainId;

  const url = `https://li.quest/v1/quote?fromChain=${fromChainId}&toChain=${toChainId}&fromToken=${multichainConfig[fromNetwork].fromCurrency[fromCurrency].address}&toToken=${multichainConfig[toNetwork].toCurrency[toCurrency].address}&fromAddress=${fromAddress}&toAddress=${toAddress}&fromAmount=${fromAmount}`;

  try {
    console.log(`Fetching LiFi quote with URL: ${url}`);
    const response = await axios.get(url, {
      headers: {
        'accept': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    console.error("Error fetching LiFi quote:", error.response?.data || error.message);
    throw new Error(`Failed to get LiFi quote: ${error.response?.data?.message || error.message}`);
  }
}

// New function for deBridge quotes
async function fetchDeBridgeQuote(params) {
  const {
    fromNetwork,
    toNetwork,
    fromCurrency,
    toCurrency,
    fromAddress,
    toAddress,
    fromAmount
  } = params;

  // Use the chainId directly from the config
  const srcChainId = multichainConfig[fromNetwork].chainId;
  const dstChainId = multichainConfig[toNetwork].chainId;

  const url = `https://dln.debridge.finance/v1.0/dln/order/create-tx?srcChainId=${srcChainId}&srcChainTokenIn=${multichainConfig[fromNetwork].fromCurrency[fromCurrency].address}&srcChainTokenInAmount=${fromAmount}&dstChainId=${dstChainId}&dstChainTokenOut=${multichainConfig[toNetwork].toCurrency[toCurrency].address}&dstChainTokenOutAmount=auto&dstChainTokenOutRecipient=${toAddress}&srcChainOrderAuthorityAddress=${fromAddress}&dstChainOrderAuthorityAddress=${fromAddress}&affiliateFeePercent=0.1&affiliateFeeRecipient=${fromAddress}`;

  try {
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error("Error fetching deBridge quote:", error.response?.data || error.message);
    throw new Error("Failed to get deBridge quote");
  }
}

// Helper function to get the correct spender address for a given provider and network
function getProviderSpenderAddress(provider, network) {
  // For native chains like Bitcoin and Solana
  if (network === "Bitcoin" || network === "Solana") {
    return "native";
  }

  // Get the appropriate spender based on provider
  switch (provider) {
    case "lifi":
      return multichainConfig[network].lifiSpenderAddress || multichainConfig[network].spenderAddress;
    case "debridge":
      return multichainConfig[network].debridgeSpenderAddress || multichainConfig[network].spenderAddress;
    case "squid":
    default:
      return multichainConfig[network].squidSpenderAddress || multichainConfig[network].spenderAddress;
  }
}

// Calculate total fees from LiFi quote
function calculateLiFiTotalFees(lifiQuote, fromCurrencyDecimals) {
  let totalFeeAmount = BigInt(0);
  
  // Process all fee costs if they exist
  if (lifiQuote.estimate?.feeCosts) {
    totalFeeAmount = lifiQuote.estimate.feeCosts.reduce((total, fee) => {
      // Check if the fee is in the same token as fromToken
      if (fee.token && fee.token.address === lifiQuote.action.fromToken.address) {
        return total + BigInt(fee.amount || 0);
      }
      return total;
    }, BigInt(0));
  }
  
  console.log(`LiFi fees in source token: ${ethers.formatUnits(totalFeeAmount.toString(), fromCurrencyDecimals)}`);
  return totalFeeAmount;
}

// Calculate total fees from deBridge quote
function calculateDeBridgeTotalFees(debridgeQuote, fromCurrencyDecimals) {
  let totalFeeAmount = BigInt(0);
  
  // Process all cost details if they exist
  if (debridgeQuote.estimation?.costsDetails) {
    // Extract all fee amounts from the costsDetails array
    debridgeQuote.estimation.costsDetails.forEach(cost => {
      // Skip the EstimatedOperatingExpenses as this is already accounted for
      // in the final amount calculation
      if (cost.type !== "EstimatedOperatingExpenses") {
        // Check if the fee is a reduction in amount (i.e., amountIn > amountOut)
        if (cost.amountIn && cost.amountOut && BigInt(cost.amountIn) > BigInt(cost.amountOut)) {
          // Calculate the fee as the difference
          const fee = BigInt(cost.amountIn) - BigInt(cost.amountOut);
          console.log(`deBridge ${cost.type} fee: ${ethers.formatUnits(fee.toString(), fromCurrencyDecimals)}`);
          totalFeeAmount += fee;
        }
        // Some fees are explicitly stated in payload
        else if (cost.payload && cost.payload.feeAmount) {
          const fee = BigInt(cost.payload.feeAmount);
          console.log(`deBridge ${cost.type} payload fee: ${ethers.formatUnits(fee.toString(), fromCurrencyDecimals)}`);
          totalFeeAmount += fee;
        }
      }
    });
  }
  
  // Add the fixFee if it exists and is non-zero
  if (debridgeQuote.order?.fixFee && debridgeQuote.order.fixFee !== "0") {
    const fixFee = BigInt(debridgeQuote.order.fixFee);
    console.log(`deBridge fixFee: ${ethers.formatUnits(fixFee.toString(), 18)}`); // fixFee is usually in ETH (18 decimals)
    // We don't add this to totalFeeAmount as it's paid separately as ETH value
  }
  
  console.log(`deBridge total fees in source token: ${ethers.formatUnits(totalFeeAmount.toString(), fromCurrencyDecimals)}`);
  return totalFeeAmount;
}

exports.handler = async (event) => {
  try {
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
    const authHeader =
      event.headers.Authorization || event.headers.authorization;
    const token = authHeader?.split(" ")[1];

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
      // Verify the JWT (for authentication only)
      decoded = jwt.verify(token, jwtSecret);
      console.log("Decoded JWT:", decoded);
    } catch (error) {
      console.error("Invalid token:", error.message);
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

    // Parse the request body
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

    // Extract parameters from the request body (toAddress is now provided by the client)
    const {
      toAmount,
      toAddress,
      fromAddress,
      fromCurrency,
      fromNetwork,
      toCurrency,
      toNetwork,
      provider = "squid", // Default to squid if not specified
    } = parsedBody;

    // Check if all required parameters are provided
    if (
      !toAddress ||
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
            "toAddress, fromAddress, fromNetwork, fromCurrency, toCurrency, and toNetwork are required",
        }),
      };
    }

    let formattedToAmount = parseFloat(toAmount);

    // Extract values from configuration
    const fromCurrencyUuid =
      multichainConfig[fromNetwork].fromCurrency[fromCurrency].uuid;
    const toCurrencyUuid =
      multichainConfig[toNetwork].toCurrency[toCurrency].uuid;
    const toCurrencyDecimals =
      multichainConfig[toNetwork].toCurrency[toCurrency].decimals;
    const fromCurrencyDecimals =
      multichainConfig[fromNetwork].fromCurrency[fromCurrency].decimals;

    // Get the provider-specific spender address
    const spenderAddress = getProviderSpenderAddress(provider, fromNetwork);

    // Handle provider selection
    if (provider === "lifi") {
      try {
        // Convert to the appropriate format for LiFi
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

        // Similar to Squid flow, we'll implement an iterative approach to find the right amount
        let attempt = 1;
        let maxAttempts = 5;
        let lifiQuote;
        let finalFromAmount = convertedAmount;
        let finalFeeAmount = BigInt(0);
        let xionFeeConverted = BigInt(0);

        while (attempt <= maxAttempts) {
          try {
            const lifiParams = {
              fromNetwork,
              toNetwork,
              fromCurrency,
              toCurrency,
              fromAddress,
              toAddress,
              fromAmount: finalFromAmount.toString()
            };

            lifiQuote = await fetchLiFiQuote(lifiParams);
            console.log("Full LiFi quote response:", JSON.stringify(lifiQuote, null, 2));
            
            // Get toAmountMin from the quote
            const toAmountMin = lifiQuote.estimate?.toAmountMin ? BigInt(lifiQuote.estimate.toAmountMin) : BigInt(0);
            const requestedToAmount = BigInt(
              ethers.parseUnits(
                toAmount.toString(),
                toCurrencyDecimals
              )
            );

            console.log(
              `Attempt ${attempt}: toAmountMin: ${ethers.formatUnits(
                toAmountMin,
                toCurrencyDecimals
              )} ${toCurrency} (requested: ${toAmount})`
            );

            // Check if toAmountMin is greater than or equal to requested amount
            if (toAmountMin >= requestedToAmount) {
              console.log(
                `Success: toAmountMin (${ethers.formatUnits(
                  toAmountMin,
                  toCurrencyDecimals
                )}) is equal to or greater than the requested ${toCurrency} amount (${toAmount}).`
              );

              // Calculate LiFi fees
              finalFeeAmount = calculateLiFiTotalFees(lifiQuote, fromCurrencyDecimals);
              
              // Calculate 1% Xion fee (same as in Squid flow)
              const xionFeeAmount = parseFloat(formattedToAmount / 100);
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

              // Add all fees to the final amount
              finalFromAmount = finalFromAmount + xionFeeConverted + finalFeeAmount;
              console.log(
                `Adjusted Amount: ${ethers.formatUnits(
                  finalFromAmount,
                  fromCurrencyDecimals
                )} ${fromCurrency}, xionFeeConverted ${xionFeeConverted}, finalFeeAmount ${finalFeeAmount}`
              );

              // One final quote with the adjusted amount to ensure we get the right destination amount
              const finalParams = {
                fromNetwork,
                toNetwork,
                fromCurrency,
                toCurrency,
                fromAddress,
                toAddress,
                fromAmount: finalFromAmount.toString()
              };

              lifiQuote = await fetchLiFiQuote(finalParams);
              break;
            } else {
              // If toAmountMin is less than requested, adjust the fromAmount and try again
              const difference =
                Number(toAmount) -
                Number(
                  ethers.formatUnits(
                    toAmountMin,
                    toCurrencyDecimals
                  )
                );
              const bufferPercentage = 1.1;
              const adjustedDifference = difference * bufferPercentage;

              const additionalFromCurrencyAmount = await convertCurrency(
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

              finalFromAmount += additionalFromCurrencyAmount;
              console.log(
                `Attempt ${attempt}: Adjusted fromCurrency amount: ${ethers.formatUnits(
                  finalFromAmount,
                  fromCurrencyDecimals
                )}`
              );
            }
            attempt++;
          } catch (error) {
            console.error(`Error in LiFi attempt ${attempt}:`, error);
            return {
              statusCode: 500,
              headers: {
                "Access-Control-Allow-Origin": "*",
              },
              body: JSON.stringify({ error: `LiFi quote error: ${error.message}` }),
            };
          }
        }

        // Check if we have a valid quote after all attempts
        if (!lifiQuote || !lifiQuote.action || !lifiQuote.estimate) {
          return {
            statusCode: 500,
            headers: {
              "Access-Control-Allow-Origin": "*",
            },
            body: JSON.stringify({ error: "Failed to get a valid LiFi quote after multiple attempts" }),
          };
        }

        const currentUnixTime = Math.floor(Date.now() / 1000);
        const expiryTime = currentUnixTime + 21;

        // Format the response
        const formattedResponse = {
          provider: "lifi",
          fromAddress: fromAddress,
          spenderAddress: spenderAddress,
          fromAmount: finalFromAmount.toString(),
          toAddress: toAddress,
          toAmount: lifiQuote.estimate?.toAmount || "0",
          fromCurrency,
          toCurrency,
          fromNetwork,
          toNetwork,
          expiry: expiryTime,
          route: lifiQuote,

          externalBridgeContract: lifiQuote.transactionRequest?.to,
          value: lifiQuote.transactionRequest?.value || "0",
          feeAmount: (xionFeeConverted + finalFeeAmount).toString(),
          callData: lifiQuote.transactionRequest?.data,
          gasLimit: lifiQuote.estimate?.gasCosts && lifiQuote.estimate.gasCosts[0]?.limit ? 
                    Math.ceil(parseInt(lifiQuote.estimate.gasCosts[0].limit) * 3.2).toString() : 
                    "300000", // Default gas limit with 3.2x buffer like Squid
          gasPrice: lifiQuote.transactionRequest?.gasPrice,
          requestId: Math.random().toString(36).substring(2, 15), // Generate a random ID
          tokenAddress: multichainConfig[fromNetwork].fromCurrency[fromCurrency].address,
          toAmountMin: lifiQuote.estimate?.toAmountMin || "0",

          // Formatted values
          fromAmountFormatted: ethers.formatUnits(finalFromAmount.toString(), fromCurrencyDecimals),
          feeAmountFormatted: ethers.formatUnits((xionFeeConverted + finalFeeAmount).toString(), fromCurrencyDecimals),
          toAmountMinFormatted: lifiQuote.estimate?.toAmountMin ?
            ethers.formatUnits(lifiQuote.estimate.toAmountMin, toCurrencyDecimals) : "0",
          toAmountFormatted: lifiQuote.estimate?.toAmount ?
            ethers.formatUnits(lifiQuote.estimate.toAmount, toCurrencyDecimals) : "0",

          transactionRequest: {
            value: lifiQuote.transactionRequest?.value ?
              BigInt(lifiQuote.transactionRequest.value).toString() : "0",
            to: lifiQuote.transactionRequest?.to,
            data: lifiQuote.transactionRequest?.data,
            from: fromAddress,
            chainId: parseInt(multichainConfig[fromNetwork].chainId),
            gasPrice: lifiQuote.transactionRequest?.gasPrice,
            gasLimit: lifiQuote.estimate?.gasCosts && lifiQuote.estimate.gasCosts[0]?.limit ? 
                      Math.ceil(parseInt(lifiQuote.estimate.gasCosts[0].limit) * 3.2).toString() : 
                      "300000"
          }
        };

        const encodedResponse = base64UrlEncode(formattedResponse);

        return {
          statusCode: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
            "Access-Control-Allow-Headers":
              "Content-Type, x-integrator-id, Authorization",
          },
          body: JSON.stringify({
            encodedResponse,
            provider: "lifi",
            ...formattedResponse
          }),
        };
      } catch (error) {
        console.error("Error with LiFi provider:", error);
        return {
          statusCode: 500,
          headers: {
            "Access-Control-Allow-Origin": "*",
          },
          body: JSON.stringify({ error: `LiFi provider error: ${error.message}` }),
        };
      }
    } else if (provider === "debridge") {
      try {
        // Initial conversion to get a starting amount
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

        // Similar to Squid and LiFi flows, implement an iterative approach
        let attempt = 1;
        let maxAttempts = 5;
        let debridgeQuote;
        let finalFromAmount = convertedAmount;
        let finalFeeAmount = BigInt(0);
        let xionFeeConverted = BigInt(0);

        while (attempt <= maxAttempts) {
          try {
            const debridgeParams = {
              fromNetwork,
              toNetwork,
              fromCurrency,
              toCurrency,
              fromAddress,
              toAddress,
              fromAmount: finalFromAmount.toString()
            };

            debridgeQuote = await fetchDeBridgeQuote(debridgeParams);
            console.log("Full deBridge quote response:", JSON.stringify(debridgeQuote, null, 2));
            
            // Get toAmountMin from the quote
            const toAmountMin = debridgeQuote.estimation?.dstChainTokenOut?.recommendedAmount ? 
              BigInt(debridgeQuote.estimation.dstChainTokenOut.recommendedAmount) : 
              (debridgeQuote.estimation?.dstChainTokenOut?.amount ? 
                BigInt(debridgeQuote.estimation.dstChainTokenOut.amount) : BigInt(0));

            const requestedToAmount = BigInt(
              ethers.parseUnits(
                toAmount.toString(),
                toCurrencyDecimals
              )
            );

            console.log(
              `Attempt ${attempt}: toAmountMin: ${ethers.formatUnits(
                toAmountMin,
                toCurrencyDecimals
              )} ${toCurrency} (requested: ${toAmount})`
            );

            // Check if toAmountMin is greater than or equal to requested amount
            if (toAmountMin >= requestedToAmount) {
              console.log(
                `Success: toAmountMin (${ethers.formatUnits(
                  toAmountMin,
                  toCurrencyDecimals
                )}) is equal to or greater than the requested ${toCurrency} amount (${toAmount}).`
              );

              // Calculate deBridge fees
              finalFeeAmount = calculateDeBridgeTotalFees(debridgeQuote, fromCurrencyDecimals);
              
              // Calculate 1% Xion fee (same as in Squid flow)
              const xionFeeAmount = parseFloat(formattedToAmount / 100);
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

              // Add all fees to the final amount
              finalFromAmount = finalFromAmount + xionFeeConverted + finalFeeAmount;
              console.log(
                `Adjusted Amount: ${ethers.formatUnits(
                  finalFromAmount,
                  fromCurrencyDecimals
                )} ${fromCurrency}, xionFeeConverted ${xionFeeConverted}, finalFeeAmount ${finalFeeAmount}`
              );

              // One final quote with the adjusted amount to ensure we get the right destination amount
              const finalParams = {
                fromNetwork,
                toNetwork,
                fromCurrency,
                toCurrency,
                fromAddress,
                toAddress,
                fromAmount: finalFromAmount.toString()
              };

              debridgeQuote = await fetchDeBridgeQuote(finalParams);
              break;
            } else {
              // If toAmountMin is less than requested, adjust the fromAmount and try again
              const difference =
                Number(toAmount) -
                Number(
                  ethers.formatUnits(
                    toAmountMin,
                    toCurrencyDecimals
                  )
                );
              const bufferPercentage = 1.1;
              const adjustedDifference = difference * bufferPercentage;

              const additionalFromCurrencyAmount = await convertCurrency(
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

              finalFromAmount += additionalFromCurrencyAmount;
              console.log(
                `Attempt ${attempt}: Adjusted fromCurrency amount: ${ethers.formatUnits(
                  finalFromAmount,
                  fromCurrencyDecimals
                )}`
              );
            }
            attempt++;
          } catch (error) {
            console.error(`Error in deBridge attempt ${attempt}:`, error);
            return {
              statusCode: 500,
              headers: {
                "Access-Control-Allow-Origin": "*",
              },
              body: JSON.stringify({ error: `deBridge quote error: ${error.message}` }),
            };
          }
        }

        // Check if we have a valid quote after all attempts
        if (!debridgeQuote || !debridgeQuote.tx || !debridgeQuote.estimation) {
          return {
            statusCode: 500,
            headers: {
              "Access-Control-Allow-Origin": "*",
            },
            body: JSON.stringify({ error: "Failed to get a valid deBridge quote after multiple attempts" }),
          };
        }

        const currentUnixTime = Math.floor(Date.now() / 1000);
        const expiryTime = currentUnixTime + 21;

        // Format the response
        const formattedResponse = {
          provider: "debridge",
          fromAddress: fromAddress,
          spenderAddress: spenderAddress,
          fromAmount: finalFromAmount.toString(),
          toAddress: toAddress,
          fromCurrency,
          toCurrency,
          fromNetwork,
          toNetwork,
          expiry: expiryTime,
          route: debridgeQuote,

          externalBridgeContract: debridgeQuote.tx.to,
          value: debridgeQuote.tx.value || "0",
          feeAmount: (xionFeeConverted + finalFeeAmount).toString(),
          callData: debridgeQuote.tx.data,
          gasLimit: "1000000", // Default gas limit for deBridge if not provided
          gasPrice: "30000000000", // Default gas price for deBridge if not provided
          requestId: debridgeQuote.order?.orderId || Math.random().toString(36).substring(2, 15),
          tokenAddress: multichainConfig[fromNetwork].fromCurrency[fromCurrency].address,
          toAmount: debridgeQuote.estimation?.dstChainTokenOut?.amount || "0",
          toAmountMin: debridgeQuote.estimation?.dstChainTokenOut?.recommendedAmount || 
                      debridgeQuote.estimation?.dstChainTokenOut?.amount || "0",

          // Formatted values
          fromAmountFormatted: ethers.formatUnits(finalFromAmount.toString(), fromCurrencyDecimals),
          feeAmountFormatted: ethers.formatUnits((xionFeeConverted + finalFeeAmount).toString(), fromCurrencyDecimals),
          toAmountMinFormatted: debridgeQuote.estimation?.dstChainTokenOut?.recommendedAmount ?
            ethers.formatUnits(debridgeQuote.estimation.dstChainTokenOut.recommendedAmount, toCurrencyDecimals) :
            (debridgeQuote.estimation?.dstChainTokenOut?.amount ?
              ethers.formatUnits(debridgeQuote.estimation.dstChainTokenOut.amount, toCurrencyDecimals) : "0"),
          toAmountFormatted: debridgeQuote.estimation?.dstChainTokenOut?.amount ?
            ethers.formatUnits(debridgeQuote.estimation.dstChainTokenOut.amount, toCurrencyDecimals) : "0",

          // Include deBridge transaction data
          transactionRequest: {
            value: debridgeQuote.tx.value || "0",
            data: debridgeQuote.tx.data,
            to: debridgeQuote.tx.to,
            from: fromAddress,
            chainId: parseInt(multichainConfig[fromNetwork].chainId),
            gasPrice: "30000000000", // Default gas price
            gasLimit: "1000000" // Default gas limit
          }
        };

        const encodedResponse = base64UrlEncode(formattedResponse);

        return {
          statusCode: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
            "Access-Control-Allow-Headers":
              "Content-Type, x-integrator-id, Authorization",
          },
          body: JSON.stringify({
            encodedResponse,
            provider: "debridge",
            ...formattedResponse
          }),
        };
      } catch (error) {
        console.error("Error with deBridge provider:", error);
        return {
          statusCode: 500,
          headers: {
            "Access-Control-Allow-Origin": "*",
          },
          body: JSON.stringify({ error: `deBridge provider error: ${error.message}` }),
        };
      }
    }

    // Default provider: squid
    // Inside your handler, in the Bitcoin/Solana block:
    if (fromNetwork === "Bitcoin" || fromNetwork === "Solana") {
      // Use coinranking conversion for these networks too.
      const convertedAmount = await convertCurrency(
        formattedToAmount, // the amount in the destination currency units
        toCurrencyUuid,    // using the target token's uuid as the "from" parameter
        fromCurrencyUuid,  // converting to the native token's unit
        fromCurrencyDecimals
      );

      // Log the conversion result for debugging
      console.log(
        `Converted amount for ${fromNetwork}: ${ethers.formatUnits(
          convertedAmount,
          fromCurrencyDecimals
        )} (${convertedAmount.toString()} in raw units)`
      );

      if (fromNetwork === "Bitcoin" && convertedAmount < BigInt(70000)) {
        return {
          statusCode: 400,
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ error: "Minimum swap amount for Bitcoin is 0.0007 BTC" }),
        };
      }

      // Build the route parameters using the converted amount from Coinranking:
      const routeParams = {
        fromAddress: fromAddress,
        fromChain: fromNetwork === "Bitcoin" ? "bitcoin" : "solana-mainnet-beta",
        fromToken: fromNetwork === "Bitcoin" ? "satoshi" : "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        fromAmount: convertedAmount.toString(),
        toChain: multichainConfig[toNetwork].chainId,
        toToken: multichainConfig[toNetwork].toCurrency[toCurrency].address,
        toAddress: toAddress,
        quoteOnly: false,
        enableBoost: true,
      };

      console.log("Route Parameters:", JSON.stringify(routeParams, null, 2));

      let transactionRequest;
      try {
        const routeResponse = await fetchRoute(routeParams);
        transactionRequest = routeResponse.data.route.transactionRequest;
        console.log("Transaction Request from route response:", JSON.stringify(transactionRequest, null, 2));
      } catch (error) {
        console.error("Error fetching route:", error.response?.data || error.message);
        return {
          statusCode: 500,
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ error: "Error fetching route" }),
        };
      }

      // Build the deposit request payload directly from the transaction request
      const depositRequest = transactionRequest;

      console.log("Deposit Request Payload:", JSON.stringify(depositRequest, null, 2));

      try {
        const depositResponse = await fetchDepositAddress(depositRequest);
        console.log("Deposit Address Response:", JSON.stringify(depositResponse, null, 2));
        return {
          statusCode: 200,
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({
            provider: "squid",
            spenderAddress: spenderAddress,
            depositAddress: depositResponse.depositAddress,
            amount: depositResponse.amount,
            chainflipStatusTrackingId: depositResponse.chainflipStatusTrackingId,
            fromAddress,
            toAddress,
            fromCurrency,
            toCurrency,
            fromNetwork,
            toNetwork,
          }),
        };
      } catch (error) {
        console.error("Error calling deposit-address endpoint:", error.response?.data || error.message);
        return {
          statusCode: 500,
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ error: error.message }),
        };
      }
    }

    // Existing logic for EVM chains with Squid
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
      fromToken:
        multichainConfig[fromNetwork].fromCurrency[fromCurrency].address,
      toToken: multichainConfig[toNetwork].toCurrency[toCurrency].address,
      fromAmount: convertedAmount.toString(),
      fromAddress: spenderAddress, // Use the provider-specific spender address
      toAddress: toAddress,
      onChainQuoting: false,
      quoteOnly: false,
      enableBoost: true,
    };

    let attempt = 1;
    let maxAttempts = 5;
    let response;
    let finalCosts = BigInt(0);
    let finalCostsFromCurrency = BigInt(0);
    let xionFeeConverted = BigInt(0);
    let estimate;

    while (attempt <= maxAttempts) {
      try {
        response = await fetchRoute(params);
        console.log("Full Squid response:", JSON.stringify(response.data, null, 2));
      } catch (error) {
        console.error("Error fetching route:", error);
        return {
          statusCode: 500,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
            "Access-Control-Allow-Headers":
              "Content-Type, x-integrator-id, Authorization",
          },
          body: JSON.stringify({ error: "Error fetching route" }),
        };
      }

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
      estimate = route.estimate;
      console.log("GAS COSTS: ", estimate.gasCosts);
      console.log("Fee COSTS: ", estimate.feeCosts);

      let toAmountMin = BigInt(estimate.toAmountMin);

      console.log(
        `Attempt ${attempt}: toAmountMin: ${ethers.formatUnits(
          toAmountMin,
          multichainConfig[toNetwork].toCurrency[toCurrency].decimals
        )} ${toCurrency}`
      );

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

        finalCosts =
          BigInt(estimate.gasCosts[0].amount) +
          estimate.feeCosts.reduce(
            (total, cost) => total + BigInt(cost.amount),
            BigInt(0)
          );

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
          )} ${multichainConfig[fromNetwork].gasToken
          }, Converted to ${ethers.formatUnits(
            finalCostsFromCurrency,
            fromCurrencyDecimals
          )} ${fromCurrency}`
        );

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

        let adjustedAmount =
          convertedAmount + xionFeeConverted + finalCostsFromCurrency;
        console.log(
          `Adjusted Amount: ${ethers.formatUnits(
            adjustedAmount,
            fromCurrencyDecimals
          )} ${fromCurrency}, xionFeeConverted ${xionFeeConverted}, finalCostsFromCurrency ${finalCostsFromCurrency}`
        );

        params.fromAmount = adjustedAmount.toString();
        break;
      } else {
        let difference =
          Number(toAmount) -
          Number(
            ethers.formatUnits(
              toAmountMin,
              multichainConfig[toNetwork].toCurrency[toCurrency].decimals
            )
          );
        let bufferPercentage = 1.1;
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

        convertedAmount += additionalFromCurrencyAmount;
        params.fromAmount = convertedAmount.toString();
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

    const feeAmount = xionFeeConverted + finalCostsFromCurrency;
    const currentUnixTime = Math.floor(Date.now() / 1000);
    const expiryTime = currentUnixTime + 21;
    console.log("Final Route", response.data.route);

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

    // After fetching the final route response
    const bufferedGasLimit = Math.ceil(
      parseInt(response.data.route.transactionRequest.gasLimit) * 3.2
    ).toString();

    console.log(`Original Gas Limit: ${response.data.route.transactionRequest.gasLimit}`);
    console.log(`Buffered Gas Limit: ${bufferedGasLimit}`);

    const quoteResponse = {
      provider: "squid",
      fromAddress: fromAddress,
      spenderAddress: spenderAddress,
      externalBridgeContract:
        response.data.route.transactionRequest.target,
      fromAmount: params.fromAmount,
      value: response.data.route.transactionRequest.value,
      feeAmount: feeAmount.toString(),
      callData: response.data.route.transactionRequest.data,
      gasLimit: bufferedGasLimit,
      gasPrice: response.data.route.transactionRequest.gasPrice,
      requestId: response.headers["x-request-id"],
      toAmountMin: estimate.toAmountMin,
      toAmount: estimate.toAmount,
      exchangeRate: estimate.exchangeRate,
      expiry: expiryTime,
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

    const encodedResponse = base64UrlEncode(quoteResponse);

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, x-integrator-id, Authorization",
      },
      body: JSON.stringify({
        encodedResponse,
        provider: "squid",
        spenderAddress: spenderAddress,
        fromAddress: fromAddress,
        fromAmount: fromAmountFormatted,
        feeAmount: feeAmountFormatted,
        requestId: response.headers["x-request-id"],
        toAmountMin: toAmountMinFormatted,
        toAmount: toAmountFormatted,
        expiry: expiryTime,
        tokenAddress: params.fromToken,
        fromCurrency: fromCurrency,
        fromNetwork: fromNetwork,
        toNetwork: toNetwork,
        toCurrency: toCurrency,
        toAddress: toAddress,
      }),
    };
  } catch (err) {
    console.error("Unhandled error in handler:", err);
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, x-integrator-id, Authorization",
      },
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};