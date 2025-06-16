const {
  DynamoDBClient,
  DeleteItemCommand,
  GetItemCommand,
} = require("@aws-sdk/client-dynamodb");
const { ethers } = require("ethers");

// Initialize DynamoDB client
const dynamoDbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const DYNAMO_TABLE_NAME = "SingleBillingLockedBalance";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

exports.handler = async (event) => {
  try {
    console.log("Received event:", JSON.stringify(event, null, 2));

    if (!event.Records) {
      console.error("No SQS Records found in the event");
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No SQS Records found" }),
      };
    }

    for (const record of event.Records) {
      const parsedBody = JSON.parse(record.body);
      const { transactionHash, buyerAddress } = parsedBody;

      if (!transactionHash || !buyerAddress) {
        console.error("Missing required parameters in SQS message");
        continue;
      }

      console.log(`Processing transaction: ${transactionHash}`);
      const resultMessage = await processTransaction(parsedBody);
      console.log(`Result: ${resultMessage}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Processed successfully" }),
    };
  } catch (error) {
    console.error("Error processing SQS records:", error);
    throw new Error("Error occurred, requeuing message");
  }
};

async function processTransaction(params) {
  const { transactionHash, buyerAddress } = params;

  try {
    const status = await checkTransactionStatus(transactionHash);

    if (status === "Success" || status === "Failed") {
      console.log(
        `Transaction ${transactionHash} confirmed with status: ${status}`
      );
      await deleteLockRow(buyerAddress);
      return `Transaction ${transactionHash} confirmed as ${status}`;
    } else {
      console.log(`Transaction ${transactionHash} pending, requeuing...`);
      throw new Error(`Transaction ${transactionHash} not finalized`);
    }
  } catch (error) {
    console.error(
      `Error processing transaction ${transactionHash}:`,
      error.message
    );
    throw new Error(
      `Requeued: Error occurred while processing transaction ${transactionHash}`
    );
  }
}

// Check transaction status using ethers.js
async function checkTransactionStatus(transactionHash) {
  const rpcUrl =
    "https://quiet-alpha-card.matic.quiknode.pro/c29dcda8375770b9a14f0c8abd032661e0efee5c/";
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  console.log(`Fetching status for transactionHash: ${transactionHash}`);

  let receipt = null;
  const maxRetries = 15;
  const delayMs = 600;

  for (let i = 0; i < maxRetries; i++) {
    try {
      receipt = await provider.getTransactionReceipt(transactionHash);
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
    throw new Error("Transaction receipt not found");
  }

  const status = receipt.status;
  const statusText = status === 1 ? "Success" : "Failed";
  console.log(`Transaction ${transactionHash} status: ${statusText}`);
  return statusText;
}

async function deleteLockRow(buyerAddress) {
  try {
    const deleteParams = {
      TableName: DYNAMO_TABLE_NAME,
      Key: { buyerAddress: { S: buyerAddress } },
    };

    const command = new DeleteItemCommand(deleteParams);
    await dynamoDbClient.send(command);
    console.log(
      `Successfully deleted lock row for buyerAddress: ${buyerAddress}`
    );
  } catch (error) {
    console.error(
      `Error deleting lock row for buyerAddress ${buyerAddress}:`,
      error.message
    );
    throw error;
  }
}
