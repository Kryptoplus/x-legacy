const axios = require("axios");
const AWS = require("aws-sdk");
const { ethers } = require("ethers");
const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");

// Configure DynamoDB
const dynamoDB = new AWS.DynamoDB.DocumentClient();

const sqsClient = new SQSClient({ region: process.env.AWS_REGION });

const SINGLE_BILLING_SQS_QUEUE_URL = process.env.SINGLE_BILLING_SQS_QUEUE_URL;

const DYNAMO_TABLE_NAME = "SingleBillingLockedBalance";
const EXPIRY_DURATION = 60;
const polygonProvider = new ethers.JsonRpcProvider(
  "https://quiet-alpha-card.matic.quiknode.pro/c29dcda8375770b9a14f0c8abd032661e0efee5c/"
);

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
];

const RESTRICTED_BALANCE_ABI = [
  {
    inputs: [
      { internalType: "address", name: "_user", type: "address" },
      { internalType: "address", name: "_token", type: "address" },
    ],
    name: "getUserRestrictedTokenBalance",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
];

const USDT_ADDRESS = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"; // USDT on Polygon
const RESTRICTED_CONTRACT_ADDRESS =
  "0x57A56BEaD1D0B65Ab5E3AcF528ECced8FbEb9378";

// Fetch total balance: `balanceOf` + `restrictedBalance`
const getTotalBalance = async (buyerAddress, provider) => {
  try {
    // USDT balance
    const usdtContract = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider);
    const balance = await usdtContract.balanceOf(buyerAddress);

    // Restricted balance
    const restrictedContract = new ethers.Contract(
      RESTRICTED_CONTRACT_ADDRESS,
      RESTRICTED_BALANCE_ABI,
      provider
    );
    const restrictedBalance =
      await restrictedContract.getUserRestrictedTokenBalance(
        buyerAddress,
        USDT_ADDRESS
      );

    console.log(`balanceOf: ${balance.toString()}`);
    console.log(`restrictedBalance: ${restrictedBalance.toString()}`);

    const totalBalance = balance.add(restrictedBalance);
    console.log(
      `Total Balance (balanceOf + restrictedBalance): ${totalBalance.toString()}`
    );

    return ethers.formatUnits(totalBalance, 6);
  } catch (error) {
    console.error("Error fetching total balance:", error.message);
    throw new Error("Failed to fetch total balance");
  }
};

exports.handler = async (event) => {
  console.log("Received event:", JSON.stringify(event));
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    };
  }
  const incomingHeaders = event.headers || {};
  let parsedBody;
  try {
    parsedBody = JSON.parse(event.body);
  } catch (error) {
    console.error("Error parsing event body:", error.message);
    return {
      statusCode: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: "Invalid request body" }),
    };
  }

  // Validate required parameters
  const { referenceId, productName, amount, buyerAddress, currency } =
    parsedBody;
  if (!referenceId || !productName || !amount || !buyerAddress || !currency) {
    console.log("Missing required parameters in the request");
    return {
      statusCode: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error:
          "All parameters are required: referenceId, productName, amount, buyerAddress, currency",
      }),
    };
  }

  let userBalance;
  try {
    userBalance = await getTotalBalance(buyerAddress, polygonProvider);
    console.log(`Total Balance: ${userBalance} USDT`);
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to fetch user total balance" }),
    };
  }

  let lockRow;
  try {
    const lockCheck = await dynamoDB
      .get({
        TableName: DYNAMO_TABLE_NAME,
        Key: { buyerAddress },
      })
      .promise();

    lockRow = lockCheck.Item;
  } catch (error) {
    console.error("Error checking LockBalance table:", error.message);
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: "Failed to check lock balance" }),
    };
  }

  let effectiveBalance;
  const currentTime = Math.floor(Date.now() / 1000);

  if (lockRow) {
    if (lockRow.expiry > currentTime) {
      console.log("Row exists and not expired. Re-fetching balance...");
      effectiveBalance = Math.min(
        parseFloat(lockRow.balance),
        parseFloat(userBalance)
      );
      console.log(
        `Using minimum of locked balance (${lockRow.balance}) and API balance (${userBalance}): ${effectiveBalance}`
      );
    } else {
      console.log(
        "Row exists but expired. Using current balance as the truth."
      );
      effectiveBalance = parseFloat(userBalance);
    }
  } else {
    // Create new row if it doesn't exist
    console.log("Row does not exist. Creating a new lock entry...");
    effectiveBalance = parseFloat(userBalance);
    try {
      await dynamoDB
        .put({
          TableName: DYNAMO_TABLE_NAME,
          Item: {
            buyerAddress,
            referenceId,
            productName,
            balance: effectiveBalance.toFixed(6), // Save balance in 6 decimal places
            expiry: currentTime + EXPIRY_DURATION,
          },
        })
        .promise();
      console.log("Lock row created successfully.");
    } catch (error) {
      console.error("Error creating lock row:", error.message);
      return {
        statusCode: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Failed to create lock row" }),
      };
    }
  }

  // Check if the balance is sufficient
  if (effectiveBalance < parseFloat(amount)) {
    return {
      statusCode: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: "Insufficient balance" }),
    };
  }

  const data = {
    referenceId,
    productName,
    amount,
    buyerAddress,
    currency,
  };

  // Forward headers for the outgoing request
  const outgoingHeaders = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...incomingHeaders,
  };

  try {
    const response = await axios.post(
      "https://prodp-api.xion.app/api/v2/single/payment",
      data,
      {
        headers: outgoingHeaders,
      }
    );

    // Push transaction details to SQS
    const sqsParams = {
      MessageBody: JSON.stringify({
        referenceId,
        productName,
        amount,
        buyerAddress,
        currency,
        transactionHash: response.data.transactionHash,
      }),
      QueueUrl: SINGLE_BILLING_SQS_QUEUE_URL,
    };

    const sqsCommand = new SendMessageCommand(sqsParams);
    await sqsClient.send(sqsCommand);
    console.log("Successfully pushed transaction to SQS:", sqsParams);

    // Return the response data
    return {
      statusCode: response.status,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(response.data),
    };
  } catch (error) {
    console.error(
      "API error during payment:",
      error.response ? error.response.data : error.message
    );
    const status = error.response ? error.response.status : 500;
    const errorData = error.response
      ? error.response.data
      : { error: error.message };

    return {
      statusCode: status,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(errorData),
    };
  }
};
