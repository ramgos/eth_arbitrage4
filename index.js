const Web3 = require('web3');
const BN = require('bn.js');

const pairABI = require('./data/SushiPairABI.json'); 
const dexes = require('./data/dexes.json');
const config = require('./data/config.json');
const tokens = require('./data/tokens.json');

const web3 = new Web3(config.MORALIS_WSS);


const ReservePairData = (originalPairData) => {
    return {
        hasReserveData: false,

        pairAddress: originalPairData.pairAddress,
        latestHash: 0,
        token0: originalPairData.token0,
        token1: originalPairData.token1,
        reserve0: new BN(0),
        reserve1: new BN(0),
    };
}


const Main = () => {
    const pairAddressToGroupId = new Map();
    const pairAddressToReservePairData = new Map();  // save data about reserves for each pair contract
    const groupIdToLock = new Map();  // lock groups if they are calculating

    // setup maps
    Object.entries(tokens).forEach(([id, tokenPairs]) => {
        groupIdToLock.set(id, 0);
        tokenPairs.forEach((elem) => {
            pairAddressToGroupId.set(elem.pairAddress, id);
            pairAddressToReservePairData.set(elem.pairAddress, ReservePairData(elem));
        });
    });
    const pairAddresses = Array.from(pairAddressToGroupId.keys());


    // update reserve data in map
    const updatePairReservesData = (pairAddress, latestHash, reserve0, reserve1) => {
        pairAddressToReservePairData.get(pairAddress).hasReserveData = true;
        pairAddressToReservePairData.get(pairAddress).latestHash = latestHash;
        pairAddressToReservePairData.get(pairAddress).reserve0 = reserve0;
        pairAddressToReservePairData.get(pairAddress).reserve1 = reserve1;
    }


    // main
    const subscription = web3.eth.subscribe('logs', {
        address: pairAddresses, 
        topics: ['0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1']  // signature of sync event
    }, (error, result) => {
        if (!error) {
            const pairAddress = result.address;
            if (pairAddressToGroupId.has(pairAddress) && !result.removed) {
                // parse reserve data from log and update
                const [reserve0, reserve1] = result.data.slice(2).match(/.{1,64}/g).map(hex => new BN(hex, 16));
                updatePairReservesData(pairAddress, result.transactionHash, reserve0, reserve1);

                const groupId = pairAddressToGroupId.get(pairAddress);
                const otherPairContractsInGroup = tokens[groupId].filter(elem => elem.pairAddress !== pairAddress);  // all pair contracts in group except the one that recieved the sync event
                otherPairContractsInGroup.forEach((otherPair) => {
                    const otherPairReserveData = pairAddressToReservePairData.get(otherPair.pairAddress);
                    const eventPairReserveData = pairAddressToReservePairData.get(pairAddress);

                    // here calculate arbitrage profitability, if profitable append to queue and let different process handle sending transactions
                    
                    console.log(otherPair.pairAddress);
                    console.log(pairAddress);
                })
                console.log();
            }
        }
        else {
            console.log(error);
        }
    })
}

Main();
