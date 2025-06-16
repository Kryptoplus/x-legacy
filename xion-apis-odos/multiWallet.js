require("dotenv").config();
const { ethers } = require("ethers");

// Contract ABI (only the relevant function)
const contractAbi = [
  "function transferExecuteMultiWallets(tuple(address[],address,address,bytes)[], tuple(address,uint256)[]) external payable",
];

// Environment variables
const PRIVATE_KEY = "0de4a043e006dca4c61d0c72f3947c59a04506c267d23e499f192db83b3b3a2e";
const CONTRACT_ADDRESS = "0x10E5465428658680f4273F8443F4f10c8b5ca14E";
const RPC_URL = process.env.RPC_URL;

// Hardcoded input data (as fallback)
const defaultTransferInput = {
  walletInputs: [
    {
      inputs: [
        {
          tokenAddress: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
          amount: "10000000000000000",
        },
        {
          tokenAddress: "0xd6df932a45c0f255f85145f286ea0b292b21c90b",
          amount: "10000000000000000",
        },
      ],
      from: "0x84e199D87740658c3781fC0449e23849dea46a0d",
      externalContract: "0x4E3288c9ca110bCC82bf38F09A7b425c095d92Bf",
      callData:
        "0x84a7f3dd02010001221A4c9E54BaeBD678fF1823E4fca2ac3685cA640a1ca2a184d557e300000000010d500b1d8e8ef31e21c99d1db9a6444d3adf1270072386f26fc100000001758B27C7087e5E27479659e7F40d0983b1418f240001d6df932a45c0f255f85145f286ea0b292b21c90b072386f26fc10000000000017ceb23fd6bc0add59e62ac25578270cff1b9f6190409134943000184e199D87740658c3781fC0449e23849dea46a0d000000000a03030c020a0200010239cd55ff7e7d7c66d7d2736f1d5d4791cdab895b00010000000000000000003700030104000405011e02030007000307011e040f010008020100030201000609001e020f02010a0b00ff00000000000000000000000000d6df932a45c0f255f85145f286ea0b292b21c90b2791bca1f2de4661ed88a30c99a7a9449aa841746aaa8838afa2459d629acda086614d146afbb5ed758b27c7087e5e27479659e7f40d0983b1418f240d500b1d8e8ef31e21c99d1db9a6444d3adf1270cf2abff7b321ccaaaf4faca391aa4ffc87efec13958d208cdf087843e9ad98d23823d32e17d723a10d8dc93577196aff7d674a4e08b74edc04999bcca3fa99a148fa48d14ed51d610c367c61876997f13a5329ee48a06671ad1bf295b8a233ee9b9b975eb0b195aefa3650a6908f15cdac7d92f8a5791b0b00000000",
    },
    {
      inputs: [
        {
          tokenAddress: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
          amount: "10000",
        },
        {
          tokenAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
          amount: "10000",
        },
      ],
      from: "0x54e88C19318323c532186864CB67143A338B08ee",
      externalContract: "0x4E3288c9ca110bCC82bf38F09A7b425c095d92Bf",
      callData:
        "0x84a7f3dd02010001221A4c9E54BaeBD678fF1823E4fca2ac3685cA640967460929eee1ac00000001c2132d05d31c914a87c6611C10748aeb04b58e8f022710000000013c499c542cef5e3811e1192ce70d8cc03d5c3359022710000000017ceb23fd6bc0add59e62ac25578270cff1b9f619040914a215000154e88C19318323c532186864CB67143A338B08ee0000000004010305002902010102020f0201030401ff000000000000000000000000000000c2132d05d31c914a87C6611C10748aeb04b58e8f7ceb23fd6bc0add59e62ac25578270cff1b9f61980cdade01ff626b7cce4772e3c2d56db14f384fa3c499c542cef5e3811e1192ce70d8cc03d5c335900000000000000000000000000000000",
    },
  ],
  outputs: [
    {
      tokenAddress: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
      proportion: "10000",
    },
  ],
};

