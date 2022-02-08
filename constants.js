const networks = {
    reef_testnet: {
        rpc: 'wss://rpc-testnet.reefscan.com/ws',
        contracts: {
            marketplace: '0xb4a9E2655c52a523711966cd0804df697fB71A47',
            erc1155: '0x5646C5AE729b456a164414CdA57CDF41074A5478',
            utility: '0xc857bb5C1D062c465a1B3Cf8af19635cC3B8e1Bc'
        }
    },
    reef_mainnet: {
        rpc: 'wss://rpc.reefscan.com/ws',
        contracts: {
            marketplace: '',
            erc1155: '',
        }
    }
}

module.exports = {
    networks,
    defaultNetwork: 'reef_testnet'
}