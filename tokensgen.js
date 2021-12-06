// NOTE: USE THIS SCRIPT ONLY FROM SERVER

const fs = require('fs');
const _ = require('lodash');

const dexes = require('./data/dexes.json');
const consts = require('./data/consts.json');

const factoryABI = require('./data/SushiFactoryABI.json');
const pairABI = require('./data/SushiPairABI.json');
const ERC20ABI = require('./data/ERC20ABI.json');

const { getWeb3 } = require('./web3provider.js');
const primaryTokens = [consts.WMATIC, "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619"];  // wmatic and weth


const doShareItems = (arr1, arr2) => {
    return arr1.some(item => arr2.includes(item));
}


const AnalyzePair = async (index, factoryContract, web3) => {
    try {
        const pairAddress = await factoryContract.methods.allPairs(index).call();
        if (pairAddress) {
            const pairContract = new web3.eth.Contract(pairABI, pairAddress);
            const [token0, token1] = await Promise.all([
                pairContract.methods.token0().call(), 
                pairContract.methods.token1().call(),
            ]);

            // include only pairs with primary tokens 
            if (!doShareItems([token0, token1], primaryTokens)) {
                return;
            }

            const token0Contract = new web3.eth.Contract(ERC20ABI, token0);
            const token1Contract = new web3.eth.Contract(ERC20ABI, token1);

            const [decimals0, symbol0, decimals1, symbol1] = await Promise.all([
                token0Contract.methods.decimals().call(),
                token0Contract.methods.symbol().call(),
                token1Contract.methods.decimals().call(),
                token1Contract.methods.symbol().call(),
            ]);

            return {
                id: [token0, token1].sort().join(''),
                pairAddress: pairAddress,
                pairFactoryAddress: factoryContract.options.address,
                token0: {
                    symbol: symbol0,
                    address: token0,
                    decimals: decimals0,
                },
                token1: {
                    symbol: symbol1,
                    address: token1,
                    decimals: decimals1,
                }
            }   
        }
        else {
            // handle non-existance of pair address
        }
    } catch (error) {
        console.error(error);
    }
}


// get iterator of type [index, factoryContractObj], apply AnalyzePair and push to results
// return array of AnalyzePair results
const Worker = async (jobsIterator, web3) => {
    let results = [];
    for (const [index, factoryContract] of jobsIterator) {
        const res = await AnalyzePair(index, factoryContract, web3);
        results.push(res);
        // wait 300 to not overwhelm node, remove if this is ran from node's server with IPC
        // await new Promise(resolve => setTimeout(resolve, 300));
    }
    return results;
}


const AnalyzeFactory = async (key, web3) => {
    const factoryAddress = dexes[key].factory;
    const factoryContract = new web3.eth.Contract(factoryABI, factoryAddress);
    const allPairsLength = await factoryContract.methods.allPairsLength().call();

    const jobsIterator = Array(Number(allPairsLength)).fill(factoryContract).entries();
    const workers = Array(3).fill(jobsIterator).map((jobIterator) => Worker(jobIterator, web3));

    // take only fulfilled results
    let result = (await Promise.allSettled(workers)).map((workerResults) => {
        if (workerResults.status === 'fulfilled') {
            return workerResults.value;
        }
    });
    // merge all results from different workers
    result = [].concat(...result);
    // remove undefined results
    result = result.filter(elem => elem !== undefined);

    return result;
}


const Main = async () => {
    try {
        const web3 = await getWeb3();
        const dexKeys = Object.keys(dexes);
        // merge all results from different AnalyzeFactories
        const validPairs = [].concat(...(await Promise.all(dexKeys.map(key => AnalyzeFactory(key, web3)))));
        // groupby token pairs amongst different factories
        let byID = _.groupBy(validPairs, pair => pair.id);
        // remove token pairs that are only found in one factory
        byID = Object.fromEntries(
            Object.entries(byID).filter(([id, tokenDatas]) => tokenDatas.length > 1)
        )

        const byIDAsJson = JSON.stringify(byID, null, 4);
        fs.writeFile('./data/tokens.json', byIDAsJson, 'utf-8', (error) => console.error(error));
    } catch (error) {
        console.error(error);
    }
}

Main();