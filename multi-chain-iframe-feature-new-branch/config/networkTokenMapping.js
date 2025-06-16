import { ethereum, polygon, avalanche, base, bsc } from "thirdweb/chains";

const networkTokenMapping = {
    Polygon: {
        chain: polygon,
        chainId: 137, // Polygon chain ID
        tokens: {
            USDT: {
                relayerUrl: "https://xion.engine-usw2.thirdweb.com/relayer/polygon-usdt-relayer-url",
                useContract: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
                spender: "0xa7fFB35C7f24cbf76C5e1B109e27Bb923D7054C3",
                decimals: 6, // USDT on Polygon has 6 decimals
                icon: "/USDT-Polygon.svg",
                name: "USDT"                // Polygon USDT icon
            },
            // Add more tokens if needed
        },
    },
    Avalanche: {
        chain: avalanche,
        chainId: 43114, // Avalanche chain ID
        tokens: {
            USDC: {
                relayerUrl: "https://xion.engine-usw2.thirdweb.com/relayer/2f970407-fb6a-4512-8a32-e65c1b4a12ce",
                useContract: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
                spender: "0xa7fFB35C7f24cbf76C5e1B109e27Bb923D7054C3",
                decimals: 6, // USDT on Polygon has 6 decimals
                icon: "/USDC-AVAX-Icon.svg", // Avalanche USDT icon
                name: "USDC"
            },
            // Add more tokens if needed
        },
    },
    Binance: {
        chain: bsc,
        chainId: 56, // Binance Smart Chain chain ID
        tokens: {
            USDT: {
                relayerUrl: "https://xion.engine-usw2.thirdweb.com/relayer/a69e0a11-6076-4b47-897c-ed0a30481018",
                useContract: "0x55d398326f99059ff775485246999027b3197955",
                spender: "0xB31674FD66a7620AC4EE9CA94e349Dc3682414b8",
                decimals: 18, // USDT on Polygon has 6 decimals
                icon: "/USDT-BNBChain.svg",
                name: "USDT"                // Binance USDT icon
            },
            // Add more tokens if needed
        },
    },
    Base: {
        chain: base,
        chainId: 8453, // Base chain ID
        tokens: {
            USDC: {
                relayerUrl: "https://xion.engine-usw2.thirdweb.com/relayer/7c61e8b9-bfe5-4196-96b4-938e6957b199",
                useContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                spender: "0xa7fFB35C7f24cbf76C5e1B109e27Bb923D7054C3",
                decimals: 6, // USDT on Polygon has 6 decimals
                icon: "/USDT-Base.svg",
                name: "USDC"                // Base USDT icon
            },
            // Add more tokens if needed
        },
    },
    // Solana: {
    //     chain: Solana,
    //     chainId: null, // Solana does not have an EVM-compatible chain ID
    //     tokens: {
    //         USDT: {
    //             relayerUrl: "https://xion.engine-usw2.thirdweb.com/relayer/solana-usdt-relayer-url",
    //             useContract: "0xSolanaUSDTContractAddress",
    //             spender: "0xSolanaSpenderAddress",
    //             icon: "/USDT-Solana.svg" // Solana USDT icon
    //         },
    //         // Add more tokens if needed
    //     },
    // },
};

export default networkTokenMapping;