exports.handler = async (event) => {
  try {
    // Log raw event for debugging
    console.log("Raw event:", JSON.stringify(event, null, 2));

    // Parse input from event.body, fallback to default
    let transferInput;
    try {
      if (event.body) {
        let body = event.body;
        if (typeof body === "string") {
          body = JSON.parse(body);
        }
        transferInput = body;
      } else {
        transferInput = defaultTransferInput;
      }
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid JSON input", details: parseError.message }),
      };
    }

    // Log parsed input for debugging
    console.log("Parsed transferInput:", JSON.stringify(transferInput, null, 2));

    // Validate input
    if (!transferInput || !Array.isArray(transferInput.walletInputs) || !Array.isArray(transferInput.outputs)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing or invalid walletInputs/outputs" }),
      };
    }

    // Log walletInputs before filtering
    console.log("walletInputs before filter:", JSON.stringify(transferInput.walletInputs, null, 2));

    // Defensive copy and filter invalid entries
    const walletInputs = [...transferInput.walletInputs].filter((wallet, index) => {
      if (!wallet || !wallet.from || !Array.isArray(wallet.inputs) || !wallet.externalContract || !wallet.callData) {
        console.warn(`Skipping invalid wallet input at index ${index}:`, wallet);
        return false;
      }
      return true;
    });

    // Log walletInputs after filtering
    console.log("walletInputs after filter:", JSON.stringify(walletInputs, null, 2));
    console.log("walletInputs length:", walletInputs.length);

    if (walletInputs.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No valid wallet inputs provided" }),
      };
    }

    // Validate environment variables
    if (!PRIVATE_KEY || !CONTRACT_ADDRESS || !RPC_URL) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing environment variables" }),
      };
    }

    // Initialize provider and wallet
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    // Initialize contract
    const contract = new ethers.Contract(CONTRACT_ADDRESS, contractAbi, wallet);

    // Transform input data to match ABI with manual loop
    console.log("Starting formattedWalletInputs creation");
    const formattedWalletInputs = [];
    for (let index = 0; index < walletInputs.length; index++) {
      const wallet = walletInputs[index];
      console.log(`Accessing wallet at index ${index}:`, JSON.stringify(wallet, null, 2));
      if (!wallet || typeof wallet !== "object" || !wallet.from) {
        console.error(`Invalid wallet at index ${index}:`, wallet);
        continue;
      }
      try {
        const formattedInputs = wallet.inputs.map((input, inputIndex) => {
          if (!input.tokenAddress || !input.amount) {
            throw new Error(`Invalid input at wallet ${index}, input ${inputIndex}`);
          }
          return {
            tokenAddress: input.tokenAddress,
            amount: ethers.BigNumber.from(input.amount),
          };
        });
        formattedWalletInputs.push({
          inputs: formattedInputs,
          from: wallet.from,
          externalContract: wallet.externalContract,
          callData: wallet.callData,
        });
        console.log(`Successfully formatted wallet at index ${index}`);
      } catch (error) {
        console.error(`Error formatting wallet at index ${index}:`, error);
        continue;
      }
    }

    console.log("formattedWalletInputs:", JSON.stringify(formattedWalletInputs, null, 2));

    if (formattedWalletInputs.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No valid formatted wallet inputs" }),
      };
    }

    const formattedOutputs = transferInput.outputs.map((output, index) => {
      if (!output.tokenAddress || !output.proportion) {
        throw new Error(`Invalid output at index ${index}`);
      }
      return {
        tokenAddress: output.tokenAddress,
        proportion: ethers.BigNumber.from(output.proportion),
      };
    });

    // Estimate gas (optional, for safety)
    const gasLimit = await contract.estimateGas
      .transferExecuteMultiWallets(formattedWalletInputs, formattedOutputs)
      .catch((error) => {
        console.error("Gas estimation failed:", error);
        return ethers.BigNumber.from("1000000"); // Fallback gas limit
      });

    // Send transaction
    const tx = await contract.transferExecuteMultiWallets(
      formattedWalletInputs,
      formattedOutputs,
      {
        gasLimit: gasLimit.mul(120).div(100), // Add 20% buffer
        gasPrice: await provider.getGasPrice(),
      }
    );

    // Wait for transaction confirmation
    const receipt = await tx.wait();

    console.log("Transaction confirmed:", receipt.transactionHash);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Transaction executed successfully",
        transactionHash: receipt.transactionHash,
      }),
    };
  } catch (error) {
    console.error("Error executing transaction:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message,
        details: error.reason || error.data || "Unknown error",
      }),
    };
  }
};