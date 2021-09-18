const Web3 = require('web3');
const fs = require('fs');
const BN = require('bn.js');
const _ = require('lodash');

const dexes = require('./data/dexes.json');
const consts = require('./data/consts.json');
const config = require('./data/config.json');

const factoryABI = require('./data/SushiFactoryABI.json');
const pairABI = require('./data/SushiPairABI.json');
const ERC20ABI = require('./data/ERC20ABI.json');

const web3 = new Web3(config.RPC_URL);


// TODO add support to multiple primary tokens, rn only wmatic is supported

// analyze pair data and decide whether that pair should be used in arbitrage
// return pair data if pair is valid
// otherwise, return nothing
const AnalyzePair = async (index, factoryContract) => {
    try {
        const pairAddress = await factoryContract.methods.allPairs(index).call();
        if (pairAddress) {
            const pairContract = new web3.eth.Contract(pairABI, pairAddress);
            const [token0, token1] = await Promise.all([
                pairContract.methods.token0().call(), 
                pairContract.methods.token1().call(),
            ]);

            // NOTE: prev commit order of tokens in data (token0, token1) is not preserved, and may contain false data in pairs
            // Where token0 isn't WMATIC

            // changed from swapping of reserves to 'token0isPrimary'
            let token0isPrimary;
            if (token0 === consts.WMATIC) {
                token0isPrimary = true;
            }
            else if (token1 === consts.WMATIC) {
                token0isPrimary = false;    
            }
            else {
                return;
            }

            const reserves = await pairContract.methods.getReserves().call();
            const [reserve0, reserve1] = [reserves._reserve0, reserves._reserve1];
            const [minWMATICLiquidity, WMATICDecimals] = [new BN(10000), new BN(18)] 

            let wmaticBalance;
            if (token0isPrimary) {
                wmaticBalance = reserve0;
            }
            else {
                wmaticBalance = reserve1;
            }
            if (wmaticBalance > minWMATICLiquidity.pow(WMATICDecimals)) { // at least 10000 wmatic to be valid

                // TODO add more checks of contracts

                const token0Contract = new web3.eth.Contract(ERC20ABI, token0);
                const token1Contract = new web3.eth.Contract(ERC20ABI, token1);

                const [decimals0, symbol0, decimals1, symbol1] = await Promise.all([
                    token0Contract.methods.decimals().call(),
                    token0Contract.methods.symbol().call(),
                    token1Contract.methods.decimals().call(),
                    token1Contract.methods.symbol().call(),
                ]);

                /* 
                Token data specification:

                id: string that is merge of two addresses of tokens, ordered
                pairAddress: address of pair contract
                pairFactoryAddress: address of pair contract's factory

                token0 and token1:
                    symbol: symbol of token
                    address: address of token contract
                    decimals: decimals of token contract

                */
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
                return;
            }     
        }
        else {
            // handle non-existance of pair address
        }
    } catch (error) {
        console.log(error);
    }
}


// get iterator of type [index, factoryContractObj], apply AnalyzePair and push to results
// return array of AnalyzePair results
const Worker = async (jobsIterator) => {
    let results = [];
    for (const [index, factoryContract] of jobsIterator) {
        const res = await AnalyzePair(index, factoryContract);
        results.push(res);
        // wait 300 to not overwhelm node, remove if this is ran from node's server with IPC
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    return results;
}


// 
const AnalyzeFactory = async (key) => {
    const factoryAddress = dexes[key].factory;
    const factoryContract = new web3.eth.Contract(factoryABI, factoryAddress);
    const allPairsLength = await factoryContract.methods.allPairsLength().call();

    const jobsIterator = Array(Number(allPairsLength)).fill(factoryContract).entries();
    const workers = Array(3).fill(jobsIterator).map(Worker);

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
        const dexKeys = Object.keys(dexes);
        // merge all results from different AnalyzeFactories
        const validPairs = [].concat(...(await Promise.all(dexKeys.map(key => AnalyzeFactory(key)))));
        // groupby token pairs amongst different factories
        let byID = _.groupBy(validPairs, pair => pair.id);
        // remove token pairs that are only found in one factory
        byID = Object.fromEntries(
            Object.entries(byID).filter(([id, tokenDatas]) => tokenDatas.length > 1)
        )

        const byIDAsJson = JSON.stringify(byID, null, 4);
        fs.writeFile('./data/tokens.json', byIDAsJson, 'utf-8', (error) => console.log(error))
        
    } catch (error) {
        console.log(error);
    }
}

Main();
