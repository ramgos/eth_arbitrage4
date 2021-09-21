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

// right now no support for different fees amongst uniswap dexes


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
            hasReserveData: reservePairData.hasReserveData,

            pairAddress: reservePairData.pairAddress,
            latestHash: reservePairData.latestHash,
            token0: reservePairData.token1,
            token1: reservePairData.token0,
            reserve0: reservePairData.reserve1,
            reserve1: reservePairData.reserve0,
        };
    }
}


const Main = () => {
    const pairAddressToGroupId = new Map();
    const pairAddressToData = new Map();
    const pairAddressToReserveData = new Map();  // save data about reserves for each pair contract
    const factoryAddressToDexData = new Map();

    // setup maps
    Object.entries(tokens).forEach(([id, tokenPairs]) => {
        tokenPairs.forEach((elem) => {
            pairAddressToGroupId.set(elem.pairAddress, id);
            pairAddressToData.set(elem.pairAddress, elem);
            pairAddressToReserveData.set(elem.pairAddress, ReservePairData(elem));
        });
    });
    Object.entries(dexes).forEach(([dexName, dexData]) => {
        factoryAddressToDexData.set(dexData.factory, dexData);
    });
    const pairAddresses = Array.from(pairAddressToGroupId.keys());


    // update reserve data in map
    const UpdatePairReservesData = (pairAddress, latestHash, reserve0, reserve1, token0, token1) => {
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


    const CheckArbOneWay = (pairAddress0, pairAddress1) => {
        const vPairReserveData0 = VirtualReservePairData(pairAddressToReserveData.get(pairAddress0));
        const vPairReserveData1 = VirtualReservePairData(pairAddressToReserveData.get(pairAddress1));

        const optimalAmount = extraMath.ceil(arbMath.getOptimalAmount(
            vPairReserveData0.reserve0, 
            vPairReserveData0.reserve1,
            vPairReserveData1.reserve0,
            vPairReserveData1.reserve1
        ));

        if (optimalAmount.isGreaterThanOrEqualTo(new BigNumber(1))) {
            console.log('profit found!');
            console.log(`amount: ${optimalAmount.shiftedBy(-18).toString()}`);
            console.log(`token to: ${vPairReserveData0.token1.symbol}`);
            console.log(`dex from: ${factoryAddressToDexData.get(pairAddressToData.get(pairAddress0).pairFactoryAddress).name}`);
            console.log(`dex to: ${factoryAddressToDexData.get(pairAddressToData.get(pairAddress1).pairFactoryAddress).name}`);
            console.log();
        }
    }


    // main
    web3.eth.subscribe('logs', {
        address: pairAddresses, 
        topics: ['0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1']  // signature of sync event
    }, (error, syncEvent) => {
        if (!error) {
            const pairAddress = syncEvent.address;

            if (pairAddressToGroupId.has(pairAddress) && !syncEvent.removed) {
                const groupId = pairAddressToGroupId.get(pairAddress);
                const otherPairDatasInGroup = tokens[groupId].filter(elem => elem.pairAddress !== pairAddress);  // all pair contracts in group except the one that recieved the sync event
                const pairData = tokens[groupId].filter(elem => elem.pairAddress === pairAddress)[0];

                // parse reserve data from log and update
                const [reserve0, reserve1] = syncEvent.data.slice(2).match(/.{1,64}/g).map(hex => new BigNumber(hex, 16));
                UpdatePairReservesData(pairAddress, syncEvent.transactionHash, reserve0, reserve1, pairData.token0, pairData.token1);

                /*
                uncomment to test whether recieved data is actual reserve data

                const pairContract = new web3.eth.Contract(pairABI, pairAddress);
                pairContract.methods.getReserves().call((error, data) => {
                    console.log([data._reserve0.toString(), data._reserve1.toString()]);
                    console.log([reserve0.toString(10), reserve1.toString(10)]);
                    console.log();
                });
                */

                // 'otherPairData' is pair data from tokens.json, and 'otherPairReserveData is in format of ReservePairData'
                otherPairDatasInGroup.forEach((otherPairData) => {
                    const otherPairAddress = otherPairData.pairAddress;
                    const otherPairReserveData = pairAddressToReserveData.get(otherPairAddress);

                    // here calculate arbitrage profitability, if profitable append to queue and let different process handle sending transactions

                    if (otherPairReserveData.hasReserveData === false) {
                        // if other pair doens't have reserve data, fetch and calculate

                        const otherPairContract = new web3.eth.Contract(pairABI, otherPairData.pairAddress);
                        otherPairContract.methods.getReserves().call((error, reserveData) => {
                            if (!error && reserveData._reserve0 && reserveData._reserve1) {
                                // convert BN to BigNumber and update reserve data

                                const [otherReserve0, otherReserve1] = [new BigNumber(reserveData._reserve0.toString()), new BigNumber(reserveData._reserve1.toString())];
                                UpdatePairReservesData(otherPairAddress, 0, otherReserve0, otherReserve1, otherPairData.token0, otherPairData.token1);
                                
                                CheckArbOneWay(pairAddress, otherPairAddress);
                                CheckArbOneWay(otherPairAddress, pairAddress);
                            }
                            else {
                                console.log(error);
                            }
                        });
                    }
                    else {
                        CheckArbOneWay(pairAddress, otherPairAddress);
                        CheckArbOneWay(otherPairAddress, pairAddress);
                    }
                });
            }
        }
        else {
            console.log(error);
        }
    });
}

Main();
