const Web3 = require('web3');
const config = require('./data/config.json');

//*********************************\\
// Gas Price Calculation Prototype \\
//*********************************\\

const web3 = new Web3(config.WSS_RPC);
const INTERVAL = 500;
const MAX_RETRYS = 20;
const MAX_PULLS = 5;

let usedPulls = 0;
let locked = true;

// lock subscription at the beggining for 15 seconds to drain all old pending transactions
setTimeout(() => {
    locked = false
}, 15000);

// whenever recieve pending transaction, if no more than MAX_PULLS transactions 
// are being pulled, start pulling the transaction every INTERVAL 
web3.eth.subscribe('pendingTransactions', (error, tx_hash) => {
    if (locked) { return }
    if (error) {
        console.log("Unexpected error at beggining of event handling");
    }
    const begginingTime = Date.now();
    let endTime;
    let gasPrice;
    
    if (usedPulls >= MAX_PULLS) {
        return;
    }

    new Promise(async (resolveTxGoingThrough, rejectTxGoingThrough) => {
        usedPulls++;
        let tries = 0;
        while (tries < MAX_RETRYS) {
            await new Promise((resolvePull) => {
                setTimeout(() => {
                    web3.eth.getTransaction(tx_hash, (error, tx_data) => {
                        if (!tx_data || error || tx_data.blockNumber === null) {
                            resolvePull();        
                        }
                        else {
                            gasPrice = tx_data.gasPrice;
                            endTime = Date.now();
                            usedPulls--;
                            resolveTxGoingThrough();
                        }
                    });
                }, INTERVAL);
            });
            tries++;
        }
        usedPulls--;
        rejectTxGoingThrough();

    }).then(() => {
        console.log(`${tx_hash} approved in ${(endTime - begginingTime) / 1000} with gas price of ${gasPrice}`);
    }).catch(() => {
        console.log(`${tx_hash} not approved in ${MAX_RETRYS} tries`);
    });
});