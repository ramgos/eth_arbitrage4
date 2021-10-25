const Web3 = require('web3');
const BigNumber = require('bignumber.js');
const redis = require('redis');
const redisClient = redis.createClient({
    host: '127.0.0.1',
    port: 6379
});

const {Queue, Worker} = require('node-resque');

const pairABI = require('./data/SushiPairABI.json');
const dexes = require('./data/dexes.json');
const consts = require('./data/consts.json');
const config = require('./data/config.json');
const tokens = require('./data/tokens.json');

const arbMath = require('./arbmath.js');
const extraMath = require('./extramath.js');

const web3 = new Web3(config.WSS_RPC);
const primaryToken = consts.WMATIC;

const {connectionDetails, queueName} = require('./nodeResqueConfig.js');

const pairAddressToLatestHash = new Map();


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


const Main = async () => {
    // arb sender code
    const jobs = {
        arb: {
            perform: async ({
                amount,
                grosspay,
                token0,
                token1,
                pairAddress0,
                pairAddress0Hash,
                pairAddress1,
                pairAddress1Hash,
                router0,
                router1,
                dexName0,
                dexName1,
                timestamp
            }) => {
                
                const now = Date.now();
                if (now - timestamp > consts.EXPIRY) {
                    console.log(`old: ${now - timestamp}`);
                    return;
                } 
                
                const latestHash0 = pairAddressToLatestHash.has(pairAddress0) ? pairAddressToLatestHash.get(pairAddress0) : '0';
                const latestHash1 = pairAddressToLatestHash.has(pairAddress1) ? pairAddressToLatestHash.get(pairAddress1) : '0';

                if (latestHash0 === pairAddress0Hash && latestHash1 === pairAddress1Hash) {
                    console.log("hashes are valid");
                    console.log({
                        amount,
                        grosspay,
                        token0,
                        token1,
                        pairAddress0,
                        pairAddress0Hash,
                        pairAddress1,
                        pairAddress1Hash,
                        router0,
                        router1,
                        dexName0,
                        dexName1,
                        timestamp
                    });
                }
                else {
                    console.log("hashes have updated");
                }

                console.log(`time passed: ${Date.now() - now}`);
            }
        }
    }

    const worker = new Worker(
        { connection: connectionDetails, queues: [queueName] },
        jobs
    );

    await worker.connect();
    worker.start();
    
    worker.on("failure", (queue, job, failure, duration) => {
        console.log(failure);
    });
    worker.on("error", (error) => {
        console.log(error);
    });

    // setup queue

    const queue = new Queue({ connection: connectionDetails }, jobs);
    queue.on("error", function (error) {
        console.log(error);
    });
    await queue.connect();

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


    // update reserve data in map
    const UpdatePairReservesData = async (pairAddress, latestHash, reserve0, reserve1, token0, token1) => {
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


    // check if profit, if yes append to queue
    const CheckArbOneWay = async (pairAddress0, pairAddress1) => {
        const vPairReserveData0 = VirtualReservePairData(pairAddressToReserveData.get(pairAddress0));
        const vPairReserveData1 = VirtualReservePairData(pairAddressToReserveData.get(pairAddress1));

        const vPair0DexData = pairAddressToDexData.get(pairAddress0);
        const vPair1DexData = pairAddressToDexData.get(pairAddress1);

        const optimalAmount = extraMath.ceil(arbMath.getOptimalAmount(
            vPairReserveData0.reserve0, 
            vPairReserveData0.reserve1,
            vPairReserveData1.reserve0,
            vPairReserveData1.reserve1,
            new BigNumber(vPair0DexData.a),
            new BigNumber(vPair0DexData.b),
            new BigNumber(vPair1DexData.a),
            new BigNumber(vPair1DexData.b)
        ));

        const grosspay = extraMath.ceil(arbMath.getMaxArbReturn(
            vPairReserveData0.reserve0, 
            vPairReserveData0.reserve1,
            vPairReserveData1.reserve0,
            vPairReserveData1.reserve1,
            new BigNumber(vPair0DexData.a),
            new BigNumber(vPair0DexData.b),
            new BigNumber(vPair1DexData.a),
            new BigNumber(vPair1DexData.b)
        ));

        if (optimalAmount.isGreaterThanOrEqualTo(new BigNumber(1))) {
            await queue.enqueue(queueName, 'arb', [{
                amount: optimalAmount.toString(10),
                grosspay: grosspay,
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
                timestamp: Date.now()
            }]);
        }
    }


    // check arb opportuinites whenever a swap happens in any one of the dex contracts
    web3.eth.subscribe('logs', {
        address: Array.from(pairAddressToGroupId.keys()), 
        topics: ['0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1']  // signature of sync event
    }, async (error, syncEvent) => {
        if (!error) {
            const pairAddress = syncEvent.address;

            if (pairAddressToGroupId.has(pairAddress) && !syncEvent.removed) {
                const groupId = pairAddressToGroupId.get(pairAddress);
                const otherPairDatasInGroup = tokens[groupId].filter(elem => elem.pairAddress !== pairAddress);  // all pair contracts in group except the one that recieved the sync event
                const pairData = tokens[groupId].filter(elem => elem.pairAddress === pairAddress)[0];

                // parse reserve data from log and update
                const [reserve0, reserve1] = syncEvent.data.slice(2).match(/.{1,64}/g).map(hex => new BigNumber(hex, 16));
                await UpdatePairReservesData(pairAddress, syncEvent.transactionHash, reserve0, reserve1, pairData.token0, pairData.token1);

                // 'otherPairData' is pair data from tokens.json, and 'otherPairReserveData is in format of ReservePairData'
                otherPairDatasInGroup.forEach(async (otherPairData) => {
                    const otherPairAddress = otherPairData.pairAddress;
                    const otherPairReserveData = pairAddressToReserveData.get(otherPairAddress);

                    // here calculate arbitrage profitability, if profitable append to queue and let different process handle sending transactions

                    if (otherPairReserveData.hasReserveData === false) {
                        // if other pair doens't have reserve data, fetch and calculate

                        const otherPairContract = new web3.eth.Contract(pairABI, otherPairData.pairAddress);
                        otherPairContract.methods.getReserves().call(async (error, reserveData) => {
                            if (!error && reserveData._reserve0 && reserveData._reserve1) {
                                // convert BN to BigNumber and update reserve data

                                const [otherReserve0, otherReserve1] = [new BigNumber(reserveData._reserve0.toString()), new BigNumber(reserveData._reserve1.toString())];
                                await UpdatePairReservesData(otherPairAddress, '0', otherReserve0, otherReserve1, otherPairData.token0, otherPairData.token1);
                                
                                await Promise.all([
                                    CheckArbOneWay(pairAddress, otherPairAddress),
                                    CheckArbOneWay(otherPairAddress, pairAddress)
                                ]);
                            }
                            else {
                                console.log(error);
                            }
                        });
                    }
                    else {
                        await Promise.all([
                            CheckArbOneWay(pairAddress, otherPairAddress),
                            CheckArbOneWay(otherPairAddress, pairAddress)
                        ]);
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
