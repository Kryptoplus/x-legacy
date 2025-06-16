const jwt = require('jsonwebtoken');
const { DynamoDBClient, PutItemCommand, UpdateItemCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
const anchor = require("@coral-xyz/anchor");
const {
    PublicKey,
    Connection,
    Transaction,
    sendAndConfirmTransaction,
    ComputeBudgetProgram,
    SystemProgram,
} = require("@solana/web3.js");
const idl = require("./idl.json");
const { utf8 } = require("@coral-xyz/anchor/dist/cjs/utils/bytes");
const { TOKEN_PROGRAM_ID } = require("@coral-xyz/anchor/dist/cjs/utils/token");
const {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
} = require("@solana/spl-token");
const { BN } = require("bn.js");
const axios = require('axios');

const dynamoDbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'SolanaTransactions';

const merchantFeeMapping = require('./SolanaApis/merchantFeeMapping.js');
const authorizedMerchants = require('./SolanaApis/authorizedMerchants.js'); // Import the authorized merchants list

const mintAddress = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const pdaTokenAccount = new PublicKey("G2CpyHXubhUkCEBHDWb2jDuXYmeTCNz4yPhifauFS2yL");
const relayer = new PublicKey("2Etbf1ua9fyUgjeq4vDC8xKCHWn4uKGjRGwK8da4maYk");
const feewalletBPS = 100;
// const feewalletAccount = "5rATHWftBLmqGUURAS7zoFQZYRkELL7ihbgqYpWqx6m8"; 
// const buyer = "2Etbf1ua9fyUgjeq4vDC8xKCHWn4uKGjRGwK8da4maYk"
const feewalletTokenAccount = new PublicKey("HmF2yUikh8ygyfiqMHxQz4W1mVHz7AtTWrhpPYQe3KJJ");
const { v4: uuidv4 } = require('uuid');  // Import the UUID library
const PROGRAM_ID = new PublicKey(idl.address);
const SHYFT_API_KEY = process.env.SHYFT_API_KEY;
const RELAYER_ADDRESS = process.env.RELAYER_ADDRESS;
const SOLANA_NETWORK = process.env.SOLANA_NETWORK;
// const { AccountLayout, createInitializeAccountInstruction } = require("@solana/spl-token");

require('events').EventEmitter.defaultMaxListeners = 20;

// Added function to initialize the token program for minting
// async function initTokenProgram(connection) {
//     try {
//         // Ensure mintAddress is a PublicKey instance
//         const mintAddressPubKey = new PublicKey(mintAddress);

//         // Derive the PDA Token Account using correct seeds
//         const [pdaTokenAccount, bump] = PublicKey.findProgramAddressSync(
//              [mintAddressPubKey.toBuffer()],
//             PROGRAM_ID
//         );

//         console.log(`Initializing token program for mint address: ${mintAddress}, PDA Token Account: ${pdaTokenAccount.toBase58()}`);

//         // Check if the PDA token account already exists
//         const pdaAccountInfo = await connection.getAccountInfo(pdaTokenAccount);
//         if (!pdaAccountInfo) {
//             console.log('PDA token account does not exist, creating...');

//             // Calculate the minimum balance for rent exemption
//             const lamports = await connection.getMinimumBalanceForRentExemption(AccountLayout.span);

//             const transaction = new Transaction();

//             // Create the account at the PDA address
//             transaction.add(
//                 SystemProgram.createAccount({
//                     fromPubkey: new PublicKey(RELAYER_ADDRESS), // Fee payer
//                     newAccountPubkey: pdaTokenAccount,          // PDA address
//                     lamports,
//                     space: AccountLayout.span,
//                     programId: TOKEN_PROGRAM_ID,
//                 })
//             );

//             // Initialize the account as a token account
//             transaction.add(
//                 createInitializeAccountInstruction(
//                     pdaTokenAccount,       // Account to initialize
//                     mintAddressPubKey,     // Token mint address
//                     pdaTokenAccount        // Owner of the token account (PDA itself)
//                 )
//             );

//             // Get the latest blockhash
//             const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

//             transaction.recentBlockhash = blockhash;
//             transaction.lastValidBlockHeight = lastValidBlockHeight;
//             transaction.feePayer = new PublicKey(RELAYER_ADDRESS);

//             // Serialize transaction
//             const serializedTransaction = transaction.serialize({
//                 requireAllSignatures: false,
//                 verifySignatures: false,
//             });
//             const encodedTransaction = serializedTransaction.toString('base64');

//             // Send transaction via Shyft API
//             const signResponse = await axios.post(
//                 'https://api.shyft.to/sol/v1/txn_relayer/sign',
//                 {
//                     network: SOLANA_NETWORK,
//                     encoded_transaction: encodedTransaction,
//                 },
//                 {
//                     headers: {
//                         'x-api-key': SHYFT_API_KEY,
//                         'Content-Type': 'application/json',
//                     }
//                 }
//             );

//             if (signResponse.data.success) {
//                 console.log(`PDA token account created: ${pdaTokenAccount.toBase58()}`);
//             } else {
//                 throw new Error(`Failed to create PDA token account: ${signResponse.data.error}`);
//             }
//         } else {
//             console.log('PDA token account already exists:', pdaTokenAccount.toBase58());
//         }

//         return pdaTokenAccount;
//     } catch (error) {
//         console.error('Error initializing token program:', error);
//         throw error;
//     }
// }



async function getNextSerial() {
    const params = {
        TableName: TABLE_NAME,
        Key: {
            serialKey: { S: "currentSerial" } // Reference to the special tracking item
        },
        UpdateExpression: "SET serialValue = serialValue + :incr",
        ExpressionAttributeValues: {
            ":incr": { N: "1" } // Increment serial by 1
        },
        ReturnValues: "UPDATED_NEW" // Return the updated serial value
    };

    try {
        const data = await dynamoDbClient.send(new UpdateItemCommand(params));
        return parseInt(data.Attributes.serialValue.N, 10); // Return the incremented serial
    } catch (error) {
        console.error('Error retrieving next serial from DynamoDB:', error);
        throw error;
    }
}

// Function to save the transaction data to DynamoDB
async function saveTransaction(serial, orderCode, buyerAddress, solanaWalletAddress, amount, merchantWebhook, referenceID) {
    const params = {
        TableName: TABLE_NAME,
        Item: {
            serialKey: { S: serial.toString() }, // Corrected key name to match the primary key
            orderCode: { S: orderCode }, // Unique order code
            buyerAddress: { S: buyerAddress }, // Buyer address as a string
            solanaWalletAddress: { S: solanaWalletAddress }, // Solana wallet address as a string
            amount: { N: amount.toString() }, // Amount as a number
            status: { S: "Pending" }, // Status as a string
            merchantWebhook: { S: merchantWebhook }, // Merchant webhook as a string
            referenceID: { S: referenceID }, // Manually entered reference ID
            createdAt: { S: new Date().toISOString() }, // Timestamp of when the record was created
            notificationDeliveryStatus: { BOOL: false } // Default to false
        },
    };

    try {
        await dynamoDbClient.send(new PutItemCommand(params));
        console.log(`Transaction ${serial} saved to DynamoDB with status "Pending"`);
    } catch (error) {
        console.error('Error saving transaction to DynamoDB:', error);
        throw error;
    }
}

// Function to update the transaction status in DynamoDB
async function updateTransaction(serial, updateData) {
    console.log('updateTransaction called with:', {
        serial,
        updateData
    });

    const notificationDeliveryStatus = updateData.notificationDeliveryStatus !== undefined ? updateData.notificationDeliveryStatus : false;

    const params = {
        TableName: TABLE_NAME,
        Key: { serialKey: { S: serial.toString() } },
        UpdateExpression: 'set #s = :status, transactionHash = :transactionHash, updatedAt = :updatedAt, notificationDeliveryStatus = :notificationDeliveryStatus',
        ExpressionAttributeNames: {
            '#s': 'status'
        },
        ExpressionAttributeValues: {
            ':status': { S: updateData.status },
            ':transactionHash': { S: updateData.transactionHash },
            ':updatedAt': { S: new Date().toISOString() },
            ':notificationDeliveryStatus': { BOOL: notificationDeliveryStatus }
        },
    };
    console.log('DynamoDB UpdateItemCommand params:', params);

    try {
        await dynamoDbClient.send(new UpdateItemCommand(params));
    } catch (error) {
        console.error('Error updating transaction in DynamoDB:', error);
        throw error;
    }
}


// Function to notify the merchant
async function notifyMerchant(transactionHash, status, amount, buyerAddress, webhookUrl, serial, orderCode, referenceID) {
    console.log('notifyMerchant called with:', {
        transactionHash,
        status,
        amount,
        buyerAddress,
        webhookUrl,
        serial,
        orderCode,
        referenceID
    });
    let notificationSuccess = false;

    try {
        const response = await axios.post(webhookUrl, {
            transactionHash,
            status,
            amount,
            buyerAddress,
            orderCode,
            referenceID
        });

        console.log(`Merchant notified: ${response.statusText}`);
        notificationSuccess = true; // Mark as true if successful
    } catch (error) {
        console.error(`Failed to notify merchant: ${error.message}`);
        // Continue execution even if notifying the merchant fails
    } finally {
        // Update the transaction with notificationDeliveryStatus regardless of success or failure
        try {
            await updateTransaction(serial, {
                status,
                transactionHash,
                notificationDeliveryStatus: notificationSuccess
            });
        } catch (error) {
            console.error(`Failed to update transaction with notification status: ${error.message}`);
            // Even if this fails, we continue execution to prevent stopping the whole function
        }
    }
}

// Function to get recent prioritization fees
//   async function getRecentPrioritizationFees(accounts) {
//     try {
//         const SOLANA_RPC_URL = `https://api.${process.env.SOLANA_NETWORK}.solana.com`;

//         const response = await axios.post(SOLANA_RPC_URL, {
//             jsonrpc: "2.0",
//             id: 1,
//             method: "getRecentPrioritizationFees",
//             params: [accounts]
//         });

//         if (response.data && response.data.result) {
//             const fees = response.data.result;
//             // console.log("Recent prioritization fees:", fees);
//             return fees;
//         } else {
//             console.error("Failed to retrieve recent prioritization fees");
//             return null;
//         }
//     } catch (error) {
//         console.error("Error fetching prioritization fees:", error);
//         return null;
//     }
// }

module.exports.handler = async (event) => {
    // console.time("LambdaExecutionTime"); // Start timing the execution
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
    // Get the JWT secret key from environment variables
    const jwtSecret = process.env.JWT_SECRET;

    // Extract the JWT from the 'Authorization' header
    const authHeader = event.headers.Authorization || event.headers.authorization; // Check both cases
    console.log('Authorization header:', authHeader); // Log the header for debugging

    const token = authHeader?.split(' ')[1]; // Get the token part

    if (!token) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Authorization token is missing' })
        };
    }

    try {
        // Verify the JWT
        const decoded = jwt.verify(token, jwtSecret);
        console.log('Decoded JWT:', decoded); // Log the decoded token for debugging

        // Use claims from the JWT payload
        // const solanaWalletAddress = decoded.walletAddress;

        // Continue with the main logic of your function here
        const parsedBody = JSON.parse(event.body);

        const {
            buyerAddress,
            amount,
            merchantWebhook,
            referenceID,
            solanaWalletAddress
        } = parsedBody;

        if (decoded.walletAddress != "9pC9PWxb9Xwb4Y3vkCvvAAwE4BTqsf9mGQiUZjM1uZwn") {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'JWT token is incorrect' })
            };
        }

        const buyer = buyerAddress;

        const orderCode = uuidv4().replace(/-/g, '').slice(0, 5);  // Generate a 5-character alphanumeric code

        console.log('Extracted variables:', {
            buyerAddress,
            solanaWalletAddress,
            amount,
            merchantWebhook,
            referenceID
        });

        const merchentfeeBPS = merchantFeeMapping[solanaWalletAddress];
        console.log('Merchant fee BPS:', merchentfeeBPS);

        // console.log('Mint Address:', mintAddress);
        // console.log('Source:', buyerAddress);
        // console.log('Buyer:', buyer);
        // console.log('Merchent Account:', solanaWalletAddress);
        // console.log('Feewallet Account:', feewalletAccount);
        // console.log('Amount:', amount);
        // console.log('Merchent Fee BPS:', merchentfeeBPS);
        // console.log('Feewallet BPS:', feewalletBPS);

        // Fetch recent prioritization fees for the buyer's account
        // const recentFees = await getRecentPrioritizationFees([buyerAddress]);

        let priorityFee = 80000;  // Default priority fee in micro-lamports

        // if (recentFees && recentFees.length > 0) {
        //     // Choose the highest fee from the list
        //     const highestFeeObject = recentFees.reduce((max, feeObj) => 
        //         feeObj.prioritizationFee > max.prioritizationFee ? feeObj : max, recentFees[0]);

        //     priorityFee = highestFeeObject.prioritizationFee;  // Use the highest priority fee found
        // }

        // console.log("Using priority fee:", priorityFee);

        if (!mintAddress) {
            throw new Error('Mint Address is undefined');
        }
        const mintAddressPubKey = new PublicKey(mintAddress);

        // const SHYFT_API_KEY = process.env.SHYFT_API_KEY;
        // const RELAYER_ADDRESS = process.env.RELAYER_ADDRESS;
        // const SOLANA_NETWORK = process.env.SOLANA_NETWORK;

        if (!SHYFT_API_KEY) {
            throw new Error('Shyft API Key is not set. Please check your environment variables.');
        }
        if (!RELAYER_ADDRESS) {
            throw new Error('Relayer address is not defined');
        }
        if (!SOLANA_NETWORK) {
            throw new Error('Solana network is not defined in environment variables.');
        }

        const SOLANA_NETWORK_URL = `https://fluent-cosmopolitan-patron.solana-mainnet.quiknode.pro/18ab6c68fc21ecc31d10afbde4fb13be00f9be04/`;
        if (!(SOLANA_NETWORK_URL.startsWith('http:') || SOLANA_NETWORK_URL.startsWith('https:'))) {
            throw new Error('Invalid Solana network URL. It must start with "http:" or "https:".');
        }

        // // Check if the merchantTokenAccount is authorized
        // if (!authorizedMerchants.includes(solanaWalletAddress)) {
        //     console.error('Unauthorized merchant');
        //     return {
        //         statusCode: 400,
        //         body: JSON.stringify({ message: 'Merchant is not authorized to perform this transaction.' })
        //     };
        // }

        const connection = new Connection(SOLANA_NETWORK_URL, "confirmed");

        // Run allowance and balance checks concurrently
        let allowance, balance;

        console.log(`Fetching allowance and balance for ${buyerAddress}`);

        if (!allowance || !balance) {
            const [allowanceResponse, balanceResponse] = await Promise.all([
                axios.get(`https://solana-balance-apis.vercel.app/api/getAllowance?address=${buyerAddress}`),
                axios.get(`https://solana-balance-apis.vercel.app/api/getBalance?address=${buyerAddress}&token=usdt`)
            ]);

            allowance = new BN(allowanceResponse.data.allowance);
            balance = new BN(balanceResponse.data.balance);
        }

        console.log(`Allowance: ${allowance.toString()}, Balance: ${balance.toString()}`);

        const tokenPrecision = new BN(10).pow(new BN(6)); // Define precision (6 decimals for USDT)
        const tokenAmountBN = new BN(amount * tokenPrecision.toNumber()); // Convert the amount to integer

        // Check allowance
        if (allowance.lt(tokenAmountBN)) {
            console.error(`Allowance is insufficient. Allowance: ${allowance.toString()}, Required: ${tokenAmountBN.toString()}`);
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Not enough user allowance.' })
            };
        }

        // Check balance
        if (balance.lt(tokenAmountBN)) {
            console.error(`Balance is insufficient. Balance: ${balance.toString()}, Required: ${tokenAmountBN.toString()}`);
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Not enough user balance.' })
            };
        }

        const serial = await getNextSerial();

        await saveTransaction(serial, orderCode, buyerAddress, solanaWalletAddress, amount, parsedBody.merchantWebhook, referenceID);

        console.log('PROGRAM_ID:', PROGRAM_ID.toBase58());
        console.log('Deriving VaultPda with seed "vault"');
        // const PROGRAM_ID = new PublicKey(idl.address);
        const [VaultPda] = PublicKey.findProgramAddressSync(
            [utf8.encode("white-list")],
            PROGRAM_ID
        );
        console.log('Derived VaultPda:', VaultPda.toBase58());

        const provider = new anchor.AnchorProvider(
            connection,
            new anchor.Wallet({ publicKey: new PublicKey(RELAYER_ADDRESS) }),
            {
                preflightCommitment: "processed",
                maxRetries: 0,
            }
        );

        anchor.setProvider(provider);

        const wallet = await getAssociatedTokenAddress(
            mintAddressPubKey,
            new PublicKey(buyerAddress),
            false, // Allow owner off curve
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        console.log('Derived Wallet (ATA):', wallet.toBase58());

        console.log('Deriving restritedAccountPda with seeds:');
        console.log('Seed 1: "restricted_account"');
        console.log('Seed 2:', wallet.toBase58());
        const [restritedAccountPda, bumpRestritedAccount] = PublicKey.findProgramAddressSync(
            [new PublicKey(buyerAddress).toBuffer()],
            PROGRAM_ID
        );

        console.log('Restricted Account PDA:', restritedAccountPda.toString()); // Added logging for restricted account PDA
        console.log('Derived restritedAccountPda:', restritedAccountPda.toBase58());
        console.log('Bump seed for restritedAccountPda:', bumpRestritedAccount);
         // Create or get the PDA token account
        //  const [pdaTokenAccount] = PublicKey.findProgramAddressSync(
        //     [utf8.encode("pda-seed")], // Replace "pda-seed" with the actual seed logic as per your program requirements
        //     PROGRAM_ID
        // );
// Initialize Token Program
// await initTokenProgram(mintAddress);

 // Create the PDA Token Account using the recommendation provided
//  const [pdaTokenAccount, bumppdaTokenAccount] = PublicKey.findProgramAddressSync(
//     [mintAddressPubKey.toBuffer()],
//     PROGRAM_ID
// );
        // console.log('pdaTokenAccount:', pdaTokenAccount.toString());

        // Check if PDA exists
// const pdaAccountInfo = await connection.getAccountInfo(pdaTokenAccount);
// if (!pdaAccountInfo) {
//     console.error('PDA token account does not exist:', pdaTokenAccount.toString());
//     throw new Error('PDA token account is missing.');
// }
// const pdaAccountInfo = await connection.getAccountInfo(pdaTokenAccount);
//         if (!pdaAccountInfo) {
//             console.error('PDA token account does not exist:', pdaTokenAccount.toString());
//             throw new Error('PDA token account is missing.');
//         }
// console.log('Deriving pdaTokenAccount with seeds:');
// console.log('Seed 1: "token_account"');
// console.log('Seed 2:', mintAddressPubKey.toBase58());
     // Initialize PDA Token Account (create if missing)
    //  const pdaTokenAccount = await initTokenProgram(connection);
// console.log('pdaTokenAccount:', pdaTokenAccount.toString());

// console.log('Derived pdaTokenAccount:', pdaTokenAccount.toBase58());
// console.log('Bump seed for pdaTokenAccount:', bump);

        const mintData = await connection.getParsedAccountInfo(mintAddressPubKey);
        if (!mintData || !mintData.value) {
            throw new Error('Failed to retrieve mint data');
        }

        const sourceTokenAccount = await createAssociatedTokenAccount(
            connection,
            RELAYER_ADDRESS,
            mintAddressPubKey,
            new PublicKey(buyerAddress)
        );

        const merchentTokenAccount = await createAssociatedTokenAccount(
            connection,
            RELAYER_ADDRESS,
            mintAddressPubKey,
            new PublicKey(solanaWalletAddress)
        );

        // Function to create an associated token account
        async function createAssociatedTokenAccount(connection, feePayer, mint, owner) {
            try {
                const associatedTokenAddress = await getAssociatedTokenAddress(
                    mint,
                    owner,
                    false, // Allow owner off curve
                    TOKEN_PROGRAM_ID,
                    ASSOCIATED_TOKEN_PROGRAM_ID
                );

                const accountInfo = await connection.getAccountInfo(associatedTokenAddress);
                if (accountInfo !== null) {
                    // console.log(
                    //     "Associated token account already exists:",
                    //     associatedTokenAddress.toBase58()
                    // );
                    return associatedTokenAddress;
                }

                const transaction = new Transaction().add(
                    createAssociatedTokenAccountInstruction(
                        new PublicKey(feePayer),
                        associatedTokenAddress,
                        owner,
                        mint,
                        TOKEN_PROGRAM_ID,
                        ASSOCIATED_TOKEN_PROGRAM_ID
                    )
                );

                await sendAndConfirmTransaction(connection, transaction, [new PublicKey(feePayer)]);
                // console.log(
                //     "Associated token account created:",
                //     associatedTokenAddress.toBase58()
                // );
                return associatedTokenAddress;
            } catch (error) {
                console.error('Error creating associated token account:', error);
                throw error;
            }
        }
        // const feewalletAccountPDA = new PublicKey(feewalletAccount);
        // const feewalletTokenAccount = await getAssociatedTokenAddress(
        //     mintAddressPubKey,
        //     feewalletAccountPDA,
        //     true,  // Indicates that the owner is an off-curve PDA
        //     TOKEN_PROGRAM_ID,
        //     ASSOCIATED_TOKEN_PROGRAM_ID
        // );

        // // Check if the token account already exists
        // const feewalletAccountInfo = await connection.getAccountInfo(feewalletTokenAccount);
        // if (!feewalletAccountInfo) {
        //     // Create the associated token account with the PDA as the owner
        //     const createIx = createAssociatedTokenAccountInstruction(
        //         new PublicKey(RELAYER_ADDRESS), // Fee payer
        //         feewalletTokenAccount,          // The associated token account address
        //         feewalletAccountPDA,            // The PDA (program account) as the owner
        //         mintAddressPubKey,              // The mint address
        //         TOKEN_PROGRAM_ID,
        //         ASSOCIATED_TOKEN_PROGRAM_ID
        //     );
        //     const transaction = new Transaction().add(createIx);
        //     await sendAndConfirmTransaction(connection, transaction, [new PublicKey(RELAYER_ADDRESS)]);
        // }

        // console.log(`Associated Token Account for feewalletAccount: ${feewalletTokenAccount.toBase58()}`);

        const factor = Math.pow(10, mintData.value.data.parsed.info.decimals);
        const tokenAmount = new BN(amount * factor);

        const program = new anchor.Program(idl, provider);

        // Create ComputeBudget instructions
        const computeUnitLimit = ComputeBudgetProgram.setComputeUnitLimit({
            units: 1000000,
        });

        const computeUnitPrice = ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: BigInt(priorityFee),  // Convert priority fee to BigInt
        });

        // Create transaction with ComputeBudget instructions
        const tx = new Transaction()
            .add(computeUnitLimit)
            .add(computeUnitPrice)
            .add(
                await program.methods
                    .purchaseProcess(
                        tokenAmount,
                        new BN(merchentfeeBPS),
                        new BN(feewalletBPS)
                    )
                    .accounts({
                        vault: VaultPda,
                        restritedAccount: restritedAccountPda, // NEWLY ADDED LINE
                        pdaTokenAccount: pdaTokenAccount, // NEWLY ADDED LINE FOR pdaTokenAccount
                        buyer: relayer,
                        source: sourceTokenAccount,
                        merchantTokenAccount: merchentTokenAccount,
                        feeWalletTokenAccount: feewalletTokenAccount,
                        delegate: VaultPda,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .transaction({
                        skipPreflight: true, // Skip preflight
                        maxRetries: 1, // Set maxRetries here
                    })
            );
            // Log the accounts after they are defined
// console.log('Transaction Accounts:', {
//     vault: VaultPda.toBase58(),
//     restritedAccount: restritedAccountPda.toBase58(),
//     pdaTokenAccount: pdaTokenAccount.toBase58(),
//     buyer: new PublicKey(buyer).toBase58(),
//     source: sourceTokenAccount.toBase58(),
//     merchantTokenAccount: merchentTokenAccount.toBase58(),
//     feeWalletTokenAccount: feewalletTokenAccount.toBase58(),
//     delegate: VaultPda.toBase58(),
//     tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
// });
            

        // const { blockhash } = await connection.getRecentBlockhash();
        // Updated method:
        const latestBlockhash = await connection.getLatestBlockhash();
        tx.recentBlockhash = latestBlockhash.blockhash;
        tx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
        // tx.recentBlockhash = blockhash;
        tx.feePayer = new PublicKey(RELAYER_ADDRESS);

        // console.log('Serializing transaction...');
        const serializedTransaction = tx.serialize({ requireAllSignatures: false });
        const encodedTransaction = serializedTransaction.toString('base64');
        // console.log('Serialized transaction:', encodedTransaction);
        let signResponse; // Declare in the broader scope

        // console.log('Signing and sending transaction via Shyft relayer...');
        try {
            signResponse = await axios.post(
                'https://api.shyft.to/sol/v1/txn_relayer/sign',
                {
                    network: SOLANA_NETWORK,
                    encoded_transaction: encodedTransaction,
                },
                {
                    headers: {
                        'x-api-key': SHYFT_API_KEY,
                        'Content-Type': 'application/json',
                    }
                }
            );
            console.log('Shyft API response:', signResponse.data);
     // Validate the response structure
     if (!signResponse || !signResponse.data) {
        throw new Error('Shyft API response is undefined or missing "data" property.');
    }
    if (!signResponse.data.success || !signResponse.data.result?.tx) {
        console.error('Invalid Shyft API response:', signResponse.data);
        throw new Error('Shyft API response does not contain the transaction hash.');
    }
        } catch (err) {
            console.error('Error during Shyft API call:', err.response?.data || err.message);
            throw err;
        }

        // console.log('Transaction signed and sent:', signResponse.data);
        // console.log('Sign Response:', signResponse.data);

        // Extracting transaction hash and status
        const txHash = signResponse.data.result.tx;
        const status = signResponse.data.success ? 'successful' : 'failed';

        // Wait for the transaction confirmation
        // console.log('Waiting for transaction confirmation...');
        // const confirmedTransaction = await connection.confirmTransaction(txHash, 'confirmed');
        // const status = confirmedTransaction.value.err ? 'Failed' : 'Success';

        await updateTransaction(serial, {
            status,
            transactionHash: txHash
        });

        // console.timeEnd("LambdaExecutionTime"); // End timing and log the time
        // Notify the merchant about the transaction result
        await notifyMerchant(txHash, status, amount, buyerAddress, merchantWebhook, serial, orderCode, referenceID);

        const response = {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*', // Allow all origins or specify your domain
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                transactionHash: txHash,
                status: status,
                amount: amount,
                buyerAddress: buyerAddress,
                solanaWalletAddress: solanaWalletAddress,
                orderCode: orderCode,
                referenceID: referenceID // Include reference ID in the response
            })
        };
        return response;
    } catch (error) {
        // Catch specific JWT errors
        if (error.name === 'JsonWebTokenError') {
            console.error('Invalid token:', error.message); // Log the specific JWT error
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Invalid token' })
            };
        }

        // General error handler
        console.error('General error:', error);
        const response = {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*', // Allow all origins or specify your domain
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ error: error.message })
        };
        return response;
    }
};