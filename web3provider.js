const Web3 = require('web3');
const net = require('net');
const config = require('./data/config.json');

// return wss provider if ipc not available

const IPC_PATH = "/root/.bor/data/bor.ipc";

const getWeb3 = async () => {
    const web3IPC = new Web3(new Web3.providers.IpcProvider(IPC_PATH, net));
    const web3WSS = new Web3(config.WSS_RPC);

    try {
        const status = await web3IPC.eth.net.isListening();
        if (status) {
            console.log("succesfully connected to the IPC provider:");
            return web3IPC;
        }
        else {
            console.log("IPC provider is not listening");
            return web3WSS;
        }
    } 
    catch (err) {
        console.log("error connecting to IPC provider:");
        console.log(err);
        return web3WSS;
    }
}

module.exports = {
    getWeb3
}

/*

Test getWeb3 functionallity

getWeb3().then((web3) => {
    web3.eth.getBlockNumber((err, number) => {
        if (err) {
            console.log(err);
            return;
        }

        console.log(number);
    });
});
*/