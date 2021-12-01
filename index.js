const BigNumber = require('bignumber.js');
const { cloneDeep } = require('lodash');

const pairABI = require('./data/SushiPairABI.json');
const arbitrageABI = require('./data/Arbitrage2ABI.json');
const erc20ABI = require('./data/ERC20ABI.json');
const factoryABI = require('./data/SushiFactoryABI.json');

const dexes = require('./data/dexes.json');
const consts = require('./data/consts.json');
const config = require('./data/config.json');
const tokens = require('./data/tokens.json');

const arbMath = require('./arbmath.js');
const extraMath = require('./extramath.js');
const { getWeb3 } = require('./web3provider.js');
const { getGasPriceDefault } = require('./gascalculator.js');
const { logtxn } = require('./dbhelper.js');
const { logger } = require('./logger.js');

const defaultFactoryAddress = "0xc35DADB65012eC5796536bD9864eD8773aBc74C4"
const wmaticAddress = consts.WMATIC;

//#region set up maps
const pairAddressToLatestHash = new Map();
pairAddressToLatestHashGet = (key) => pairAddressToLatestHash.has(key) ? pairAddressToLatestHash.get(key) : "0";

// readonly maps
const pairAddressToGroupId = new Map();
const pairAddressToDexData = new Map();
const factoryAddressToDexData = new Map();

// setup maps
Object.entries(dexes).forEach(([_, dexData]) => {
    factoryAddressToDexData.set(dexData.factory, dexData);
});
Object.entries(tokens).forEach(([id, tokenPairs]) => {
    tokenPairs.forEach((elem) => {
        pairAddressToGroupId.set(elem.pairAddress, id);
        pairAddressToDexData.set(elem.pairAddress, factoryAddressToDexData.get(elem.pairFactoryAddress));
    });
});

//#endregion


const evaluateAsMatic = async (tokenAddress, tokenAmount, web3) => {
    if (tokenAddress === wmaticAddress) {
        return tokenAmount;
    }
    try {
        const defaultFactoryContract = new web3.eth.Contract(factoryABI, defaultFactoryAddress);
        const tokenContract = new web3.eth.Contract(erc20ABI, tokenAddress);

        const decimals = await tokenContract.methods.decimals().call();
        const oneToken = (new BigNumber(10)).pow(new BigNumber(decimals.toString(10)));

        const wmaticTokenPairAddress = await defaultFactoryContract.methods.getPair(tokenAddress, wmaticAddress).call();
        const wmaticTokenPairContract = new web3.eth.Contract(pairABI, wmaticTokenPairAddress);

        const reserveData = await wmaticTokenPairContract.methods.getReserves().call();
        let [reserve0, reserve1] = [new BigNumber(reserveData._reserve0.toString(10)), new BigNumber(reserveData._reserve1.toString(10))];

        const token0 = await wmaticTokenPairContract.methods.token0().call();
        if (token0 !== tokenAddress) {
            [reserve0, reserve1] = [reserve1, reserve0];
        }

        const dexData = factoryAddressToDexData.get(defaultFactoryAddress);
        const [a, b] = [new BigNumber(dexData.a), new BigNumber(dexData.b)];

        const returnForOne = arbMath.getPoolReturn(reserve0, reserve1, oneToken, a, b);
        const humanTokenAmount = tokenAmount.div(oneToken);
        const returnForTokenAmount = extraMath.ceil(returnForOne.times(humanTokenAmount));
        return returnForTokenAmount;

    } catch(error) {
        logger.error(error, {meta:{msg:`index.js: Could not evaluate token as matic: ${tokenAddress}`}});
        throw error;
    }
}


