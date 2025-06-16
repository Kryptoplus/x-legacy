const { ethers } = require("ethers");
const jwt = require("jsonwebtoken");
const multichainConfig = require("./Squid/multichainConfig.json");

// Function to get the chain configuration based on fromChainId
function getChainConfig(fromChainId) {
  for (const chainName in multichainConfig) {
    const config = multichainConfig[chainName];
    if (config.chainId === fromChainId) {
      return config;
    }
  }
  return null;
}

// Helper function to introduce a delay
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

exports.handler = async (event) => {
  // Parsing only the needed parameters from the event body
  const { transactionId, requestId, fromChainId, toChainId } = JSON.parse(
    event.body
  );

  // Check if all required parameters are present
  if (!transactionId || !requestId || !fromChainId || !toChainId) {
    console.error(
      "Missing one or more required parameters: transactionId, requestId, fromChainId, toChainId"
    );
    return {
      statusCode: 400,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", // Allow all origins or specify your domain
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
      body: "Missing required body parameters.",
    };
  }

  const jwtSecret = process.env.JWT_SECRET;
  const authHeader = event.headers.Authorization || event.headers.authorization; // Check both cases
  const token = authHeader?.split(" ")[1]; // Get the token part

  if (!token) {
    return {
      statusCode: 401,
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
      body: JSON.stringify({ error: "Invalid token" }),
    };
  }

  console.log(
    `Fetching status for Transaction ID: ${transactionId} on Chain ID: ${fromChainId}`
  );

  try {
    const chainConfig = getChainConfig(fromChainId);
    if (!chainConfig) {
      console.error("Chain configuration not found for Chain ID:", fromChainId);
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
        body: JSON.stringify({ error: "Invalid fromChainId" }),
      };
    }

    const rpcUrl = chainConfig.rpcUrl;
    if (!rpcUrl) {
      console.error("RPC URL not found for Chain ID:", fromChainId);
      return {
        statusCode: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
        body: JSON.stringify({
          error: "RPC URL not configured for this chain",
        }),
      };
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);

    let receipt = null;
    const maxRetries = 10;
    const delayMs = 200;

    for (let i = 0; i < maxRetries; i++) {
      try {
        receipt = await provider.getTransactionReceipt(transactionId);
        if (receipt) {
          console.log(`Transaction receipt found at attempt ${i + 1}`);
          break;
        }
        console.log(
          `Transaction receipt not found, attempt ${
            i + 1
          }. Retrying in ${delayMs} ms...`
        );
        await delay(delayMs);
      } catch (error) {
        console.error(
          `Error fetching transaction receipt at attempt ${i + 1}:`,
          error.message
        );
        await delay(delayMs);
      }
    }

    if (!receipt) {
      console.error("Transaction receipt not found after maximum retries");
      return {
        statusCode: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
        body: JSON.stringify({ error: "Transaction receipt not found" }),
      };
    }

    const status = receipt.status;

    const cleanedResponse = {
      transactionId: transactionId,
      requestId: requestId,
      status: status === 1 ? "success" : "failed",
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", // Allow all origins or specify your domain
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
      body: JSON.stringify(cleanedResponse),
    };
  } catch (error) {
    console.error("Error during status fetching:", error.message);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", // Allow all origins or specify your domain
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
