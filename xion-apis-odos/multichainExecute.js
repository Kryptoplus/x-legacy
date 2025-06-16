const { Relayer } = require("@openzeppelin/defender-relay-client");
const { ethers } = require("ethers");
const networkMapping = require("./Squid/networkMapping.json"); // Load the external mapping file
const jwt = require("jsonwebtoken");
const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");
const multichainConfig = require("./Squid/multichainConfig.json");

const sqsClient = new SQSClient({ region: process.env.AWS_REGION });
const MULTICHAIN_SQS_QUEUE_URL = process.env.MULTICHAIN_SQS_QUEUE_URL;
const SOURCE_TX_STATUS_SQS_QUEUE_URL =
  process.env.SOURCE_TX_STATUS_SQS_QUEUE_URL;

exports.handler = async (event) => {
  // Parse the incoming event body
  const req = event.body ? JSON.parse(event.body) : event;

  // Decode the encoded request if it exists
  let decodedReq;
  if (req.encodedResponse) {
    const decodedString = Buffer.from(req.encodedResponse, "base64").toString(
      "utf-8"
    );
    decodedReq = JSON.parse(decodedString);
    console.log("Decoded request:", JSON.stringify(decodedReq)); // Log the decoded request
  } else {
    console.error("No encodedResponse found in the request");
    return {
      statusCode: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, x-integrator-id, Authorization",
      },
      body: JSON.stringify({
        message: "No encodedResponse found in the request",
      }),
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

  const merchantAddress = decoded.evmWalletAddress;
  const merchantWebhook = decoded.webhookUrl;

  if (!merchantAddress) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Merchant address is missing in JWT" }),
    };
  }

  // Extract parameters from the decoded request
  const {
    fromAddress,
    externalBridgeContract,
    fromAmount,
    value,
    feeAmount,
    callData,
    gasLimit,
    gasPrice,
    requestId,
    tokenAddress,
    fromCurrency,
    expiry,
    fromNetwork,
    toNetwork,
    toCurrency,
    toAddress,
    toAmount,
    toAmountMin,
    fromAmountFormatted,
    feeAmountFormatted,
    toAmountMinFormatted,
    toAmountFormatted,
  } = decodedReq;

  if (
    !fromAddress ||
    !externalBridgeContract ||
    !fromAmount ||
    !value ||
    !feeAmount ||
    !callData ||
    !gasLimit ||
    !gasPrice ||
    !requestId ||
    !tokenAddress ||
    !fromCurrency ||
    !expiry ||
    !fromNetwork ||
    !toNetwork ||
    !toCurrency ||
    !toAddress ||
    !toAmount ||
    !toAmountMin ||
    !fromAmountFormatted ||
    !feeAmountFormatted ||
    !toAmountMinFormatted ||
    !toAmountFormatted
  ) {
    return {
      statusCode: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, x-integrator-id, Authorization",
      },
      body: JSON.stringify({ message: "Missing required parameters" }),
    };
  }

  // Check if the current time is greater than the expiry time
  const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
  if (currentTime > expiry) {
    console.error("The route has expired, get a new quote to continue");
    return {
      statusCode: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, x-integrator-id, Authorization",
      },
      body: JSON.stringify({
        message: "The route has expired, get a new quote to continue",
      }),
    };
  }

  // Retrieve network details from the mapping file
  const networkConfig = multichainConfig[fromNetwork];
  if (!networkConfig) {
    return {
      statusCode: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, x-integrator-id, Authorization",
      },
      body: JSON.stringify({ message: "Unsupported Network" }),
    };
  }

  // Add a provider-specific spender address selection
  const { rpcUrl } = networkConfig;
  let contractAddress;

  // Extract provider from the decoded request
  const bridgeProvider = decodedReq.provider || "squid"; // Renamed from 'provider'

  // Select the appropriate spender address based on the provider
  switch (bridgeProvider) {
    case "squid":
      contractAddress = networkConfig.squidSpenderAddress;
      break;
    case "lifi":
      contractAddress = networkConfig.lifiSpenderAddress;
      break;
    case "debridge":
      contractAddress = networkConfig.dlnSpenderAddress;
      break;
    default:
      contractAddress = networkConfig.squidSpenderAddress; // Default to squid
  }

  // Ensure rpcUrl and contractAddress are valid
  if (!rpcUrl || !contractAddress) {
    return {
      statusCode: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, x-integrator-id, Authorization",
      },
      body: JSON.stringify({
        message: `Invalid network RPC details found for ${fromNetwork} with provider ${bridgeProvider}`,
      }),
    };
  }

  // Log spenderAddress, tokenAddress, and senderAddress before balance and allowance checks
  console.log("Contract Address:", contractAddress);
  console.log("Token Address:", tokenAddress);
  console.log("Sender Address:", fromAddress);

  // Setup provider and contract instances
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const tokenContract = new ethers.Contract(
    tokenAddress,
    [
      "function balanceOf(address owner) view returns (uint256)",
      "function allowance(address owner, address spender) view returns (uint256)",
    ],
    provider
  );

  try {
    // Check balance
    const balance = await tokenContract.balanceOf(fromAddress);
    const formattedBalance = ethers.formatUnits(
      balance,
      multichainConfig[fromNetwork].fromCurrency[fromCurrency].decimals
    );
    const formattedAmount = ethers.formatUnits(
      fromAmount,
      multichainConfig[fromNetwork].fromCurrency[fromCurrency].decimals
    );
    console.log("Formatted Balance:", formattedBalance);
    console.log("Formatted Amount:", formattedAmount);
    if (parseFloat(formattedBalance) < parseFloat(formattedAmount)) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, x-integrator-id, Authorization",
        },
        body: JSON.stringify({ message: "Customer balance is insufficient" }),
      };
    }

    // Check allowance
    const allowance = await tokenContract.allowance(
      fromAddress,
      contractAddress
    );
    const formattedAllowance = ethers.formatUnits(
      allowance,
      multichainConfig[fromNetwork].fromCurrency[fromCurrency].decimals
    );
    console.log("Formatted Allowance:", formattedAllowance);
    if (parseFloat(formattedAllowance) < parseFloat(formattedAmount)) {
      console.error("Customer allowance is insufficient");
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, x-integrator-id, Authorization",
        },
        body: JSON.stringify({ message: "Customer allowance is insufficient" }),
      };
    }

    // Define the ABIs for different providers
    const squidAbi = [
      {
        inputs: [
          { internalType: "address", name: "tokenAddress", type: "address" },
          { internalType: "address", name: "from", type: "address" },
          { internalType: "uint256", name: "amount", type: "uint256" },
          { internalType: "address", name: "externalContract", type: "address" },
          { internalType: "uint256", name: "feeAmount", type: "uint256" },
          { internalType: "bytes", name: "callData", type: "bytes" },
        ],
        name: "transferExecute",
        outputs: [],
        stateMutability: "payable",
        type: "function",
      },
    ];

    // XionMultichain contract ABI (for lifi and debridge)
    const xionContractAbi = [
      {
        inputs: [
          { internalType: "address", name: "tokenAddress", type: "address" },
          { internalType: "address", name: "from", type: "address" },
          { internalType: "uint256", name: "amount", type: "uint256" },
          { internalType: "address", name: "externalContract", type: "address" },
          { internalType: "bytes", name: "callData", type: "bytes" },
        ],
        name: "transferExecute",
        outputs: [],
        stateMutability: "payable",
        type: "function",
      },
    ];

    // Select ABI and encode function call data based on provider
    let iface;
    let encodedCallData;

    switch (bridgeProvider) {
      case "squid":
        iface = new ethers.Interface(squidAbi);
        encodedCallData = iface.encodeFunctionData("transferExecute", [
          tokenAddress,
          fromAddress,
          fromAmount,
          externalBridgeContract,
          feeAmount,
          callData,
        ]);
        break;

      case "lifi":
      case "debridge":
        iface = new ethers.Interface(xionContractAbi);
        encodedCallData = iface.encodeFunctionData("transferExecute", [
          tokenAddress,
          fromAddress,
          fromAmount,
          externalBridgeContract,
          callData,
        ]);
        break;

      default:
        // Default to squid
        iface = new ethers.Interface(squidAbi);
        encodedCallData = iface.encodeFunctionData("transferExecute", [
          tokenAddress,
          fromAddress,
          fromAmount,
          externalBridgeContract,
          feeAmount,
          callData,
        ]);
    }

    // For debugging - decode the call data
    try {
      let decodedData;
      if (bridgeProvider === "squid") {
        decodedData = iface.decodeFunctionData("transferExecute", encodedCallData);
      } else {
        decodedData = new ethers.Interface(xionContractAbi).decodeFunctionData(
          "transferExecute",
          encodedCallData
        );
      }
      console.log(`Decoded call data for ${bridgeProvider}:`, decodedData);
    } catch (error) {
      console.error(`Error decoding call data for ${bridgeProvider}:`, error);
    }

    // Select credentials based on the fromNetwork
    let credentials;
    switch (fromNetwork) {
      case "Avalanche":
        credentials = {
          apiKey: process.env.RELAYER_API_KEY_AVAX,
          apiSecret: process.env.RELAYER_API_SECRET_AVAX,
        };
        break;
      case "Polygon":
        credentials = {
          apiKey: process.env.RELAYER_API_KEY,
          apiSecret: process.env.RELAYER_API_SECRET,
        };
        break;
      case "Base":
        credentials = {
          apiKey: process.env.RELAYER_API_KEY_BASE,
          apiSecret: process.env.RELAYER_API_SECRET_BASE,
        };
        break;
      case "Bnb":
        credentials = {
          apiKey: process.env.RELAYER_API_KEY_BNB,
          apiSecret: process.env.RELAYER_API_SECRET_BNB,
        };
        break;
      case "Arbitrum":
        credentials = {
          apiKey: process.env.RELAYER_API_KEY_ARB,
          apiSecret: process.env.RELAYER_API_SECRET_ARB,
        };
        break;
      default:
        console.error(
          "No relayer credentials found for the network:",
          fromNetwork
        );
        return {
          statusCode: 400,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
            "Access-Control-Allow-Headers":
              "Content-Type, x-integrator-id, Authorization",
          },
          body: JSON.stringify({
            message: "Unsupported network for relayer credentials",
          }),
        };
    }

    console.log("Using credentials for network:", fromNetwork);
    const relayer = new Relayer(credentials);

    console.log(
      "Gas Price: ",
      Number(await provider._perform({ method: "getGasPrice" }))
    );
    let feeData = await provider.getFeeData();
    console.log("Gas Price 2: ", feeData.gasPrice);

    let gasPrice;

    switch (fromNetwork) {
      case "Base":
        gasPrice = (feeData.gasPrice + feeData.gasPrice).toString();
        break;
      default:
        gasPrice = feeData.gasPrice.toString();
        break;
    }

    const txDetails = {
      to: contractAddress,
      data: encodedCallData,
      value: value,
      gasLimit: gasLimit,
      gasPrice: gasPrice,
    };

    console.log("Sending transaction:", txDetails);
    const tx = await relayer.sendTransaction(txDetails);
    console.log("Transaction successful with hash:", tx.hash);

    const fromChainId = multichainConfig[fromNetwork].chainId;
    const toChainId = multichainConfig[toNetwork].chainId;

    // Prepare the message body
    const messageBody = JSON.stringify({
      fromChainId: fromChainId,
      toChainId: toChainId,
      transactionHash: tx.hash,
      nativeValue: value,
      fromAmount: fromAmount,
      fromAddress: fromAddress,
      fromCurrency: fromCurrency,
      fromNetwork: fromNetwork,
      toAmount: toAmount,
      toAmountMin: toAmountMin,
      toNetwork: toNetwork,
      toCurrency: toCurrency,
      toAddress: toAddress,
      feeAmount: feeAmount,
      requestId: requestId,
      fromTokenAddress: tokenAddress,
      fromAmountFormatted: fromAmountFormatted,
      feeAmountFormatted: feeAmountFormatted,
      toAmountMinFormatted: toAmountMinFormatted,
      toAmountFormatted: toAmountFormatted,
      merchantAddress: merchantAddress,
      merchantWebhook: merchantWebhook,
    });

    // Create an array of the queue URLs
    const queueUrls = [
      SOURCE_TX_STATUS_SQS_QUEUE_URL,
      MULTICHAIN_SQS_QUEUE_URL,
    ];

    try {
      for (const queueUrl of queueUrls) {
        const sqsMessageParams = {
          MessageBody: messageBody,
          QueueUrl: queueUrl,
        };
        const sqsCommand = new SendMessageCommand(sqsMessageParams);
        await sqsClient.send(sqsCommand);
        console.log(
          `Successfully sent transaction details to SQS queue ${queueUrl}`
        );
      }
    } catch (error) {
      console.error("Failed to send message to SQS:", error);
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, x-integrator-id, Authorization",
      },
      body: JSON.stringify({
        transactionId: tx.hash,
        requestId: requestId,
        fromChainId: fromChainId,
        toChainId: toChainId,
      }),
    };
  } catch (error) {
    console.error("Transaction error:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, x-integrator-id, Authorization",
      },
      body: JSON.stringify({ error: error.message }),
    };
  }
};