const CheckArbOneWay = async ({pairData0, pairData1, pair0reserve0, pair0reserve1, pair1reserve0, pair1reserve1, gasPriceMin, now, senderAccount, web3}) => {
    const [token0, token1] = [pairData0.token0.address, pairData0.token1.address];
    const [pairAddress0, pairAddress1] = [pairData0.pairAddress, pairData1.pairAddress];
    const [pair0DexData, pair1DexData] = [pairAddressToDexData.get(pairAddress0), pairAddressToDexData.get(pairAddress1)];
    const [router0, router1] = [pair0DexData.router, pair1DexData.router];
    const [hash0, hash1] = [pairAddressToLatestHashGet(pairAddress0), pairAddressToLatestHashGet(pairAddress1)].map(cloneDeep);
    const [a0, b0, a1, b1] = [new BigNumber(pair0DexData.a), new BigNumber(pair0DexData.b), new BigNumber(pair1DexData.a), new BigNumber(pair1DexData.b)];
    const reserveData = {pairData0, pairData1, pair0reserve0, pair0reserve1, pair1reserve0, pair1reserve1};

    const optimalAmountBN = extraMath.ceil(arbMath.getOptimalAmount(
        pair0reserve0, 
        pair0reserve1,
        pair1reserve0,
        pair1reserve1,
        a0, b0,
        a1, b1
    ));

    const grossPayBN = extraMath.ceil(arbMath.getMaxArbReturn(
        pair0reserve0, 
        pair0reserve1,
        pair1reserve0,
        pair1reserve1,
        a0, b0,
        a1, b1
    ));

    const swap0ResultWeightedBN = extraMath.ceil(arbMath.getPoolReturn(
        pair0reserve0, 
        pair1reserve1,
        optimalAmountBN,
        a0, b0
    ).times(new BigNumber(consts.MIN_OUTPUT_FACOTR)));

    // max point of graph is left to x = 1
    if (optimalAmountBN.lt(1)) {
        return;
    }

    const grossProfitBN = grossPayBN.minus(optimalAmountBN);
    if (grossProfitBN.lt(new BigNumber(0))) {
        logger.warn(`index.js: Impossible oppurtunity slipped`, {meta: {args: reserveData}});
        return ;
    }

    try {
        const grossProfitAsWMATICBN = await evaluateAsMatic(token0, grossProfitBN, web3);

        // calculate what portion of profit goes towards gas price
        const gasPrecentBN = new BigNumber(consts.GAS_PRECENT);
        const totalGasPriceBN = extraMath.ceil(grossProfitAsWMATICBN.times(gasPrecentBN));
        const maxGasPriceBN = new BigNumber(consts.MAX_GAS_PRICE);
    
        if (totalGasPriceBN.gt(maxGasPriceBN)) {
            logger.debug('index.js: too risky gas price', {meta:{
                grossProfit: grossProfitBN.toString(10),
                gasPrecent: gasPrecentBN.toString(10)
            }});
            return;
        }

        const nonce = await web3.eth.getTransactionCount(senderAccount.address);
        const blockNumber = await web3.eth.getBlockNumber();
        const deadline = blockNumber + consts.DEADLINE;

        const arbContract = new web3.eth.Contract(arbitrageABI, config.CONTRACT_ADDRESS);
        const callData = {
            token0,
            token1,
            router0, 
            router1, 
            optimalAmount: optimalAmountBN.toString(10),
            swap0ResultWeighted: swap0ResultWeightedBN.toString(10),
            deadline
        }

        const rawArbTransactionData = arbContract.methods.doubleSwap(
            ...Object.values(callData)
        ).encodeABI();

        const preGasEstimateTransaction = {
            from: senderAccount.address,
            to: arbContract.options.address,
            data: rawArbTransactionData,
            nonce: nonce
        }

        web3.eth.estimateGas(preGasEstimateTransaction, (error, estimatedGas) => {
            if (error) {/*console.error(error);*/ return;}

            const estimatedGasBN = new BigNumber(estimatedGas);
            const gasBufferBN = new BigNumber(consts.GAS_OVERESTIMATE);
            const totalGasBN = extraMath.ceil(estimatedGasBN.times(gasBufferBN));  // gas limit
            const gasPriceBN = extraMath.ceil(totalGasPriceBN.div(totalGasBN));  // gas price per unit

            // gas price isnt big enough
            if (gasPriceBN.lt(gasPriceMin)) {
                return;
            }

            postGasEstimateTransaction = {
                from: senderAccount.address,
                to: arbContract.options.address,
                data: rawArbTransactionData,
                gas: totalGasBN.toString(10),
                gasPrice: gasPriceBN.toString(10),
                nonce: nonce
            }

            web3.eth.accounts.signTransaction(postGasEstimateTransaction, senderAccount.privateKey, (error, signedTxn) => {
                if (error) {logger.error(error, { meta: {msg: "index.js: Failed to sign arbitrage transaction", txn: postGasEstimateTransaction, args: reserveData}}); return;}

                const [latestHash0, latestHash1] = [pairAddressToLatestHashGet(pairAddress0), pairAddressToLatestHashGet(pairAddress1)];
                if ((latestHash0 !== hash0) || (latestHash1 !== hash1)) {
                    logger.info("index.js: Hashes Changed", {meta: {hash0, latestHash0, hash1, latestHash1}});
                    return;
                }

                const nowNow = Date.now();
                const delay = nowNow - now;
                if (delay >= consts.EXPIRY) {
                    logger.info("index.js: expired", {meta: {delay}});
                    return;
                }

                const arbTxn = web3.eth.sendSignedTransaction(signedTxn.rawTransaction);

                arbTxn
                    .on('transactionHash', (transactionHash) => {
                        logger.info(`index.js: transaction hash: ${transactionHash}`, {meta: {txn: postGasEstimateTransaction, args: reserveData}});
                        logtxn({
                            hash: transactionHash,
                            timestart: now,
                            blockNumber,
                            nonce,
                            call: JSON.stringify(callData),
                            reserve: JSON.stringify(reserveData)
                        });
                    })
                    .on('receipt', (transactionReceipt) => {
                        logger.info(transactionReceipt, {meta: {txn: postGasEstimateTransaction, args: reserveData}});
                    })
                    .on('confirmation', (confirmationNumber) => {
                        logger.info(`index.js: confirmation number: ${confirmationNumber}`, {meta: {txn: postGasEstimateTransaction, args: reserveData}});
                    })
                    .on('error', (error) => {
                        logger.error(error, {meta: {msg: "index.js: txn failed", txn: postGasEstimateTransaction, args: reserveData}});
                    });
            });
        });
    } catch (error) {
        logger.error(error, {meta: {msg: "index.js: failure in CheckArbOneWay"}});
    }
}


