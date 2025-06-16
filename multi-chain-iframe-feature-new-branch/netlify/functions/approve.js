import axios from 'axios';
import { Transaction } from '@solana/web3.js';

const SHYFT_API_KEY = process.env.SHYFT_API_KEY;
const SOLANA_NETWORK = process.env.SOLANA_NETWORK;
const RELAYER_ADDRESS = process.env.RELAYER_ADDRESS;

exports.handler = async (event, context) => {
  try {
    // // Log the method and initial request details
    // console.log('Request Method:', event.httpMethod);
    // console.log('Request Headers:', event.headers);
    // console.log('Request Body:', event.body);
  
    // // Log the environment variables to ensure they are loaded
    // console.log('Environment Variables:');
    // console.log('SHYFT_API_KEY:', SHYFT_API_KEY ? 'Loaded' : 'Not Loaded');
    // console.log('SOLANA_NETWORK:', SOLANA_NETWORK);
    // console.log('RELAYER_ADDRESS:', RELAYER_ADDRESS);

    // Check if the method is POST
    if (event.httpMethod !== 'POST') {
      // console.log('Invalid method:', event.httpMethod);
      return {
        statusCode: 405,
        body: JSON.stringify({ message: 'Method not allowed' }),
      };
    }

    // Parse the request body (since it's a string in event.body)
    const { encodedTransaction } = JSON.parse(event.body);
    if (!encodedTransaction) {
      // console.log('Missing required parameters:', { encodedTransaction });
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Missing required parameters' }),
      };
    }

    // console.log('Receiving encoded transaction from owner...');
    // // console.log('Using relayer address:', RELAYER_ADDRESS);
    // console.log('Network:', SOLANA_NETWORK);
    // console.log('Encoded Transaction:', encodedTransaction);

    // Decode the transaction
    const transaction = Transaction.from(Buffer.from(encodedTransaction, 'base64'));
    // console.log('Transaction decoded successfully:', transaction);

    // Check the owner's signature
    const ownerSignatureIndex = transaction.signatures.findIndex(sig => sig.publicKey.toBase58() === RELAYER_ADDRESS);
    if (ownerSignatureIndex === -1) {
      // console.log('Owner signature missing');
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Owner signature missing' }),
      };
    }

    // Send the transaction to Shyft API for relayer to sign and submit
    // console.log('Sending transaction to Shyft relayer for signing and submission...');
    const signResponse = await axios.post(
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

    // console.log('Transaction signed and sent:', signResponse.data);
    return {
      statusCode: 200,
      body: JSON.stringify(signResponse.data),
    };
  } catch (error) {
    console.error('Transaction error:', error);
    if (error.response) {
      console.error('Error response data:', error.response.data);
      return {
        statusCode: 500,
        body: JSON.stringify({ message: 'Internal server error', error: error.response.data }),
      };
    } else {
      return {
        statusCode: 500,
        body: JSON.stringify({ message: 'Internal server error', error: error.message }),
      };
    }
  }
};
