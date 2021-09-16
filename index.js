const Web3 = require('web3');
const sushiABI = require('./data/SushiPairABI.json'); 
const config = require("./data/config.json")

// test of contract events in web3js
const web3 = new Web3(config.MORALIS_WSS);
const contract = new web3.eth.Contract(sushiABI, "0xc4e595acdd7d12fec385e5da5d43160e8a0bac0e"); // WMATIC WETH pair
contract.events.Swap(console.log);