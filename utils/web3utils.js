const { logger } = require('../logger.js');

const EmptyTransaction = ({senderAccount, gasPrice, nonce, web3}) => {
    const emptyTx = { nonce, gasPrice };
    web3.eth.estimateGas(emptyTx, (error, gas) => {
        if (error) {
            logger.error(error, { meta: {msg: "utils/web3utils.js: error estimating gas of empty transaction"} });
            return;
        }
        emptyTx.gas = gas;
        web3.eth.accounts.signTransaction(emptyTx, senderAccount.privateKey, (error, signTransaction) => {
            if (error) {
                logger.error(error, { meta: {msg: "utils/web3utils.js: error signing empty transaction"}});
                return;
            }

            const sentEmptyTx = web3.eth.sendSignedTransaction(signTransaction.rawTransaction);
            sentEmptyTx
                .on('transactionHash', (transactionHash) => {
                    logger.info(`utils/web3utils.js: transaction hash: ${transactionHash}`);
                    logtxn({
                        hash: transactionHash,
                        timestart: 0,
                        blockNumber: 0,
                        nonce,
                        call: "",
                        reserve: ""
                    });
                })
                .on('receipt', (transactionReceipt) => {
                    logger.info(transactionReceipt, {meta: {msg: "utils/web3utils.js: empty transaction receipt"}});
                })
                .on('error', (error) => {
                    logger.error(error, {meta: {msg: "utils/web3utils.js: empty txn failed"}});
                });
        });
    });
}

module.exports = {
    EmptyTransaction
}