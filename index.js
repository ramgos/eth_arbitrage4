const Web3 = require('web3');
const BigNumber = require('bignumber.js');

const pairABI = require('./data/SushiPairABI.json');
const dexes = require('./data/dexes.json');
const consts = require('./data/consts.json');
const config = require('./data/config.json');
const tokens = require('./data/tokens.json');

const arbMath = require('./arbmath.js');
const extraMath = require('./extramath.js');

const web3 = new Web3(config.WSS_RPC);
const primaryToken = consts.WMATIC;


const ReservePairData = (originalPairData) => {
    return {
        hasReserveData: false,

        pairAddress: originalPairData.pairAddress,
        latestHash: 0,
        token0: originalPairData.token0,
        token1: originalPairData.token1,
        reserve0: new BigNumber(0),
        reserve1: new BigNumber(0),
    };
}


// like ReservePairData but token0, reserve0 is primaryToken, and token1, reserve1 is other token
const VirtualReservePairData = (reservePairData) => {
    if (reservePairData.token0.address === primaryToken) {
        return reservePairData;
    }
    else {
        return {
            ...reservePairData,
            token0: reservePairData.token1,
            token1: reservePairData.token0,
            reserve0: reservePairData.reserve1,
            reserve1: reservePairData.reserve0,
        };
    }
}


// update reserve data in map
const UpdatePairReservesData = (pairAddress, latestHash, reserve0, reserve1, token0, token1) => {
    pairAddressToLatestHash.set(pairAddress, latestHash);
    pairAddressToReserveData.set(pairAddress, {
        hasReserveData: true,

        pairAddress,
        latestHash,
        reserve0,
        reserve1,
        token0,
        token1,
    });
}

//#region set up maps

const pairAddressToLatestHash = new Map();
const pairAddressToGroupId = new Map();
const pairAddressToData = new Map();
const pairAddressToReserveData = new Map();  // save data about reserves for each pair contract
const pairAddressToDexData = new Map();
const factoryAddressToDexData = new Map();

// setup maps
Object.entries(dexes).forEach(([dexName, dexData]) => {
    factoryAddressToDexData.set(dexData.factory, dexData);
});
Object.entries(tokens).forEach(([id, tokenPairs]) => {
    tokenPairs.forEach((elem) => {
        pairAddressToGroupId.set(elem.pairAddress, id);
        pairAddressToData.set(elem.pairAddress, elem);
        pairAddressToReserveData.set(elem.pairAddress, ReservePairData(elem));
        pairAddressToDexData.set(elem.pairAddress, factoryAddressToDexData.get(elem.pairFactoryAddress));
    });
});

//#endregion

// check if profit, send transaction if yes
const CheckArbOneWay = (pairAddress0, pairAddress1, startTimestamp) => {
    const vPairReserveData0 = VirtualReservePairData(pairAddressToReserveData.get(pairAddress0));
    const vPairReserveData1 = VirtualReservePairData(pairAddressToReserveData.get(pairAddress1));

    const vPair0DexData = pairAddressToDexData.get(pairAddress0);
    const vPair1DexData = pairAddressToDexData.get(pairAddress1);

    const [a0, b0, a1, b1] = [new BigNumber(vPair0DexData.a), new BigNumber(vPair0DexData.b), new BigNumber(vPair1DexData.a), new BigNumber(vPair1DexData.b)];

    const optimalAmount = extraMath.ceil(arbMath.getOptimalAmount(
        vPairReserveData0.reserve0, 
        vPairReserveData0.reserve1,
        vPairReserveData1.reserve0,
        vPairReserveData1.reserve1,
        a0, b0,
        a1, b1
    ));

    const grosspay = extraMath.ceil(arbMath.getMaxArbReturn(
        vPairReserveData0.reserve0, 
        vPairReserveData0.reserve1,
        vPairReserveData1.reserve0,
        vPairReserveData1.reserve1,
        a0, b0,
        a1, b1
    ));

    if (optimalAmount.isGreaterThanOrEqualTo(new BigNumber(1))) {
        const args = {
            amount: optimalAmount.toString(10),
            grosspay: grosspay.toString(10),
            token0: vPairReserveData0.token0.address,
            token1: vPairReserveData0.token1.address,
            pairAddress0: pairAddress0,
            pairAddress1: pairAddress1,
            pairAddress0Hash: vPairReserveData0.latestHash,
            pairAddress1Hash: vPairReserveData1.latestHash,
            router0: pairAddressToDexData.get(pairAddress0).router,
            router1: pairAddressToDexData.get(pairAddress1).router,
            dexName0: pairAddressToDexData.get(pairAddress0).name,
            dexName1: pairAddressToDexData.get(pairAddress1).name,
            timestamp: startTimestamp,
        };

        console.log(args);
    }
}


// check arb opportuinites whenever a swap happens in any one of the dex contracts
web3.eth.subscribe('logs', {
    address: Array.from(pairAddressToGroupId.keys()), 
    topics: ['0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1']  // signature of sync event
}, (error, syncEvent) => {
    const now = Date.now();

    if (!error) {
        const pairAddress = syncEvent.address;

        if (pairAddressToGroupId.has(pairAddress) && !syncEvent.removed) {
            const groupId = pairAddressToGroupId.get(pairAddress);
            const otherPairDatasInGroup = tokens[groupId].filter(elem => elem.pairAddress !== pairAddress);  // all pair contracts in group except the one that recieved the sync event
            const pairData = tokens[groupId].filter(elem => elem.pairAddress === pairAddress)[0];

            // parse reserve data from log and update
            const [reserve0, reserve1] = syncEvent.data.slice(2).match(/.{1,64}/g).map(hex => new BigNumber(hex, 16));
            UpdatePairReservesData(pairAddress, syncEvent.transactionHash, reserve0, reserve1, pairData.token0, pairData.token1);

            // 'otherPairData' is pair data from tokens.json, and 'otherPairReserveData is in format of ReservePairData'
            otherPairDatasInGroup.forEach((otherPairData) => {
                const otherPairAddress = otherPairData.pairAddress;
                const otherPairReserveData = pairAddressToReserveData.get(otherPairAddress);

                // here calculate arbitrage profitability, if profitable handle sending transactions

                if (otherPairReserveData.hasReserveData === false) {
                    // if other pair doens't have reserve data, fetch and calculate

                    const otherPairContract = new web3.eth.Contract(pairABI, otherPairData.pairAddress);
                    otherPairContract.methods.getReserves().call((error, reserveData) => {
                        if (!error && reserveData._reserve0 && reserveData._reserve1) {
                            // convert BN to BigNumber and update reserve data

                            const [otherReserve0, otherReserve1] = [new BigNumber(reserveData._reserve0.toString()), new BigNumber(reserveData._reserve1.toString())];
                            UpdatePairReservesData(otherPairAddress, '0', otherReserve0, otherReserve1, otherPairData.token0, otherPairData.token1);
                        }
                        else {
                            console.log(error);
                        }
                    });
                }

                CheckArbOneWay(pairAddress, otherPairAddress, now),
                CheckArbOneWay(otherPairAddress, pairAddress, now)
            });
        }
    }
    else {
        console.log(error);
    }
});