CheckArbBothWays = ({pairData0, pairData1, pair0reserve0, pair0reserve1, pair1reserve0, pair1reserve1, gasPriceMin, now, senderAccount, web3}) => {
    CheckArbOneWay({pairData0, pairData1, pair0reserve0, pair0reserve1, pair1reserve0, pair1reserve1, gasPriceMin, now, senderAccount, web3});
    CheckArbOneWay({pairData1, pairData0, pair1reserve0, pair1reserve1, pair0reserve0, pair0reserve1, gasPriceMin, now, senderAccount, web3});
}


const main = async () => {
    try {
        const web3 = await getWeb3();
        const senderAccount = web3.eth.accounts.privateKeyToAccount(config.PRIVATE_KEY);
        
        //#region gas price clock

        // create a clock such that every consts.GASPRICE_THROTTLE ms it updates 
        // the minGasPrice

        let cachedGasPrice = await getGasPriceDefault(web3);
        setInterval(() => {
            getGasPriceDefault(web3)
                .then((newGasPrice) => {
                    cachedGasPrice = newGasPrice
                })
                .catch((error) => {
                    logger.error(error, {meta: {msg: "could not get new gas price"}});
                    cachedGasPrice = (new BigNumber(1)).div(0);  // set cached gas price to infinity so CheckArbOneWay will always fail
                });
        }, consts.GASPRICE_THROTTLE);
        //#endregion

        web3.eth.subscribe('logs', {
            address: Array.from(pairAddressToGroupId.keys()), 
            topics: ['0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1']  // signature of sync event
        }, (error, syncEvent) => {
            const now = Date.now();
            if (error) {
                logger.error(error, {meta: {msg: 'index.js: Error trying to recieve log info'}});
                return;
            }

            const pairAddress = syncEvent.address;
            if (!(pairAddressToGroupId.has(pairAddress) && !syncEvent.removed)) {
                logger.error("index.js: Invalid pairAddress / removed", {meta: {pairAddress, removed: syncEvent.removed}});
                return;
            }

            pairAddressToLatestHash.set(pairAddress, syncEvent.transactionHash);

            const groupId = pairAddressToGroupId.get(pairAddress);
            const otherPairDatasInGroup = tokens[groupId].filter(elem => elem.pairAddress !== pairAddress);  // all pair contracts in group except the one that recieved the sync event
            const pairData = tokens[groupId].filter(elem => elem.pairAddress === pairAddress)[0];

            // parse reserve data from log and update
            const [reserve0, reserve1] = syncEvent.data.slice(2).match(/.{1,64}/g).map(hex => new BigNumber(hex, 16));

            otherPairDatasInGroup.forEach((otherPairData) => {
                // here calculate arbitrage profitability, if profitable handle sending transactions
                const otherPairContract = new web3.eth.Contract(pairABI, otherPairData.pairAddress);
                    otherPairContract.methods.getReserves().call((error, reserveData) => {
                    if (!error && reserveData._reserve0 && reserveData._reserve1) {
                        // convert BN to BigNumber
                        const [otherReserve0, otherReserve1] = [new BigNumber(reserveData._reserve0.toString(10)), new BigNumber(reserveData._reserve1.toString(10))];
                        CheckArbBothWays({
                            pairData0: pairData,
                            pairData1: otherPairData,
                            pair0reserve0: reserve0,
                            pair0reserve1: reserve1,
                            pair1reserve0: otherReserve0,
                            pair1reserve1: otherReserve1,
                            gasPriceMin: cachedGasPrice,
                            now,
                            senderAccount,
                            web3
                        });
                    }
                    else {
                        logger.error(error, {meta: {msg: "index.js: Could not get reserves of other pair contract"}});
                    }
                });
            });
        });
    } catch (error) {
        logger.error(error, {meta: {msg: "index.js: Could not start main"}});
    }
}

main();
