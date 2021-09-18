const Web3 = require('web3');
const BN = require('bn.js');

const pairABI = require('./data/SushiPairABI.json'); 
const dexes = require('./data/dexes.json');
const config = require('./data/config.json');
const tokens = require('./data/tokens.json');

const web3 = new Web3(config.MORALIS_WSS);

const Main = () => {
    const pairAddressToGroupId = new Map();
    const groupIdToLock = new Map();
    Object.entries(tokens).forEach(([id, tokenPairs]) => {
        groupIdToLock.set(id, 0);
        tokenPairs.forEach((elem) => {
            pairAddressToGroupId.set(elem.pairAddress, id);
        })
    });
    const pairAddresses = Array.from(pairAddressToGroupId.keys());

    const getPairContractData = (pairAddress) => {
        for (pairContractData of tokens[pairAddressToGroupId.get(pairAddress)]) {
            if (pairContractData.pairAddress === pairAddress) {
                return pairContractData;
            }
        }
    }

    const subscription = web3.eth.subscribe('logs', {
        address: pairAddresses, 
        topics: ['0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1']
    }, (error, result) => {
        if (!error) {
            if (pairAddressToGroupId.has(result.address)) {
                // parse data from log
                const [reserve0, reserve1] = result.data.slice(2).match(/.{1,64}/g).map(hex => new BN(hex, 16));
                console.log(`tx hash: ${result.transactionHash}`);
                console.log(`reserve0: ${reserve0} reserve1: ${reserve1}`);
            }
        }
        else {
            console.log(error);
        }
    })
}

Main();
