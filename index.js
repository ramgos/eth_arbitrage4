const Web3 = require('web3');
const BigNumber = require('bignumber.js');
const { cloneDeep } = require('lodash');

const pairABI = require('./data/SushiPairABI.json');
const arbitrageABI = require('./data/Arbitrage2ABI.json');
const erc20ABI = require('./data/ERC20ABI.json');

const dexes = require('./data/dexes.json');
const consts = require('./data/consts.json');
const config = require('./data/config.json');
const tokens = require('./data/tokens.json');

const arbMath = require('./arbmath.js');
const extraMath = require('./extramath.js');
const { getWeb3 } = require('./web3provider.js');
const { GasPriceProvider } = require('./gascalculator');
const { logger } = require('./logger.js');

const primaryToken = consts.WMATIC;
const gasPriceProvider = new GasPriceProvider();


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
const CheckArbOneWay = (pairAddress0, pairAddress1, startTimestamp, web3, senderAccount) => {
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

    const grossPay = extraMath.ceil(arbMath.getMaxArbReturn(
        vPairReserveData0.reserve0, 
        vPairReserveData0.reserve1,
        vPairReserveData1.reserve0,
        vPairReserveData1.reserve1,
        a0, b0,
        a1, b1
    ));

    const swap0ResultWeighted = extraMath.ceil(arbMath.getPoolReturn(
        vPairReserveData0.reserve0, 
        vPairReserveData0.reserve1,
        optimalAmount,
        a0, b0
    ).times(new BigNumber(consts.MIN_OUTPUT_FACOTR)));

    if (optimalAmount.isGreaterThanOrEqualTo(new BigNumber(1))) {
        // use clonedeep so data doesn't reference map values
        const args = cloneDeep({
            amount: optimalAmount.toString(10),
            grossPay: grossPay.toString(10),
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
        });

        // check that there is enought input token in arbitrage contract
        const inputTokenContract = new web3.eth.Contract(erc20ABI, args.token0);
        inputTokenContract.methods.balanceOf(config.CONTRACT_ADDRESS).call((error, inputTokenBalance) => {
            if (error) { logger.error(error, {args: {args, errcode: 7}}); return; }
            
            const inputTokenBalanceBN = new BigNumber(inputTokenBalance.toString(10));  // convert BN to BigNumber
            const gasPrecentBN = new BigNumber(consts.GAS_PRECENT);
            const grossProfitBN = (new BigNumber(args.grossPay)).minus(args.amount);

            if (grossProfitBN.lt(new BigNumber(0))) {
                logger.warn(`impossible oppurtunity slipped`, {args});
                return ;
            }

            // calculate what portion of profit goes towards gas price
            const totalGasPriceBN = extraMath.ceil(grossProfitBN.times(gasPrecentBN));

            if (totalGasPriceBN.gt(new BigNumber(consts.MAX_GAS_PRICE))) {
                logger.debug('too risky gas price', {
                    args,
                    grossProfit: grossProfitBN.toString(10),
                    gasPrecent: gasPrecentBN.toString(10)
                });
                return;
            }

            // check if has enough balance to make transaction
            if ((new BigNumber(args.amount)).lte(inputTokenBalanceBN)) {
                const arbContract = new web3.eth.Contract(arbitrageABI, config.CONTRACT_ADDRESS);
                // get nonce
                web3.eth.getTransactionCount(senderAccount.address, (error, nonce) => {
                    if (error) { logger.error(error, {args: {args, errcode: 6}}); return; }
                    // estimate gas price
                    gasPriceProvider.getGasPrice((acceptableGasPrice) => {
                        const deadline = Math.floor(Date.now() / 1000) + consts.DEADLINE;
                        const rawArbTransactionData = arbContract.methods.doubleSwap(
                                args.token0,
                                args.token1,
                                args.router0, 
                                args.router1, 
                                args.amount,
                                swap0ResultWeighted,
                                deadline
                            ).encodeABI();
                        
                        const preGasEstimateTransaction = {
                            from: senderAccount.address,
                            to: arbContract.options.address,
                            data: rawArbTransactionData,
                            nonce: nonce
                        }

                        // estimate gas unit count
                        web3.eth.estimateGas(preGasEstimateTransaction, (error, estimatedGas) => {
                            if (error) { /*logger.error(error);*/ return; }  // supposed to fail - gas estimation serves as check that transaction is feasiable

                            const estimatedGasBN = new BigNumber(estimatedGas);
                            const gasBufferBN = new BigNumber(consts.GAS_OVERESTIMATE);
                            const acceptableGasPriceBN = new BigNumber(acceptableGasPrice.toString(10));  // convert from BN to BigNumber
                            const totalGasBN = extraMath.ceil(estimatedGasBN.times(gasBufferBN));  // gas limit
                            const gasPriceBN = extraMath.floor(totalGasPriceBN.div(totalGasBN));  // gas price per unit

                            if (gasPriceBN.gte(acceptableGasPriceBN)) {
                                postGasEstimateTransaction = {
                                    from: senderAccount.address,
                                    to: arbContract.options.address,
                                    data: rawArbTransactionData,
                                    gas: totalGasBN.toString(10),
                                    gasPrice: gasPriceBN.toString(10),
                                    nonce: nonce
                                }

                                web3.eth.accounts.signTransaction(postGasEstimateTransaction, senderAccount.privateKey, (error, signedTxn) => {
                                    if (error) { logger.error(error, {args: {args, errcode: 5}}); return; }
                                    const pairAddress0LatestHash = pairAddressToLatestHash.get(args.pairAddress0);
                                    const pairAddress1LatestHash = pairAddressToLatestHash.get(args.pairAddress1);

                                    if (pairAddress0LatestHash === args.pairAddress0Hash && pairAddress1LatestHash === args.pairAddress1Hash) {
                                        const now = Date.now()
                                        const delay = now - args.timestamp;
                                        if (delay > consts.EXPIRY) {
                                            logger.warn(`too slow: ${delay}`, {args});
                                        }
                                        else {

                                            let cancelledOrCompleted = false;

                                            const arbTxn = web3.eth.sendSignedTransaction(signedTxn.rawTransaction);

                                            arbTxn.on('transactionHash', (transactionHash) => {
                                                logger.info(`transaction hash: ${transactionHash}`, {args});
                                                const checks = consts.CHECKS;
                                                const checkingDelay = consts.CHECKING_DELAY;

                                                // send empty tx with higher gas price
                                                const cancelGasPriceFactor = new BigNumber(consts.CANCEL_GASPRICE);
                                                const cancelGasPrice = extraMath.ceil(gasPriceBN.times(cancelGasPriceFactor));

                                                for (let i = 0; i < checks; i ++) {
                                                    // check 'checks' time whether transaction should be cancelled
                                                    setTimeout(() => {
                                                        if (cancelledOrCompleted) {
                                                            return;
                                                        }
                                                        web3.eth.estimateGas(postGasEstimateTransaction, (error) => {
                                                            if (error) {
                                                                logger.info(`cancelling transaction ${transactionHash}`, {args:{args, errcode: 8}});
                                                                cancelledOrCompleted = true;

                                                                const cancelTxn = {
                                                                    from: senderAccount.address,
                                                                    to: senderAccount.address,
                                                                    gas: "21000",
                                                                    gasPrice: cancelGasPrice.toString(10),
                                                                    value: "0",
                                                                    nonce: nonce
                                                                }

                                                                web3.eth.accounts.signTransaction(cancelTxn, senderAccount.privateKey, (error, signedCanceled) => {
                                                                    if (error) { logger.error(error, {args: {args, errcode: 4}}); return; }
                                                                    web3.eth.sendSignedTransaction(signedCanceled);
                                                                });
                                                            }
                                                        });
                                                    }, checkingDelay * (i + 1));
                                                }})
                                                .on('receipt', (transactionReceipt) => {
                                                    logger.info(transactionReceipt);
                                                })
                                                .on('confirmation', (confirmationNumber) => {
                                                    logger.info(`confirmation number: ${confirmationNumber}`);
                                                })
                                                .on('error', (error) => {
                                                    logger.error(error, {errcode: 3});
                                                });
                                        }
                                    }
                                    else {
                                        logger.warn('hashes changed', {args: {
                                            args, 
                                            hash0Now: pairAddress0LatestHash,
                                            hash1Now: pairAddress1LatestHash,
                                            hash0Then: args.pairAddress0Hash,
                                            hash1Then: args.pairAddress1Hash
                                        }});
                                    }
                                });
                            }
                        });
                    });
                }); 
            }
        });
    }
}


// check arb opportuinites whenever a swap happens in any one of the dex contracts

getWeb3()
    .then((web3) => {
        const senderAccount = web3.eth.accounts.privateKeyToAccount(config.PRIVATE_KEY);

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
        
                                    const [otherReserve0, otherReserve1] = [new BigNumber(reserveData._reserve0.toString(10)), new BigNumber(reserveData._reserve1.toString(10))];
                                    UpdatePairReservesData(otherPairAddress, '0', otherReserve0, otherReserve1, otherPairData.token0, otherPairData.token1);
                                }
                                else {
                                    logger.error(error, {errcode: 2});
                                }
                            });
                        }
        
                        CheckArbOneWay(pairAddress, otherPairAddress, now, web3, senderAccount),
                        CheckArbOneWay(otherPairAddress, pairAddress, now, web3, senderAccount)
                    });
                }
            }
            else {
                logger.log(error, {errcode: 1});
            }
        });
    })
    .catch((err) => {
        logger.error(err, {msg: "Something went terribly wrong. Could not get web3 provider: "});
    });